import { describe, it, expect } from 'vitest';
import { runPrefill } from '../../src/plugins/prefill.js';
import type { PermissionGate } from '../../src/permissions/index.js';

const allowGate: PermissionGate = { async check() { return { allow: true }; } };
const denyGate: PermissionGate = { async check() { return { allow: false, reason: 'no' }; } };

describe('runPrefill', () => {
  it('replaces an allowed span with command stdout', async () => {
    const rendered = { text: 'out: !`echo hello`', prefill: ['echo hello'] };
    const r = await runPrefill(rendered, { gate: allowGate, cwd: process.cwd() });
    expect(r.text).toBe('out: hello');
    expect(r.warnings).toEqual([]);
  });

  it('drops a denied span and records a warning', async () => {
    const rendered = { text: 'x !`echo hi` y', prefill: ['echo hi'] };
    const r = await runPrefill(rendered, { gate: denyGate, cwd: process.cwd() });
    expect(r.text).toBe('x  y');
    expect(r.warnings[0]).toContain('echo hi');
  });

  it('returns text unchanged when there are no spans', async () => {
    const r = await runPrefill({ text: 'plain', prefill: [] }, { gate: denyGate, cwd: process.cwd() });
    expect(r.text).toBe('plain');
  });
});
