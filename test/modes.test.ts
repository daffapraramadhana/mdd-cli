import { describe, it, expect } from 'vitest';
import { nextMode, modeLabel, EDIT_TOOLS, type Mode } from '../src/modes.js';

describe('nextMode', () => {
  it('rotates normal → auto-edit → plan → normal', () => {
    expect(nextMode('normal')).toBe('auto-edit');
    expect(nextMode('auto-edit')).toBe('plan');
    expect(nextMode('plan')).toBe('normal');
  });

  it('returns to the start after three cycles', () => {
    let m: Mode = 'normal';
    for (let i = 0; i < 3; i++) m = nextMode(m);
    expect(m).toBe('normal');
  });
});

describe('modeLabel', () => {
  it('gives human-readable labels', () => {
    expect(modeLabel('normal')).toBe('normal');
    expect(modeLabel('auto-edit')).toBe('auto-accept edits');
    expect(modeLabel('plan')).toBe('plan');
  });
});

describe('EDIT_TOOLS', () => {
  it('contains exactly the three file-edit tools', () => {
    expect([...EDIT_TOOLS].sort()).toEqual(['edit_file', 'multi_edit', 'write_file']);
  });
});
