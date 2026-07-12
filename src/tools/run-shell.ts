import { z } from 'zod';
import type { Tool } from './types.js';
import { runCommand } from './exec.js';

const schema = z.object({ command: z.string().describe('Shell command to run via /bin/sh') });

const DENY = [/rm\s+-rf\s+\/(\s|\*|$)/, /:\(\)\s*\{.*\}\s*;/, /\bmkfs\b/, /\bdd\s+if=/];
export function isDenied(command: string): boolean {
  return DENY.some((re) => re.test(command));
}

export const runShellTool: Tool = {
  name: 'run_shell',
  description: 'Run a shell command in the working directory and return its combined output.',
  inputSchema: schema,
  mutating: true,
  handler: async (input, ctx) => {
    try {
      const { command } = schema.parse(input);
      if (isDenied(command)) return { content: `Command blocked by safety denylist: ${command}`, isError: true };
      return await runCommand(command, ctx.cwd);
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
