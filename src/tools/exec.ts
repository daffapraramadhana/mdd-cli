import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolResult } from './types.js';
import { truncate } from './registry.js';

const execAsync = promisify(exec);

export async function runCommand(command: string, cwd: string): Promise<ToolResult> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return { content: truncate([stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)'), isError: false };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message: string };
    const body = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    return { content: truncate(`exit code ${e.code ?? 1}\n${body || e.message}`), isError: true };
  }
}
