import { describe, it, expect } from 'vitest';
import { sanitizeInput } from '../../src/ui/scroll.js';

describe('sanitizeInput', () => {
  it('strips SGR mouse sequences with the ESC present', () => {
    expect(sanitizeInput('ab\x1b[<64;10;5Mcd')).toBe('abcd');
    expect(sanitizeInput('\x1b[<65;1;1m')).toBe('');
  });
  it('strips ESC-less mouse remnants (some terminals drop the ESC before the input sees them)', () => {
    expect(sanitizeInput('[<65;54;39M[<64;54;39M[<65;54;39M')).toBe('');
    expect(sanitizeInput('hi[<64;10;5Mthere')).toBe('hithere');
  });
  it('keeps legitimate bracket / array text', () => {
    expect(sanitizeInput('arr[0] and map[a; b] = c')).toBe('arr[0] and map[a; b] = c');
    expect(sanitizeInput('if (x < 3) [go]')).toBe('if (x < 3) [go]');
  });
  it('strips stray escape/control sequences but keeps normal text (incl. tab)', () => {
    expect(sanitizeInput('hi\x1b[Hthere')).toBe('hithere');
    expect(sanitizeInput('a\x00b\x1fc')).toBe('abc');
    expect(sanitizeInput('normal text 123 !@#')).toBe('normal text 123 !@#');
  });
});
