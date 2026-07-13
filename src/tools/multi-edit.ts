// src/tools/multi-edit.ts
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({
  path: z.string().describe('File path relative to the working directory'),
  edits: z
    .array(z.object({ old_string: z.string(), new_string: z.string() }))
    .min(1)
    .describe('Edits applied in order; each old_string must be unique in the file at the time it is applied'),
});

export const multiEditTool: Tool = {
  name: 'multi_edit',
  description: 'Apply several find-and-replace edits to one file, in order and atomically (nothing is written if any edit fails).',
  inputSchema: schema,
  mutating: true,
  handler: async (input, ctx) => {
    try {
      const { path, edits } = schema.parse(input);
      const abs = resolve(ctx.cwd, path);
      let text = await readFile(abs, 'utf8');
      for (const [i, e] of edits.entries()) {
        const first = text.indexOf(e.old_string);
        if (first === -1) return { content: `edit ${i + 1}: old_string not found in ${path}`, isError: true };
        if (text.indexOf(e.old_string, first + e.old_string.length) !== -1)
          return { content: `edit ${i + 1}: old_string is not unique in ${path}; add surrounding context`, isError: true };
        text = text.slice(0, first) + e.new_string + text.slice(first + e.old_string.length);
      }
      await writeFile(abs, text, 'utf8');
      return { content: `Applied ${edits.length} edit(s) to ${path}`, isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
