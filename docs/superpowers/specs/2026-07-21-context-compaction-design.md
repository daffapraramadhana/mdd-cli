# Context compaction — design

## Problem

A long REPL conversation eventually exceeds the model's context window. The whole
conversation (system prompt + every prior message + **every tool result**, including
large file dumps) is replayed to the model on every turn, so a session that reads big
files repeatedly grows without bound. When it crosses the model's maximum, the request
fails:

```
400 invalid_request_error: prompt is too long: 1001265 tokens > 1000000 maximum
```

Once over the limit, *every* subsequent turn is over too — pressing "continue" just
re-hits the wall, because the context does not shrink on its own. There is currently no
recovery other than starting a fresh session.

## Goal

Let a conversation continue past the point where it would otherwise overflow, by
replacing the older history with a concise LLM-written summary while keeping the most
recent exchanges verbatim. Two triggers:

1. **Manual** — the user types `/compact`.
2. **Automatic** — when the last request's real prompt size crosses ~80% of the model's
   context limit, compact proactively so the *next* request is already small.

## Non-goals

- No configurable threshold or configurable tail length (YAGNI — hardcoded constants).
- No transcript (UI scrollback) trimming — only the model-facing history shrinks.
- No new provider method — summarization reuses the existing `stream()` interface.

## Key insight: what actually has to shrink

There are two parallel histories:

- `messages: Message[]` in `repl()` — the **model-facing** array, resent every turn.
  This is the only thing that consumes context tokens.
- `store` `transcript: TranscriptItem[]` — the **display** scrollback. Persisted in the
  session record and reloaded on resume, but never resent to the model.

Compaction rewrites **only `messages`**. The transcript is left intact (the user keeps
their full visible history) and a single system line is appended noting the compaction.
This keeps the change small and avoids fragile transcript/message alignment.

## Ground-truth token signal

The provider already emits a `usage` event carrying `inputTokens` — the **real** prompt
token count of the last request (see `ProviderEvent` in `src/providers/index.ts`, wired
through `onUsage` in `runTurn`). The auto-trigger compares the *latest* request's
`inputTokens` against the model's limit — no tokenizer or estimation needed.

Note: `store.addUsage` **accumulates** input tokens across turns, which is not what the
threshold check wants. The check needs the single most recent request's `inputTokens`,
so that value is tracked separately (a dedicated local / store field updated on each
`usage` event), distinct from the running `usage` total shown in the status bar.

## New module — `src/agent/compact.ts` (pure, unit-tested)

Pure helpers, kept out of orchestration the same way `rate-limit.ts` sits beside
`loop.ts`.

- `contextLimit(model: string): number`
  Returns the model's context window. Default **1_000_000** (matches every model in
  `KNOWN_MODELS`). An internal override map handles exceptions if any appear later.
  `--model` accepts any string, so an unknown model always falls back to the default.

- `shouldCompact(lastInputTokens: number, model: string, ratio = 0.8): boolean`
  `true` when `lastInputTokens > contextLimit(model) * ratio`.

- `splitForCompaction(messages: Message[], keepExchanges = 2): { head: Message[]; tail: Message[] }`
  Splits at a **genuine user-text message** boundary — a `{role:'user'}` message whose
  content is text (the start of a real user turn), NOT a `user` message that only carries
  `tool_result` blocks. Keeping the boundary on real user turns guarantees a
  `tool_use`/`tool_result` pair is never split across the head/tail line. `tail` = the
  last `keepExchanges` real exchanges kept verbatim; `head` = everything before, to be
  summarized. If there are `<= keepExchanges` real exchanges, `head` is empty (nothing to
  compact).

- `summaryInput(head: Message[]): Message[]`
  Builds the messages sent to the summarizer, defensively shrunk so the summarization
  call itself can never overflow — even when invoked from an already-maxed conversation:
  - each `tool_result` block's `content` is truncated (keep head + tail, elide the
    middle with a `… [N chars elided] …` marker);
  - `image` blocks are dropped;
  - a trailing `{role:'user'}` instruction message asks for the summary
    (`SUMMARY_INSTRUCTION`). Because `head` ends with an assistant message, appending a
    user instruction preserves valid role alternation.

- `buildCompacted(summaryText: string, tail: Message[]): Message[]`
  Returns `[user(summaryText), assistant(ack), ...tail]`. The synthetic assistant ack
  guarantees valid role alternation regardless of what `tail` begins with.

- Constants: `SUMMARY_SYSTEM` (system prompt instructing a factual, task-focused
  summary), `SUMMARY_INSTRUCTION`, `COMPACT_RATIO = 0.8`, `KEEP_EXCHANGES = 2`,
  `DEFAULT_CONTEXT_LIMIT = 1_000_000`.

## Orchestration — `compactConversation()` in `repl()`

A closure over `messages`, `session`, `store`, and the provider, shared by both triggers.
Async.

1. **Guard** — `splitForCompaction(messages)`; if `head` is empty →
   `store.addSystem('Nothing to compact yet.')` and return.
2. **Summarize** — collect text from
   `provider.stream(summaryInput(head), [], { model: session.model, systemPrompt: SUMMARY_SYSTEM, maxTokens: 8192, signal })`.
   No tools. On abort or stream error → `store.addSystem('⚠ compaction failed: …')`,
   leave `messages` untouched, return (fail safe — never corrupt the history).
3. **Replace** — `messages.splice(0, messages.length, ...buildCompacted(summary, tail))`.
4. **Note** — `store.addSystem('✻ Compacted context — freed ~N tokens')` (N estimated
   from the drop in `lastInputTokens` or a char-based heuristic; approximate is fine).
5. Persist rides on the existing per-turn atomic save (auto path) or an explicit save
   (manual path, so a `/compact` with no following turn is still durable).

## Triggers

### Manual `/compact`
- Added to `HELP` text.
- Dispatched via a new `compact: () => void` callback on `CommandDeps`, matching the
  existing async-via-callback pattern (`pickModel`, `resumeSession`). The callback kicks
  off `compactConversation()` in a `void (async () => …)()`.
- `onSubmit` already blocks slash commands while a turn runs (`if (running) return`), so
  `/compact` can only run when idle.

### Auto near threshold
- Track `lastInputTokens` (updated on every `usage` event).
- After a turn completes (status back to idle, `running = false`), if
  `shouldCompact(lastInputTokens, session.model)` → run `compactConversation()` with a
  `✻ Auto-compacted context (~was → now)` note.
- Guard against churn: the `head`-empty guard already makes a no-op cheap; auto only
  fires when there is genuinely something to compact and we're near the limit.

## UI

- System lines via the existing `store.addSystem` (dim, gutter-aligned) — no new
  transcript item kind.
- Manual: `✻ Compacted context — freed ~N tokens`.
- Auto: `✻ Auto-compacted context to stay under the model's limit — freed ~N tokens`.
- Nothing-to-do: `Nothing to compact yet.`
- Failure: `⚠ compaction failed: <reason>` (history unchanged).

## Testing (TDD) — `test/agent/compact.test.ts`

Pure module gets full coverage; orchestration stays thin.

- `splitForCompaction`:
  - never places the boundary between a `tool_use` and its `tool_result`;
  - boundary lands on genuine user-text messages, not `tool_result`-only user messages;
  - `head` empty when there are `<= keepExchanges` real exchanges.
- `summaryInput`:
  - truncates oversized `tool_result` content and marks elision;
  - drops `image` blocks;
  - appends the trailing user instruction; result starts with a valid alternation.
- `buildCompacted`:
  - shape `[user, assistant, ...tail]`; roles alternate for tails starting with either
    role.
- `shouldCompact`: below/at/above the 80% boundary.
- `contextLimit`: known model and unknown-model fallback to default.

## Changelog

User-facing. Same commit adds to `## [Unreleased]` under `Added`:

> - `/compact` command and automatic context compaction near the model's token limit,
>   so long sessions no longer dead-end on "prompt is too long".
