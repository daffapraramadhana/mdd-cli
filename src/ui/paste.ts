// Pure paste-collapsing logic for the prompt. No React/Ink imports so it is fully unit-testable.
// A long paste is replaced inline with a `[Pasted text #n …]` token; the full text is kept in a
// map and re-expanded on submit so the model always receives it.

export const PASTE_MIN_LINES = 4;
export const PASTE_MIN_CHARS = 400;
export const PASTE_COALESCE_MS = 25;

export interface PasteState { map: Map<number, string>; count: number; lastNum: number; lastAt: number; }
export interface DetectedPaste { inserted: string; at: number; }

export function createPasteState(): PasteState {
  return { map: new Map(), count: 0, lastNum: 0, lastAt: 0 };
}

/** The inserted chunk for a pure insertion (common prefix + common suffix), else null. */
export function detectPaste(prev: string, next: string): DetectedPaste | null {
  if (next.length <= prev.length) return null;
  let p = 0;
  while (p < prev.length && prev[p] === next[p]) p++;
  let s = 0;
  while (s < prev.length - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  if (p + s !== prev.length) return null; // middle of prev differs → replacement, not a pure insert
  return { inserted: next.slice(p, next.length - s), at: p };
}

export function isLongPaste(chunk: string): boolean {
  const lineCount = chunk.split('\n').length;
  return lineCount >= PASTE_MIN_LINES || chunk.length >= PASTE_MIN_CHARS;
}

export function pasteLabel(n: number, chunk: string): string {
  const lineCount = chunk.split('\n').length;
  if (lineCount > 1) return `[Pasted text #${n} +${lineCount} lines]`;
  return `[Pasted text #${n} +${chunk.length} chars]`;
}

function tokenRegex(n: number, flags = ''): RegExp {
  return new RegExp(`\\[Pasted text #${n} [^\\]]*\\]`, flags);
}

export function expandPastes(display: string, map: Map<number, string>): string {
  return display.replace(/\[Pasted text #(\d+) [^\]]*\]/g, (m, num) => {
    const full = map.get(Number(num));
    return full !== undefined ? full : m;
  });
}

/** Reduce an input change into a (possibly collapsed) value + updated paste state. */
export function applyChange(
  prev: string, next: string, state: PasteState, now: number,
): { value: string; state: PasteState } {
  const d = detectPaste(prev, next);
  if (!d || !isLongPaste(d.inserted)) return { value: next, state };

  // Coalesce with the previous paste if it is recent and its token is still in the value.
  if (state.lastNum > 0 && now - state.lastAt <= PASTE_COALESCE_MS && tokenRegex(state.lastNum).test(prev)) {
    const combined = (state.map.get(state.lastNum) ?? '') + '\n' + d.inserted;
    const map = new Map(state.map);
    map.set(state.lastNum, combined);
    const value = prev.replace(tokenRegex(state.lastNum), pasteLabel(state.lastNum, combined));
    return { value, state: { ...state, map, lastAt: now } };
  }

  const n = state.count + 1;
  const map = new Map(state.map);
  map.set(n, d.inserted);
  const value = next.slice(0, d.at) + pasteLabel(n, d.inserted) + next.slice(d.at + d.inserted.length);
  return { value, state: { map, count: n, lastNum: n, lastAt: now } };
}
