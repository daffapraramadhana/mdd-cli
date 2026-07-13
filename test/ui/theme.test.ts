import { describe, it, expect } from 'vitest';
import { getTheme, THEME_NAMES, hexToRgb, gradientColors, gradientText } from '../../src/ui/theme.js';
import { spinnerFrame, thinkingDots, cursorFrame, SPINNER_FRAMES } from '../../src/ui/spinner.js';

describe('themes', () => {
  it('defaults to neon for unknown names', () => {
    expect(getTheme(undefined).name).toBe('neon');
    expect(getTheme('nope').name).toBe('neon');
  });
  it('resolves known themes', () => {
    for (const n of THEME_NAMES) expect(getTheme(n).name).toBe(n);
    expect(getTheme('ocean').assistant).toBe('#22d3ee');
  });
});

describe('gradient', () => {
  it('parses hex to rgb', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
  });
  it('interpolates endpoints exactly and blends the middle', () => {
    const cols = gradientColors(3, ['#000000', '#ffffff']);
    expect(cols[0]).toEqual([0, 0, 0]);
    expect(cols[2]).toEqual([255, 255, 255]);
    expect(cols[1]).toEqual([128, 128, 128]);
  });
  it('wraps each line in a 24-bit color escape', () => {
    const out = gradientText('a\nb', ['#000000', '#ffffff']);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('\x1b[38;2;0;0;0m');
    expect(lines[0]).toContain('a');
  });
});

describe('spinner frames', () => {
  it('cycles spinner frames by tick', () => {
    expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0]);
    expect(spinnerFrame(SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
    expect(spinnerFrame(1)).toBe(SPINNER_FRAMES[1]);
  });
  it('cycles thinking dots 0..3', () => {
    expect(thinkingDots(0)).toBe('');
    expect(thinkingDots(3)).toBe('...');
    expect(thinkingDots(4)).toBe('');
  });
  it('blinks the cursor on even ticks', () => {
    expect(cursorFrame(0)).toBe('▌');
    expect(cursorFrame(1)).toBe(' ');
  });
});
