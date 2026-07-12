import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editFileTool } from '../../src/tools/edit-file.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('edit_file', () => {
  it('replaces the unique occurrence of old_string', async () => {
    await writeFile(join(dir, 'a.txt'), 'foo bar baz');
    const r = await editFileTool.handler({ path: 'a.txt', old_string: 'bar', new_string: 'QUX' }, { cwd: dir });
    expect(r.isError).toBe(false);
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('foo QUX baz');
  });
  it('errors when old_string is not found', async () => {
    await writeFile(join(dir, 'a.txt'), 'foo');
    const r = await editFileTool.handler({ path: 'a.txt', old_string: 'zzz', new_string: 'x' }, { cwd: dir });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not found/i);
  });
  it('errors when old_string is not unique', async () => {
    await writeFile(join(dir, 'a.txt'), 'x x');
    const r = await editFileTool.handler({ path: 'a.txt', old_string: 'x', new_string: 'y' }, { cwd: dir });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/unique|multiple|more than once/i);
  });
  it('returns an error result (does not throw) on malformed input', async () => {
    const r = await editFileTool.handler({ path: 'a.txt', old_string: 'x' }, { cwd: dir });
    expect(r.isError).toBe(true);
  });
});
