# Smooth Scroll in the Fullscreen REPL — Design

**Date:** 2026-07-13
**Status:** Approved for planning
**Area:** `src/ui/` (fullscreen REPL scrolling)

## Problem

The interactive REPL runs in the alternate screen (`mountFullscreen`, `src/ui/index.tsx`).
The alt-screen disables the terminal's native scrollback, so history can only be scrolled
with PageUp/PageDown in fixed 3-item steps (`src/ui/app.tsx`). There is no mouse-wheel
support and the stepping feels janky. Goal: Claude-Code-like smoothness while **keeping**
the frozen header + status bar the alt-screen provides.

Chosen approach (Option B): stay in the alt-screen and add terminal mouse-wheel reporting
plus refined keyboard scrolling. (Option A — switching to the native-scrollback `Static`
model — was considered and declined because the frozen header/status is wanted.)

## Approach

### 1. Mouse-wheel reporting
In `mountFullscreen`, immediately after `ALT_ENTER`, emit `\x1b[?1000h\x1b[?1006h`
(button tracking + SGR extended encoding). In `cleanup`, emit `\x1b[?1000l\x1b[?1006l`
**before** `ALT_LEAVE`. Only the fullscreen path touches these; inline/one-shot is unchanged.

### 2. Wheel parsing → scroll offset
A `stdin` `data` listener, registered in a fullscreen-only `useEffect` in `App`, scans each
chunk for SGR mouse sequences `\x1b[<Cb;Cx;Cy(M|m)`. Wheel-up is `Cb & 64` with low bit 0
(code 64); wheel-down is code 65. Each wheel-up increments the existing `scrollBack` item
offset; each wheel-down decrements it (clamped `[0, transcript.length]`). Keyboard scrolling
stays on `useInput`. Using a raw stdin listener for the mouse (instead of `useInput`) avoids
depending on how Ink parses unknown escape sequences.

The listener is added with `process.stdin.on('data', …)` and removed on effect cleanup. It
coexists with Ink's own stdin listener (both receive each chunk); ours reacts only to mouse
sequences and ignores everything else.

### 3. Input sanitization (prevent byte leakage)
With mouse reporting on, wheel bytes can bleed into the `TextInput`. Wrap the input's
`onChange` so the stored value is stripped of escape/mouse sequences before it is set:
`value.replace(/\x1b\[[0-9;<]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f]/g, '')`.
Synchronous, so no garbage ever renders. Users never type ESC sequences, so this is safe.
Applied via a `sanitizeInput` helper (pure, unit-tested).

### 4. Refined keyboard scrolling
The input is always focused, so **letter keys can't be scroll bindings** (they'd break
typing). Only non-text keys are used, in the fullscreen `useInput`:
- `↑` → up 1 item; `↓` → down 1 item (a single-line `TextInput` ignores vertical arrows, so no conflict)
- PageUp / PageDown → up / down one viewport-worth of items (`Math.max(1, rows - 4)`)

Jump-to-bottom (follow live) happens automatically when a new turn starts (`scrollBack`
resets to 0 on `status === 'busy'`, already implemented) and by paging/wheeling down to 0.
Scroll math is extracted into a pure helper `nextScroll(current, action, total, page)` returning
the clamped new offset, so it is unit-testable without a terminal.

### 5. Status hint
Footer shows scroll state when scrolled up: `▲ N above · End to follow`, and a one-time
discoverability hint that native selection needs Option (macOS) / Shift held while mouse
mode is on.

## Scope

**In:** mouse enable/disable escapes, wheel parsing, input sanitization, refined keyboard
scroll, pure `nextScroll` + `sanitizeInput` helpers, status hint, tests.

**Out (YAGNI / deliberate):**
- **Per-line scrolling.** Scrolling stays per transcript item. Going line-precise would
  require rendering the transcript as a flat ANSI line buffer, discarding the immersive Ink
  markdown (boxed/highlighted code). Rich rendering wins; per-item granularity is accepted.
- Image attachment (separate spec, built next).
- Any change to inline/one-shot mode.

## Testing

- `test/ui/scroll.test.ts` — `nextScroll` for every action (up/down/pageUp/pageDown/top/bottom)
  with clamping at both ends; `sanitizeInput` strips mouse/escape sequences and preserves
  normal text; `parseWheel` maps `\x1b[<64;..M`/`\x1b[<65;..M` (and modified variants) to
  up/down and ignores non-wheel input.
- `test/ui/app.test.tsx` — a mouse sequence routed through the input sanitizer does not appear
  in the rendered input.

## Risks

- **Terminal variance in mouse reporting.** Most modern terminals (iTerm2, Terminal.app,
  Ghostty, common Linux terms) support `?1000`+`?1006`. If a terminal doesn't, keyboard
  scrolling still works and no garbage appears (sanitizer covers stray bytes).
- **Selection tradeoff** is inherent to Option B; documented in the footer hint.
