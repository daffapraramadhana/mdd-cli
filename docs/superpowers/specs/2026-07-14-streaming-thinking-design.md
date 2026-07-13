# Streaming "Thinking" Display — Design

**Date:** 2026-07-14
**Status:** Approved, pending implementation plan

## Problem

When the model is reasoning, MDD shows nothing but a generic `thinking…` placeholder,
and the model's actual reasoning is thrown away. Models served over the `cc/*` 9router
(OpenAI-compatible) endpoint emit their chain-of-thought inline as `<think>…</think>`
tags. Today `ThinkSplitter` parses those tags purely to **strip** the reasoning from the
visible answer. We want to surface that reasoning live — a dimmed block that streams in
while the model thinks, then collapses to a compact summary once the answer begins.

## Scope

**In scope:** surfacing inline `<think>…</think>` reasoning that the provider text stream
already contains (the `cc/*` 9router models the user runs day-to-day).

**Out of scope (YAGNI):**
- Native extended thinking (Anthropic `thinking` blocks / OpenAI reasoning). The default
  `claude-opus-4-8` and `gpt-5` models would need this, but the user primarily runs `cc/*`
  models. Enabling it means provider changes, a new stream event, a config toggle, extra
  token cost/latency, and preserving thinking blocks across tool rounds — deferred.
- Keyboard expand/collapse of historical reasoning. Committed history renders through
  Ink's `<Static>` (printed once, never re-rendered), so re-expanding a collapsed block in
  scrollback is architecturally expensive. Not worth it.

## Data Flow

The change is a redirect of data that already flows through the splitter:

```
provider text delta
   └─ ThinkSplitter.push(delta) → { visible, thinking }
        visible  → store.appendStreaming   (the answer — unchanged behavior)
        thinking → store.appendReasoning    (NEW — dim live block)
```

## Components

### 1. `ThinkSplitter` — `src/ui/think.ts`

Stop discarding think content; return it on a second channel.

- `push(delta: string): { visible: string; thinking: string }`
- `flush(): { visible: string; thinking: string }`

The tag-parsing state machine is **unchanged**. Only the in-`<think>` branch changes: where
it currently drops buffered content, it now accumulates that content into the `thinking`
return channel. `visible` output is byte-for-byte identical to today's return value, so the
answer rendering path is unaffected.

Partial-tag handling at chunk boundaries stays as-is: a partial `<think>`/`</think>` is still
held back until resolved, so neither channel leaks tag fragments.

### 2. Store — `src/ui/store.ts`

New ephemeral state on `UiState`:

- `reasoning: string` — the live reasoning text for the current round (re-rendered in place).
- `reasoningStartedAt: number | null` — stamped on the first reasoning delta; used to compute
  the collapse summary's duration.

New / changed methods:

- `appendReasoning(delta: string)` — appends to `reasoning`; stamps `reasoningStartedAt` via
  the injected `now()` clock on first delta.
- **Collapse** happens when reasoning ends — i.e. the first of:
  - the first `appendStreaming` call after reasoning began (answer text starts), or
  - `startTool` (a tool call begins), or
  - `commitStreaming` / turn end (reasoning was the whole round).

  Collapsing clears `reasoning` + `reasoningStartedAt` and pushes a compact transcript item:

  ```ts
  { kind: 'reasoning'; durationMs: number }
  ```

  This is added to the `TranscriptItem` union. A single private helper
  (`collapseReasoning()`) performs the clear-and-commit so the three call sites stay
  consistent.

### 3. UI — `src/ui/app.tsx`

**Live region** (`liveRows`), rendered *above* the streaming answer when `state.reasoning`
is non-empty:

- A dim header `✻ Thinking…` reusing the existing `tick` animation (e.g. `thinkingDots(tick)`).
- The reasoning text, dimmed, **capped to the last ~8 lines** (tail). The live region
  re-renders fully each frame, so an uncapped block would flood/flicker the terminal; showing
  only the tail keeps it stable.

**Scrollback** (`renderItem`): a new `kind: 'reasoning'` case → a dim one-liner,
`✻ Thought for 2.3s` (format duration from `durationMs`).

The existing generic `thinking…` placeholder still covers the pre-first-token gap (busy but
no streaming / reasoning / tool yet).

### 4. Stream handlers — `src/cli.ts`

`streamHandlers.onText` splits the delta across the two store calls:

```ts
onText: (delta) => {
  const { visible, thinking } = splitter.push(delta);
  if (thinking) store.appendReasoning(thinking);
  if (visible)  store.appendStreaming(visible);
},
flush: () => {
  const { visible, thinking } = splitter.flush();
  if (thinking) store.appendReasoning(thinking);
  if (visible)  store.appendStreaming(visible);
},
```

### 5. Persistence — `src/session.ts`

No change. `SessionRecord.transcript` is serialized as JSON, so the new
`{ kind: 'reasoning', durationMs }` item round-trips automatically. Full reasoning text is
ephemeral (never saved); only the collapsed summary persists across `mdd resume`.

## Post-Collapse Behavior (decided)

Reasoning collapses to a **one-line summary** (`✻ Thought for Ns`) in scrollback. The full
reasoning is visible only while it streams live. (Alternatives considered and rejected: keep
full reasoning in scrollback — too noisy and bloats saved sessions; vanish entirely — loses
the "it reasoned" signal.)

## Error Handling / Edge Cases

- **Multiple `<think>` blocks in one round:** all thinking content accumulates into the same
  live `reasoning` string until the round's reasoning ends; one collapse summary per round.
- **Unterminated `<think>` at stream end:** `flush()` returns the buffered thinking so it is
  shown, then the turn-end collapse fires. (Today it is silently dropped.)
- **Reasoning interleaved after answer text:** if `<think>` appears after visible text has
  begun, it still routes to `appendReasoning` and shows in the live block; the collapse-on-
  first-answer already fired for the prior segment, so a second summary may be emitted. This
  is acceptable and rare for these models.
- **Empty `<think></think>`:** no reasoning deltas → no start stamp → no collapse item. Silent,
  as today.

## Testing

- `test/ui/think.test.ts` — update to the `{ visible, thinking }` shape; assert `visible`
  matches today's expectations **and** `thinking` captures the dropped content, across the
  existing split-tag / small-chunk / unterminated cases.
- `test/ui/store.test.ts` — new: `appendReasoning` accumulates and stamps start; collapse on
  first answer text / tool start / turn end produces exactly one `reasoning` item with a
  plausible `durationMs`; empty reasoning produces none.
- `test/ui/app.test.tsx` — new: live reasoning block renders dimmed and is tail-capped; a
  committed `reasoning` item renders the `✻ Thought for Ns` one-liner.
```
