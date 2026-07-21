import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolResult } from './types.js';
import { truncate } from './registry.js';

const execAsync = promisify(exec);

export async function runCommand(
  command: string,
  cwd: string,
  opts: { timeoutMs?: number } = {},
): Promise<ToolResult> {
  try {
    // timeout:0 (the default) means no timeout, so untimed callers are unaffected.
    // A timed-out child is force-killed so a process ignoring SIGTERM (e.g. one blocked
    // reading stdin) can't keep the caller hanging.
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 0,
      killSignal: 'SIGKILL',
    });
    return { content: truncate([stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)'), isError: false };
  } catch (err) {
    const e = err as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message: string };
    const body = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    // `killed` is set when the child was terminated by the timeout's killSignal.
    if (e.killed && opts.timeoutMs) {
      return { content: truncate(`command timed out after ${opts.timeoutMs}ms${body ? `\n${body}` : ''}`), isError: true };
    }
    return { content: truncate(`exit code ${e.code ?? 1}\n${body || e.message}`), isError: true };
  }
}
