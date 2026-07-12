import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Tool } from './types.js';
import { truncate } from './registry.js';

const schema = z.object({ path: z.string().describe('File path relative to the working directory') });

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a text file.',
  inputSchema: schema,
  mutating: false,
  handler: async (input, ctx) => {
    const { path } = schema.parse(input);
    try {
      const text = await readFile(resolve(ctx.cwd, path), 'utf8');
      return { content: truncate(text), isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
