import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({
  path: z.string().describe('File path relative to the working directory'),
  content: z.string().describe('Full contents to write; overwrites any existing file'),
});

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Create or overwrite a file with the given contents.',
  inputSchema: schema,
  mutating: true,
  handler: async (input, ctx) => {
    const { path, content } = schema.parse(input);
    try {
      const abs = resolve(ctx.cwd, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      return { content: `Wrote ${content.length} bytes to ${path}`, isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
