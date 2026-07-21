import { describe, it, expect } from 'vitest';
import { runPrefill } from '../../src/plugins/prefill.js';
import type { PermissionGate } from '../../src/permissions/index.js';
import { runShellTool } from '../../src/tools/run-shell.js';

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

  it('inserts stdout literally even when it contains $ sequences', async () => {
    const rendered = { text: "v: !`printf %s 'a $$ b'`", prefill: ["printf %s 'a $$ b'"] };
    const r = await runPrefill(rendered, { gate: allowGate, cwd: process.cwd() });
    expect(r.text).toBe('v: a $$ b');
  });

  it('gates each span with runShellTool and { command }, resolving duplicates in order', async () => {
    const seen: { tool: string; command: unknown }[] = [];
    const spyGate = { async check(tool: { name: string }, input: { command: unknown }) { seen.push({ tool: tool.name, command: input.command }); return { allow: true }; } };
    const rendered = { text: '!`echo one` then !`echo one`', prefill: ['echo one', 'echo one'] };
    const r = await runPrefill(rendered, { gate: spyGate as any, cwd: process.cwd() });
    expect(seen).toEqual([{ tool: 'run_shell', command: 'echo one' }, { tool: 'run_shell', command: 'echo one' }]);
    expect(r.text).toBe('one then one');
    expect(runShellTool.name).toBe('run_shell');
  });
});
