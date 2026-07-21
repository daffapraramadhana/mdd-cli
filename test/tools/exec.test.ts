import { describe, it, expect } from 'vitest';
import { runCommand } from '../../src/tools/exec.js';

describe('runCommand', () => {
  it('returns command output on success', async () => {
    const r = await runCommand('printf hello', process.cwd());
    expect(r.isError).toBe(false);
    expect(r.content).toBe('hello');
  });

  it('reports a non-zero exit as an error', async () => {
    const r = await runCommand('exit 3', process.cwd());
    expect(r.isError).toBe(true);
    expect(r.content).toContain('exit code 3');
  });

  it('kills and reports a command that exceeds the timeout', async () => {
    const start = Date.now();
    const r = await runCommand('sleep 5', process.cwd(), { timeoutMs: 150 });
    const elapsed = Date.now() - start;
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/timed out/);
    // It must not have waited the full 5s — the timeout killed it early.
    expect(elapsed).toBeLessThan(2000);
  });
});
