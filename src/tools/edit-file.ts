import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({
  path: z.string().describe('File path relative to the working directory'),
  old_string: z.string().describe('Exact text to replace; must appear exactly once'),
  new_string: z.string().describe('Replacement text'),
});

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Replace the unique occurrence of old_string with new_string in a file.',
  inputSchema: schema,
  mutating: true,
  handler: async (input, ctx) => {
    const { path, old_string, new_string } = schema.parse(input);
    try {
      const abs = resolve(ctx.cwd, path);
      const text = await readFile(abs, 'utf8');
      const first = text.indexOf(old_string);
      if (first === -1) return { content: `old_string not found in ${path}`, isError: true };
      if (text.indexOf(old_string, first + old_string.length) !== -1)
        return { content: `old_string is not unique in ${path}; add surrounding context`, isError: true };
      await writeFile(abs, text.slice(0, first) + new_string + text.slice(first + old_string.length), 'utf8');
      return { content: `Edited ${path}`, isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
