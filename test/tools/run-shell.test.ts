import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShellTool, isDenied } from '../../src/tools/run-shell.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('run_shell', () => {
  it('captures stdout', async () => {
    const r = await runShellTool.handler({ command: 'echo hello' }, { cwd: dir });
    expect(r.isError).toBe(false);
    expect(r.content).toContain('hello');
  });
  it('returns an error result with a nonzero exit code', async () => {
    const r = await runShellTool.handler({ command: 'exit 3' }, { cwd: dir });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/exit code 3/i);
  });
  it('runs in the provided cwd', async () => {
    const r = await runShellTool.handler({ command: 'pwd' }, { cwd: dir });
    // macOS resolves temp dirs through /private; assert the basename instead.
    expect(r.content).toContain(dir.split('/').pop()!);
  });
  it('returns an error result for malformed input instead of throwing', async () => {
    const r = await runShellTool.handler({}, { cwd: dir });
    expect(r.isError).toBe(true);
  });
});

describe('isDenied', () => {
  it('blocks catastrophic commands', () => {
    expect(isDenied('rm -rf /')).toBe(true);
    expect(isDenied(':(){ :|:& };:')).toBe(true);
    expect(isDenied('ls -la')).toBe(false);
  });
  it('blocks denied commands at the handler level', async () => {
    const r = await runShellTool.handler({ command: 'rm -rf /' }, { cwd: dir });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/blocked/i);
  });
});
