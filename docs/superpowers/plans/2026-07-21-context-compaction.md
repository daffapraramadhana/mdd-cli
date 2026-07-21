# Context Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a long REPL conversation continue past the model's context limit by replacing older history with an LLM summary while keeping recent exchanges verbatim, triggered manually via `/compact` and automatically near an 80% token threshold.

**Architecture:** A pure, unit-tested module `src/agent/compact.ts` holds all decision/transform logic (limit lookup, threshold, head/tail split, defensive summarization input, reassembly). A thin async orchestrator `compactConversation()` in `src/cli.ts`'s `repl()` streams a summary via the existing provider interface and rewrites only the model-facing `messages` array; the UI transcript is left intact and a system line is appended.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Ink (unchanged), existing `LLMProvider.stream()` interface.

## Global Constraints

- Import specifiers use the `.js` extension even for `.ts` files (ESM/NodeNext): `import { x } from './compact.js'`.
- Tests use Vitest: `import { describe, it, expect } from 'vitest'`.
- Run a single test file with: `npx vitest run test/agent/compact.test.ts`.
- Run the whole suite with: `npm test`. Build with: `npm run build`.
- `Message` shape (`src/types.ts`): `{ role: 'user' | 'assistant'; content: ContentBlock[] }`. Blocks: `TextBlock {type:'text',text}`, `ToolUseBlock {type:'tool_use',id,name,input}`, `ToolResultBlock {type:'tool_result',toolUseId,content,isError}`, `ImageBlock {type:'image',mediaType,data}`.
- No new provider method — summarization reuses `provider.stream(messages, [], opts)`.
- Only `messages` (model-facing) shrinks; never trim the UI `transcript`.
- Changelog discipline (CLAUDE.md): user-facing change → add an `Added` bullet under `## [Unreleased]` in `CHANGELOG.md` in the same commit as the wiring.
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Threshold helpers — `contextLimit` + `shouldCompact`

**Files:**
- Create: `src/agent/compact.ts`
- Test: `test/agent/compact.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `DEFAULT_CONTEXT_LIMIT = 1_000_000` (const)
  - `COMPACT_RATIO = 0.8` (const)
  - `contextLimit(model: string): number`
  - `shouldCompact(lastInputTokens: number, model: string, ratio?: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/agent/compact.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { contextLimit, shouldCompact, DEFAULT_CONTEXT_LIMIT } from '../../src/agent/compact.js';

describe('contextLimit', () => {
  it('returns the default limit for a known 9router model', () => {
    expect(contextLimit('cc/claude-sonnet-5')).toBe(1_000_000);
  });
  it('falls back to the default for an unknown model id', () => {
    expect(contextLimit('some/unknown-model')).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});

describe('shouldCompact', () => {
  it('is false below the 80% threshold', () => {
    expect(shouldCompact(700_000, 'cc/claude-sonnet-5')).toBe(false);
  });
  it('is true above the 80% threshold', () => {
    expect(shouldCompact(850_000, 'cc/claude-sonnet-5')).toBe(true);
  });
  it('is false exactly at the threshold (strict greater-than)', () => {
    expect(shouldCompact(800_000, 'cc/claude-sonnet-5')).toBe(false);
  });
  it('honors a custom ratio', () => {
    expect(shouldCompact(500_000, 'cc/claude-sonnet-5', 0.4)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/compact.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/agent/compact.ts`:

```typescript
import type { Message } from '../types.js';

export const DEFAULT_CONTEXT_LIMIT = 1_000_000;
export const COMPACT_RATIO = 0.8;

// Per-model context windows. Every model currently served (Claude + GPT via 9router)
// is 1M, so the map is a placeholder for future exceptions; unknown ids fall back to
// the default. `--model` accepts any string, so a fallback is mandatory.
const CONTEXT_LIMITS: Record<string, number> = {};

export function contextLimit(model: string): number {
  return CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
}

// True when the last request's real prompt size crossed `ratio` of the model's window.
// Strict greater-than so the boundary value itself does not trigger.
export function shouldCompact(lastInputTokens: number, model: string, ratio = COMPACT_RATIO): boolean {
  return lastInputTokens > contextLimit(model) * ratio;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/agent/compact.ts test/agent/compact.test.ts
git commit -m "feat(compact): add context-limit lookup and compaction threshold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `splitForCompaction` — tool-pair-safe head/tail split

**Files:**
- Modify: `src/agent/compact.ts`
- Test: `test/agent/compact.test.ts`

**Interfaces:**
- Consumes: `Message` type.
- Produces: `splitForCompaction(messages: Message[], keepExchanges?: number): { head: Message[]; tail: Message[] }`
  - A "real exchange" starts at a `{role:'user'}` message that contains at least one `text` block (a genuine user prompt), NOT a `user` message whose blocks are only `tool_result`.
  - `tail` = messages from the start of the `keepExchanges`-th-from-last real exchange onward (default `keepExchanges = 2`).
  - `head` = everything before that boundary.
  - If there are `<= keepExchanges` real exchanges, `head` is `[]` and `tail` is the whole array (nothing to compact).

- [ ] **Step 1: Write the failing test**

Append to `test/agent/compact.test.ts`:

```typescript
import { splitForCompaction } from '../../src/agent/compact.js';
import type { Message } from '../../src/types.js';

// A realistic interleaved history: two full agent exchanges. Each user prompt is a
// text message; tool results come back as user messages carrying tool_result blocks.
function sampleHistory(): Message[] {
  return [
    { role: 'user', content: [{ type: 'text', text: 'prompt A' }] },              // 0 exchange 1 start
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read', input: {} }] }, // 1
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'file', isError: false }] }, // 2
    { role: 'assistant', content: [{ type: 'text', text: 'done A' }] },           // 3
    { role: 'user', content: [{ type: 'text', text: 'prompt B' }] },              // 4 exchange 2 start
    { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'read', input: {} }] }, // 5
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't2', content: 'file', isError: false }] }, // 6
    { role: 'assistant', content: [{ type: 'text', text: 'done B' }] },           // 7
    { role: 'user', content: [{ type: 'text', text: 'prompt C' }] },              // 8 exchange 3 start
    { role: 'assistant', content: [{ type: 'text', text: 'done C' }] },           // 9
  ];
}

describe('splitForCompaction', () => {
  it('keeps the last 2 real exchanges in the tail, summarizes the rest', () => {
    const { head, tail } = splitForCompaction(sampleHistory(), 2);
    // Exchange 1 (indices 0-3) goes to head; exchanges 2 and 3 (indices 4-9) to tail.
    expect(head).toHaveLength(4);
    expect(tail).toHaveLength(6);
    expect(tail[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'prompt B' }] });
  });

  it('never splits a tool_use from its tool_result across the boundary', () => {
    const { tail } = splitForCompaction(sampleHistory(), 2);
    // The tail must start on a genuine user-text prompt, so no orphan tool_result leads it.
    const firstBlock = tail[0].content[0];
    expect(firstBlock.type).toBe('text');
  });

  it('returns an empty head when there are not more than keepExchanges exchanges', () => {
    const short: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'only prompt' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    ];
    const { head, tail } = splitForCompaction(short, 2);
    expect(head).toEqual([]);
    expect(tail).toEqual(short);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: FAIL — `splitForCompaction is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/agent/compact.ts`:

```typescript
export const KEEP_EXCHANGES = 2;

// A genuine user turn: role 'user' with at least one text block. A user message that
// only carries tool_result blocks is the *middle* of an agent exchange, not a new turn.
function isUserPrompt(m: Message): boolean {
  return m.role === 'user' && m.content.some((b) => b.type === 'text');
}

// Split the history so the last `keepExchanges` real exchanges stay verbatim (tail) and
// everything before is summarizable (head). The boundary always lands on a user-prompt
// message, which guarantees no tool_use/tool_result pair is split across head/tail.
export function splitForCompaction(
  messages: Message[],
  keepExchanges = KEEP_EXCHANGES,
): { head: Message[]; tail: Message[] } {
  const promptIndices = messages.map((m, i) => (isUserPrompt(m) ? i : -1)).filter((i) => i >= 0);
  if (promptIndices.length <= keepExchanges) return { head: [], tail: messages };
  const boundary = promptIndices[promptIndices.length - keepExchanges];
  return { head: messages.slice(0, boundary), tail: messages.slice(boundary) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: PASS (9 total assertions across the file).

- [ ] **Step 5: Commit**

```bash
git add src/agent/compact.ts test/agent/compact.test.ts
git commit -m "feat(compact): split history at tool-pair-safe user-turn boundary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `summaryInput` — defensively shrink head for summarization

**Files:**
- Modify: `src/agent/compact.ts`
- Test: `test/agent/compact.test.ts`

**Interfaces:**
- Consumes: `Message`, `ContentBlock` types.
- Produces:
  - `SUMMARY_INSTRUCTION` (string const) — the trailing user instruction.
  - `TOOL_RESULT_KEEP = 1000` (const) — max chars kept from each end of a tool_result before eliding.
  - `summaryInput(head: Message[]): Message[]` — returns head with every `tool_result` content truncated (head+tail kept, middle elided with a `… [N chars elided] …` marker) and every `image` block dropped, followed by one `{role:'user'}` message containing `SUMMARY_INSTRUCTION`.

- [ ] **Step 1: Write the failing test**

Append to `test/agent/compact.test.ts`:

```typescript
import { summaryInput, SUMMARY_INSTRUCTION } from '../../src/agent/compact.js';

describe('summaryInput', () => {
  it('truncates oversized tool_result content and marks the elision', () => {
    const head: Message[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'x'.repeat(50_000), isError: false }] },
    ];
    const out = summaryInput(head);
    const block = out[1].content[0];
    if (block.type !== 'tool_result') throw new Error('expected tool_result');
    expect(block.content.length).toBeLessThan(50_000);
    expect(block.content).toContain('elided');
  });

  it('drops image blocks from kept messages', () => {
    const head: Message[] = [
      { role: 'user', content: [
        { type: 'text', text: 'see this' },
        { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      ] },
    ];
    const out = summaryInput(head);
    expect(out[0].content.some((b) => b.type === 'image')).toBe(false);
    expect(out[0].content.some((b) => b.type === 'text')).toBe(true);
  });

  it('appends a trailing user instruction asking for the summary', () => {
    const head: Message[] = [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }];
    const out = summaryInput(head);
    const last = out[out.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toEqual([{ type: 'text', text: SUMMARY_INSTRUCTION }]);
  });

  it('leaves short tool_result content untouched', () => {
    const head: Message[] = [
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'short', isError: false }] },
    ];
    const out = summaryInput(head);
    const block = out[0].content[0];
    if (block.type !== 'tool_result') throw new Error('expected tool_result');
    expect(block.content).toBe('short');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: FAIL — `summaryInput is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/agent/compact.ts` (also add `ContentBlock` to the type import at the top: `import type { Message, ContentBlock } from '../types.js';`):

```typescript
export const TOOL_RESULT_KEEP = 1000;
export const SUMMARY_INSTRUCTION =
  'Summarize the conversation so far as a concise, factual briefing for continuing the ' +
  'task. Capture: the user\'s goals and constraints, key decisions, files and code touched, ' +
  'important findings from tool results, and any unresolved next steps. Be specific about ' +
  'names and paths. Do not add commentary — this summary replaces the earlier messages.';

// Truncate a long string keeping the head and tail, eliding the middle.
function elide(s: string, keep: number): string {
  if (s.length <= keep * 2) return s;
  const removed = s.length - keep * 2;
  return `${s.slice(0, keep)}\n… [${removed} chars elided] …\n${s.slice(-keep)}`;
}

// Shrink one block: cap tool_result content, drop images, pass everything else through.
function shrinkBlock(b: ContentBlock): ContentBlock | null {
  if (b.type === 'image') return null;
  if (b.type === 'tool_result') return { ...b, content: elide(b.content, TOOL_RESULT_KEEP) };
  return b;
}

// Build the summarization request from the head. Tool results are capped and images
// dropped so this call cannot itself overflow — even when compaction is invoked from an
// already-maxed conversation. A trailing user instruction asks for the summary; because
// `head` ends on an assistant message, appending a user message keeps roles alternating.
export function summaryInput(head: Message[]): Message[] {
  const shrunk: Message[] = head.map((m) => ({
    role: m.role,
    content: m.content.map(shrinkBlock).filter((b): b is ContentBlock => b !== null),
  }));
  return [...shrunk, { role: 'user', content: [{ type: 'text', text: SUMMARY_INSTRUCTION }] }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/agent/compact.ts test/agent/compact.test.ts
git commit -m "feat(compact): build overflow-safe summarization input from head

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `buildCompacted` — reassemble summary + tail

**Files:**
- Modify: `src/agent/compact.ts`
- Test: `test/agent/compact.test.ts`

**Interfaces:**
- Consumes: `Message` type.
- Produces:
  - `SUMMARY_ACK` (string const) — the synthetic assistant acknowledgement.
  - `buildCompacted(summaryText: string, tail: Message[]): Message[]` → `[{role:'user', content:[text summary]}, {role:'assistant', content:[text ack]}, ...tail]`.

- [ ] **Step 1: Write the failing test**

Append to `test/agent/compact.test.ts`:

```typescript
import { buildCompacted, SUMMARY_ACK } from '../../src/agent/compact.js';

describe('buildCompacted', () => {
  const tail: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'prompt B' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'done B' }] },
  ];

  it('prepends the summary as a user message and a synthetic assistant ack', () => {
    const out = buildCompacted('SUMMARY TEXT', tail);
    expect(out[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'SUMMARY TEXT' }] });
    expect(out[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: SUMMARY_ACK }] });
    expect(out.slice(2)).toEqual(tail);
  });

  it('produces strictly alternating roles at the seam', () => {
    const out = buildCompacted('S', tail);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].role).not.toBe(out[i - 1].role);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: FAIL — `buildCompacted is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/agent/compact.ts`:

```typescript
export const SUMMARY_ACK =
  'Understood. I have the summary of the earlier conversation above and will continue from here.';

// Assemble the compacted history: the summary as a user message, a synthetic assistant
// ack, then the verbatim tail. The ack guarantees valid role alternation no matter which
// role the tail begins with.
export function buildCompacted(summaryText: string, tail: Message[]): Message[] {
  return [
    { role: 'user', content: [{ type: 'text', text: summaryText }] },
    { role: 'assistant', content: [{ type: 'text', text: SUMMARY_ACK }] },
    ...tail,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent/compact.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/agent/compact.ts test/agent/compact.test.ts
git commit -m "feat(compact): reassemble summary and verbatim tail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire `/compact` command and auto-compaction into the REPL

**Files:**
- Modify: `src/cli.ts` (`HELP` ~212-222; `CommandDeps` ~233-242; `handleReplCommand` ~245-294; `repl()` — add `lastInputTokens` tracking, `compactConversation`, deps, auto-trigger in `onSubmit`'s `finally` ~444-494)
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

**Interfaces:**
- Consumes from Task 1-4: `contextLimit`, `shouldCompact`, `splitForCompaction`, `summaryInput`, `buildCompacted`, `SUMMARY_SYSTEM` (defined below in this task).
- Produces: `compact` callback on `CommandDeps`; `/compact` case in `handleReplCommand`.

- [ ] **Step 1: Add `SUMMARY_SYSTEM` const to the compact module**

In `src/agent/compact.ts`, add near the other constants:

```typescript
export const SUMMARY_SYSTEM =
  'You are a summarization engine for a coding assistant. Produce a dense, factual ' +
  'summary of the conversation that preserves everything needed to continue the work. ' +
  'Output only the summary text.';
```

Commit:

```bash
git add src/agent/compact.ts
git commit -m "feat(compact): add summarization system prompt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 2: Import the compact helpers in `src/cli.ts`**

Add near the other `./agent` / `./providers` imports at the top of `src/cli.ts`:

```typescript
import { splitForCompaction, summaryInput, buildCompacted, shouldCompact, SUMMARY_SYSTEM } from './agent/compact.js';
```

- [ ] **Step 3: Add `/compact` to `HELP` and `compact` to `CommandDeps`**

In `HELP` (src/cli.ts ~212), add a line after the `/resume` line:

```typescript
  '  /compact           summarize older history to free up context',
```

In `CommandDeps` (src/cli.ts ~233), add:

```typescript
  compact: () => void;
```

In `handleReplCommand`'s switch (src/cli.ts ~248), add a case:

```typescript
    case 'compact':
      deps.compact();
      break;
```

- [ ] **Step 4: Track the last request's input tokens in `repl()`**

In `repl()`, near `let running = false;` (src/cli.ts ~314), add:

```typescript
  let lastInputTokens = 0;
```

In `onSubmit`, replace the `onUsage: h.onUsage,` argument (src/cli.ts ~471) with a wrapper that records the latest request size:

```typescript
        onUsage: (inTok: number, outTok: number) => { lastInputTokens = inTok; h.onUsage(inTok, outTok); },
```

- [ ] **Step 5: Add the `compactConversation` closure in `repl()`**

Place this just above `onSubmit` (src/cli.ts ~444), so it closes over `messages`, `session`, `store`, and `sessions`/`currentId` for persistence:

```typescript
  // Shrink the model-facing history in place: summarize everything but the last couple of
  // exchanges, keep the tail verbatim. Only `messages` changes; the visible transcript is
  // left intact with a system note appended. Fail-safe: on any error the history is
  // untouched.
  const compactConversation = async (auto: boolean): Promise<void> => {
    const { head, tail } = splitForCompaction(messages);
    if (head.length === 0) { store.addSystem('Nothing to compact yet.'); return; }
    const before = lastInputTokens;
    try {
      let summary = '';
      for await (const ev of session.provider.stream(summaryInput(head), [], {
        model: session.model, systemPrompt: SUMMARY_SYSTEM, maxTokens: 8192,
      })) {
        if (ev.type === 'text') summary += ev.text;
      }
      if (!summary.trim()) { store.addSystem('⚠ compaction failed: empty summary'); return; }
      messages.splice(0, messages.length, ...buildCompacted(summary, tail));
      const note = auto
        ? '✻ Auto-compacted context to stay under the model\'s token limit'
        : '✻ Compacted context';
      const freed = before > 0 ? `  (was ~${Math.round(before / 1000)}k input tokens)` : '';
      store.addSystem(`${note}${freed}`);
      lastInputTokens = 0;
      void sessions.save({
        id: currentId, cwd, createdAt, updatedAt: Date.now(),
        provider: session.providerName, model: session.model, title,
        messages, transcript: store.getState().transcript,
      }).catch(() => store.addSystem('⚠ could not save session history'));
    } catch (err) {
      store.addSystem(`⚠ compaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
```

- [ ] **Step 6: Pass `compact` into `handleReplCommand` and guard against concurrent runs**

In `onSubmit`, update the `handleReplCommand` call (src/cli.ts ~447) to include the callback. `/compact` runs async but `handleReplCommand` is sync, so kick it off in a guarded IIFE and set `running` so a second `/compact` (or a prompt) can't overlap:

```typescript
    if (input.display.startsWith('/')) {
      handleReplCommand(input.display, session, {
        config, effectiveConfig, store, refreshMeta, applyTheme, pickModel, resumeSession, exit,
        compact: () => {
          if (running) return;
          running = true;
          store.setStatus('busy');
          void compactConversation(false).finally(() => { store.setStatus('idle'); running = false; });
        },
      });
      return;
    }
```

- [ ] **Step 7: Auto-trigger after a completed turn**

In `onSubmit`'s `finally` block (src/cli.ts ~482-493), after `running = false;` and after the existing `void sessions.save(...)`, append:

```typescript
      if (!interrupted && shouldCompact(lastInputTokens, session.model)) {
        running = true;
        store.setStatus('busy');
        void compactConversation(true).finally(() => { store.setStatus('idle'); running = false; });
      }
```

- [ ] **Step 8: Add the changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added` (create the `### Added` subheading if absent):

```markdown
- `/compact` command and automatic context compaction near the model's token limit, so long sessions no longer dead-end on "prompt is too long".
```

- [ ] **Step 9: Typecheck, build, and run the full suite**

Run: `npm run build`
Expected: builds with no TypeScript errors.

Run: `npm test`
Expected: all tests pass, including `test/agent/compact.test.ts`.

- [ ] **Step 10: Manual smoke check (optional but recommended)**

Run: `npm run dev` (or `node dist/cli.js`), then in the REPL type `/help` and confirm `/compact` is listed; type `/compact` on a fresh session and confirm it prints `Nothing to compact yet.`

- [ ] **Step 11: Commit**

```bash
git add src/cli.ts src/agent/compact.ts CHANGELOG.md
git commit -m "feat(compact): wire /compact command and auto-compaction into REPL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `contextLimit` / `shouldCompact` → Task 1. ✓
- `splitForCompaction` (tool-pair-safe, real user-turn boundary, empty head when short) → Task 2. ✓
- `summaryInput` (truncate tool_results, drop images, trailing instruction) → Task 3. ✓
- `buildCompacted` (user summary + assistant ack + tail, alternation) → Task 4. ✓
- Ground-truth `lastInputTokens` from the `usage` event, distinct from accumulated total → Task 5 Step 4. ✓
- `compactConversation` orchestration, only `messages` shrinks, transcript intact, fail-safe → Task 5 Step 5. ✓
- Manual `/compact` via `CommandDeps.compact` + `HELP` → Task 5 Steps 3, 6. ✓
- Auto near-threshold trigger after a turn → Task 5 Step 7. ✓
- System-line UI copy (`✻ Compacted…`, `✻ Auto-compacted…`, `Nothing to compact yet.`, `⚠ compaction failed…`) → Tasks 5 Steps 5-6. ✓
- Changelog `Added` bullet → Task 5 Step 8. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `splitForCompaction` returns `{head, tail}` used identically in Task 5; `summaryInput`/`buildCompacted`/`shouldCompact`/`SUMMARY_SYSTEM` names match their definitions; `ContentBlock` import added in Task 3 where first used. ✓

**Note for the implementer:** Tasks 1-4 build `src/agent/compact.ts` incrementally — the top-of-file type import becomes `import type { Message, ContentBlock } from '../types.js';` at Task 3. Apply tasks in order.
