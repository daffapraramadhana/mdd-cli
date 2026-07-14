import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, effectiveSystemPrompt } from '../src/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('names the assistant and includes the working directory', () => {
    const p = buildSystemPrompt('/tmp/project');
    expect(p).toMatch(/mdd/);
    expect(p).toContain('/tmp/project');
    expect(p.toLowerCase()).toContain('coding assistant');
  });

  it('mentions the web tools', () => {
    const p = buildSystemPrompt('/repo');
    expect(p).toMatch(/web_search|web_fetch/);
  });
});

describe('effectiveSystemPrompt', () => {
  it('returns the base unchanged in normal and auto-edit modes', () => {
    expect(effectiveSystemPrompt('BASE', 'normal')).toBe('BASE');
    expect(effectiveSystemPrompt('BASE', 'auto-edit')).toBe('BASE');
  });

  it('appends a plan-mode addendum in plan mode', () => {
    const out = effectiveSystemPrompt('BASE', 'plan');
    expect(out.startsWith('BASE')).toBe(true);
    expect(out).toMatch(/present_plan/);
    expect(out).toMatch(/plan mode/i);
  });
});
