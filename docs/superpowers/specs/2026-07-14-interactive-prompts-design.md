# Interactive Prompts — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending spec review

## Goal

Improve every UI/UX moment where the agent pauses to get input from the user. Today
there are two such moments and they are inconsistent and crude:

1. **Permission confirmation** (mutating tools) renders a raw string with `JSON.stringify`
   of the input and typed `[y]es / [n]o / [a]lways` — e.g.
   `Allow git? {"args":"log --oneline -15"} [y]es / [n]o / [a]lways:`. A rejection tells
   the model only "User denied this tool call." with no reason, so it stalls or blindly
   retries.
2. **Pickers** (`/models`, `/resume`) use a nice arrow-key `SelectList`, but nothing else does.

And one moment is missing entirely:

3. **The agent cannot ask the user a question.** Mid-task it can only proceed or stop.

This feature unifies all of these on **one styled prompt component**, redesigns the
confirmation, adds reason-on-reject, and introduces an `ask_user` capability.

## Decisions (from brainstorming)

- The agent's question UI is **multiple-choice + free text**: suggested options you pick
  with arrow keys, or a "type my own" row that opens a text field.
- The confirmation offers **yes / no-with-reason / always**. "No" opens a text field whose
  content threads back to the model as the denial reason.
- File-edit confirmations show the **action line only** (e.g. `edit src/app.tsx`), no diff.
- Ships as **one bundle**.

## Non-goals

- Diff/content previews in confirmations (action line only).
- A broader "always allow everything this session" escape hatch (per-tool `always` only).
- Changing the safety model (which tools are mutating, when the gate fires) — only its UI
  and the reason-threading.

---

## Architecture

### The shared component — generalize `SelectList`

`src/ui/select.tsx` currently takes `title: string` + `options: string[]` and resolves to a
chosen string (or cancel). Generalize it to a **prompt card** that all three surfaces use:

```ts
export interface ChoiceOption {
  label: string;          // what the user sees
  value: string;          // returned on select
  opensInput?: boolean;   // when chosen, reveal a text field instead of resolving immediately
  inputPlaceholder?: string;
}

export interface PromptSpec {
  title: string;          // header line (e.g. "before this can run, it needs your ok")
  body?: string[];        // optional lines above the options (the action, or the question)
  options: ChoiceOption[];
}

// Resolves to the chosen option's value plus optional typed text (from an opensInput option),
// or null on Esc-cancel.
export type ChoiceResult = { value: string; text?: string } | null;
```

Component behavior:
- Arrow keys move; Enter selects.
- If the selected option has `opensInput`, the component switches into text-entry mode
  (embeds `ink-text-input`), and Enter there resolves `{ value, text }` (text may be empty).
- Esc in text-entry mode returns to the option list (does not cancel the whole prompt).
- Esc at the option list resolves `null` (cancel).
- Renders `title`, then `body` lines (dim), then the options with the existing `❯` highlight,
  then the hint line.

Keep the exported name `SelectList` to minimize churn, but its props change to
`{ spec: PromptSpec; onResolve: (r: ChoiceResult) => void; accent: string }`.

### Store — one pending-prompt slot

Replace the `pendingSelect` / `requestSelect` / `resolveSelect` trio with a generalized one:

```ts
pendingChoice: PromptSpec | null;
requestChoice(spec: PromptSpec): Promise<ChoiceResult>;
resolveChoice(result: ChoiceResult): void;
```

`requestSelect(title, options)` is removed; the two existing callers (`/models`, `/resume`)
migrate to `requestChoice` by mapping their `string[]` to `ChoiceOption[]`
(`{ label: s, value: s }`) and reading `result?.value`.

### 1. Permission confirmation

`src/permissions/index.ts` — `createGate` stops building a raw string. It builds a
`PromptSpec` and calls a richer callback:

```ts
// New gate dependency (replaces the plain PromptFn):
type ConfirmFn = (spec: PromptSpec) => Promise<ChoiceResult>;
```

The spec is built from the tool + input using the EXISTING `formatToolCall` /`toolIcon`
(from `src/ui/format.ts`) so the action reads `⎇ git log --oneline -15`, not raw JSON:

- `title`: `"before this runs, it needs your ok"`
- `body`: `[`<icon> <formatToolCall(tool.name, input)>`]`
- `options`:
  - `{ label: 'yes, run it', value: 'yes' }`
  - `{ label: 'no — tell it what to do instead', value: 'no', opensInput: true, inputPlaceholder: 'what should it do instead?' }`
  - `{ label: `always allow ${tool.name} this session`, value: 'always' }`

`gate.check` return type changes from `'allow' | 'deny'` to:

```ts
interface GateDecision { allow: boolean; reason?: string; }
```

- `yes` → `{ allow: true }`
- `always` → register in the `always` set, `{ allow: true }`
- `no` → `{ allow: false, reason: result.text }` (reason may be empty if the user typed nothing)
- Esc-cancel (`null`) → treated as `no` with no reason (safe default: deny).

`src/agent/loop.ts` — the gate-denial path currently pushes a fixed
`'User denied this tool call.'`. It now incorporates the reason:

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

(Note: `check` returning an object means the loop's `=== 'deny'` comparison is replaced by
`!decision.allow`.)

### 2. `ask_user` tool

A new **non-mutating** tool so it skips the confirmation gate and prompts directly:

`src/tools/ask-user.ts`:
```ts
inputSchema: z.object({
  question: z.string().describe('The question to ask the user.'),
  options: z.array(z.string()).optional().describe('Optional suggested answers the user can pick from.'),
})
mutating: false
```

Its handler needs to prompt the user, so extend the tool context:

`src/tools/types.ts` — `ToolContext` gains an optional capability:
```ts
export interface ToolContext {
  cwd: string;
  ask?: (question: string, options?: string[]) => Promise<string>;
}
```

Handler:
```ts
async handler(input, ctx) {
  const { question, options } = parsed;
  if (!ctx.ask) return { content: 'User interaction is not available in this context.', isError: true };
  const answer = await ctx.ask(question, options);
  return { content: answer, isError: false };
}
```

`src/agent/loop.ts` — `AgentDeps` gains `ask?: (question, options?) => Promise<string>`, and
the handler call passes it through: `tool.handler(use.input, { cwd: deps.cwd, ask: deps.ask })`.

`src/cli.ts` — wires `ask` to a new store helper built on `requestChoice`:
```ts
// store.requestAsk(question, options) builds a PromptSpec:
//   title: question
//   options: [...suggested.map(o => ({label:o, value:o})),
//             { label: '✎ type my own answer…', value: '__free__', opensInput: true }]
// returns result.text (free) or result.value (picked); empty string if cancelled.
```
Both `runTurn` call sites (one-shot and interactive) pass `ask: store.requestAsk`. (One-shot
has a TUI mounted too, so `ask` works there as well.)

Register `askUserTool` in `src/tools/index.ts`. Add one line to the system prompt
(`buildSystemPrompt`) telling the model it may call `ask_user` when it needs a decision only
the user can make, rather than guessing.

### 3. Picker polish

Falls out of the shared component: `/models` and `/resume` now render through the same
`SelectList` (generalized), so highlight, spacing, and the hint line are consistent with the
confirmation and ask cards. No separate work beyond migrating their call sites.

---

## Data flow summary

```
model → tool_use(ask_user) → loop → ctx.ask() → store.requestAsk → pendingChoice
        → App renders SelectList → user picks/types → resolveChoice → answer → tool_result → model

mutating tool_use → loop → gate.check → store.requestChoice(confirm spec)
        → App renders SelectList → yes/no+reason/always → GateDecision → allow OR deny(reason) → model
```

## Testing

- **Component** (`select.test.tsx`): arrow-key movement + wrap (existing `clampIndex` stays);
  selecting a plain option resolves `{ value }`; selecting an `opensInput` option enters text
  mode and Enter resolves `{ value, text }`; Esc at the list resolves `null`.
- **Store** (`store.test.ts`): `requestChoice` sets `pendingChoice`; `resolveChoice` clears it
  and resolves the promise; `requestAsk` builds the right spec and returns typed vs picked text.
- **Gate** (`permissions` test): builds a spec with the human-readable action; maps
  yes/always/no(+reason)/cancel to the right `GateDecision`; `always` suppresses re-prompt.
- **ask_user tool**: returns `ctx.ask` result as content; errors cleanly when `ask` is absent.
- **Loop**: denial threads the reason into the tool_result; `ask_user` handler receives the
  wired `ask`.
- **Migration**: `/models` and `/resume` still resolve the chosen id (update existing cli tests).

## Build order

1. Component generalization (`SelectList` + `PromptSpec`/`ChoiceOption`/`ChoiceResult`).
2. Store (`pendingChoice`/`requestChoice`/`resolveChoice`; migrate `requestSelect` callers).
3. App wiring + `/models`,`/resume` migration.
4. Permission confirmation (gate spec + `GateDecision` + loop deny reason).
5. `ask_user` tool (+ `ToolContext.ask`, loop `ask`, cli `requestAsk`, registry, system prompt).

## Files touched

- `src/ui/select.tsx` — generalized prompt card.
- `src/ui/store.ts` — `pendingChoice`/`requestChoice`/`resolveChoice`/`requestAsk`.
- `src/ui/app.tsx` — render `pendingChoice` via `SelectList`.
- `src/permissions/index.ts` — `ConfirmFn`, `PromptSpec` build, `GateDecision`.
- `src/agent/loop.ts` — `gate.check` object return, deny-reason threading, `ask` in deps + ctx.
- `src/tools/types.ts` — `ToolContext.ask`.
- `src/tools/ask-user.ts` (new) + `src/tools/index.ts` (register).
- `src/cli.ts` — migrate pickers to `requestChoice`, wire `ask: store.requestAsk`.
- System prompt builder — one line about `ask_user`.
- Tests alongside each.
