import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { multiEditTool } from '../../src/tools/multi-edit.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('multi_edit', () => {
  it('applies several edits in order', async () => {
    await writeFile(join(dir, 'a.ts'), 'let a = 1;\nlet b = 2;');
    const r = await multiEditTool.handler(
      { path: 'a.ts', edits: [{ old_string: 'a = 1', new_string: 'a = 10' }, { old_string: 'b = 2', new_string: 'b = 20' }] },
      { cwd: dir },
    );
    expect(r.isError).toBe(false);
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('let a = 10;\nlet b = 20;');
  });

  it('is atomic — a failing edit writes nothing', async () => {
    await writeFile(join(dir, 'a.ts'), 'x = 1');
    const before = await readFile(join(dir, 'a.ts'), 'utf8');
    const r = await multiEditTool.handler(
      { path: 'a.ts', edits: [{ old_string: 'x = 1', new_string: 'x = 2' }, { old_string: 'NOPE', new_string: 'y' }] },
      { cwd: dir },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/edit 2/);
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe(before); // unchanged
  });

  it('errors on a non-unique old_string', async () => {
    await writeFile(join(dir, 'a.ts'), 'x x');
    const r = await multiEditTool.handler({ path: 'a.ts', edits: [{ old_string: 'x', new_string: 'y' }] }, { cwd: dir });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not unique/);
  });
});
