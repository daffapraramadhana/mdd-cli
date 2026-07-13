// src/tools/search.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Tool } from './types.js';
import { truncate } from './registry.js';

const execFileAsync = promisify(execFile);

const schema = z.object({
  pattern: z.string().describe('Text or extended-regex pattern to search for'),
  path: z.string().default('.').describe('Directory to search, relative to the working directory'),
});

// execFile (args array, no shell) avoids injection from a model-supplied pattern.
export const searchTool: Tool = {
  name: 'search',
  description: 'Search files recursively for a pattern (grep -E). Skips node_modules, .git, and dist. Read-only.',
  inputSchema: schema,
  mutating: false,
  handler: async (input, ctx) => {
    try {
      const { pattern, path } = schema.parse(input);
      const args = ['-rInE', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--', pattern, path];
      try {
        const { stdout } = await execFileAsync('grep', args, { cwd: ctx.cwd, maxBuffer: 10 * 1024 * 1024 });
        return { content: truncate(stdout.trim() || '(no matches)'), isError: false };
      } catch (err) {
        const e = err as { code?: number; message: string };
        if (e.code === 1) return { content: '(no matches)', isError: false }; // grep exit 1 = no matches
        return { content: e.message, isError: true };
      }
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
