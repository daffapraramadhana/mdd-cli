# Streaming Thinking Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the model's inline `<think>…</think>` reasoning as a dim, live-streaming block that collapses to a `✻ Thought for Ns` one-liner once the answer begins.

**Architecture:** `ThinkSplitter` already parses the `<think>` tags that `cc/*` 9router models emit; today it discards the content. We flip it to return the reasoning on a second channel, route that into new ephemeral store state (`reasoning`), render it dimmed above the streaming answer (tail-capped), and commit a compact `{ kind: 'reasoning', durationMs }` summary to the transcript when reasoning ends.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React 19 + Ink 6 for the TUI, Vitest + ink-testing-library for tests.

## Global Constraints

- ESM project: **all relative imports use `.js` extensions**, even for `.ts`/`.tsx` sources (e.g. `import { UiStore } from './store.js'`).
- `UiStore` takes an injectable clock: `constructor(private now: () => number = Date.now)`. Use `this.now()` for all timestamps — never `Date.now()` directly in the store.
- `visible` output of `ThinkSplitter` must remain byte-for-byte identical to today's behavior — the answer-rendering path must not change.
- Follow existing file conventions: top-of-file `// src/path` comment, terse inline comments explaining *why*.
- Test commands: single file `npx vitest run test/ui/<file>`; full suite `npm test`; typecheck/build `npm run build`.

---

### Task 1: `ThinkSplitter` returns reasoning on a second channel

**Files:**
- Modify: `src/ui/think.ts`
- Test: `test/ui/think.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `ThinkSplitter.push(delta: string): { visible: string; thinking: string }`
  - `ThinkSplitter.flush(): { visible: string; thinking: string }`

- [ ] **Step 1: Rewrite the test file to assert both channels**

Replace the entire contents of `test/ui/think.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { ThinkSplitter } from '../../src/ui/think.js';

function run(chunks: string[]): { visible: string; thinking: string } {
  const s = new ThinkSplitter();
  let visible = '';
  let thinking = '';
  for (const c of chunks) {
    const r = s.push(c);
    visible += r.visible;
    thinking += r.thinking;
  }
  const f = s.flush();
  return { visible: visible + f.visible, thinking: thinking + f.thinking };
}

describe('ThinkSplitter', () => {
  it('passes plain text through unchanged with no thinking', () => {
    expect(run(['hello world'])).toEqual({ visible: 'hello world', thinking: '' });
  });

  it('separates a complete <think> block from visible text', () => {
    expect(run(['a<think>secret</think>b'])).toEqual({ visible: 'ab', thinking: 'secret' });
  });

  it('yields empty thinking for an empty <think></think> block', () => {
    expect(run(['<think></think>ok'])).toEqual({ visible: 'ok', thinking: '' });
  });

  it('handles a tag split across chunks', () => {
    // "<thi" | "nk>hidden</thi" | "nk>done"
    expect(run(['<thi', 'nk>hidden</thi', 'nk>done'])).toEqual({ visible: 'done', thinking: 'hidden' });
  });

  it('accumulates think content arriving in many small chunks', () => {
    expect(run(['before ', '<think>', 'a', 'b', 'c', '</think>', ' after']))
      .toEqual({ visible: 'before  after', thinking: 'abc' });
  });

  it('keeps a literal < that is not a think tag', () => {
    expect(run(['x < y and <div>'])).toEqual({ visible: 'x < y and <div>', thinking: '' });
  });

  it('surfaces an unterminated think block at end of stream', () => {
    expect(run(['visible<think>still thinking']))
      .toEqual({ visible: 'visible', thinking: 'still thinking' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ui/think.test.ts`
Expected: FAIL — `push`/`flush` currently return strings, so `.visible`/`.thinking` are `undefined` and the `toEqual` assertions fail.

- [ ] **Step 3: Rewrite `ThinkSplitter` to emit thinking instead of dropping it**

Replace the entire contents of `src/ui/think.ts` with:

```ts
// src/ui/think.ts
// Streaming filter that SEPARATES <think>…</think> reasoning from the visible response.
// Tags may be split across deltas, so partial tags at a chunk boundary are held back.
// Returns two channels per call: `visible` (answer text) and `thinking` (reasoning).

const OPEN = '<think>';
const CLOSE = '</think>';

export class ThinkSplitter {
  private buf = '';
  private inThink = false;

  /** Feed a streamed delta; returns the visible answer text and reasoning ready to show. */
  push(delta: string): { visible: string; thinking: string } {
    this.buf += delta;
    let out = '';
    let think = '';
    for (;;) {
      if (!this.inThink) {
        const lt = this.buf.indexOf('<');
        if (lt === -1) { out += this.buf; this.buf = ''; break; }
        out += this.buf.slice(0, lt);
        this.buf = this.buf.slice(lt);
        if (this.buf.startsWith(OPEN)) { this.inThink = true; this.buf = this.buf.slice(OPEN.length); continue; }
        if (OPEN.startsWith(this.buf)) break; // partial "<think>" — wait for more
        out += '<'; this.buf = this.buf.slice(1); continue; // literal '<'
      } else {
        const lt = this.buf.indexOf('<');
        if (lt === -1) { think += this.buf; this.buf = ''; break; } // reasoning content
        think += this.buf.slice(0, lt); // reasoning before '<'
        this.buf = this.buf.slice(lt);
        if (this.buf.startsWith(CLOSE)) { this.inThink = false; this.buf = this.buf.slice(CLOSE.length); continue; }
        if (CLOSE.startsWith(this.buf)) break; // partial "</think>" — wait
        think += '<'; this.buf = this.buf.slice(1); continue; // '<' inside think
      }
    }
    return { visible: out, thinking: think };
  }

  /** Flush any trailing buffered text at the end of a turn. */
  flush(): { visible: string; thinking: string } {
    const visible = this.inThink ? '' : this.buf;
    const thinking = this.inThink ? this.buf : '';
    this.buf = '';
    this.inThink = false;
    return { visible, thinking };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ui/think.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/think.ts test/ui/think.test.ts
git commit -m "feat(ui): ThinkSplitter surfaces reasoning instead of dropping it"
```

---

### Task 2: Store gains ephemeral reasoning state + collapse-to-summary

**Files:**
- Modify: `src/ui/store.ts`
- Test: `test/ui/store.test.ts`

**Interfaces:**
- Consumes: `UiStore` constructor clock `now()` (existing).
- Produces:
  - `TranscriptItem` union gains: `{ kind: 'reasoning'; durationMs: number }`
  - `UiState` gains: `reasoning: string`, `reasoningStartedAt: number | null`
  - `UiStore.appendReasoning(delta: string): void`
  - Collapse is automatic — no public method. It fires from `appendStreaming` (first answer delta) and `commitStreaming` (which `startTool` already calls, and turn-end calls directly).

- [ ] **Step 1: Add failing tests for reasoning accumulation + collapse**

Append these tests inside the top-level `describe('UiStore', () => { … })` block in `test/ui/store.test.ts` (before its closing `});`):

```ts
  it('accumulates reasoning and stamps the start time on the first delta', () => {
    let t = 200;
    const s = new UiStore(() => t);
    s.appendReasoning('let me ');
    t = 999; // later deltas must NOT move the start stamp
    s.appendReasoning('think');
    expect(s.getState().reasoning).toBe('let me think');
    expect(s.getState().transcript).toEqual([]); // not collapsed yet
  });

  it('collapses reasoning to a summary when the first answer text arrives', () => {
    let t = 100;
    const s = new UiStore(() => t);
    s.appendReasoning('pondering');
    t = 450;
    s.appendStreaming('Here is the answer');
    expect(s.getState().reasoning).toBe('');
    expect(s.getState().reasoningStartedAt).toBeNull();
    expect(s.getState().streaming).toBe('Here is the answer');
    expect(s.getState().transcript).toEqual([{ kind: 'reasoning', durationMs: 350 }]);
  });

  it('collapses reasoning before a tool call that has no preceding answer text', () => {
    let t = 0;
    const s = new UiStore(() => t);
    s.appendReasoning('I should read the file');
    t = 120;
    s.startTool('read_file', { path: 'a' });
    expect(s.getState().reasoning).toBe('');
    expect(s.getState().transcript).toEqual([{ kind: 'reasoning', durationMs: 120 }]);
    expect(s.getState().activeTool).toEqual({ name: 'read_file', input: { path: 'a' }, startedAt: 120 });
  });

  it('collapses trailing reasoning at turn end via commitStreaming', () => {
    let t = 10;
    const s = new UiStore(() => t);
    s.appendReasoning('unfinished thought');
    t = 60;
    s.commitStreaming();
    expect(s.getState().reasoning).toBe('');
    expect(s.getState().transcript).toEqual([{ kind: 'reasoning', durationMs: 50 }]);
  });

  it('emits only one reasoning summary per round even with interleaved answer deltas', () => {
    const s = new UiStore(() => 0);
    s.appendReasoning('think');
    s.appendStreaming('a');
    s.appendStreaming('b'); // second answer delta must not add another summary
    const reasoningItems = s.getState().transcript.filter((i) => i.kind === 'reasoning');
    expect(reasoningItems).toHaveLength(1);
  });

  it('produces no summary when there was no reasoning', () => {
    const s = new UiStore(() => 0);
    s.appendStreaming('just an answer');
    s.commitStreaming();
    expect(s.getState().transcript).toEqual([{ kind: 'assistant', text: 'just an answer' }]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/ui/store.test.ts`
Expected: FAIL — `appendReasoning` is not a function; `reasoning`/`reasoningStartedAt` are `undefined`.

- [ ] **Step 3: Extend the `TranscriptItem` union and `UiState`**

In `src/ui/store.ts`, change the `TranscriptItem` type (currently ends with the `system` variant) to add a `reasoning` variant:

```ts
export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; input: unknown; status: 'ok' | 'error'; durationMs: number }
  | { kind: 'reasoning'; durationMs: number }
  | { kind: 'system'; text: string };
```

In the `UiState` interface, add two fields (place them next to `streaming`):

```ts
  streaming: string;
  reasoning: string;
  reasoningStartedAt: number | null;
```

In the `private state: UiState = { … }` initializer, add the defaults:

```ts
    transcript: [], streaming: '', reasoning: '', reasoningStartedAt: null,
    status: 'idle', pendingPrompt: null, meta: null, activeTool: null,
    themeName: 'neon', pendingSelect: null, usage: { inputTokens: 0, outputTokens: 0 },
```

- [ ] **Step 4: Add `appendReasoning`, a private `collapseReasoning`, and wire the collapse into `appendStreaming` + `commitStreaming`**

In `src/ui/store.ts`, add `appendReasoning` and `collapseReasoning` immediately after the existing `appendStreaming` method, and prepend the collapse call to both `appendStreaming` and `commitStreaming`.

Replace the existing `appendStreaming` and `commitStreaming` methods with:

```ts
  appendStreaming = (delta: string): void => {
    this.collapseReasoning(); // first answer delta ends the reasoning block
    this.set({ streaming: this.state.streaming + delta });
  };

  appendReasoning = (delta: string): void => {
    this.set({
      reasoning: this.state.reasoning + delta,
      reasoningStartedAt: this.state.reasoningStartedAt ?? this.now(),
    });
  };

  // Reasoning "ends" (answer text starts, a tool starts, or the turn ends): drop the live
  // block and leave a compact "✻ Thought for Ns" summary in scrollback. Idempotent no-op
  // when no reasoning is pending, so it is safe to call from every end condition.
  private collapseReasoning(): void {
    if (this.state.reasoningStartedAt === null) return;
    const durationMs = Math.max(0, this.now() - this.state.reasoningStartedAt);
    this.set({
      transcript: [...this.state.transcript, { kind: 'reasoning', durationMs }],
      reasoning: '',
      reasoningStartedAt: null,
    });
  }

  commitStreaming = (): void => {
    this.collapseReasoning();
    if (!this.state.streaming) return;
    this.set({
      transcript: [...this.state.transcript, { kind: 'assistant', text: this.state.streaming }],
      streaming: '',
    });
  };
```

Note: `startTool` already calls `commitStreaming()` first, so it inherits the collapse automatically — no change to `startTool` needed. Also update `loadTranscript` to clear reasoning on restore:

```ts
  loadTranscript = (items: TranscriptItem[]): void => {
    this.set({ transcript: items, streaming: '', reasoning: '', reasoningStartedAt: null });
  };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/ui/store.test.ts`
Expected: PASS (all existing + 6 new tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/store.ts test/ui/store.test.ts
git commit -m "feat(ui): store live reasoning state, collapse to summary on answer/tool/turn-end"
```

---

### Task 3: Wire the split into the stream handlers

**Files:**
- Modify: `src/cli.ts:151-161` (the `streamHandlers` function)
- Test: `test/ui/stream-handlers.test.ts` (create)

**Interfaces:**
- Consumes: `ThinkSplitter.push/flush` returning `{ visible, thinking }` (Task 1); `UiStore.appendReasoning` + `appendStreaming` (Task 2).
- Produces: `export function streamHandlers(store: UiStore)` — now exported so it can be unit-tested. Its `onText`/`flush` route `thinking` → `appendReasoning` and `visible` → `appendStreaming`.

- [ ] **Step 1: Write the failing test**

Create `test/ui/stream-handlers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { streamHandlers } from '../../src/cli.js';
import { UiStore } from '../../src/ui/store.js';

describe('streamHandlers', () => {
  it('routes <think> content to reasoning and the rest to streaming', () => {
    const store = new UiStore(() => 0);
    const h = streamHandlers(store);
    h.onText('<think>reasoning here</think>');
    expect(store.getState().reasoning).toBe('reasoning here');
    h.onText('visible answer');
    // first answer delta collapses reasoning into a summary
    expect(store.getState().reasoning).toBe('');
    expect(store.getState().streaming).toBe('visible answer');
    expect(store.getState().transcript.some((i) => i.kind === 'reasoning')).toBe(true);
  });

  it('surfaces an unterminated think block into pending reasoning state', () => {
    const store = new UiStore(() => 0);
    const h = streamHandlers(store);
    h.onText('answer');
    h.onText('<think>still going'); // no closing tag, no following answer text
    h.flush();
    // The handler leaves reasoning pending; the caller's commitStreaming collapses it at turn end.
    expect(store.getState().streaming).toBe('answer');
    expect(store.getState().reasoning).toBe('still going');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ui/stream-handlers.test.ts`
Expected: FAIL — `streamHandlers` is not exported from `src/cli.ts`.

- [ ] **Step 3: Export `streamHandlers` and route both channels**

In `src/cli.ts`, replace the existing `streamHandlers` function (lines ~151-161) with:

```ts
/** Per-turn streaming callbacks: splits <think> reasoning from answer text, tracks tools, flush at end. */
export function streamHandlers(store: UiStore) {
  const splitter = new ThinkSplitter();
  return {
    onText: (delta: string): void => {
      const { visible, thinking } = splitter.push(delta);
      if (thinking) store.appendReasoning(thinking);
      if (visible) store.appendStreaming(visible);
    },
    onToolStart: (name: string, input: unknown): void => store.startTool(name, input),
    onToolEnd: (isError: boolean): void => store.endTool(isError ? 'error' : 'ok'),
    onUsage: (inTok: number, outTok: number): void => store.addUsage(inTok, outTok),
    flush: (): void => {
      const { visible, thinking } = splitter.flush();
      if (thinking) store.appendReasoning(thinking);
      if (visible) store.appendStreaming(visible);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ui/stream-handlers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/ui/stream-handlers.test.ts
git commit -m "feat(cli): route <think> reasoning into the live reasoning block"
```

---

### Task 4: Render the live reasoning block + scrollback summary

**Files:**
- Modify: `src/ui/app.tsx` (`renderItem` for the committed summary; `liveRows` for the live block)
- Test: `test/ui/app.test.tsx`

**Interfaces:**
- Consumes: `state.reasoning` (string), and `{ kind: 'reasoning'; durationMs }` transcript items (Task 2).
- Produces: no exports; visual rendering only.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the top-level `describe('App', () => { … })` block in `test/ui/app.test.tsx` (before its closing `});`):

```ts
  it('renders the live reasoning block dimmed while thinking', () => {
    const store = new UiStore();
    store.setStatus('busy');
    store.appendReasoning('weighing the options');
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Thinking');
    expect(frame).toContain('weighing the options');
  });

  it('caps the live reasoning block to the last 8 lines', () => {
    const store = new UiStore();
    store.setStatus('busy');
    store.appendReasoning(Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n'));
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('line0'); // trimmed from the top
    expect(frame).toContain('line11'); // newest kept
  });

  it('renders a collapsed reasoning summary in scrollback', () => {
    const store = new UiStore();
    store.loadTranscript([{ kind: 'reasoning', durationMs: 2300 }]);
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Thought for 2.3s');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: FAIL — no "Thinking" live block, no "Thought for" summary rendered.

- [ ] **Step 3: Render the collapsed summary in `renderItem`**

In `src/ui/app.tsx`, inside `renderItem`, add a `reasoning` case just before the final tool-line `return` (after the `system` block, before `const ok = item.status === 'ok';`):

```tsx
  if (item.kind === 'reasoning') {
    return (
      <Box key={key} marginTop={1}>
        <Box width={GUTTER} flexShrink={0}><Text> </Text></Box>
        <Text dimColor>{`✻ Thought for ${(item.durationMs / 1000).toFixed(1)}s`}</Text>
      </Box>
    );
  }
```

- [ ] **Step 4: Render the live reasoning block in `liveRows`**

In `src/ui/app.tsx`, add the live reasoning block at the **start** of the `liveRows` fragment (immediately after the opening `<>`, before the `{state.streaming ? (` line). It tail-caps to the last 8 lines so the in-place live region stays stable:

```tsx
      {state.reasoning ? (
        <Row label="MDD" color={theme.assistant}>
          <Box flexDirection="column">
            <Text dimColor>{`✻ Thinking${thinkingDots(tick)}`}</Text>
            <Text dimColor italic>{state.reasoning.split('\n').slice(-8).join('\n')}</Text>
          </Box>
        </Row>
      ) : null}
```

Note: `thinkingDots`, `Row`, and `theme` are already imported/in scope in `app.tsx`. The `animating` flag (line 98) already includes `state.status === 'busy'`, so the tick animation runs while reasoning streams — no change needed there.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: PASS (all existing + 3 new tests).

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run build`
Expected: All tests pass; build (tsup) completes with no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/app.tsx test/ui/app.test.tsx
git commit -m "feat(ui): render live reasoning block and collapsed Thought-for summary"
```

---

## Manual Verification

After Task 4, exercise the real flow against a `cc/*` model that emits `<think>` tags:

```bash
npm run dev -- --provider openai --base-url http://localhost:20128/v1 --model cc/claude-sonnet-5
```

Ask a question that induces reasoning. Confirm:
1. A dim `✻ Thinking…` block streams the reasoning live below the `MDD` label.
2. When the answer starts, the block disappears and a dim `✻ Thought for Ns` line remains above the answer.
3. On a long reasoning burst, the live block stays ~8 lines tall (no terminal flooding).
4. `mdd resume` on that session shows the `✻ Thought for Ns` summary but not the full reasoning.

## Self-Review Notes

- **Spec coverage:** ThinkSplitter two-channel (Task 1) · store reasoning state + collapse on all three end conditions (Task 2) · cli wiring (Task 3) · live dim tail-capped block + scrollback one-liner (Task 4) · persistence auto-handled by JSON transcript (no task needed, verified in manual step 4). All spec sections mapped.
- **Type consistency:** `{ visible, thinking }` shape identical across Tasks 1/3; `{ kind: 'reasoning'; durationMs: number }` identical across Tasks 2/4; `appendReasoning`/`collapseReasoning` names consistent.
- **No placeholders:** every code step shows complete code; every run step states the expected result.
