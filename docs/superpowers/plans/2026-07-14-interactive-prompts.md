# Interactive Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify every "agent pauses for user input" moment on one styled prompt component — redesign the permission confirmation (human-readable action + reason-on-reject), add an `ask_user` tool, and make `/models`/`/resume` ride the same component.

**Architecture:** Generalize `SelectList` into a prompt card (`PromptSpec` = title + body lines + rich options, where an option can open an inline text field). One store slot (`pendingChoice`/`requestChoice`) drives it. The permission gate builds a `PromptSpec` from the tool + input via the existing `formatToolCall`, and `gate.check` returns `{ allow, reason? }`. A new non-mutating `ask_user` tool prompts the user via a new `ToolContext.ask` capability wired cli → store.

**Tech Stack:** TypeScript, Ink (React for terminal), Vitest. Tests in `test/**` mirror `src/**` and import from `../../src/…/X.js`.

## Global Constraints

- Tests: `npm test` runs `vitest run`. Single file: `npx vitest run test/<path>.test.ts(x)`.
- Import style in tests: `import { ... } from '../../src/…/<name>.js'` (`.js` extension, NodeNext).
- No new dependencies. `ink-text-input` is already a dependency (used in `app.tsx`).
- Typecheck must stay clean: `npx tsc --noEmit`. Run it after any task touching `cli.ts`, `loop.ts`, or `permissions`.
- Two `runTurn` call sites: `src/cli.ts` one-shot (`oneShot`, ~line 176) and interactive REPL (~line 377). Both mount a TUI, so both wire `ask`.
- Esc-cancel on a permission confirmation means **deny** (safe default), with no reason.
- Keep the exported component name `SelectList` (its props change). Keep `clampIndex` and its tests.

**Shared types (defined in Task 1, consumed by all later tasks) — use these exact names/shapes:**
```ts
export interface ChoiceOption { label: string; value: string; opensInput?: boolean; inputPlaceholder?: string; }
export interface PromptSpec { title: string; body?: string[]; options: ChoiceOption[]; }
export type ChoiceResult = { value: string; text?: string } | null;
```

---

### Task 1: Generalize `SelectList` into a prompt card

**Files:**
- Modify: `src/ui/select.tsx`
- Test: `test/ui/select.test.tsx`

**Interfaces:**
- Produces: `ChoiceOption`, `PromptSpec`, `ChoiceResult` (exported from `select.tsx`); `clampIndex` (unchanged); `SelectList({ spec: PromptSpec; onResolve: (r: ChoiceResult) => void; accent: string })`.
- Behavior: arrow keys move (wrap via `clampIndex`); Enter selects. A plain option resolves `{ value }`. An `opensInput` option enters text-entry mode (embeds `ink-text-input`); Enter there resolves `{ value, text }` (text may be `''`). Esc in text mode returns to the list; Esc in the list resolves `null`.

- [ ] **Step 1: Rewrite the component test for the new API**

Replace the `describe('SelectList', …)` block in `test/ui/select.test.tsx` (keep the `clampIndex` block). Add `vi` where needed:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { clampIndex, SelectList, type PromptSpec } from '../../src/ui/select.js';

// (keep the existing clampIndex describe block unchanged)

describe('SelectList', () => {
  const spec: PromptSpec = {
    title: 'Pick one',
    body: ['some context line'],
    options: [
      { label: 'first', value: 'a' },
      { label: 'type your own', value: 'free', opensInput: true, inputPlaceholder: 'your answer' },
    ],
  };

  it('renders the title, body, options, and a highlighted cursor', () => {
    const { lastFrame } = render(<SelectList spec={spec} onResolve={() => {}} accent="#a855f7" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Pick one');
    expect(frame).toContain('some context line');
    expect(frame).toContain('❯ first'); // first option highlighted by default
    expect(frame).toContain('type your own');
  });

  it('resolves the value of a plain option on Enter', () => {
    const onResolve = vi.fn();
    const { stdin } = render(<SelectList spec={spec} onResolve={onResolve} accent="#a855f7" />);
    stdin.write('\r'); // Enter on the first option
    expect(onResolve).toHaveBeenCalledWith({ value: 'a' });
  });

  it('resolves null on Esc at the option list', () => {
    const onResolve = vi.fn();
    const { stdin } = render(<SelectList spec={spec} onResolve={onResolve} accent="#a855f7" />);
    stdin.write('\x1B'); // Esc
    expect(onResolve).toHaveBeenCalledWith(null);
  });

  it('enters text mode for an opensInput option and resolves { value, text } on Enter', () => {
    const onResolve = vi.fn();
    const { stdin } = render(<SelectList spec={spec} onResolve={onResolve} accent="#a855f7" />);
    stdin.write('\x1B[B'); // Down to the "type your own" option
    stdin.write('\r');     // select it -> enters text mode
    stdin.write('hi');     // type
    stdin.write('\r');     // submit
    expect(onResolve).toHaveBeenCalledWith({ value: 'free', text: 'hi' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ui/select.test.tsx`
Expected: FAIL — new props/exports don't exist yet.

- [ ] **Step 3: Rewrite `src/ui/select.tsx`**

```tsx
// src/ui/select.tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface ChoiceOption { label: string; value: string; opensInput?: boolean; inputPlaceholder?: string; }
export interface PromptSpec { title: string; body?: string[]; options: ChoiceOption[]; }
export type ChoiceResult = { value: string; text?: string } | null;

/** Wrap an index into [0, len) with up/down wraparound. */
export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

export function SelectList({ spec, onResolve, accent }: { spec: PromptSpec; onResolve: (r: ChoiceResult) => void; accent: string }) {
  const [idx, setIdx] = useState(0);
  const [inputFor, setInputFor] = useState<ChoiceOption | null>(null);
  const [text, setText] = useState('');

  useInput((_input, key) => {
    if (inputFor) {
      if (key.escape) { setInputFor(null); setText(''); } // back to the list
      return; // Enter/typing handled by TextInput below
    }
    if (key.upArrow) setIdx((i) => clampIndex(i - 1, spec.options.length));
    else if (key.downArrow) setIdx((i) => clampIndex(i + 1, spec.options.length));
    else if (key.escape) onResolve(null);
    else if (key.return) {
      const opt = spec.options[idx];
      if (opt.opensInput) { setInputFor(opt); setText(''); }
      else onResolve({ value: opt.value });
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
      <Text bold color={accent}>{spec.title}</Text>
      {(spec.body ?? []).map((line, i) => <Text key={`b${i}`} dimColor>{line}</Text>)}
      {inputFor ? (
        <Box>
          <Text color={accent}>{`↳ `}</Text>
          <TextInput value={text} onChange={setText} onSubmit={() => onResolve({ value: inputFor.value, text })} />
          {text === '' && inputFor.inputPlaceholder ? <Text dimColor>{inputFor.inputPlaceholder}</Text> : null}
        </Box>
      ) : (
        spec.options.map((opt, i) =>
          i === idx
            ? <Text key={i} color={accent} bold>{`❯ ${opt.label}`}</Text>
            : <Text key={i}>{`  ${opt.label}`}</Text>,
        )
      )}
      <Text dimColor>{inputFor ? 'enter send · esc back' : '↑/↓ move · enter select · esc cancel'}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ui/select.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/select.tsx test/ui/select.test.tsx
git commit -m "feat(ui): generalize SelectList into a prompt card with body + free-text options"
```

---

### Task 2: Store — `pendingChoice` / `requestChoice` / `resolveChoice` / `requestAsk`

**Files:**
- Modify: `src/ui/store.ts`
- Test: `test/ui/store.test.ts`

**Interfaces:**
- Consumes: `PromptSpec`, `ChoiceResult`, `ChoiceOption` from `./select.js` (Task 1).
- Produces:
  - `UiState.pendingChoice: PromptSpec | null` (replaces `pendingSelect`).
  - `requestChoice(spec: PromptSpec): Promise<ChoiceResult>`
  - `resolveChoice(result: ChoiceResult): void`
  - `requestAsk(question: string, options?: string[]): Promise<string>` — builds a spec whose options are the suggestions plus a `{ value: '__free__', opensInput: true }` "type my own" row; resolves to `result.text` (if the free option was used), else `result.value`, else `''` on cancel.
- Removed: `pendingSelect` / `requestSelect` / `resolveSelect` (migrated in Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/store.test.ts` (and update the two existing `requestSelect`/`pendingSelect` tests to the new names — see Step 3 note):

```ts
it('requestChoice sets pendingChoice and resolveChoice resolves + clears it', async () => {
  const s = new UiStore();
  const p = s.requestChoice({ title: 'ok?', options: [{ label: 'yes', value: 'y' }] });
  expect(s.getState().pendingChoice).toEqual({ title: 'ok?', options: [{ label: 'yes', value: 'y' }] });
  s.resolveChoice({ value: 'y' });
  expect(s.getState().pendingChoice).toBeNull();
  await expect(p).resolves.toEqual({ value: 'y' });
});

it('requestAsk returns the picked option value', async () => {
  const s = new UiStore();
  const p = s.requestAsk('which pm?', ['pnpm', 'npm']);
  const spec = s.getState().pendingChoice!;
  expect(spec.title).toBe('which pm?');
  expect(spec.options.map((o) => o.value)).toEqual(['pnpm', 'npm', '__free__']);
  s.resolveChoice({ value: 'pnpm' });
  await expect(p).resolves.toBe('pnpm');
});

it('requestAsk returns typed text when the free option is used, and empty string on cancel', async () => {
  const s = new UiStore();
  const p1 = s.requestAsk('q', ['a']);
  s.resolveChoice({ value: '__free__', text: 'my own answer' });
  await expect(p1).resolves.toBe('my own answer');

  const p2 = s.requestAsk('q');
  s.resolveChoice(null);
  await expect(p2).resolves.toBe('');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/ui/store.test.ts`
Expected: FAIL — `requestChoice`/`requestAsk`/`pendingChoice` undefined.

- [ ] **Step 3: Implement the store changes**

In `src/ui/store.ts`:

Add imports:
```ts
import type { PromptSpec, ChoiceOption, ChoiceResult } from './select.js';
```

Replace `pendingSelect: PendingSelect | null;` in `UiState` with:
```ts
  pendingChoice: PromptSpec | null;
```
Remove the `PendingSelect` interface (no longer used). In the state literal, replace `pendingSelect: null` with `pendingChoice: null`.

Replace the `selectResolver` field and the `requestSelect`/`resolveSelect` methods with:
```ts
  private choiceResolver: ((result: ChoiceResult) => void) | null = null;

  requestChoice = (spec: PromptSpec): Promise<ChoiceResult> =>
    new Promise((resolve) => { this.choiceResolver = resolve; this.set({ pendingChoice: spec }); });

  resolveChoice = (result: ChoiceResult): void => {
    const r = this.choiceResolver;
    this.choiceResolver = null;
    this.set({ pendingChoice: null });
    r?.(result);
  };

  requestAsk = async (question: string, options: string[] = []): Promise<string> => {
    const opts: ChoiceOption[] = [
      ...options.map((o) => ({ label: o, value: o })),
      { label: '✎ type my own answer…', value: '__free__', opensInput: true, inputPlaceholder: 'your answer' },
    ];
    const result = await this.requestChoice({ title: question, options: opts });
    if (result === null) return '';
    return result.value === '__free__' ? (result.text ?? '') : result.value;
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/ui/store.test.ts`
Expected: PASS. (The two old `requestSelect`/`pendingSelect` store tests must be rewritten to `requestChoice`/`pendingChoice` in Step 1; if any remain, update them now.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/store.ts test/ui/store.test.ts
git commit -m "feat(ui): generalized pendingChoice/requestChoice store slot + requestAsk"
```

---

### Task 3: App wiring + migrate `/models` and `/resume`

**Files:**
- Modify: `src/ui/app.tsx`, `src/cli.ts`
- Test: `test/ui/app.test.tsx` (and update any cli picker test that referenced `requestSelect`)

**Interfaces:**
- Consumes: `pendingChoice`/`resolveChoice` (Task 2), `SelectList` new API (Task 1).
- Produces: the app renders `state.pendingChoice` via `SelectList`; `pickModel`/`resumeSession` in `cli.ts` use `requestChoice`.

- [ ] **Step 1: Write the failing test**

Add to `test/ui/app.test.tsx`:
```tsx
it('renders a pending choice prompt via SelectList', () => {
  const store = new UiStore();
  store.setMeta({ provider: 'anthropic', model: 'm', cwd: '~/x', autoApprove: false });
  void store.requestChoice({ title: 'run this?', body: ['git status'], options: [{ label: 'yes', value: 'y' }] });
  const { lastFrame } = render(<App store={store} onSubmit={() => {}} />);
  const frame = lastFrame() ?? '';
  expect(frame).toContain('run this?');
  expect(frame).toContain('git status');
  expect(frame).toContain('❯ yes');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ui/app.test.tsx`
Expected: FAIL — app still references `pendingSelect`/old `SelectList` API (won't compile or won't render).

- [ ] **Step 3: Update `src/ui/app.tsx`**

Change the `SelectList` import usage. Where the app currently renders `state.pendingSelect` with the old `SelectList` props, replace with the `pendingChoice` + new API. Find the block that reads `state.pendingSelect ? (<SelectList title=… options=… onSelect=… onCancel=… />) : (…)` and replace the `SelectList` usage with:

```tsx
  const bottom = state.pendingChoice ? (
    <SelectList
      spec={state.pendingChoice}
      onResolve={(r) => store.resolveChoice(r)}
      accent={theme.accent}
    />
  ) : (
    // …the existing input chrome block, unchanged…
  );
```

Any other reference to `state.pendingSelect` in `app.tsx` (e.g. the Esc-interrupt guard and the `marginTop` on the bottom block) must be renamed to `state.pendingChoice`.

- [ ] **Step 4: Migrate the pickers in `src/cli.ts`**

`pickModel`:
```ts
  const pickModel = (): void => {
    void (async () => {
      const result = await store.requestChoice({
        title: 'Select a model  (↑/↓ · enter · esc)',
        options: KNOWN_MODELS.map((m) => ({ label: m.id, value: m.id })),
      });
      const chosen = result?.value;
      if (chosen) { session.model = chosen; refreshMeta(); store.addSystem(`→ model set to ${chosen}`); }
    })();
  };
```

`resumeSession` — replace the `requestSelect` call and the `chosen` handling:
```ts
      const result = await store.requestChoice({
        title: 'Resume a session  (↑/↓ · enter · esc)',
        options: labels.map((l) => ({ label: l, value: l })),
      });
      const chosen = result?.value;
      if (!chosen) return;
      const idx = labels.indexOf(chosen);
```
(The rest of `resumeSession` is unchanged — `labels.indexOf(chosen)` still works since `value === label`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run test/ui/app.test.tsx && npm test && npx tsc --noEmit`
Expected: PASS, clean. If a cli test asserted on `requestSelect`, update it to `requestChoice`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.tsx src/cli.ts test/ui/app.test.tsx
git commit -m "feat(ui): render pendingChoice; migrate /models and /resume to requestChoice"
```

---

### Task 4: Permission confirmation — human action + reason-on-reject

**Files:**
- Modify: `src/permissions/index.ts`, `src/agent/loop.ts`, `src/cli.ts`
- Test: `test/permissions.test.ts` (create if absent; else `test/permissions/…`), `test/agent/loop.test.ts`

**Interfaces:**
- Consumes: `PromptSpec`/`ChoiceResult` (Task 1); `formatToolCall`/`toolIcon` from `../ui/format.js`.
- Produces:
  - `type ConfirmFn = (spec: PromptSpec) => Promise<ChoiceResult>;`
  - `interface GateDecision { allow: boolean; reason?: string; }`
  - `createGate({ confirm, autoApprove })` and `gate.check(...) : Promise<GateDecision>`.
  - `loop.ts`: denial path threads `decision.reason` into the tool_result.

- [ ] **Step 1: Write the failing gate tests**

Create `test/permissions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createGate } from '../src/permissions/index.js';
import type { Tool } from '../src/tools/types.js';
import { z } from 'zod';
import type { ChoiceResult } from '../src/ui/select.js';

const tool = (over: Partial<Tool> = {}): Tool => ({
  name: 'git', description: '', inputSchema: z.object({}), mutating: true,
  handler: async () => ({ content: '', isError: false }), ...over,
});

describe('createGate', () => {
  it('auto-approves non-mutating tools without confirming', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; } });
    const d = await gate.check(tool({ mutating: false }), {});
    expect(d).toEqual({ allow: true });
    expect(asked).toBe(0);
  });

  it('shows a human-readable action and allows on yes', async () => {
    let seen = '';
    const gate = createGate({ confirm: async (spec) => { seen = (spec.body ?? []).join(' '); return { value: 'yes' }; } });
    const d = await gate.check(tool(), { args: 'log --oneline -15' });
    expect(seen).toContain('git(log --oneline -15)'); // via formatToolCall, not raw JSON
    expect(d).toEqual({ allow: true });
  });

  it('denies with the typed reason on no', async () => {
    const gate = createGate({ confirm: async (): Promise<ChoiceResult> => ({ value: 'no', text: 'use --stat instead' }) });
    const d = await gate.check(tool(), {});
    expect(d).toEqual({ allow: false, reason: 'use --stat instead' });
  });

  it('remembers "always" per tool and stops confirming it', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'always' }; } });
    expect(await gate.check(tool(), {})).toEqual({ allow: true });
    expect(await gate.check(tool(), {})).toEqual({ allow: true });
    expect(asked).toBe(1); // second call skipped by the always-set
  });

  it('treats Esc-cancel (null) as deny with no reason', async () => {
    const gate = createGate({ confirm: async () => null });
    expect(await gate.check(tool(), {})).toEqual({ allow: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/permissions.test.ts`
Expected: FAIL — `createGate` still takes `prompt` and returns `'allow'|'deny'`.

- [ ] **Step 3: Rewrite `src/permissions/index.ts`**

```ts
import type { Tool } from '../tools/types.js';
import type { PromptSpec, ChoiceResult } from '../ui/select.js';
import { formatToolCall, toolIcon } from '../ui/format.js';

export type ConfirmFn = (spec: PromptSpec) => Promise<ChoiceResult>;
export interface GateDecision { allow: boolean; reason?: string; }
export interface PermissionGate { check(tool: Tool, input: unknown): Promise<GateDecision>; }

export function createGate(opts: { confirm: ConfirmFn; autoApprove?: boolean }): PermissionGate {
  const always = new Set<string>();
  return {
    async check(tool, input) {
      if (!tool.mutating || opts.autoApprove || always.has(tool.name)) return { allow: true };
      const spec: PromptSpec = {
        title: 'before this runs, it needs your ok',
        body: [`${toolIcon(tool.name)} ${formatToolCall(tool.name, input)}`],
        options: [
          { label: 'yes, run it', value: 'yes' },
          { label: 'no — tell it what to do instead', value: 'no', opensInput: true, inputPlaceholder: 'what should it do instead?' },
          { label: `always allow ${tool.name} this session`, value: 'always' },
        ],
      };
      const result = await opts.confirm(spec);
      if (result?.value === 'always') { always.add(tool.name); return { allow: true }; }
      if (result?.value === 'yes') return { allow: true };
      return { allow: false, ...(result?.text ? { reason: result.text } : {}) }; // 'no' or cancel
    },
  };
}
```

- [ ] **Step 4: Update the denial path in `src/agent/loop.ts`**

Replace the gate-decision block:
```ts
      const decision = await deps.gate.check(tool, use.input);
      if (!decision.allow) {
        const msg = decision.reason
          ? `User denied this tool call. They said: ${decision.reason}`
          : 'User denied this tool call.';
        results.push({ type: 'tool_result', toolUseId: use.id, content: msg, isError: true });
        deps.onToolEnd?.(true, msg);
        continue;
      }
```
(Delete the old `if (decision === 'deny')` version.)

- [ ] **Step 5: Wire the gate to the store in `src/cli.ts`**

Both `createGate` call sites (one-shot ~line 177, interactive ~line 296) change from
`{ prompt: store.requestPrompt, autoApprove: opts.yes }` to:
```ts
  const gate = createGate({ confirm: store.requestChoice, autoApprove: opts.yes });
```

- [ ] **Step 6: Update the existing loop denial test**

`test/agent/loop.test.ts` has a test asserting the denied `tool_result` matches `/denied/i`
(the "returns a denial tool_result when the gate denies" test). Its fake gate is
`createGate({ prompt: async () => 'n' })` — update it to the new confirm API:
`createGate({ confirm: async () => ({ value: 'no' }) })`. The assertion `tr?.content` matching
`/denied/i` still holds (message starts "User denied this tool call."). Also update the
"fires onToolStart then onToolEnd … on denial" test's gate the same way.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run test/permissions.test.ts test/agent/loop.test.ts && npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/permissions/index.ts src/agent/loop.ts src/cli.ts test/permissions.test.ts test/agent/loop.test.ts
git commit -m "feat(permissions): human-readable confirmation card with reason-on-reject"
```

---

### Task 5: `ask_user` tool

**Files:**
- Create: `src/tools/ask-user.ts`
- Modify: `src/tools/types.ts`, `src/tools/index.ts`, `src/agent/loop.ts`, `src/cli.ts`, `src/system-prompt.ts`
- Test: `test/tools/ask-user.test.ts` (create), `test/agent/loop.test.ts`

**Interfaces:**
- Consumes: `ToolContext.ask` (added here); `store.requestAsk` (Task 2).
- Produces: `askUserTool: Tool`; `ToolContext.ask?: (question: string, options?: string[]) => Promise<string>`; `AgentDeps.ask?` forwarded to the handler context.

- [ ] **Step 1: Write the failing tool test**

Create `test/tools/ask-user.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { askUserTool } from '../../src/tools/ask-user.js';

describe('askUserTool', () => {
  it('is non-mutating', () => { expect(askUserTool.mutating).toBe(false); });

  it('returns the ask() answer as content', async () => {
    const r = await askUserTool.handler(
      { question: 'which pm?', options: ['pnpm', 'npm'] },
      { cwd: '/tmp', ask: async (q, o) => `${q}|${o?.join(',')}` },
    );
    expect(r).toEqual({ content: 'which pm?|pnpm,npm', isError: false });
  });

  it('errors cleanly when ask is unavailable', async () => {
    const r = await askUserTool.handler({ question: 'q' }, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not available/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/tools/ask-user.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Extend `ToolContext` in `src/tools/types.ts`**

```ts
export interface ToolContext {
  cwd: string;
  ask?: (question: string, options?: string[]) => Promise<string>;
}
```

- [ ] **Step 4: Create `src/tools/ask-user.ts`**

```ts
import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({
  question: z.string().describe('The question to ask the user.'),
  options: z.array(z.string()).optional().describe('Optional suggested answers the user can pick from.'),
});

export const askUserTool: Tool = {
  name: 'ask_user',
  description:
    'Ask the user a question when you need a decision only they can make (a preference, an ambiguous requirement, a missing detail). Provide 2-4 suggested options when you can; the user may also type their own answer. Prefer asking over guessing when getting it wrong would waste work.',
  inputSchema: schema,
  mutating: false,
  async handler(input, ctx) {
    const { question, options } = schema.parse(input);
    if (!ctx.ask) return { content: 'User interaction is not available in this context.', isError: true };
    const answer = await ctx.ask(question, options);
    return { content: answer, isError: false };
  },
};
```

- [ ] **Step 5: Register it in `src/tools/index.ts`**

```ts
import { askUserTool } from './ask-user.js';
// add askUserTool to the allTools array (place it last):
export const allTools: Tool[] = [
  readFileTool, listDirTool, searchTool, writeFileTool, editFileTool, multiEditTool, runShellTool, gitTool, askUserTool,
];
```

- [ ] **Step 6: Thread `ask` through the loop**

In `src/agent/loop.ts`, add to `AgentDeps`:
```ts
  ask?: (question: string, options?: string[]) => Promise<string>;
```
And pass it into the handler context:
```ts
        const r = await tool.handler(use.input, { cwd: deps.cwd, ask: deps.ask });
```

- [ ] **Step 7: Wire `ask` in `src/cli.ts` and the system prompt**

At both `runTurn` call sites, add `ask: store.requestAsk` to the deps object (alongside the
existing `onText`/`onToolStart`/etc.).

In `src/system-prompt.ts`, add one line to the prompt text (inside `buildSystemPrompt`), e.g.:
`- When you need a decision only the user can make, call the ask_user tool instead of guessing.`

- [ ] **Step 8: Add a loop integration test**

Add to `test/agent/loop.test.ts` (reuse the `FakeProvider` harness):
```ts
it('routes an ask_user tool call to the ask() dep and feeds the answer back', async () => {
  const provider = new FakeProvider([
    [{ type: 'tool_use', id: 'q1', name: 'ask_user', input: { question: 'which pm?', options: ['pnpm', 'npm'] } }, { type: 'done', stopReason: 'tool_use' }],
    [{ type: 'text', text: 'ok, pnpm it is' }, { type: 'done', stopReason: 'end' }],
  ]);
  const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'set up scripts' }] }], {
    provider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }) }),
    cwd: dir, model: 'x', systemPrompt: 's',
    ask: async () => 'pnpm',
  });
  const tr = out.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: string } | undefined;
  expect(tr?.content).toBe('pnpm');
});
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npx vitest run test/tools/ask-user.test.ts test/agent/loop.test.ts && npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 10: Commit**

```bash
git add src/tools/ask-user.ts src/tools/types.ts src/tools/index.ts src/agent/loop.ts src/cli.ts src/system-prompt.ts test/tools/ask-user.test.ts test/agent/loop.test.ts
git commit -m "feat(tools): ask_user tool so the agent can ask the user mid-task"
```

---

## Self-Review

**Spec coverage:**
- Shared prompt component (body + rich options + free-text) → Task 1. ✓
- One store slot + `requestAsk` → Task 2. ✓
- App renders it; `/models`+`/resume` migrate (picker polish) → Task 3. ✓
- Confirmation redesign: human action via `formatToolCall`, yes/no+reason/always, `GateDecision`, loop deny reason → Task 4. ✓
- `ask_user` tool + `ToolContext.ask` + loop `ask` + cli `requestAsk` + system prompt → Task 5. ✓
- Esc-cancel on confirm = deny (safe default) → Task 4 gate (`result?.value` neither yes nor always → `{ allow: false }`). ✓
- Action-line-only for edits (no diff) → gate `body` is just `formatToolCall`. ✓

**Placeholder scan:** No TBD/TODO. All steps carry complete code. Note: after Task 4, the store's
`requestPrompt`/`resolvePrompt`/`pendingPrompt` become unused (the gate no longer uses the raw
text prompt). They are intentionally left in place — `app.tsx`'s submit logic and the Esc-interrupt
guard still reference `pendingPrompt` harmlessly (it stays `null`). Removing them is out of scope;
flag for a future cleanup rather than expanding this plan's surface.

**Type consistency:** `PromptSpec`/`ChoiceOption`/`ChoiceResult` defined in Task 1 (`select.tsx`)
and imported unchanged by Tasks 2/4. `GateDecision { allow, reason? }` from Task 4 consumed by the
loop in the same task. `ToolContext.ask` (Task 5) matches `AgentDeps.ask` and `store.requestAsk`
signatures: `(question: string, options?: string[]) => Promise<string>`. `requestChoice` returns
`ChoiceResult` everywhere. The `__free__` sentinel is internal to `requestAsk` (Task 2) and the
`ask_user` flow only ever sees the resolved string.
