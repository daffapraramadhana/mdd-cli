# Mode Cycling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Shift+Tab mode cycle (Normal → Auto-accept edits → Plan) to the mdd REPL, where Plan mode blocks all changes and the agent proposes a plan via a `present_plan` tool that, when approved, flips back to Normal and continues execution in the same turn.

**Architecture:** A single `Mode` value lives on `ReplSession` and is the source of truth. The permission gate reads it live to decide allow/deny/confirm. A new non-mutating `present_plan` tool drives the approval prompt and switches the mode via a context callback. Shift+Tab in the ink input cycles the mode. The per-turn system prompt gets a plan-mode addendum, and `present_plan`'s schema is exposed only while in Plan mode.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod schemas, ink/React TUI, Vitest.

## Global Constraints

- ESM project: **all relative imports use `.js` extensions** (e.g. `import { nextMode } from './modes.js'`), even for `.ts`/`.tsx` sources.
- Zod v4 is in use (`z.toJSONSchema(...)`, `z.object(...)`).
- Tools implement the `Tool` interface (`src/tools/types.ts`): `{ name, description, inputSchema, mutating, handler }`.
- Follow existing style: small focused modules, pure string/logic helpers kept free of ink/React for unit-testing.
- The three modes are exactly: `'normal' | 'auto-edit' | 'plan'`. Cycle order: `normal → auto-edit → plan → normal`.
- Edit tools (auto-approved in `auto-edit` mode) are exactly: `write_file`, `edit_file`, `multi_edit`.
- Run tests with `npx vitest run`. Build with `npm run build` (tsup) if a manual smoke check is needed.

---

### Task 1: Mode model (`src/modes.ts`)

Pure, dependency-free module: the `Mode` type, the cycle function, a display label, and the edit-tool set. Everything else imports from here to avoid circular deps between `permissions`, `banner`, and `cli`.

**Files:**
- Create: `src/modes.ts`
- Test: `test/modes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Mode = 'normal' | 'auto-edit' | 'plan'`
  - `function nextMode(mode: Mode): Mode` — rotates `normal → auto-edit → plan → normal`
  - `function modeLabel(mode: Mode): string` — `'normal'` → `'normal'`, `'auto-edit'` → `'auto-accept edits'`, `'plan'` → `'plan'`
  - `const EDIT_TOOLS: ReadonlySet<string>` — `new Set(['write_file', 'edit_file', 'multi_edit'])`

- [ ] **Step 1: Write the failing test**

Create `test/modes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextMode, modeLabel, EDIT_TOOLS, type Mode } from '../src/modes.js';

describe('nextMode', () => {
  it('rotates normal → auto-edit → plan → normal', () => {
    expect(nextMode('normal')).toBe('auto-edit');
    expect(nextMode('auto-edit')).toBe('plan');
    expect(nextMode('plan')).toBe('normal');
  });

  it('returns to the start after three cycles', () => {
    let m: Mode = 'normal';
    for (let i = 0; i < 3; i++) m = nextMode(m);
    expect(m).toBe('normal');
  });
});

describe('modeLabel', () => {
  it('gives human-readable labels', () => {
    expect(modeLabel('normal')).toBe('normal');
    expect(modeLabel('auto-edit')).toBe('auto-accept edits');
    expect(modeLabel('plan')).toBe('plan');
  });
});

describe('EDIT_TOOLS', () => {
  it('contains exactly the three file-edit tools', () => {
    expect([...EDIT_TOOLS].sort()).toEqual(['edit_file', 'multi_edit', 'write_file']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modes.test.ts`
Expected: FAIL — cannot resolve `../src/modes.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/modes.ts`:

```ts
// The REPL permission posture, cycled with Shift+Tab. Kept dependency-free so the gate,
// status bar, and cli can all import it without circular references.

export type Mode = 'normal' | 'auto-edit' | 'plan';

const ORDER: Mode[] = ['normal', 'auto-edit', 'plan'];

/** Rotate to the next mode: normal → auto-edit → plan → normal. */
export function nextMode(mode: Mode): Mode {
  const i = ORDER.indexOf(mode);
  return ORDER[(i + 1) % ORDER.length];
}

/** Human-readable label for the status bar and system messages. */
export function modeLabel(mode: Mode): string {
  if (mode === 'auto-edit') return 'auto-accept edits';
  return mode; // 'normal' | 'plan'
}

/** Tools auto-approved in auto-edit mode (file edits only; not shell/git). */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file', 'multi_edit']);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modes.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/modes.ts test/modes.test.ts
git commit -m "feat(modes): add Mode type, nextMode cycle, and edit-tool set"
```

---

### Task 2: Mode-aware permission gate (`src/permissions/index.ts`)

Add an optional `getMode` reader to `createGate` and apply the precedence table. Backward compatible: with no `getMode`, behavior is unchanged (defaults to `'normal'`).

**Files:**
- Modify: `src/permissions/index.ts`
- Test: `test/permissions.test.ts` (extend)

**Interfaces:**
- Consumes: `Mode`, `EDIT_TOOLS` from `src/modes.js`.
- Produces: `createGate(opts: { confirm: ConfirmFn; autoApprove?: boolean; getMode?: () => Mode })` — same `PermissionGate` return type.

Precedence inside `check(tool, input)`:
1. `!tool.mutating` → `{ allow: true }`
2. `getMode?.() === 'plan'` → `{ allow: false, reason: <plan message> }`
3. `autoApprove` → `{ allow: true }`
4. `mode === 'auto-edit' && EDIT_TOOLS.has(tool.name)` → `{ allow: true }`
5. `always.has(tool.name)` → `{ allow: true }`
6. else → confirm prompt (existing logic)

- [ ] **Step 1: Write the failing tests**

Append to `test/permissions.test.ts` (inside the file, add a new `describe` block; keep existing tests):

```ts
import { EDIT_TOOLS } from '../src/modes.js';

describe('createGate — modes', () => {
  it('plan mode denies every mutating tool without confirming', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; }, getMode: () => 'plan' });
    const d = await gate.check(tool({ name: 'write_file' }), {});
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/plan mode/i);
    expect(asked).toBe(0);
  });

  it('plan mode still allows non-mutating tools (e.g. present_plan)', async () => {
    const gate = createGate({ confirm: async () => ({ value: 'yes' }), getMode: () => 'plan' });
    expect(await gate.check(tool({ name: 'present_plan', mutating: false }), {})).toEqual({ allow: true });
  });

  it('auto-edit mode auto-approves file edits but confirms shell/git', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; }, getMode: () => 'auto-edit' });
    for (const name of EDIT_TOOLS) {
      expect(await gate.check(tool({ name }), {})).toEqual({ allow: true });
    }
    expect(asked).toBe(0);
    expect(await gate.check(tool({ name: 'run_shell' }), { command: 'ls' })).toEqual({ allow: true });
    expect(await gate.check(tool({ name: 'git' }), { args: 'status' })).toEqual({ allow: true });
    expect(asked).toBe(2); // shell + git each confirmed once
  });

  it('normal mode confirms mutating tools (unchanged behavior)', async () => {
    let asked = 0;
    const gate = createGate({ confirm: async () => { asked++; return { value: 'yes' }; }, getMode: () => 'normal' });
    expect(await gate.check(tool({ name: 'edit_file' }), {})).toEqual({ allow: true });
    expect(asked).toBe(1);
  });

  it('plan mode takes precedence over --yes autoApprove', async () => {
    const gate = createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true, getMode: () => 'plan' });
    const d = await gate.check(tool({ name: 'run_shell' }), { command: 'rm -rf x' });
    expect(d.allow).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/permissions.test.ts`
Expected: FAIL — `getMode` not applied; plan/auto-edit cases return `{ allow: true }` via confirm or wrong branch.

- [ ] **Step 3: Write minimal implementation**

In `src/permissions/index.ts`, add the import at the top (after existing imports):

```ts
import { EDIT_TOOLS, type Mode } from '../modes.js';
```

Replace the `createGate` function body with:

```ts
export function createGate(opts: { confirm: ConfirmFn; autoApprove?: boolean; getMode?: () => Mode }): PermissionGate {
  const always = new Set<string>();
  return {
    async check(tool, input) {
      if (!tool.mutating) return { allow: true };
      const mode = opts.getMode?.() ?? 'normal';
      if (mode === 'plan') {
        return { allow: false, reason: 'Plan mode is on — no changes yet. Research with read-only tools and call present_plan when you have a concrete plan.' };
      }
      if (opts.autoApprove) return { allow: true };
      if (mode === 'auto-edit' && EDIT_TOOLS.has(tool.name)) return { allow: true };
      if (always.has(tool.name)) return { allow: true };
      const spec: PromptSpec = {
        title: 'before this runs, it needs your ok',
        body: [confirmAction(tool.name, input)],
        options: [
          { label: 'yes, run it', value: 'yes' },
          { label: 'no — tell it what to do instead', value: 'no', opensInput: true, inputPlaceholder: 'what should it do instead?' },
          { label: `always allow ${tool.name} this session`, value: 'always' },
        ],
      };
      const result = await opts.confirm(spec);
      if (result?.value === 'always') { always.add(tool.name); return { allow: true }; }
      if (result?.value === 'yes') return { allow: true };
      return { allow: false, ...(result?.text ? { reason: result.text } : {}) };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/permissions.test.ts`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/permissions/index.ts test/permissions.test.ts
git commit -m "feat(permissions): make the gate mode-aware (plan blocks, auto-edit fast-paths edits)"
```

---

### Task 3: `present_plan` tool + context callback (`src/tools/present-plan.ts`)

A non-mutating tool that surfaces the proposed plan for approval. It delegates the UI + mode switch to a `presentPlan` callback on `ToolContext`, mirroring how `ask` is threaded.

**Files:**
- Create: `src/tools/present-plan.ts`
- Modify: `src/tools/types.ts` (add `presentPlan` to `ToolContext`; add `PlanDecision` type)
- Modify: `src/tools/index.ts` (register the tool)
- Test: `test/tools/present-plan.test.ts`

**Interfaces:**
- Consumes: `ToolContext.presentPlan?: (plan: string) => Promise<PlanDecision>`.
- Produces:
  - `type PlanDecision = { approved: true } | { approved: false; feedback?: string }` (exported from `src/tools/types.ts`)
  - `const presentPlanTool: Tool` (name `'present_plan'`, `mutating: false`)

- [ ] **Step 1: Write the failing test**

Create `test/tools/present-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { presentPlanTool } from '../../src/tools/present-plan.js';
import type { PlanDecision, ToolContext } from '../../src/tools/types.js';

const ctx = (presentPlan?: ToolContext['presentPlan']): ToolContext => ({ cwd: '/tmp', presentPlan });

describe('present_plan tool', () => {
  it('is non-mutating and named present_plan', () => {
    expect(presentPlanTool.name).toBe('present_plan');
    expect(presentPlanTool.mutating).toBe(false);
  });

  it('returns a proceed result when the user approves', async () => {
    const r = await presentPlanTool.handler({ plan: '1. do a thing' }, ctx(async () => ({ approved: true })));
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/approved/i);
  });

  it('returns the feedback as tool output when the user keeps planning', async () => {
    const decision: PlanDecision = { approved: false, feedback: 'also handle errors' };
    const r = await presentPlanTool.handler({ plan: '1. do a thing' }, ctx(async () => decision));
    expect(r.isError).toBe(false);
    expect(r.content).toContain('also handle errors');
  });

  it('errors when no presentPlan callback is available', async () => {
    const r = await presentPlanTool.handler({ plan: 'x' }, ctx(undefined));
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools/present-plan.test.ts`
Expected: FAIL — module `present-plan.js` not found.

- [ ] **Step 3a: Extend `ToolContext` and add `PlanDecision`**

In `src/tools/types.ts`, add the `PlanDecision` type and extend `ToolContext`:

```ts
export type PlanDecision = { approved: true } | { approved: false; feedback?: string };
export interface ToolContext {
  cwd: string;
  ask?: (question: string, options?: string[]) => Promise<string>;
  web?: { searchEndpoint?: string; apiKey?: string };
  presentPlan?: (plan: string) => Promise<PlanDecision>;
}
```

- [ ] **Step 3b: Create the tool**

Create `src/tools/present-plan.ts`:

```ts
import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({
  plan: z.string().describe('The step-by-step plan to carry out, in markdown. Be concrete: which files change and what each step does.'),
});

export const presentPlanTool: Tool = {
  name: 'present_plan',
  description:
    'Present a concrete implementation plan for the user to approve. Only available in plan mode. On approval, the session switches to normal mode and you continue by executing the plan. If the user asks for changes, revise the plan and call present_plan again.',
  inputSchema: schema,
  mutating: false,
  async handler(input, ctx) {
    const { plan } = schema.parse(input);
    if (!ctx.presentPlan) return { content: 'Plan approval is not available in this context.', isError: true };
    const decision = await ctx.presentPlan(plan);
    if (decision.approved) {
      return { content: 'Plan approved. Now in normal mode — proceed with executing the plan.', isError: false };
    }
    const feedback = decision.feedback?.trim();
    return {
      content: feedback
        ? `User did not approve the plan. They said: ${feedback}. Revise the plan and call present_plan again.`
        : 'User did not approve the plan. Revise it and call present_plan again.',
      isError: false,
    };
  },
};
```

- [ ] **Step 3c: Register the tool**

In `src/tools/index.ts`, import and add to `allTools`:

```ts
import { presentPlanTool } from './present-plan.js';
```

and include `presentPlanTool` at the end of the `allTools` array:

```ts
export const allTools: Tool[] = [
  readFileTool, listDirTool, searchTool, writeFileTool, editFileTool, multiEditTool, runShellTool, gitTool, askUserTool, webFetchTool, webSearchTool, presentPlanTool,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tools/present-plan.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/tools/present-plan.ts src/tools/types.ts src/tools/index.ts test/tools/present-plan.test.ts
git commit -m "feat(tools): add present_plan tool and presentPlan tool-context callback"
```

---

### Task 4: Per-turn tool-schema filtering (`src/tools/registry.ts` + `src/agent/loop.ts`)

Expose `present_plan` to the model **only in plan mode**. All other tools stay in the schema in every mode (so post-approval execution can continue in the same turn). `present_plan` is always registered (so `registry.get` can find its handler) but filtered out of the schema list otherwise.

**Files:**
- Modify: `src/tools/registry.ts` (`schemas` accepts an optional filter)
- Modify: `src/agent/loop.ts` (`AgentDeps.toolFilter`, pass to `schemas`)
- Test: `test/tools/registry.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `ToolRegistry.schemas(filter?: (name: string) => boolean): ToolSchema[]`
  - `AgentDeps.toolFilter?: (name: string) => boolean`

- [ ] **Step 1: Write the failing test**

Create `test/tools/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../../src/tools/index.js';

describe('ToolRegistry.schemas filter', () => {
  it('includes all tools when no filter is given', () => {
    const names = buildRegistry().schemas().map((s) => s.name);
    expect(names).toContain('present_plan');
    expect(names).toContain('read_file');
  });

  it('omits tools rejected by the filter', () => {
    const names = buildRegistry().schemas((n) => n !== 'present_plan').map((s) => s.name);
    expect(names).not.toContain('present_plan');
    expect(names).toContain('read_file');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools/registry.test.ts`
Expected: FAIL — `schemas` ignores the filter argument, so `present_plan` is still present.

- [ ] **Step 3a: Add the filter to `schemas`**

In `src/tools/registry.ts`, change the `schemas` method:

```ts
  schemas(filter?: (name: string) => boolean): ToolSchema[] {
    return this.list()
      .filter((t) => (filter ? filter(t.name) : true))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: z.toJSONSchema(t.inputSchema) as Record<string, unknown>,
      }));
  }
```

- [ ] **Step 3b: Thread `toolFilter` through the loop**

In `src/agent/loop.ts`, add to the `AgentDeps` interface (alongside the other optional callbacks):

```ts
  toolFilter?: (name: string) => boolean;
```

and change the schema call (currently `deps.registry.schemas()` on the provider-stream line) to:

```ts
    for await (const ev of deps.provider.stream(messages, deps.registry.schemas(deps.toolFilter), {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tools/registry.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts src/agent/loop.ts test/tools/registry.test.ts
git commit -m "feat(tools): allow per-turn tool-schema filtering (gate present_plan behind plan mode)"
```

---

### Task 5: Plan-mode system-prompt addendum (`src/system-prompt.ts`)

Compose the per-turn system prompt from the base plus a plan-mode addendum. Extract a small, testable helper so the composition logic is unit-covered.

**Files:**
- Modify: `src/system-prompt.ts`
- Test: `test/system-prompt.test.ts` (extend)

**Interfaces:**
- Consumes: `Mode` from `src/modes.js`.
- Produces: `function effectiveSystemPrompt(base: string, mode: Mode): string`

- [ ] **Step 1: Write the failing test**

Append to `test/system-prompt.test.ts`:

```ts
import { effectiveSystemPrompt } from '../src/system-prompt.js';

describe('effectiveSystemPrompt', () => {
  it('returns the base unchanged in normal and auto-edit modes', () => {
    expect(effectiveSystemPrompt('BASE', 'normal')).toBe('BASE');
    expect(effectiveSystemPrompt('BASE', 'auto-edit')).toBe('BASE');
  });

  it('appends a plan-mode addendum in plan mode', () => {
    const out = effectiveSystemPrompt('BASE', 'plan');
    expect(out.startsWith('BASE')).toBe(true);
    expect(out).toMatch(/present_plan/);
    expect(out).toMatch(/plan mode/i);
  });
});
```

(If `test/system-prompt.test.ts` has no top-level `describe`/imports for these, add `import { describe, it, expect } from 'vitest';` only if not already present — do not duplicate the import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/system-prompt.test.ts`
Expected: FAIL — `effectiveSystemPrompt` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/system-prompt.ts`, add the import at the top:

```ts
import type { Mode } from './modes.js';
```

and append these exports at the end of the file:

```ts
const PLAN_ADDENDUM = [
  '',
  'PLAN MODE is active.',
  '- Do NOT edit files, run shell commands, or run git — those tools are blocked right now.',
  '- Research the task using the read-only tools (read_file, list_dir, search).',
  '- When you have a concrete, step-by-step plan, call the present_plan tool with it.',
  '- If the user approves, the session switches to normal mode and you execute the plan.',
].join('\n');

/** Compose the per-turn system prompt: base text, plus a plan-mode addendum when in plan mode. */
export function effectiveSystemPrompt(base: string, mode: Mode): string {
  return mode === 'plan' ? base + '\n' + PLAN_ADDENDUM : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts test/system-prompt.test.ts
git commit -m "feat(system-prompt): add plan-mode addendum via effectiveSystemPrompt"
```

---

### Task 6: Mode in the status bar (`src/ui/banner.ts`)

Add `mode` to `SessionMeta` and render it in the status line. Non-normal modes are shown; normal is omitted to keep the bar clean.

**Files:**
- Modify: `src/ui/banner.ts`
- Test: `test/ui/banner.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: `Mode`, `modeLabel` from `src/modes.js`.
- Produces: `SessionMeta` gains `mode?: Mode`; `formatStatus` appends the mode label when `mode` is set and not `'normal'`.

- [ ] **Step 1: Write the failing test**

Create `test/ui/banner.test.ts` (if it already exists, add the `describe` block below and skip the import if duplicated):

```ts
import { describe, it, expect } from 'vitest';
import { formatStatus, type SessionMeta } from '../../src/ui/banner.js';

const base: SessionMeta = { provider: 'openai', model: 'gpt-x', cwd: '~/p' };

describe('formatStatus — mode', () => {
  it('omits the mode label in normal mode', () => {
    expect(formatStatus({ ...base, mode: 'normal' })).toBe('openai · gpt-x');
  });

  it('shows plan mode', () => {
    expect(formatStatus({ ...base, mode: 'plan' })).toContain('plan');
  });

  it('shows auto-accept edits mode', () => {
    expect(formatStatus({ ...base, mode: 'auto-edit' })).toContain('auto-accept edits');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ui/banner.test.ts`
Expected: FAIL — `mode` not on `SessionMeta` / not rendered.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/banner.ts`, add the import at the top:

```ts
import { modeLabel, type Mode } from '../modes.js';
```

Extend the `SessionMeta` interface with:

```ts
  mode?: Mode;
```

Replace `formatStatus` with:

```ts
/** The status-line content next to the `mdd` badge: `provider · model[ · mode][ · auto-approve]`. */
export function formatStatus(meta: SessionMeta): string {
  const parts = [meta.provider, meta.model];
  if (meta.mode && meta.mode !== 'normal') parts.push(modeLabel(meta.mode));
  if (meta.autoApprove) parts.push('auto-approve');
  return parts.join(' · ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ui/banner.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/ui/banner.ts test/ui/banner.test.ts
git commit -m "feat(ui): show the active mode in the status bar"
```

---

### Task 7: Shift+Tab keybinding + `onCycleMode` prop (`src/ui/app.tsx`, `src/ui/index.tsx`)

Wire a mode-cycle callback from `mountApp` into `App`, and cycle it on Shift+Tab in the existing `useInput` handler. This is ink/React glue verified by a build + manual run (ink components are not unit-tested in this repo).

**Files:**
- Modify: `src/ui/app.tsx` (App props + `useInput` branch)
- Modify: `src/ui/index.tsx` (`mountApp` opts + pass-through)

**Interfaces:**
- Consumes: `onCycleMode?: () => void` (supplied by cli in Task 8).
- Produces: `App` accepts `onCycleMode?: () => void`; `mountApp(store, onSubmit, opts)` accepts `opts.onCycleMode?: () => void`.

- [ ] **Step 1: Add the prop to `App` and handle Shift+Tab**

In `src/ui/app.tsx`, change the `App` signature (line ~104) to accept `onCycleMode`:

```tsx
export function App({ store, onSubmit, showHeader = false, onCycleMode }: { store: UiStore; onSubmit: (input: SubmitInput) => void; showHeader?: boolean; onCycleMode?: () => void }) {
```

Then extend the existing top-level `useInput` handler (the one that handles Esc, ~line 129) to also cycle mode on Shift+Tab:

```tsx
  useInput((_input, key) => {
    if (key.tab && key.shift && state.pendingChoice === null && state.pendingPrompt === null) {
      onCycleMode?.();
      return;
    }
    if (key.escape && state.status === 'busy' && state.pendingChoice === null && state.pendingPrompt === null) {
      store.requestAbort();
    }
  });
```

- [ ] **Step 2: Thread `onCycleMode` through `mountApp`**

In `src/ui/index.tsx`, extend the `opts` param and pass it to `App`:

```tsx
export function mountApp(
  store: UiStore,
  onSubmit: (input: SubmitInput) => void,
  opts: { showHeader?: boolean; onCycleMode?: () => void } = {},
): { unmount(): void; waitUntilExit(): Promise<void> } {
  if (opts.showHeader) process.stdout.write(CLEAR_ALL);
  const instance = render(<App store={store} onSubmit={onSubmit} showHeader={opts.showHeader} onCycleMode={opts.onCycleMode} />);
  return {
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
```

- [ ] **Step 3: Update the input hint line**

In `src/ui/app.tsx`, update the `HINTS` constant (line 22) to mention the keybinding:

```tsx
const HINTS = '/model  /resume  /theme  /help    shift+tab cycle mode';
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: tsup build succeeds with no type errors. (Full REPL wiring lands in Task 8; this task only needs to compile.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx src/ui/index.tsx
git commit -m "feat(ui): cycle mode on shift+tab via onCycleMode"
```

---

### Task 8: Wire modes into the REPL (`src/cli.ts`)

Connect all the pieces in `repl()`: `ReplSession.mode`, the mode passed into `sessionMeta`, the gate's `getMode`, the `onCycleMode` handler, the `presentPlan` callback, the per-turn system prompt and tool filter, and updated help text.

**Files:**
- Modify: `src/cli.ts`
- Test: verified by build + manual smoke (this is integration glue; the risky logic is unit-tested in Tasks 1–6).

**Interfaces:**
- Consumes: `Mode`, `nextMode`, `modeLabel` (`src/modes.js`); `effectiveSystemPrompt` (`src/system-prompt.js`); `createGate` with `getMode`; `presentPlanTool` context callback; `mountApp` `onCycleMode`.
- Produces: `ReplSession` gains `mode: Mode`.

- [ ] **Step 1: Import the mode helpers**

In `src/cli.ts`, add to the imports near the other UI/util imports:

```ts
import { nextMode, modeLabel, type Mode } from './modes.js';
```

and extend the existing `system-prompt` import to include `effectiveSystemPrompt`:

```ts
import { buildSystemPrompt, effectiveSystemPrompt } from './system-prompt.js';
```

(If `buildSystemPrompt` is currently imported on its own line, add `effectiveSystemPrompt` to that same import.)

- [ ] **Step 2: Add `mode` to `ReplSession` and `sessionMeta`**

Change the `ReplSession` interface (line ~214) to add:

```ts
  mode: Mode;
```

Change `sessionMeta` (line ~149) to accept and forward the mode:

```ts
function sessionMeta(providerName: string, model: string, cwd: string, autoApprove: boolean, mode: Mode, branch?: string): SessionMeta {
  return { provider: providerName, model, cwd: shortenCwd(cwd, homedir()), autoApprove, mode, branch };
}
```

Update the `oneShot` call site (line ~178) to pass `'normal'`:

```ts
  store.setMeta(sessionMeta(provider.name, model, cwd, !!opts.yes, 'normal', gitBranch(cwd)));
```

- [ ] **Step 3: Initialize `mode` and update `refreshMeta` + gate in `repl()`**

In `repl()`, set the initial mode in the `session` object literal (line ~308) by adding:

```ts
    mode: 'normal',
```

Change `refreshMeta` (line ~315) to pass the live mode:

```ts
  const refreshMeta = (): void => {
    store.setMeta(sessionMeta(session.providerName, session.model, cwd, !!opts.yes, session.mode, branch));
  };
```

Change the gate construction (line ~298) to read the live mode:

```ts
  const gate = createGate({ confirm: store.requestChoice, autoApprove: opts.yes, getMode: () => session.mode });
```

- [ ] **Step 4: Add the `onCycleMode` and `presentPlan` callbacks**

In `repl()`, after `refreshMeta` is defined, add:

```ts
  const cycleMode = (): void => {
    session.mode = nextMode(session.mode);
    refreshMeta();
    store.addSystem(`→ ${modeLabel(session.mode)} mode`);
  };

  // Drives the present_plan approval prompt. On approval, flip to normal so the same turn
  // continues under normal-mode gating; otherwise return the user's feedback to the agent.
  const presentPlan = async (plan: string): Promise<{ approved: true } | { approved: false; feedback?: string }> => {
    const result = await store.requestChoice({
      title: 'Approve this plan?',
      body: plan.split('\n'),
      options: [
        { label: '✅ yes, run it', value: 'yes' },
        { label: '✍ no — keep planning', value: 'no', opensInput: true, inputPlaceholder: 'what should change?' },
      ],
    });
    if (result?.value === 'yes') {
      session.mode = 'normal';
      refreshMeta();
      store.addSystem('→ plan approved · normal mode');
      return { approved: true };
    }
    return { approved: false, ...(result?.text ? { feedback: result.text } : {}) };
  };
```

- [ ] **Step 5: Pass `onCycleMode` to `mountApp`**

Change the `mountApp` call (line ~460) to:

```ts
  app = mountApp(store, (input) => { void onSubmit(input); }, { showHeader: true, onCycleMode: cycleMode });
```

- [ ] **Step 6: Use per-turn system prompt, tool filter, and presentPlan in `runTurn`**

In `repl()`, the base prompt is built once (line ~300, `const systemPrompt = buildSystemPrompt(cwd);`). Rename that const to `baseSystemPrompt`:

```ts
  const baseSystemPrompt = buildSystemPrompt(cwd);
```

Then in `onSubmit`, change the `runTurn` call (line ~404) to compute the effective prompt, filter `present_plan`, and pass `presentPlan`:

```ts
      await runTurn(messages, {
        provider: session.provider, registry, gate, cwd, model: session.model,
        systemPrompt: effectiveSystemPrompt(baseSystemPrompt, session.mode),
        toolFilter: (name) => name !== 'present_plan' || session.mode === 'plan',
        onText: h.onText, onToolStart: h.onToolStart, onToolEnd: h.onToolEnd, onUsage: h.onUsage,
        signal: controller.signal,
        ask: store.requestAsk,
        presentPlan,
        web: webCtxFromConfig(effectiveConfig),
      });
```

- [ ] **Step 7: Update the help text**

In the `HELP` array (line ~202), add a line before `/exit`:

```ts
  '  shift+tab          cycle mode: normal · auto-accept edits · plan',
```

- [ ] **Step 8: Build and run the full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 9: Manual smoke check**

Run: `node dist/cli.js` (or `npm run build && mdd` if linked) in a scratch git repo, then:
- Press **Shift+Tab** twice → status bar shows `plan`; a system line reads `→ plan mode`.
- Ask it to "add a hello function to a new file". In plan mode it should research (read-only) and call `present_plan`; you get the **Approve this plan?** prompt.
- Choose **yes** → status flips to normal (`→ plan approved · normal mode`) and it proceeds, now asking confirmation before the file write.
- Verify **auto-accept edits** mode (one Shift+Tab from normal): a file edit is applied without a confirm prompt, but a `run_shell` command still prompts.

Expected: all four behaviors as described.

- [ ] **Step 10: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): wire mode cycling — gate, present_plan, per-turn prompt, shift+tab, help"
```

---

## Self-Review Notes

- **Spec coverage:** §1 mode state → Tasks 1 & 8; §2 mode-aware gate → Task 2; §3 present_plan + approval → Tasks 3 & 8; §4 Shift+Tab → Task 7; §5 system-prompt steering → Task 5; §6 status bar/UX → Tasks 6, 7 (hints) & 8 (help). Schema exposure (§3) → Task 4.
- **Accepted limitation:** read-only `git` is blocked in plan mode (spec §2) — no task attempts to special-case it; the plan-mode addendum steers the agent to `read_file`/`list_dir`/`search` instead.
- **Type consistency:** `Mode`, `nextMode`, `modeLabel`, `EDIT_TOOLS` (Task 1) are used verbatim in Tasks 2/5/6/8. `PlanDecision` shape `{ approved: true } | { approved: false; feedback?: string }` matches between `present_plan` (Task 3) and the cli `presentPlan` callback (Task 8). `toolFilter`/`schemas(filter)` names match between Tasks 4 and 8.
- **`present_plan` reachability:** always registered (Task 3) so `registry.get` finds the handler; only its *schema* is filtered out when not in plan mode (Task 4) — the model can't call a tool whose schema it never sees.
