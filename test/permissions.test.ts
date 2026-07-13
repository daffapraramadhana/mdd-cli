import { describe, it, expect } from 'vitest';
import { createGate } from '../src/permissions/index.js';
import type { Tool } from '../src/tools/types.js';
import { z } from 'zod';
import type { ChoiceResult } from '../src/ui/select.js';

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
    expect(seen).toContain('git(log --oneline -15)'); // via formatToolCall, not raw JSON
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
});
