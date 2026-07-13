import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { clampIndex, SelectList, type PromptSpec } from '../../src/ui/select.js';

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

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
// ink-testing-library's stdin.write() dispatches through Ink/React's async scheduler: the
// re-render from a state update lands within a tick, but ink's useInput re-subscribes its
// internal listener (with the fresh closure) via a passive effect that settles a couple of
// ticks later. A single tick() can leave the OLD closure (stale `idx`) handling the very next
// write. Settling on a few ticks after each write avoids that race without weakening assertions.
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await tick(); };

describe('SelectList', () => {
  const spec: PromptSpec = {
    title: 'Pick one',
    body: ['some context line'],
    options: [
      { label: 'first', value: 'a' },
      { label: 'type your own', value: 'free', opensInput: true, inputPlaceholder: 'your answer' },
    ],
  };

  it('renders the title, body, options, and a highlighted cursor', () => {
    const { lastFrame } = render(<SelectList spec={spec} onResolve={() => {}} accent="#a855f7" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Pick one');
    expect(frame).toContain('some context line');
    expect(frame).toContain('❯ first'); // first option highlighted by default
    expect(frame).toContain('type your own');
  });

  it('resolves the value of a plain option on Enter', () => {
    const onResolve = vi.fn();
    const { stdin } = render(<SelectList spec={spec} onResolve={onResolve} accent="#a855f7" />);
    stdin.write('\r'); // Enter on the first option
    expect(onResolve).toHaveBeenCalledWith({ value: 'a' });
  });

  it('resolves null on Esc at the option list', async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<SelectList spec={spec} onResolve={onResolve} accent="#a855f7" />);
    stdin.write('\x1B'); // Esc
    await settle();
    expect(onResolve).toHaveBeenCalledWith(null);
  });

  it('enters text mode for an opensInput option and resolves { value, text } on Enter', async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<SelectList spec={spec} onResolve={onResolve} accent="#a855f7" />);
    stdin.write('\x1B[B'); // Down to the "type your own" option
    await settle();
    stdin.write('\r');     // select it -> enters text mode
    await settle();
    stdin.write('hi');     // type
    await settle();
    stdin.write('\r');     // submit
    await settle();
    expect(onResolve).toHaveBeenCalledWith({ value: 'free', text: 'hi' });
  });
});
