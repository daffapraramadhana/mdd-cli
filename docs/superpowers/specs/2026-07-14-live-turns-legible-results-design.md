# Live Turns, Legible Results — UI/UX Design

**Date:** 2026-07-14
**Status:** Approved (design), pending spec review
**Branch:** feat/header-input-polish (or a fresh branch off it)

## Goal

Make an in-progress MDD turn feel *alive* and make what it did *legible*. Today a turn
is mostly silent: tool calls appear as static one-liners with only a status + duration
(`✓ ▤ read_file(x)  7ms`), the actual result is thrown away, and a long turn gives no
sense of progress or any way to stop it. This pass closes those gaps.

Two focus areas, chosen with the user: **turn liveliness** and **output readability**.
Scope is a focused sweep — one flagship item built to full polish plus three supporting
items. The streaming *thinking* display is explicitly **deferred** (it has its own design
doc at `2026-07-14-streaming-thinking-design.md`).

## Non-goals

- Streaming thinking display (separate, already-designed effort).
- Syntax highlighting of prose code blocks — already implemented (`markdown.tsx` →
  `highlight.ts`). Not touched here.
- A full transcript redesign. We keep the `<Static>` history + pinned live region
  architecture in `app.tsx` intact.
- Persisting tool result previews into saved sessions (previews are ephemeral, live-only;
  see "Session persistence" below).

---

## Feature 1 (Flagship) — Tool calls that breathe and collapse to a result

### Behavior

**While running** — the active tool line shows the spinner + tool label **plus a live
elapsed timer** that ticks up (`0.4s`, `1.1s`, `3.2s`…). The existing 90ms animation
interval in `app.tsx` already re-renders while `animating`, so the timer is derived from
`Date.now() - activeTool.startedAt` at render time — no new interval.

**On finish** — the tool collapses into the transcript as it does now (✓/✗ + label +
duration), and gains **a second dim, indented line: a one-line preview of the result.**

Preview content is derived per tool from the result string (`r.content` in `loop.ts`):

| Tool | Preview |
|------|---------|
| `read_file` | `42 lines · 1.2 KB` (line count from content; bytes from content length) |
| `list_dir` | `12 entries` (count lines/entries in content) |
| `edit_file` / `write_file` | `+3 −1` if the result reports a diff/counts; else `wrote 30 lines` |
| `run_shell` | first 1–2 non-empty stdout lines, truncated to width; append `exit N` if non-zero |
| `git` | first non-empty output line, truncated |
| unknown / fallback | first non-empty line of content, truncated |

On **error**, the preview shows the first line of the error content in the error color,
regardless of tool.

The preview is a **pure function of the result string** (`summarizePreview(name, content,
isError)`), so it lives in `format.ts` next to `formatToolCall` and is unit-testable with
no UI.

### Data flow / wiring

The result is already computed in the loop and immediately discarded. Thread it through:

1. **`loop.ts`** — widen the callback:
   `onToolEnd?: (isError: boolean, content?: string) => void`.
   Pass `r.content` at the success site (line ~62); pass the error/deny/unknown message
   strings at the other three `onToolEnd` sites. (Deny/unknown are short fixed strings;
   they'll summarize fine.)

2. **`store.ts`** —
   - `TranscriptItem` tool variant gains `preview?: string`.
   - `endTool(status, preview?)` stores it on the committed tool item.
   - `ActiveTool` is unchanged (timer is derived from `startedAt`, already present).

3. **`cli.ts`** — `streamHandlers`: `onToolEnd(isError, content)` calls
   `store.endTool(isError ? 'error' : 'ok', summarizePreview(name, content, isError))`.
   Note: `onToolEnd` currently receives no tool name. Two options — (a) capture the name
   in the handler closure from the preceding `onToolStart`, or (b) compute the preview in
   the store from `activeTool.name`. **Chosen: (b)** — the store already knows
   `activeTool.name`, so pass the raw `content` into `endTool` and let it call
   `summarizePreview(this.activeTool.name, content, isError)`. Keeps `cli.ts` thin and
   avoids a stale-name closure bug.

4. **`app.tsx` / `format.ts`** — `ToolLine` (or a sibling) renders the optional preview as
   an indented dim line beneath the tool line. The running line renders the elapsed timer.

### Rendering detail

- Preview line indents to align under the tool label (past the `GUTTER` + marker), dim.
- Truncate to terminal `width` (already available via `useStdout`).
- Multi-line shell output is collapsed to its first 1–2 lines here; full output is never
  shown inline (that's what the model consumes, not the human).

---

## Feature 2 — Turn heartbeat + interrupt

### Behavior

While `status === 'busy'`, the live indicator (thinking dots / streaming cursor / active
tool) is accompanied by **elapsed turn time** and a hint: `esc to interrupt`. Pressing
**Esc** aborts the in-flight turn.

- Elapsed time is measured from turn start (store records `turnStartedAt` when status goes
  busy). Rendered next to the existing thinking/streaming indicator.
- The hint appears only while busy; hidden when idle.

### Wiring

`loop.ts` already accepts `signal?: AbortSignal` and forwards it to `provider.stream`.
It is currently **not passed** at either `runTurn` call site (`cli.ts:176`, `:377`).

1. **Interactive path (`cli.ts:377`)** — create an `AbortController` per turn, pass
   `controller.signal` into `runTurn`. Expose an abort hook so the UI can trigger it
   (e.g. `store.setAbort(() => controller.abort())` / `store.requestAbort()`), cleared in
   the `finally`.
2. **`app.tsx`** — add `useInput` handling: when `status === 'busy'` and Esc is pressed,
   call `store.requestAbort()`. Must not interfere with `ink-text-input` (Esc is not a
   text key; verify no conflict with paste/select modes — when `pendingSelect` is open,
   Esc already means cancel-select and must keep that meaning).
3. On abort, the turn loop's `provider.stream` throws/ends; existing `catch` in `cli.ts`
   already handles turn errors — extend it to render a dim `⊘ interrupted` system line
   rather than an `Error:` line when the cause is an abort.

### Risk / smallest-viable

This is the most involved item (touches keyboard handling + async cancellation). If Esc
conflicts or provider cancellation is unclean, the fallback is **heartbeat only** (show
elapsed time + a passive hint) and land interrupt separately. The elapsed-time half is
low-risk and independently valuable.

One-shot path (`cli.ts:176`) does not get interrupt (no interactive keyboard); it's
unchanged.

---

## Feature 3 — Softer turn separation + grouped tool rail

### Behavior

- **Turn divider:** replace the hard `'─'.repeat(48)` rule between user turns
  (`app.tsx:49`) with a quieter, branded separator — a short dim accent tick / spaced
  dots rather than a full hard rule. Softer visual rhythm between turns.
- **Tool grouping:** a turn's consecutive tool-call lines get a subtle shared left rail
  (a dim vertical mark in the gutter) so they read as one block belonging to the
  assistant's turn, instead of loose disconnected lines.

### Wiring

Pure `app.tsx` presentation change. The tool rail is a dim character rendered in the
`GUTTER` box of `ToolLine` when the item is part of a tool run. No store/loop changes.
Keep it conservative — this is polish, not a redesign; it must not fight the existing
`<Static>` scrollback model.

---

## Session persistence

Tool result previews are **live-only** and not persisted. On `/resume`, restored tool
items simply render without a preview line (the `preview?` field is absent). This avoids
bloating saved sessions and keeps `loadTranscript` unchanged. Acceptable: previews are a
during-the-turn affordance, not history.

## Testing

- **`summarizePreview(name, content, isError)`** — pure unit tests: each tool kind, error
  case, empty content, multi-line shell, truncation at width, byte/line counting.
- **Store** — `endTool` stores the summarized preview; `turnStartedAt` set on busy;
  `requestAbort` invokes the registered hook.
- **Loop** — `onToolEnd` receives `r.content` on success and the correct message strings
  on deny/unknown/throw (extend existing loop tests).
- Elapsed-timer rendering and `useInput`/Esc are behavioral; covered by manual run-through
  (the `verify`/`run` skill) since Ink keyboard + timers are awkward to unit test.

## Build order

1. **Flagship previews** (loop signature → store field → `summarizePreview` in format →
   render). Self-contained, high payoff, no keyboard risk. Ship first.
2. **Heartbeat (elapsed time only)** — cheap, builds on the existing animation tick.
3. **Softer separation + tool rail** — pure `app.tsx` polish.
4. **Interrupt (Esc → abort)** — last, highest risk; can slip without blocking 1–3.

## Files touched

- `src/agent/loop.ts` — `onToolEnd` signature (+ pass `signal` at call sites via cli).
- `src/ui/store.ts` — `preview?` on tool item, `endTool` summarizes, `turnStartedAt`,
  abort hook.
- `src/ui/format.ts` — new `summarizePreview`; possibly a `formatElapsed` helper.
- `src/ui/app.tsx` — running timer, preview line, heartbeat + hint, `useInput` Esc,
  softer divider, tool rail.
- `src/cli.ts` — pass `content` to `endTool`; `AbortController` per interactive turn;
  interrupted-vs-error rendering.
- Tests alongside `format.ts` / `store.ts` / `loop.ts`.
