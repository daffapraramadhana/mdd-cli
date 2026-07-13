import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchTool } from '../../src/tools/search.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('search', () => {
  it('finds matching lines with file:line', async () => {
    await writeFile(join(dir, 'a.ts'), 'const foo = 1;\nconst bar = 2;');
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'b.ts'), 'export const foo = 3;');
    const r = await searchTool.handler({ pattern: 'foo' }, { cwd: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/a\.ts:1/);
    expect(r.content).toMatch(/sub\/b\.ts:1/);
    expect(r.content).not.toContain('bar');
  });

  it('returns (no matches) instead of an error when nothing matches', async () => {
    await writeFile(join(dir, 'a.ts'), 'hello');
    const r = await searchTool.handler({ pattern: 'zzzznope' }, { cwd: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toBe('(no matches)');
  });

  it('is read-only', () => {
    expect(searchTool.mutating).toBe(false);
  });
});
