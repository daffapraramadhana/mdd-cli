import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitTool } from '../../src/tools/git.js';

const execAsync = promisify(exec);
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); await execAsync('git init', { cwd: dir }); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('git', () => {
  it('runs git subcommands in the cwd', async () => {
    const r = await gitTool.handler({ args: 'status --short' }, { cwd: dir });
    expect(r.isError).toBe(false);
  });

  it('returns an error result for malformed input instead of throwing', async () => {
    const r = await gitTool.handler({}, { cwd: dir });
    expect(r.isError).toBe(true);
  });
});
