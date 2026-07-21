import type { PermissionGate } from '../permissions/index.js';
import { runCommand } from '../tools/exec.js';
import { runShellTool } from '../tools/run-shell.js';

export interface PrefillResult { text: string; warnings: string[]; }

export async function runPrefill(
  rendered: { text: string; prefill: string[] },
  opts: { gate: PermissionGate; cwd: string },
): Promise<PrefillResult> {
  let text = rendered.text;
  const warnings: string[] = [];
  for (const command of rendered.prefill) {
    const token = '!`' + command + '`';
    const decision = await opts.gate.check(runShellTool, { command });
    let replacement = '';
    if (decision.allow) {
      const res = await runCommand(command, opts.cwd);
      replacement = res.content.trim();
    } else {
      warnings.push(`⚠ skipped prefill: ${command}`);
    }
    text = text.replace(token, () => replacement);
  }
  return { text, warnings };
}
