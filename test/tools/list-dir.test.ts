import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDirTool } from '../../src/tools/list-dir.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('list_dir', () => {
  it('lists files and marks directories with a trailing slash', async () => {
    await writeFile(join(dir, 'file.txt'), '');
    await mkdir(join(dir, 'sub'));
    const r = await listDirTool.handler({ path: '.' }, { cwd: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toContain('file.txt');
    expect(r.content).toContain('sub/');
  });
});
