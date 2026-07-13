import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from '../../src/ui/header.js';
import { getTheme } from '../../src/ui/theme.js';

describe('Header', () => {
  it('renders the ASCII MDD logo, model info, and command hints', () => {
    const { lastFrame } = render(
      <Header
        meta={{ provider: 'openai', model: 'cc/claude-sonnet-5', cwd: '~/proj', branch: 'main' }}
        theme={getTheme('neon')}
        version="0.1.0"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('█'); // block-art logo present
    expect(frame).toContain('terminal coding assistant · v0.1.0');
    expect(frame).toContain('openai');
    expect(frame).toContain('cc/claude-sonnet-5');
    expect(frame).toContain('~/proj (main)');
    expect(frame).toContain('Commands');
  });
});
