import { describe, it, expect } from 'vitest';
import { createGate } from '../src/permissions/index.js';
import type { Tool } from '../src/tools/types.js';
import { z } from 'zod';
import type { ChoiceResult } from '../src/ui/select.js';
import { EDIT_TOOLS } from '../src/modes.js';

const tool = (over: Partial<Tool> = {}): Tool => ({
  name: 'git', description: '', inputSchema: z.object({}), mutating: true,
  handler: async () => ({ content: '', isError: false }), ...over,
});

describe('createGate', () => {
  it('auto-approves non-mutating tools without confirming', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; } });
    const d = await gate.check(tool({ mutating: false }), {});
    expect(d).toEqual({ allow: true });
    expect(asked).toBe(0);
  });

  it('shows a human-readable action and allows on yes', async () => {
    let seen = '';
    const gate = createGate({ confirm: async (spec) => { seen = (spec.body ?? []).join(' '); return { value: 'yes' }; } });
    const d = await gate.check(tool(), { args: 'log --oneline -15' });
    expect(seen).toContain('git log --oneline -15'); // full form on the consent card, not raw JSON
    expect(d).toEqual({ allow: true });
  });

  it('shows the FULL untruncated run_shell command on the confirmation card', async () => {
    let seen = '';
    const gate = createGate({ confirm: async (spec) => { seen = (spec.body ?? []).join(' '); return { value: 'yes' }; } });
    const longCommand = 'find . -type f -name "*.test.ts" -exec grep -l "describe(" {} \\; | sort | uniq -c';
    expect(longCommand.length).toBeGreaterThan(60);
    const d = await gate.check(tool({ name: 'run_shell' }), { command: longCommand });
    expect(seen).toContain(longCommand); // full command present, not sliced
    expect(seen).not.toContain('…'); // never truncated on the consent surface
    expect(d).toEqual({ allow: true });
  });

  it('denies with the typed reason on no', async () => {
    const gate = createGate({ confirm: async (): Promise<ChoiceResult> => ({ value: 'no', text: 'use --stat instead' }) });
    const d = await gate.check(tool(), {});
    expect(d).toEqual({ allow: false, reason: 'use --stat instead' });
  });

  it('remembers "always" per tool and stops confirming it', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'always' }; } });
    expect(await gate.check(tool(), {})).toEqual({ allow: true });
    expect(await gate.check(tool(), {})).toEqual({ allow: true });
    expect(asked).toBe(1); // second call skipped by the always-set
  });

  it('treats Esc-cancel (null) as deny with no reason', async () => {
    const gate = createGate({ confirm: async () => null });
    expect(await gate.check(tool(), {})).toEqual({ allow: false });
  });

  it('auto-approves a mutating tool without confirming when autoApprove is set', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; }, autoApprove: true });
    const d = await gate.check(tool(), {}); // tool() is mutating by default in this file
    expect(d).toEqual({ allow: true });
    expect(asked).toBe(0); // confirm never called
  });

  it('does not remember a plain "yes" — re-confirms on the next call', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; } });
    expect(await gate.check(tool(), {})).toEqual({ allow: true });
    expect(await gate.check(tool(), {})).toEqual({ allow: true });
    expect(asked).toBe(2); // asked both times — not cached like 'always'
  });
});

describe('createGate — modes', () => {
  it('plan mode denies every mutating tool without confirming', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; }, getMode: () => 'plan' });
    const d = await gate.check(tool({ name: 'write_file' }), {});
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/plan mode/i);
    expect(asked).toBe(0);
  });

  it('plan mode still allows non-mutating tools (e.g. present_plan)', async () => {
    const gate = createGate({ confirm: async () => ({ value: 'yes' }), getMode: () => 'plan' });
    expect(await gate.check(tool({ name: 'present_plan', mutating: false }), {})).toEqual({ allow: true });
  });

  it('auto-edit mode auto-approves file edits but confirms shell/git', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; }, getMode: () => 'auto-edit' });
    for (const name of EDIT_TOOLS) {
      expect(await gate.check(tool({ name }), {})).toEqual({ allow: true });
    }
    expect(asked).toBe(0);
    expect(await gate.check(tool({ name: 'run_shell' }), { command: 'ls' })).toEqual({ allow: true });
    expect(await gate.check(tool({ name: 'git' }), { args: 'status' })).toEqual({ allow: true });
    expect(asked).toBe(2); // shell + git each confirmed once
  });

  it('normal mode confirms mutating tools (unchanged behavior)', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; }, getMode: () => 'normal' });
    expect(await gate.check(tool({ name: 'edit_file' }), {})).toEqual({ allow: true });
    expect(asked).toBe(1);
  });

  it('plan mode takes precedence over --yes autoApprove', async () => {
    const gate = createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true, getMode: () => 'plan' });
    const d = await gate.check(tool({ name: 'run_shell' }), { command: 'rm -rf x' });
    expect(d.allow).toBe(false);
  });
});
