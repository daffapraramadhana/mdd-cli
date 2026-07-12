import { describe, it, expect, vi } from 'vitest';
import { createGate } from '../../src/permissions/index.js';
import type { Tool } from '../../src/tools/types.js';

const roTool = { name: 'read_file', mutating: false } as Tool;
const rwTool = { name: 'write_file', mutating: true } as Tool;

describe('permission gate', () => {
  it('allows non-mutating tools without prompting', async () => {
    const prompt = vi.fn();
    const gate = createGate({ prompt });
    expect(await gate.check(roTool, {})).toBe('allow');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prompts for mutating tools and denies on "n"', async () => {
    const gate = createGate({ prompt: async () => 'n' });
    expect(await gate.check(rwTool, {})).toBe('deny');
  });

  it('allows once on "y" and prompts again next time', async () => {
    const prompt = vi.fn(async () => 'y');
    const gate = createGate({ prompt });
    expect(await gate.check(rwTool, {})).toBe('allow');
    expect(await gate.check(rwTool, {})).toBe('allow');
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('remembers the tool on "a" and stops prompting', async () => {
    const prompt = vi.fn(async () => 'a');
    const gate = createGate({ prompt });
    expect(await gate.check(rwTool, {})).toBe('allow');
    expect(await gate.check(rwTool, {})).toBe('allow');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('auto-approves when autoApprove is set', async () => {
    const prompt = vi.fn();
    const gate = createGate({ prompt, autoApprove: true });
    expect(await gate.check(rwTool, {})).toBe('allow');
    expect(prompt).not.toHaveBeenCalled();
  });
});
