import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Tool } from './types.js';
import { truncate } from './registry.js';

const schema = z.object({ path: z.string().default('.').describe('Directory path relative to the working directory') });

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List the entries of a directory. Directories are shown with a trailing slash.',
  inputSchema: schema,
  mutating: false,
  handler: async (input, ctx) => {
    try {
      const { path } = schema.parse(input);
      const entries = await readdir(resolve(ctx.cwd, path), { withFileTypes: true });
      const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return { content: truncate(lines.join('\n') || '(empty)'), isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
