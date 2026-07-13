import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from '../../src/ui/header.js';
import { getTheme } from '../../src/ui/theme.js';

describe('Header', () => {
  it('renders the ASCII MDD logo, subtitle, and command hints', () => {
    const { lastFrame } = render(<Header theme={getTheme('neon')} version="0.1.0" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('█'); // block-art logo present
    expect(frame).toContain('terminal coding assistant · v0.1.0');
    expect(frame).toContain('Commands');
    expect(frame).toContain('/models');
  });
});
