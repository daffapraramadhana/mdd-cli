# Long-Paste Collapsing — Design

**Date:** 2026-07-13
**Status:** Approved for planning (implementation pending)
**Area:** `src/ui/paste.ts` (new), `src/ui/app.tsx`, `src/cli.ts`

## Problem

The prompt is a single-line `ink-text-input`. Pasting a long or multi-line blob dumps the whole
thing into that one line — it wraps awkwardly, is hard to edit around, and bloats the transcript
and session history when sent. We want Claude Code's treatment: a long paste collapses into an
inline chip such as `[Pasted text #1 +42 lines]`, while the model still receives the full text.

## Decisions (locked)

- **Detection:** heuristic value-diffing (no bracketed-paste mode). In the input's `onChange`, diff
  the previous value against the new one; the inserted middle chunk is the arrival. If that chunk is
  "long", treat it as a paste.
- **Threshold:** a chunk is a paste when it has **≥ 4 lines OR ≥ 400 characters**. Tunable constants.
- **Placeholder:** the inserted chunk is replaced *inline at the cursor* with a token
  `[Pasted text #<n> +<N> lines]` (multi-line) or `[Pasted text #<n> +<N> chars]` (long single line).
- **Numbering:** `#1, #2, …` per composing buffer; resets after each submit.
- **Collapsed everywhere:** the chip shows in the input while composing AND in the conversation
  history after send. The model receives the fully expanded text.
- **Delete-to-drop:** removing the token from the input drops that paste (it simply won't expand).

## Non-goals (YAGNI)

- Bracketed-paste mode (`\x1b[?2004h`) + custom input component. Noted as a future robustness upgrade
  for gigantic pastes the OS splits across multiple stdin reads.
- Editing a chip back into its full text.
- Per-session (rather than per-message) paste numbering.
- Image / file attachments (separate, deferred feature).

## Known limitation

A very large paste that the terminal delivers across multiple stdin chunks can, in the worst case,
produce more than one chip. A small **coalescing window** merges long inserts that arrive
back-to-back (within a short interval) into a single paste, which covers the common macOS cases.

## New module: `src/ui/paste.ts`

Pure, no React/Ink imports, fully unit-testable.

```ts
export interface DetectedPaste { inserted: string; at: number } // at = insertion offset in prev

export function detectPaste(prev: string, next: string): DetectedPaste | null;
//   Returns the inserted chunk for a pure insertion (common prefix + common suffix), else null
//   (e.g. deletions or replacements that aren't a simple insert).

export function isLongPaste(chunk: string): boolean;      // ≥ 4 lines OR ≥ 400 chars
export function pasteLabel(n: number, chunk: string): string; // "[Pasted text #1 +42 lines]" | "… +812 chars]"
export function expandPastes(display: string, map: Map<number, string>): string;
//   Replaces every "[Pasted text #<n> …]" token that has a map entry with its full text; leaves
//   tokens without an entry untouched.
```

Constants (exported for reuse/tests): `PASTE_MIN_LINES = 4`, `PASTE_MIN_CHARS = 400`,
`PASTE_COALESCE_MS` (small window, e.g. 25).

## `app.tsx` changes

- Hold the paste map (`Map<number, string>`) and a counter in a ref, plus the coalescing timer.
- In the input `onChange(next)`: after `sanitizeInput`, run `detectPaste(prevValue, next)`. If the
  inserted chunk `isLongPaste`, stash it under the next number, replace it in the value with
  `pasteLabel(n, chunk)`, and `setValue(collapsed)`. Otherwise `setValue(next)` as today.
  (Coalescing: if another long insert lands within `PASTE_COALESCE_MS`, append to the same entry and
  update its chip in place instead of creating a new one.)
- `handleSubmit`: build `display = value` (collapsed) and `text = expandPastes(display, map)`
  (expanded). Call `onSubmit({ display, text })`. Reset the map + counter. The `pendingPrompt`
  (permission answer) path is unchanged — it still resolves the raw value, no paste handling.

## `cli.ts` changes

- `App`'s `onSubmit` prop becomes `(input: { display: string; text: string }) => void`.
- In `repl()`, the submit handler uses `input.display` for `store.addUser(...)` (transcript shows the
  chip) and `input.text` for the message pushed to `messages` (model gets full text). The existing
  `running`/save/title logic is otherwise unchanged (title from `input.display` so it stays short).
- `oneShot` and other `mountApp(store, () => {})` callers ignore the payload — no change needed.

## Data flow

Paste → `onChange` diff → long? stash blob + inline chip → (compose more) → submit → `expandPastes`
→ `onSubmit({ display, text })` → transcript gets `display`, `messages` gets `text` → per-turn save
writes both (already the case). Resume restores full context from `messages` and chips from the
transcript with no `SessionRecord` change.

## Error handling / edge cases

- `detectPaste` returns null for non-insertions (backspace, mid-token edits) → value passes through
  verbatim; a mangled/partly-deleted token just fails to expand and is sent literally.
- A user who *types* the literal token text has no map entry for it → left as-is (not expanded).
- Cursor lands at end of the collapsed value after a paste (acceptable; matches Claude).

## Testing

- `test/ui/paste.test.ts` (pure): `detectPaste` for inserts at start/middle/end and null for
  deletes; `isLongPaste` boundaries (3 vs 4 lines, 399 vs 400 chars); `pasteLabel` lines-vs-chars
  wording; `expandPastes` for single, multiple, and missing-entry tokens.
- `test/ui/app.test.tsx`: `stdin.write(longBlob)` → frame contains `[Pasted text #1` and NOT a
  sentinel line from the blob; a short paste stays literal; a submit spy receives `text` = full blob
  and `display` = collapsed line.
