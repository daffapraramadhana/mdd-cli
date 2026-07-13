import { describe, it, expect } from 'vitest';
import { highlight, type HlPalette } from '../../src/ui/highlight.js';

const P: HlPalette = {
  keyword: '#k', string: '#s', comment: '#c', number: '#n', fn: '#f', base: '#b',
};

// The color a given substring was tokenized as (first token whose text === needle).
const colorOf = (code: string, lang: string | null, needle: string): string | undefined =>
  highlight(code, lang, P).find((t) => t.text === needle)?.color;

// Reassembling all token text must reproduce the input exactly — no dropped chars.
const roundTrips = (code: string, lang: string | null): boolean =>
  highlight(code, lang, P).map((t) => t.text).join('') === code;

describe('highlight', () => {
  it('colors ts keywords, strings, comments, numbers', () => {
    const code = 'const x = "hi"; // note\nlet n = 42;';
    expect(colorOf(code, 'ts', 'const')).toBe('#k');
    expect(colorOf(code, 'ts', '"hi"')).toBe('#s');
    expect(colorOf(code, 'ts', '// note')).toBe('#c');
    expect(colorOf(code, 'ts', '42')).toBe('#n');
    expect(roundTrips(code, 'ts')).toBe(true);
  });

  it('colors json literals and strings', () => {
    const code = '{ "on": true, "n": 3 }';
    expect(colorOf(code, 'json', '"on"')).toBe('#s');
    expect(colorOf(code, 'json', 'true')).toBe('#k');
    expect(colorOf(code, 'json', '3')).toBe('#n');
  });

  it('colors shell comments, keywords, and flags', () => {
    const code = 'echo hi # go\nnpm test --watch';
    expect(colorOf(code, 'bash', 'echo')).toBe('#k');
    expect(colorOf(code, 'bash', '# go')).toBe('#c');
    expect(colorOf(code, 'bash', '--watch')).toBe('#n');
  });

  it('colors python keywords and comments', () => {
    const code = 'def f():  # doc\n    return None';
    expect(colorOf(code, 'py', 'def')).toBe('#k');
    expect(colorOf(code, 'py', 'return')).toBe('#k');
    expect(colorOf(code, 'py', '# doc')).toBe('#c');
  });

  it('falls back to a single base token for unknown / null language', () => {
    expect(highlight('whatever ~!@', 'brainfuck', P)).toEqual([{ text: 'whatever ~!@', color: '#b' }]);
    expect(highlight('plain', null, P)).toEqual([{ text: 'plain', color: '#b' }]);
  });

  it('never throws and round-trips on odd input', () => {
    for (const s of ['', '```', '"unterminated', '/* open', '\\\\', '\n\n\n']) {
      expect(() => highlight(s, 'ts', P)).not.toThrow();
      expect(roundTrips(s, 'ts')).toBe(true);
    }
  });
});
