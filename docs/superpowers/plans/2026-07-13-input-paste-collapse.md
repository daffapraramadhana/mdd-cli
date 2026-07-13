# Long-Paste Collapsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the spec first: `docs/superpowers/specs/2026-07-13-input-paste-collapse-design.md`.

**Goal:** Collapse a long paste in the prompt into an inline `[Pasted text #1 +42 lines]` chip (in the input and the transcript) while sending the full text to the model — like Claude Code.

**Architecture:** A new pure `src/ui/paste.ts` reducer detects pastes by diffing the input value and manages a paste map; `app.tsx` calls it from the input's `onChange`, expands on submit, and passes `{ display, text }` upward; `cli.ts` uses `display` for the transcript and `text` for the model message.

**Tech Stack:** TypeScript ESM, React 19 + Ink 6 (`ink-text-input`), vitest + `ink-testing-library`. No new dependencies.

## Global Constraints

- No new runtime dependencies.
- `src/ui/paste.ts` must not import React/Ink (pure, unit-testable).
- `Date.now()` is fine here (Node runtime, not a workflow script).
- Collapsed chip shows in the input AND the transcript; the model always receives the fully expanded text.
- Never change `SessionRecord` — persistence works for free (transcript saves `display`, `messages` saves `text`).

---

### Task 1: `src/ui/paste.ts` pure module

**Files:**
- Create: `src/ui/paste.ts`
- Test: `test/ui/paste.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PASTE_MIN_LINES = 4`, `PASTE_MIN_CHARS = 400`, `PASTE_COALESCE_MS = 25` (numbers)
  - `interface PasteState { map: Map<number, string>; count: number; lastNum: number; lastAt: number }`
  - `interface DetectedPaste { inserted: string; at: number }`
  - `function detectPaste(prev: string, next: string): DetectedPaste | null`
  - `function isLongPaste(chunk: string): boolean`
  - `function pasteLabel(n: number, chunk: string): string`
  - `function expandPastes(display: string, map: Map<number, string>): string`
  - `function createPasteState(): PasteState`
  - `function applyChange(prev: string, next: string, state: PasteState, now: number): { value: string; state: PasteState }`

- [ ] **Step 1: Write the failing test**

Create `test/ui/paste.test.ts`:

```ts
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
    expect(b.value).toBe('[Pasted text #1 +20 lines]');
    expect(b.state.map.get(1)).toBe(lines(10) + lines(10));
    expect(b.state.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ui/paste.test.ts`
Expected: FAIL — `Cannot find module '../../src/ui/paste.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/paste.ts`:

```ts
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
    const combined = (state.map.get(state.lastNum) ?? '') + d.inserted;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ui/paste.test.ts`
Expected: PASS (5 describe blocks, all green).

- [ ] **Step 5: Commit**

```bash
git add src/ui/paste.ts test/ui/paste.test.ts
git commit -m "feat(ui): pure paste-collapse reducer (detect/label/expand/applyChange)"
```

---

### Task 2: Wire paste-collapse into the input and submit path

**Files:**
- Modify: `src/ui/app.tsx` (imports, `SubmitInput` type, `App` prop type, paste ref, input `onChange`, `handleSubmit`)
- Modify: `src/ui/index.tsx` (mountApp `onSubmit` type + re-export `SubmitInput`)
- Modify: `src/cli.ts` (`repl` `onSubmit` consumes `{ display, text }`; mount call)
- Test: `test/ui/app.test.tsx` (paste behavior + submit payload)

**Interfaces:**
- Consumes (Task 1): `createPasteState`, `applyChange`, `expandPastes`.
- Produces: `interface SubmitInput { display: string; text: string }` (exported from `src/ui/app.tsx`, re-exported from `src/ui/index.tsx`). `App`/`mountApp` `onSubmit` become `(input: SubmitInput) => void`.

- [ ] **Step 1: Write the failing test**

Append to `test/ui/app.test.tsx` (inside the top-level `describe('App', …)` block, before its closing `});`):

```tsx
  it('collapses a long multi-line paste into a chip in the input', () => {
    const store = new UiStore();
    const { lastFrame, stdin } = render(<App store={store} onSubmit={() => {}} />);
    const blob = Array.from({ length: 30 }, (_, i) => `SENTINEL_LINE_${i}`).join('\n');
    stdin.write(blob);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[Pasted text #1');
    expect(frame).not.toContain('SENTINEL_LINE_15'); // raw blob is not shown
  });

  it('leaves a short paste literal in the input', () => {
    const store = new UiStore();
    const { lastFrame, stdin } = render(<App store={store} onSubmit={() => {}} />);
    stdin.write('just a short line');
    expect(lastFrame() ?? '').toContain('just a short line');
    expect(lastFrame() ?? '').not.toContain('[Pasted text');
  });

  it('submits the collapsed display and the fully expanded text', () => {
    const store = new UiStore();
    let received: { display: string; text: string } | null = null;
    const { stdin } = render(<App store={store} onSubmit={(input) => { received = input; }} />);
    const blob = Array.from({ length: 30 }, (_, i) => `SENTINEL_LINE_${i}`).join('\n');
    stdin.write(blob);
    stdin.write('\r'); // Enter
    expect(received).not.toBeNull();
    expect(received!.display).toContain('[Pasted text #1');
    expect(received!.text).toContain('SENTINEL_LINE_15'); // model gets the full blob
    expect(received!.text).not.toContain('[Pasted text'); // no token leaks to the model
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: FAIL — the long-paste test shows the raw blob (no chip yet); the submit test's `received.display`/`text` are undefined (onSubmit still gets a string).

- [ ] **Step 3a: Update `src/ui/app.tsx`**

Add `useRef` to the react import and import the paste helpers. Change:

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react';
```
to:
```tsx
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
```

Add after the existing `import { formatUsage } from '../usage.js';` line:
```tsx
import { createPasteState, applyChange, expandPastes } from './paste.js';
```

Add the exported payload type and switch the `App` prop. Replace:
```tsx
export function App({ store, onSubmit, showHeader = false }: { store: UiStore; onSubmit: (line: string) => void; showHeader?: boolean }) {
```
with:
```tsx
export interface SubmitInput { display: string; text: string }

export function App({ store, onSubmit, showHeader = false }: { store: UiStore; onSubmit: (input: SubmitInput) => void; showHeader?: boolean }) {
```

Add the paste ref next to the other hooks. After:
```tsx
  const [value, setValue] = useState('');
  const [tick, setTick] = useState(0);
```
add:
```tsx
  const pasteRef = useRef(createPasteState());
```

Replace `handleSubmit`:
```tsx
  const handleSubmit = (v: string) => {
    if (state.pendingPrompt !== null) { setValue(''); store.resolvePrompt(v); return; }
    // A turn is running: keep the draft in the box (don't clear, don't send) until it's idle.
    if (state.status === 'busy') return;
    setValue('');
    if (v.trim()) onSubmit(v.trim());
  };
```
with:
```tsx
  const handleSubmit = (v: string) => {
    if (state.pendingPrompt !== null) { setValue(''); pasteRef.current = createPasteState(); store.resolvePrompt(v); return; }
    // A turn is running: keep the draft in the box (don't clear, don't send) until it's idle.
    if (state.status === 'busy') return;
    const display = v.trim();
    const map = pasteRef.current.map;
    setValue('');
    pasteRef.current = createPasteState();
    if (display) onSubmit({ display, text: expandPastes(display, map) });
  };
```

Replace the input's `onChange` handler. Change:
```tsx
        <TextInput value={value} onChange={(v) => setValue(sanitizeInput(v))} onSubmit={handleSubmit} />
```
to:
```tsx
        <TextInput
          value={value}
          onChange={(next) => {
            const r = applyChange(value, sanitizeInput(next), pasteRef.current, Date.now());
            pasteRef.current = r.state;
            setValue(r.value);
          }}
          onSubmit={handleSubmit}
        />
```

- [ ] **Step 3b: Update `src/ui/index.tsx`**

Change:
```tsx
import { render } from 'ink';
import { App } from './app.js';
import { UiStore } from './store.js';
```
to:
```tsx
import { render } from 'ink';
import { App, type SubmitInput } from './app.js';
import { UiStore } from './store.js';
```

Add to the re-export block (after the `export type { TranscriptItem, UiState } …` line):
```tsx
export type { SubmitInput } from './app.js';
```

Change the `mountApp` signature:
```tsx
  onSubmit: (line: string) => void,
```
to:
```tsx
  onSubmit: (input: SubmitInput) => void,
```

- [ ] **Step 3c: Update `src/cli.ts`**

Add `type SubmitInput` to the ui import. Change:
```tsx
import { UiStore, mountApp, shortenCwd, type SessionMeta } from './ui/index.js';
```
to:
```tsx
import { UiStore, mountApp, shortenCwd, type SessionMeta, type SubmitInput } from './ui/index.js';
```

Replace the `repl` submit handler head. Change:
```tsx
  const onSubmit = async (line: string): Promise<void> => {
    if (running) return;
    if (line.startsWith('/')) {
      handleReplCommand(line, session, { config, effectiveConfig, store, refreshMeta, applyTheme, pickModel, resumeSession, exit });
      return;
    }
    running = true;
    store.addUser(line);
    if (!title) title = truncateTitle(line);
    store.setStatus('busy');
    messages.push({ role: 'user', content: [{ type: 'text', text: line }] });
```
to:
```tsx
  const onSubmit = async (input: SubmitInput): Promise<void> => {
    if (running) return;
    if (input.display.startsWith('/')) {
      handleReplCommand(input.display, session, { config, effectiveConfig, store, refreshMeta, applyTheme, pickModel, resumeSession, exit });
      return;
    }
    running = true;
    store.addUser(input.display);
    if (!title) title = truncateTitle(input.display);
    store.setStatus('busy');
    messages.push({ role: 'user', content: [{ type: 'text', text: input.text }] });
```

Update the mount call. Change:
```tsx
  app = mountApp(store, (line) => { void onSubmit(line); }, { showHeader: true });
```
to:
```tsx
  app = mountApp(store, (input) => { void onSubmit(input); }, { showHeader: true });
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run test/ui/app.test.tsx && npx tsc --noEmit`
Expected: app tests PASS (including the 3 new ones); `tsc` reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/ui/index.tsx src/cli.ts test/ui/app.test.tsx
git commit -m "feat(ui): collapse long pastes into inline chips; send full text to model"
```

---

### Task 3: Full verify + build

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all files PASS (existing suite + `paste.test.ts` + the new `app.test.tsx` cases), no failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `Build success`.

- [ ] **Step 4: Manual smoke**

Run `mdd`, paste a ~30-line block into the prompt → it collapses to `[Pasted text #1 +30 lines]`. Type a short sentence around it, press Enter → the transcript shows your text with the chip, and MDD responds as if it received the full pasted content. `/exit`, then `mdd --continue` → the restored transcript still shows the chip and context is intact.

- [ ] **Step 5: Commit (if the smoke revealed nothing to change, this is a no-op)**

```bash
git commit --allow-empty -m "chore: verify long-paste collapsing end-to-end"
```

## Self-Review

- **Spec coverage:** detection by value-diff (Task 1 `detectPaste`/`applyChange`), 4-line/400-char threshold (`isLongPaste`), inline `[Pasted text #n …]` token with lines-vs-chars label (`pasteLabel`), per-buffer numbering + reset on submit (`applyChange` counter + `createPasteState` in `handleSubmit`), collapsed everywhere with full text to model (`display` vs `expandPastes` → `text`; `cli.ts` uses each), coalescing window (`applyChange` + `PASTE_COALESCE_MS`), delete-to-drop (unexpanded tokens pass through `expandPastes`), no `SessionRecord` change (Task 2 touches only the submit payload). All covered.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `SubmitInput { display, text }` defined in `app.tsx`, re-exported by `index.tsx`, imported by `cli.ts`; `applyChange`/`createPasteState`/`expandPastes` signatures match between Task 1 and their Task 2 call sites.
