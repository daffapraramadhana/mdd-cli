import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileTool } from '../../src/tools/write-file.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('write_file', () => {
  it('creates a file, including parent directories', async () => {
    const r = await writeFileTool.handler({ path: 'nested/a.txt', content: 'hi' }, { cwd: dir });
    expect(r.isError).toBe(false);
    expect(await readFile(join(dir, 'nested/a.txt'), 'utf8')).toBe('hi');
  });
  it('is marked as mutating', () => {
    expect(writeFileTool.mutating).toBe(true);
  });
  it('returns an error result (does not throw) on malformed input', async () => {
    const r = await writeFileTool.handler({ path: 'a.txt' }, { cwd: dir });
    expect(r.isError).toBe(true);
  });
});
