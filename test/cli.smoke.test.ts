// test/cli.smoke.test.ts
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const run = process.env.MDD_E2E === '1' ? describe : describe.skip;

run('cli smoke (real API)', () => {
  it('answers a one-shot prompt about the current directory', async () => {
    const { stdout } = await execFileAsync('node', ['dist/cli.js', '--yes', 'list the files here and tell me how many there are'], {
      cwd: process.cwd(), timeout: 60_000,
    });
    expect(stdout.length).toBeGreaterThan(0);
  });
});
