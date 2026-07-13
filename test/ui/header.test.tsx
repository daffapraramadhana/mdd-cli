import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { render as inkRender, Static } from 'ink';
import { Header } from '../../src/ui/header.js';
import { getTheme } from '../../src/ui/theme.js';

describe('Header', () => {
  it('renders the ASCII MDD logo, subtitle, and command hints', () => {
    const { lastFrame } = render(<Header theme={getTheme('neon')} version="0.1.0" width={100} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('█'); // block-art logo present
    expect(frame).toContain('terminal coding assistant · v0.1.0');
    expect(frame).toContain('Commands');
    expect(frame).toContain('/models');
  });

  // Regression: the banner must span the FULL terminal width. It lives inside <Static>, where
  // `width="100%"` collapses to content width — only an explicit numeric width stretches. This
  // renders through REAL Ink (ink-testing-library masks the Static width behavior).
  it('spans the full terminal width inside <Static> (explicit width, not content-sized)', () => {
    const COLS = 140;
    let buf = '';
    const stdout = {
      columns: COLS, rows: 40, isTTY: true,
      write: (s: string) => { buf += s; return true; },
      on() {}, off() {}, removeListener() {},
    } as unknown as NodeJS.WriteStream;
    const app = inkRender(
      <Static items={[0]}>{() => <Header key="h" theme={getTheme('neon')} version="0.2.0" width={COLS} />}</Static>,
      { stdout, patchConsole: false },
    );
    app.unmount();
    const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
    const topBorder = strip(buf).split('\n').find((l) => l.includes('╭')) ?? '';
    expect(topBorder.length).toBe(COLS); // full width, not the ~content width the bug produced
  });
});
