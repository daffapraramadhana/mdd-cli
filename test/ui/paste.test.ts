import { describe, it, expect } from 'vitest';
import {
  detectPaste, isLongPaste, pasteLabel, expandPastes, createPasteState, applyChange,
  PASTE_COALESCE_MS,
} from '../../src/ui/paste.js';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

describe('detectPaste', () => {
  it('detects an insertion at the start, middle, and end', () => {
    expect(detectPaste('', 'abc')).toEqual({ inserted: 'abc', at: 0 });
    expect(detectPaste('ac', 'aXXc')).toEqual({ inserted: 'XX', at: 1 });
    expect(detectPaste('ab', 'abZ')).toEqual({ inserted: 'Z', at: 2 });
  });
  it('returns null for deletions and replacements', () => {
    expect(detectPaste('abc', 'ab')).toBeNull();      // shorter
    expect(detectPaste('abc', 'aXc')).toBeNull();      // same length replace
    expect(detectPaste('abc', 'aXXXc')).toBeNull();    // b replaced by XXX (not a pure insert)
  });
});

describe('isLongPaste', () => {
  it('is true at >= 4 lines or >= 400 chars, false below', () => {
    expect(isLongPaste(lines(3))).toBe(false);
    expect(isLongPaste(lines(4))).toBe(true);
    expect(isLongPaste('x'.repeat(399))).toBe(false);
    expect(isLongPaste('x'.repeat(400))).toBe(true);
  });
});

describe('pasteLabel', () => {
  it('uses lines for multi-line and chars for a long single line', () => {
    expect(pasteLabel(1, lines(42))).toBe('[Pasted text #1 +42 lines]');
    expect(pasteLabel(2, 'x'.repeat(812))).toBe('[Pasted text #2 +812 chars]');
  });
});

describe('expandPastes', () => {
  it('replaces known tokens and leaves unknown ones untouched', () => {
    const map = new Map<number, string>([[1, 'FULL-ONE'], [2, 'FULL-TWO']]);
    expect(expandPastes('a [Pasted text #1 +5 lines] b', map)).toBe('a FULL-ONE b');
    expect(expandPastes('[Pasted text #1 +1 lines][Pasted text #2 +1 lines]', map)).toBe('FULL-ONEFULL-TWO');
    expect(expandPastes('[Pasted text #9 +1 lines]', map)).toBe('[Pasted text #9 +1 lines]');
  });
});

describe('applyChange', () => {
  it('passes short inserts through unchanged', () => {
    const s = createPasteState();
    const r = applyChange('', 'hello', s, 1000);
    expect(r.value).toBe('hello');
    expect(r.state.count).toBe(0);
  });
  it('collapses a long paste to a chip and stores the full text', () => {
    const blob = lines(50);
    const r = applyChange('', blob, createPasteState(), 1000);
    expect(r.value).toBe('[Pasted text #1 +50 lines]');
    expect(r.state.map.get(1)).toBe(blob);
    expect(r.state.count).toBe(1);
  });
  it('numbers a second, non-coalesced paste as #2', () => {
    const a = applyChange('', lines(10), createPasteState(), 1000);
    const b = applyChange(a.value, a.value + lines(10), a.state, 1000 + PASTE_COALESCE_MS + 10);
    expect(b.value).toBe('[Pasted text #1 +10 lines][Pasted text #2 +10 lines]');
    expect(b.state.map.get(2)).toBe(lines(10));
    expect(b.state.count).toBe(2);
  });
  it('coalesces a second long insert within the window into #1', () => {
    const a = applyChange('', lines(10), createPasteState(), 1000);
    const b = applyChange(a.value, a.value + lines(10), a.state, 1000 + 5);
    expect(b.value).toBe('[Pasted text #1 +19 lines]');
    expect(b.state.map.get(1)).toBe(lines(10) + lines(10));
    expect(b.state.count).toBe(1);
  });
});
