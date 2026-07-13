# Live Turns, Legible Results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an in-progress MDD turn feel alive (live tool timer, turn heartbeat, esc-to-interrupt) and make what it did legible (per-tool result preview lines), plus softer turn separation and a grouped tool rail.

**Architecture:** The tool result string already exists in `loop.ts` (`r.content`) and is discarded by `onToolEnd`. We thread it through the callback into the store, which summarizes it via a pure `summarizePreview()` in `format.ts` and attaches it to the committed tool item. Rendering additions live in `app.tsx`. Interrupt reuses the existing `AbortSignal` seam on `runTurn`.

**Tech Stack:** TypeScript, Ink (React for terminal), Vitest. Tests in `test/ui/**` mirror `src/ui/**` and import from `../../src/ui/X.js`.

## Global Constraints

- Tests: `npm test` runs `vitest run`. Run a single file with `npx vitest run test/ui/<file>.test.ts`.
- Import style in tests: `import { ... } from '../../src/ui/<name>.js'` (note the `.js` extension on TS source imports — this repo uses NodeNext resolution).
- No new dependencies. Ink and its hooks (`useInput`, `useStdout`) are already available.
- Preview lines are **live-only** and NOT persisted — do not add `preview` to anything `sessions.save`/`loadTranscript` round-trips beyond the in-memory transcript item. Restored sessions simply render tool items without a preview line.
- `preview` is optional on the tool transcript item. Existing `store.test.ts` assertions use `toEqual` (which ignores `undefined` properties), so an absent/undefined `preview` must not appear as a defined key.
- Two `runTurn` call sites exist: `src/cli.ts:176` (one-shot, no keyboard — never gets interrupt) and `src/cli.ts:377` (interactive REPL — gets interrupt).

---

### Task 1: `summarizePreview` — pure per-tool result summary

**Files:**
- Modify: `src/ui/format.ts`
- Test: `test/ui/format.test.ts`

**Interfaces:**
- Produces: `summarizePreview(name: string, content: string | undefined, isError: boolean): string | undefined` — returns a one-line dim preview string, or `undefined` when there's nothing worth showing.

Real tool `content` shapes (verified in `src/tools/*.ts`):
- `read_file` → full file text (truncated). Summarize as `N lines · S` where S is a human byte size.
- `list_dir` → newline-joined entries, or `(empty)`. Summarize as `N entries`.
- `search` → matches text, or `(no matches)`. Summarize as `N matches` / `no matches`.
- `run_shell` / `exec` → stdout+stderr joined+truncated, or `(no output)`. Summarize as the first non-empty line, truncated. Errors begin with `exit code N`.
- `git` → git output. Summarize as first non-empty line, truncated.
- `write_file` → `Wrote N bytes to <path>`. Summarize as `wrote S` (human byte size).
- `multi_edit` → `Applied N edit(s) to <path>`. Summarize as `N edits`.
- `edit_file` → `Edited <path>` (no counts available). Return `undefined` (the tool line already names the file; no useful extra fact). See optional Task 7 to add `+X −Y`.
- Any error → first non-empty line of `content`, truncated (rendered in error color by the caller, so this function just returns the text).

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/format.test.ts`:

```typescript
import { summarizePreview } from '../../src/ui/format.js';

describe('summarizePreview', () => {
  it('summarizes read_file as line count + human size', () => {
    const body = Array.from({ length: 42 }, () => 'x').join('\n'); // 42 lines
    expect(summarizePreview('read_file', body, false)).toBe('42 lines · 83 B');
  });
  it('uses KB for larger reads', () => {
    const body = 'a'.repeat(2048);
    expect(summarizePreview('read_file', body, false)).toBe('1 lines · 2.0 KB');
  });
  it('summarizes list_dir as entry count, ignoring the (empty) sentinel', () => {
    expect(summarizePreview('list_dir', 'a.ts\nb.ts\nc.ts', false)).toBe('3 entries');
    expect(summarizePreview('list_dir', '(empty)', false)).toBe('empty');
  });
  it('summarizes search as match count', () => {
    expect(summarizePreview('search', 'src/a.ts:1: hit\nsrc/b.ts:9: hit', false)).toBe('2 matches');
    expect(summarizePreview('search', '(no matches)', false)).toBe('no matches');
  });
  it('summarizes run_shell as the first non-empty output line, truncated', () => {
    expect(summarizePreview('run_shell', '\n  42 passing\n1 pending', false)).toBe('42 passing');
    const long = 'x'.repeat(80);
    expect(summarizePreview('run_shell', long, false)).toBe('x'.repeat(57) + '…');
  });
  it('summarizes write_file as human size written', () => {
    expect(summarizePreview('write_file', 'Wrote 2048 bytes to a.ts', false)).toBe('wrote 2.0 KB');
  });
  it('summarizes multi_edit as edit count', () => {
    expect(summarizePreview('multi_edit', 'Applied 3 edit(s) to a.ts', false)).toBe('3 edits');
  });
  it('returns undefined for edit_file success (no useful extra fact)', () => {
    expect(summarizePreview('edit_file', 'Edited a.ts', false)).toBeUndefined();
  });
  it('returns undefined when content is missing', () => {
    expect(summarizePreview('read_file', undefined, false)).toBeUndefined();
  });
  it('shows the first line of an error, truncated', () => {
    expect(summarizePreview('run_shell', 'exit code 1\nboom', true)).toBe('exit code 1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/ui/format.test.ts`
Expected: FAIL — `summarizePreview is not a function` / not exported.

- [ ] **Step 3: Implement `summarizePreview`**

Add to `src/ui/format.ts` (below `formatToolCall`):

```typescript
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function firstLine(s: string, max = 58): string {
  const line = s.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** One-line dim preview of a tool result, or undefined when there's nothing worth showing. */
export function summarizePreview(name: string, content: string | undefined, isError: boolean): string | undefined {
  if (content === undefined) return undefined;
  if (isError) return firstLine(content) || undefined;

  switch (name) {
    case 'read_file': {
      const lines = content.split('\n').length;
      return `${lines} lines · ${humanBytes(Buffer.byteLength(content))}`;
    }
    case 'list_dir': {
      if (content.trim() === '(empty)') return 'empty';
      const n = content.split('\n').filter((l) => l.trim() !== '').length;
      return `${n} entries`;
    }
    case 'search': {
      if (content.trim() === '(no matches)') return 'no matches';
      const n = content.split('\n').filter((l) => l.trim() !== '').length;
      return `${n} matches`;
    }
    case 'write_file': {
      const m = content.match(/Wrote (\d+) bytes/);
      return m ? `wrote ${humanBytes(Number(m[1]))}` : firstLine(content) || undefined;
    }
    case 'multi_edit': {
      const m = content.match(/Applied (\d+) edit/);
      return m ? `${m[1]} edits` : firstLine(content) || undefined;
    }
    case 'edit_file':
      return undefined;
    default:
      return firstLine(content) || undefined;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/ui/format.test.ts`
Expected: PASS (all `summarizePreview` tests plus the existing `formatToolCall`/`toolIcon` tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/format.ts test/ui/format.test.ts
git commit -m "feat(ui): summarizePreview for per-tool result previews"
```

---

### Task 2: Store — preview on tool item, turn start time, abort hook

**Files:**
- Modify: `src/ui/store.ts`
- Test: `test/ui/store.test.ts`

**Interfaces:**
- Consumes: `summarizePreview` (Task 1).
- Produces:
  - `TranscriptItem` tool variant gains `preview?: string`.
  - `endTool(status: 'ok' | 'error', content?: string): void` — summarizes `content` against the active tool's name and stores the result as `preview` (omitted when undefined).
  - `UiState` gains `turnStartedAt: number | null`.
  - `setStatus('busy')` stamps `turnStartedAt = now()`; `setStatus('idle')` clears it to `null`.
  - `setAbort(fn: (() => void) | null): void` and `requestAbort(): void` (calls the registered hook if present).

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/store.test.ts`:

```typescript
it('attaches a summarized preview to the committed tool item', () => {
  let t = 0;
  const s = new UiStore(() => t);
  s.startTool('list_dir', { path: '.' });
  t = 5;
  s.endTool('ok', 'a.ts\nb.ts');
  const item = s.getState().transcript.at(-1);
  expect(item).toEqual({ kind: 'tool', name: 'list_dir', input: { path: '.' }, status: 'ok', durationMs: 5, preview: '2 entries' });
});

it('omits preview when the summary is undefined', () => {
  const s = new UiStore(() => 0);
  s.startTool('edit_file', { path: 'a.ts' });
  s.endTool('ok', 'Edited a.ts');
  const item = s.getState().transcript.at(-1) as Record<string, unknown>;
  expect('preview' in item).toBe(false);
});

it('stamps turnStartedAt on busy and clears it on idle', () => {
  let t = 100;
  const s = new UiStore(() => t);
  expect(s.getState().turnStartedAt).toBeNull();
  s.setStatus('busy');
  expect(s.getState().turnStartedAt).toBe(100);
  s.setStatus('idle');
  expect(s.getState().turnStartedAt).toBeNull();
});

it('invokes the registered abort hook on requestAbort', () => {
  const s = new UiStore();
  let aborted = 0;
  s.setAbort(() => { aborted += 1; });
  s.requestAbort();
  expect(aborted).toBe(1);
  s.setAbort(null);
  s.requestAbort(); // no hook -> no throw, no increment
  expect(aborted).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/ui/store.test.ts`
Expected: FAIL — `endTool` ignores the 2nd arg; `turnStartedAt`/`setAbort`/`requestAbort` undefined.

- [ ] **Step 3: Implement the store changes**

In `src/ui/store.ts`:

Add `preview?` to the tool variant of `TranscriptItem`:

```typescript
  | { kind: 'tool'; name: string; input: unknown; status: 'ok' | 'error'; durationMs: number; preview?: string }
```

Add to `UiState`:

```typescript
  turnStartedAt: number | null;
```

Import `summarizePreview` at the top:

```typescript
import { summarizePreview } from './format.js';
```

Initialize the new state field (in the `private state` literal) and add an abort hook field:

```typescript
    themeName: 'neon', pendingSelect: null, usage: { inputTokens: 0, outputTokens: 0 }, turnStartedAt: null,
```

```typescript
  private abortHook: (() => void) | null = null;
```

Replace `endTool`:

```typescript
  // A tool finishes: move the active tool into the transcript with its outcome, elapsed time,
  // and (if the result summarizes to something) a one-line preview.
  endTool = (status: 'ok' | 'error', content?: string): void => {
    const active = this.state.activeTool;
    if (!active) return;
    const durationMs = Math.max(0, this.now() - active.startedAt);
    const preview = summarizePreview(active.name, content, status === 'error');
    const item: TranscriptItem = { kind: 'tool', name: active.name, input: active.input, status, durationMs, ...(preview ? { preview } : {}) };
    this.set({ transcript: [...this.state.transcript, item], activeTool: null });
  };
```

Replace `setStatus`:

```typescript
  setStatus = (status: 'idle' | 'busy'): void => {
    this.set({ status, turnStartedAt: status === 'busy' ? this.now() : null });
  };
```

Add the abort methods (anywhere among the public methods):

```typescript
  setAbort = (fn: (() => void) | null): void => { this.abortHook = fn; };

  requestAbort = (): void => { this.abortHook?.(); };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/ui/store.test.ts`
Expected: PASS (new tests plus all existing store tests — the existing `endTool('ok')` / `endTool('error')` calls still work since `content` is optional and produces no preview key).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store.ts test/ui/store.test.ts
git commit -m "feat(ui): store tool preview, turn start time, abort hook"
```

---

### Task 3: Loop — pass the result content through `onToolEnd`, and bridge it in the CLI

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/cli.ts:151-161` (`streamHandlers`)
- Test: `test/agent/loop.test.ts` (create if absent) OR extend an existing loop test file.

**Interfaces:**
- Consumes: `store.endTool(status, content)` (Task 2).
- Produces: `onToolEnd?: (isError: boolean, content?: string) => void` — now carries the raw tool result string. The CLI's `streamHandlers.onToolEnd` forwards `content` to `store.endTool`.

- [ ] **Step 1: Find or create the loop test file**

Run: `ls test/agent/ 2>/dev/null || echo "no agent test dir"`

If `test/agent/loop.test.ts` does not exist, create it with this scaffold (a minimal fake provider + registry that drives one tool round). If a loop test already exists, add the `it(...)` block from Step 2 into it and reuse its existing harness instead of this scaffold.

```typescript
import { describe, it, expect } from 'vitest';
import { runTurn } from '../../src/agent/loop.js';
import type { AgentDeps } from '../../src/agent/loop.js';

// Minimal fake provider: first stream yields one tool_use then done:tool_use; second yields done:end.
function fakeDeps(overrides: Partial<AgentDeps>): AgentDeps {
  let call = 0;
  const provider = {
    name: 'fake',
    async *stream() {
      call += 1;
      if (call === 1) {
        yield { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.ts' } } as const;
        yield { type: 'done', stopReason: 'tool_use' } as const;
      } else {
        yield { type: 'text', text: 'done' } as const;
        yield { type: 'done', stopReason: 'end' } as const;
      }
    },
  };
  const registry = {
    schemas: () => [],
    get: () => ({ handler: async () => ({ content: 'line1\nline2', isError: false }) }),
  };
  const gate = { check: async () => 'allow' as const };
  return {
    provider: provider as unknown as AgentDeps['provider'],
    registry: registry as unknown as AgentDeps['registry'],
    gate: gate as unknown as AgentDeps['gate'],
    cwd: '/tmp', model: 'm', systemPrompt: '',
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
describe('runTurn onToolEnd', () => {
  it('passes the tool result content to onToolEnd', async () => {
    const seen: Array<{ isError: boolean; content?: string }> = [];
    await runTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], fakeDeps({
      onToolEnd: (isError, content) => seen.push({ isError, content }),
    }));
    expect(seen).toEqual([{ isError: false, content: 'line1\nline2' }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/agent/loop.test.ts`
Expected: FAIL — `content` is `undefined` (loop passes only `isError`).

- [ ] **Step 4: Widen the callback and update all call sites in `loop.ts`**

Change the type in `AgentDeps`:

```typescript
  onToolEnd?: (isError: boolean, content?: string) => void;
```

Update the four `onToolEnd` call sites in `runTurn`:

```typescript
        results.push({ type: 'tool_result', toolUseId: use.id, content: `Unknown tool: ${use.name}`, isError: true });
        deps.onToolEnd?.(true, `Unknown tool: ${use.name}`);
```

```typescript
        results.push({ type: 'tool_result', toolUseId: use.id, content: 'User denied this tool call.', isError: true });
        deps.onToolEnd?.(true, 'User denied this tool call.');
```

```typescript
        const r = await tool.handler(use.input, { cwd: deps.cwd });
        results.push({ type: 'tool_result', toolUseId: use.id, content: r.content, isError: r.isError });
        deps.onToolEnd?.(r.isError, r.content);
```

```typescript
        results.push({ type: 'tool_result', toolUseId: use.id, content: err instanceof Error ? err.message : String(err), isError: true });
        deps.onToolEnd?.(true, err instanceof Error ? err.message : String(err));
```

- [ ] **Step 5: Bridge the content in `src/cli.ts` `streamHandlers`**

Change `onToolEnd` in `streamHandlers` (around line 157):

```typescript
    onToolEnd: (isError: boolean, content?: string): void => store.endTool(isError ? 'error' : 'ok', content),
```

- [ ] **Step 6: Run the loop test and the full suite**

Run: `npx vitest run test/agent/loop.test.ts && npm test`
Expected: PASS — loop test green, whole suite green.

- [ ] **Step 7: Commit**

```bash
git add src/agent/loop.ts src/cli.ts test/agent/loop.test.ts
git commit -m "feat(agent): thread tool result content through onToolEnd to the store"
```

---

### Task 4: Render — preview line, live tool timer, softer divider, tool rail

**Files:**
- Modify: `src/ui/app.tsx`
- Test: `test/ui/app.test.tsx`

**Interfaces:**
- Consumes: `TranscriptItem.preview` (Task 2), `ActiveTool.startedAt` (existing).
- Produces: visual only — no new exports.

This task is presentation. It renders: (a) a dim indented preview line under each finished tool that has one; (b) a live `N.Ns` elapsed label on the running tool; (c) a softer dotted separator between user turns; (d) a dim vertical rail in the gutter of tool lines.

- [ ] **Step 1: Write the failing tests**

`test/ui/app.test.tsx` already renders the app with `ink-testing-library` (see the existing file for the render helper). Add tests that assert the new strings appear. Match the existing file's imports/harness; the assertions below use its `render` + `lastFrame()` pattern:

```typescript
it('renders a dim preview line under a finished tool', () => {
  const store = new UiStore(() => 0);
  store.setMeta({ provider: 'anthropic', model: 'm', cwd: '~/x', autoApprove: false });
  store.startTool('list_dir', { path: '.' });
  store.endTool('ok', 'a.ts\nb.ts\nc.ts');
  const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
  expect(lastFrame()).toContain('3 entries');
});

it('shows a live elapsed label on the running tool', () => {
  let t = 0;
  const store = new UiStore(() => t);
  store.setMeta({ provider: 'anthropic', model: 'm', cwd: '~/x', autoApprove: false });
  store.setStatus('busy');
  store.startTool('read_file', { path: 'a.ts' });
  t = 1200; // 1.2s elapsed
  const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
  expect(lastFrame()).toMatch(/1\.2s/);
});
```

Note on timing: `App` reads elapsed via `Date.now()` at render, but the store's injected clock drives `startedAt`. To make the elapsed test deterministic, compute elapsed in `App` from a single `now()` source. See Step 3 — `App` uses `Date.now()`; in the test, stub it: add `vi.spyOn(Date, 'now').mockReturnValue(1200)` before render and `startedAt` was stamped at `t=0`. Adjust the test to:

```typescript
import { vi } from 'vitest';
it('shows a live elapsed label on the running tool', () => {
  const store = new UiStore(() => 0);       // startedAt = 0
  store.setMeta({ provider: 'anthropic', model: 'm', cwd: '~/x', autoApprove: false });
  store.setStatus('busy');
  store.startTool('read_file', { path: 'a.ts' });
  vi.spyOn(Date, 'now').mockReturnValue(1200);
  const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
  expect(lastFrame()).toMatch(/1\.2s/);
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: FAIL — `3 entries` and `1.2s` not present.

- [ ] **Step 3: Implement the rendering changes in `src/ui/app.tsx`**

Add a small formatter near the top (after `HINTS`):

```typescript
const fmtElapsed = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
```

Replace `ToolLine` to support an optional rail, an elapsed label, and a preview line:

```typescript
function ToolLine({ marker, color, text, ms, elapsed, preview, rail }: { marker: string; color?: string; text: string; ms?: number; elapsed?: string; preview?: string; rail?: boolean }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={GUTTER} flexShrink={0}><Text dimColor>{rail ? '  │  ' : ' '}</Text></Box>
        <Text color={color}>{`${marker} ${text}`}</Text>
        {ms !== undefined ? <Text dimColor>{`  ${ms}ms`}</Text> : null}
        {elapsed ? <Text dimColor>{`  ${elapsed}`}</Text> : null}
      </Box>
      {preview ? (
        <Box>
          <Box width={GUTTER} flexShrink={0}><Text dimColor>{rail ? '  │  ' : ' '}</Text></Box>
          <Text dimColor>{preview}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
```

In `renderItem`, update the finished-tool branch to pass `preview` and `rail`:

```typescript
  const ok = item.status === 'ok';
  return (
    <ToolLine key={key} marker={ok ? '✓' : '✗'} color={ok ? theme.toolOk : theme.toolError}
      text={`${toolIcon(item.name)} ${formatToolCall(item.name, item.input)}`} ms={item.durationMs}
      preview={item.preview} rail />
  );
```

Soften the turn divider in the `user` branch of `renderItem` — replace:

```typescript
        {userNum > 1 ? <Text dimColor>{'─'.repeat(48)}</Text> : null}
```

with:

```typescript
        {userNum > 1 ? <Text dimColor>{'· '.repeat(24).trimEnd()}</Text> : null}
```

Give the running tool (in `liveRows`) a live elapsed label and the rail. Replace the `state.activeTool` block:

```typescript
      {state.activeTool ? (
        <ToolLine marker={spinnerFrame(tick)} color={theme.toolRun} rail
          elapsed={fmtElapsed(Date.now() - state.activeTool.startedAt)}
          text={`${toolIcon(state.activeTool.name)} ${formatToolCall(state.activeTool.name, state.activeTool.input)}`} />
      ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: PASS. Then `npm test` to confirm nothing else regressed (existing app tests may assert on the old `'─'.repeat(48)` divider — if one does, update that assertion to the new dotted separator).

- [ ] **Step 5: Manual visual check**

Run the app against a real turn and confirm: finished tools show a dim preview line, the running tool shows a ticking `N.Ns`, the divider between turns is dotted, and tool lines share a `│` rail.

Run: `npm run dev` (or the project's `run` skill). Ask it something that reads a file and lists a dir. Confirm the previews render.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.tsx test/ui/app.test.tsx
git commit -m "feat(ui): tool result previews, live timer, softer divider, tool rail"
```

---

### Task 5: Heartbeat — elapsed turn time + interrupt hint

**Files:**
- Modify: `src/ui/app.tsx`
- Test: `test/ui/app.test.tsx`

**Interfaces:**
- Consumes: `state.turnStartedAt` (Task 2), `state.status`.
- Produces: visual only.

The heartbeat is the low-risk half of "liveliness": while busy, show elapsed turn time and the `esc to interrupt` hint next to the thinking / streaming indicator. (Wiring esc to an actual abort is Task 6; this task only shows the hint + timer.)

- [ ] **Step 1: Write the failing test**

```typescript
it('shows elapsed turn time and the interrupt hint while busy', () => {
  const store = new UiStore(() => 0); // turnStartedAt = 0 on busy
  store.setMeta({ provider: 'anthropic', model: 'm', cwd: '~/x', autoApprove: false });
  store.setStatus('busy'); // thinking (no streaming, no active tool)
  vi.spyOn(Date, 'now').mockReturnValue(4300);
  const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
  expect(lastFrame()).toMatch(/4\.3s/);
  expect(lastFrame()).toContain('esc to interrupt');
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: FAIL — `4.3s` / `esc to interrupt` not present.

- [ ] **Step 3: Implement the heartbeat**

In `app.tsx`, the `thinking` live row currently renders `thinking…`. Replace the `thinking` block in `liveRows` so it appends elapsed + hint whenever busy:

```typescript
      {thinking ? (
        <Row label="MDD" color={theme.assistant}>
          <Text dimColor>
            {`thinking${thinkingDots(tick)}`}
            {state.turnStartedAt !== null ? `   ${fmtElapsed(Date.now() - state.turnStartedAt)}` : ''}
            {'   esc to interrupt'}
          </Text>
        </Row>
      ) : null}
```

Also surface the hint while streaming/tool-running (not just during the pre-stream `thinking` phase). Add a single status line right after `liveRows` content — simplest: append the hint to the streaming cursor row. In the `state.streaming` block, after the `cursorFrame` Text, add:

```typescript
            {state.turnStartedAt !== null ? <Text dimColor>{`  ${fmtElapsed(Date.now() - state.turnStartedAt)}  esc to interrupt`}</Text> : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/ui/app.test.tsx && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx test/ui/app.test.tsx
git commit -m "feat(ui): turn heartbeat with elapsed time and interrupt hint"
```

---

### Task 6: Interrupt — esc aborts the in-flight turn

**Files:**
- Modify: `src/ui/app.tsx` (add `useInput` Esc handling)
- Modify: `src/cli.ts:355-395` (interactive turn: `AbortController`, pass `signal`, register/clear abort hook, interrupted-vs-error rendering)
- Test: `test/ui/store.test.ts` covers the hook (Task 2); the keyboard + cancellation path is verified manually (Ink `useInput` + async cancellation are impractical to unit test).

**Interfaces:**
- Consumes: `store.requestAbort()` / `store.setAbort()` (Task 2); `runTurn`'s existing `signal?: AbortSignal` (`loop.ts:19,30`).
- Produces: pressing Esc while busy aborts the interactive turn; the turn ends with a dim `⊘ interrupted` system line instead of an `Error:` line.

- [ ] **Step 1: Wire `useInput` Esc in `app.tsx`**

Add `useInput` to the ink import:

```typescript
import { Box, Text, Static, useStdout, useInput } from 'ink';
```

Inside `App`, after the existing hooks (e.g. after the `useEffect` animation block), add:

```typescript
  // Esc interrupts an in-flight turn — but only when nothing else owns Esc (no select/prompt open).
  useInput((_input, key) => {
    if (key.escape && state.status === 'busy' && state.pendingSelect === null && state.pendingPrompt === null) {
      store.requestAbort();
    }
  });
```

- [ ] **Step 2: Wire the `AbortController` into the interactive turn in `cli.ts`**

In the interactive `onSubmit` (around line 366-394), create a controller per turn, register it, pass its signal, and clear it in `finally`. Replace the try/catch/finally:

```typescript
    running = true;
    store.addUser(input.display);
    if (!title) title = truncateTitle(input.display);
    store.setStatus('busy');
    const controller = new AbortController();
    let interrupted = false;
    store.setAbort(() => { interrupted = true; controller.abort(); });
    const content: ContentBlock[] = [
      ...(input.text ? [{ type: 'text' as const, text: input.text }] : []),
      ...blocks,
    ];
    messages.push({ role: 'user', content });
    const h = streamHandlers(store);
    try {
      await runTurn(messages, {
        provider: session.provider, registry, gate, cwd, model: session.model, systemPrompt,
        onText: h.onText, onToolStart: h.onToolStart, onToolEnd: h.onToolEnd, onUsage: h.onUsage,
        signal: controller.signal,
      });
      h.flush();
    } catch (err) {
      if (interrupted) { store.commitStreaming(); store.addSystem('⊘ interrupted'); }
      else store.appendStreaming(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      store.setAbort(null);
      store.commitStreaming();
      store.setStatus('idle');
      running = false;
      void sessions.save({
        id: currentId, cwd, createdAt, updatedAt: Date.now(),
        provider: session.providerName, model: session.model, title,
        messages, transcript: store.getState().transcript,
      }).catch(() => store.addSystem('⚠ could not save session history'));
    }
```

- [ ] **Step 3: Verify the store hook test still passes**

Run: `npx vitest run test/ui/store.test.ts`
Expected: PASS (the `requestAbort` test from Task 2).

- [ ] **Step 4: Manual verification of the interrupt path**

Run the app, start a long turn (e.g. ask it to run a slow shell command or a big multi-step task), press Esc mid-turn. Confirm: the turn stops promptly, a dim `⊘ interrupted` line appears, the input returns to idle, and you can type the next message. Confirm Esc does NOT abort when a permission select is open (it should cancel the select instead).

Run: `npm run dev`

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.tsx src/cli.ts
git commit -m "feat(ui): esc interrupts the in-flight turn"
```

---

### Task 7 (OPTIONAL): Enrich edit tools to report `+X −Y` line deltas

Only do this if you want the `+12 −3` style preview from the mockup. It changes the tool result string that the **model** also consumes (arguably an improvement — the model sees the change size too).

**Files:**
- Modify: `src/tools/edit-file.ts`, `src/tools/multi-edit.ts`
- Modify: `src/ui/format.ts` (`summarizePreview` cases for `edit_file`/`multi_edit`)
- Test: `test/ui/format.test.ts`, plus the relevant tool tests if present.

**Interfaces:**
- Produces: `edit_file` content becomes `Edited <path> (+A −B)`; `summarizePreview('edit_file', ...)` returns `+A −B`.

- [ ] **Step 1: Compute line deltas in `edit-file.ts`**

Before returning success, compute added/removed line counts by comparing the old vs new text (the tool already has both in scope where it applies the replacement). Return:

```typescript
      const added = newText.split('\n').length - oldText.split('\n').length;
      const delta = added >= 0 ? `+${added} −0` : `+0 −${-added}`; // refine per real added/removed if both are tracked
      return { content: `Edited ${path} (${delta})`, isError: false };
```

(Adjust to the file's actual variable names for old/new content; if only a single old→new string swap is available, count newlines in `old_string` vs `new_string`.)

- [ ] **Step 2: Update `summarizePreview` for `edit_file`**

```typescript
    case 'edit_file': {
      const m = content.match(/\(([+−\-\d\s]+)\)\s*$/);
      return m ? m[1].trim() : undefined;
    }
```

- [ ] **Step 3: Add tests, run, commit**

Add a `summarizePreview('edit_file', 'Edited a.ts (+12 −3)', false)` → `'+12 −3'` test, run `npx vitest run test/ui/format.test.ts`, then `npm test`, then commit.

---

## Self-Review

**Spec coverage:**
- Flagship result previews → Task 1 (summary) + Task 2 (store) + Task 3 (loop/cli wiring) + Task 4 (render). ✓
- Live elapsed timer on running tool → Task 4. ✓
- Turn heartbeat + interrupt hint → Task 5. ✓
- Esc → abort → Task 6 (uses existing `signal?` seam; both `runTurn` call sites accounted for — one-shot deliberately excluded). ✓
- Softer turn separation + tool rail → Task 4. ✓
- Session persistence: previews live-only → enforced by Global Constraints + `endTool` omitting undefined preview; `loadTranscript` untouched. ✓
- Deferred: streaming thinking display — not in this plan (correct per spec). ✓
- Preview-format deviation from mockup (`+X −Y`) is honestly scoped to optional Task 7. ✓

**Placeholder scan:** No TBD/TODO. Task 7 Step 1 flags that variable names must match the actual file — acceptable because the exact old/new identifiers aren't knowable without reading `edit-file.ts` at execution time, and the intent + formula are fully specified. All other steps contain complete code.

**Type consistency:** `endTool(status, content?)`, `onToolEnd(isError, content?)`, `summarizePreview(name, content, isError)`, `setAbort`/`requestAbort`, `turnStartedAt`, `preview?` — names match across Tasks 1→6. The store imports `summarizePreview` from `./format.js` (same module Task 1 exports it from). `ToolLine`'s new props (`elapsed`, `preview`, `rail`) are used consistently in `renderItem` and `liveRows`.
