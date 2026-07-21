import type { PermissionGate } from '../permissions/index.js';
import { runCommand } from '../tools/exec.js';
import { runShellTool, isDenied } from '../tools/run-shell.js';

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
    if (!decision.allow) {
      warnings.push(`⚠ skipped prefill: ${command}`);
    } else if (isDenied(command)) {
      warnings.push(`⚠ blocked by safety denylist: ${command}`);
    } else {
      const res = await runCommand(command, opts.cwd);
      replacement = res.content.trim();
    }
    text = text.replace(token, () => replacement);
  }
  return { text, warnings };
}
