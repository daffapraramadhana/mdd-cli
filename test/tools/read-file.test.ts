import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTool } from '../../src/tools/read-file.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('read_file', () => {
  it('returns the file contents', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const r = await readFileTool.handler({ path: 'a.txt' }, { cwd: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toBe('hello');
  });
  it('returns an error result for a missing file', async () => {
    const r = await readFileTool.handler({ path: 'nope.txt' }, { cwd: dir });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/ENOENT|not found|no such file/i);
  });
});
