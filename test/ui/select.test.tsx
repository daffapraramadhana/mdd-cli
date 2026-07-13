import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { clampIndex, SelectList } from '../../src/ui/select.js';

describe('clampIndex', () => {
  it('wraps around both ends', () => {
    expect(clampIndex(-1, 3)).toBe(2);
    expect(clampIndex(3, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
  });
  it('is safe for an empty list', () => {
    expect(clampIndex(0, 0)).toBe(0);
  });
});

describe('SelectList', () => {
  it('renders the title, options with a highlighted cursor, and hints', () => {
    const { lastFrame } = render(
      <SelectList title="Select a model" options={['gpt-5', 'cc/claude-opus-4-8']} onSelect={() => {}} onCancel={() => {}} accent="#a855f7" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Select a model');
    expect(frame).toContain('gpt-5');
    expect(frame).toContain('cc/claude-opus-4-8');
    expect(frame).toContain('❯ gpt-5'); // first option highlighted by default
    expect(frame).toContain('enter select');
  });
});
