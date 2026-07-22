import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { CommandMenu } from '../../src/ui/command-menu.js';
import { getTheme } from '../../src/ui/theme.js';

const theme = getTheme('neon');
const cmd = (name: string) => ({ name, description: `${name} desc` });

describe('CommandMenu', () => {
  it('renders nothing for an empty list', () => {
    const { lastFrame } = render(<CommandMenu commands={[]} highlight={0} theme={theme} />);
    expect(lastFrame()).toBe('');
  });

  it('lists commands and marks the highlighted row', () => {
    const { lastFrame } = render(<CommandMenu commands={[cmd('model'), cmd('plugin')]} highlight={1} theme={theme} />);
    const frame = lastFrame()!;
    expect(frame).toContain('/model');
    expect(frame).toContain('/plugin');
    expect(frame).toContain('❯ /plugin');
  });

  it('caps rows and shows a +N more line', () => {
    const many = Array.from({ length: 10 }, (_, i) => cmd(`c${i}`));
    const { lastFrame } = render(<CommandMenu commands={many} highlight={0} theme={theme} max={8} />);
    expect(lastFrame()).toContain('+3 more'); // shows 7 rows, then +3 more (10 - 7)
  });
});
