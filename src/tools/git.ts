import { z } from 'zod';
import type { Tool } from './types.js';
import { runCommand } from './exec.js';

const schema = z.object({ args: z.string().describe('Arguments passed to git, e.g. "status --short" or "log -n 5"') });

export const gitTool: Tool = {
  name: 'git',
  description: 'Run a git command in the working directory.',
  inputSchema: schema,
  mutating: true,
  handler: async (input, ctx) => {
    try {
      const { args } = schema.parse(input);
      return await runCommand(`git ${args}`, ctx.cwd);
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
