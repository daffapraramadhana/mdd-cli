# Mode cycling: Normal / Auto-accept / Plan

**Date:** 2026-07-14
**Status:** Approved — ready for implementation planning

## Summary

Add a mode-cycling system to the mdd REPL, toggled with **Shift+Tab**, that rotates
through three permission postures:

1. **Normal** (default) — asks confirmation before every mutating tool. Current behavior.
2. **Auto-accept edits** — auto-approves file edits (`write_file`, `edit_file`,
   `multi_edit`) but still prompts for `run_shell` and `git`.
3. **Plan** — read-only; blocks all mutating tools. The agent researches and ends its
   turn by proposing a plan via a dedicated `present_plan` tool. Approving the plan flips
   back to Normal mode and execution continues in the same turn.

This models Claude Code's mode cycle, mapped onto mdd's existing permission gate.

## Motivation

Today the only safety controls are per-call confirmation prompts and the global `--yes`
auto-approve flag (all-or-nothing). Users want:

- A **read-only "think first"** posture (Plan) to research a task and review a proposed
  plan before any change touches the working tree.
- A **lower-friction** posture (Auto-accept edits) that stops nagging for routine file
  edits while still guarding the riskier `run_shell` / `git`.

## Design

### 1. Mode state & data model

- New type `Mode = 'normal' | 'auto-edit' | 'plan'`.
- `ReplSession` (`src/cli.ts`) gains `mode: Mode`, defaulting to `'normal'`. This is the
  **single source of truth**, read live by the gate, the status-bar meta, and the
  `present_plan` tool.
- `SessionMeta` (`src/ui/store.ts` / consumed by the header/status bar) gains a `mode`
  field so the current mode renders in the UI.
- A pure helper `nextMode(mode: Mode): Mode` rotates
  `normal → auto-edit → plan → normal` (used by the keybinding; unit-testable).

### 2. Mode-aware permission gate

`createGate` (`src/permissions/index.ts`) currently takes a static `autoApprove`. It gains
`getMode: () => Mode` and evaluates in this precedence:

1. Tool is **non-mutating** → **allow**. (This is also why `present_plan`, being
   non-mutating, always passes the gate.)
2. `mode === 'plan'` → **deny** with reason:
   *"Plan mode is on — no changes yet. Research with read-only tools and call
   `present_plan` when ready."*
3. `autoApprove` (`--yes`) → **allow**.
4. `mode === 'auto-edit'` **and** tool is a file-edit tool
   (`write_file` | `edit_file` | `multi_edit`) → **allow**.
5. Tool is in the session's `always`-allow set → **allow**.
6. Otherwise → **confirm** (today's behavior).

Precedence note: Plan mode is checked **before** `--yes` on purpose — explicitly entering
plan mode is a stronger intent than the launch-time auto-approve flag, and plan mode is the
more restrictive posture.

**Known limitation (accepted for v1):** the `git` tool is marked `mutating: true`
wholesale, so read-only subcommands (`git status`, `git diff`, `git log`) are also blocked
in Plan mode. The agent can still research via `read_file`, `list_dir`, and `search`. If
this proves limiting, a follow-up can special-case read-only git subcommands; out of scope
here.

### 3. `present_plan` tool + approval flow

- New tool `present_plan` with input `{ plan: string }` (markdown). `mutating: false`.
- **Schema exposure:** the per-turn tool-schema list includes `present_plan` **only when
  `mode === 'plan'`**; it is omitted in other modes. All other tools remain in the schema
  in every mode (so post-approval execution can continue in the same turn).
- **Handler behavior**, on call:
  1. Render the plan (markdown) to the transcript.
  2. Show the existing choice prompt:
     **"Approve this plan?" → `✅ yes, run it` / `✍ no, keep planning`** — the "no" option
     opens the feedback input, mirroring the permission-gate prompt.
  3. **Approve** → set `session.mode = 'normal'`, refresh meta, return tool_result
     *"Plan approved — proceed with execution."* The loop continues in the **same turn**,
     now gated under Normal mode.
  4. **Keep planning** → return the user's feedback text as the tool_result; mode stays
     `plan`.
- **Wiring:** the handler reaches the UI prompt and mode mutation through a new context
  callback threaded through `AgentDeps` / the tool context, mirroring how `ask` is already
  threaded (`src/agent/loop.ts`). Concretely, a `presentPlan(plan) => Promise<...>`
  callback (or an `ask`-style + `setMode` pair) supplied by the REPL.

### 4. Shift+Tab keybinding

- An ink `useInput` handler in the input component (`src/ui/app.tsx`) catches Shift+Tab
  (`key.tab && key.shift`, and/or the `\x1b[Z` sequence) and calls an `onCycleMode` prop.
- `onCycleMode` sets `session.mode = nextMode(session.mode)`, refreshes the status bar, and
  prints a brief system line confirming the switch (e.g. `→ plan mode`).
- The current mode is passed into the app for the status bar display.

### 5. System-prompt steering

- The effective system prompt is composed **per turn**: `base + modeAddendum(mode)`.
  Currently `buildSystemPrompt(cwd)` is built once at startup; this moves composition to
  per-turn (or wraps the base with the addendum before calling `runTurn`).
- **Plan addendum:** instruct the agent to research with read-only tools only, not attempt
  edits/shell/git, and to end the turn by calling `present_plan` with a concrete,
  step-by-step plan.
- **Normal / Auto-accept:** no addendum (empty string).

### 6. Status bar / UX

- The status bar shows the active mode, visually distinct (e.g. color the `plan` label).
- Switching modes prints a one-line system confirmation.
- Help text (`HELP` in `src/cli.ts` and the header hints) mentions **Shift+Tab — cycle
  mode**.

## Testing

- **Gate matrix:** for each `Mode` × tool category (non-mutating / file-edit /
  shell / git), assert allow / deny / confirm per the precedence table. Include the
  Plan-vs-`--yes` precedence case.
- **`nextMode`:** rotates through all three and wraps correctly.
- **`present_plan`:** approve path sets mode to `normal` and returns the proceed result;
  reject path keeps mode `plan` and surfaces the feedback text.
- **Schema exposure:** `present_plan` present in the schema list only when in Plan mode.

## Out of scope

- Read-only `git` subcommand allowance in Plan mode (accepted limitation above).
- A `--plan` launch flag (keybinding is the entry point per the agreed design).
- A fourth "full auto" mode in the cycle (`--yes` already covers full auto-approve).
- Persisting the selected mode across sessions.

## Affected files (anticipated)

- `src/cli.ts` — `Mode` type, `ReplSession.mode`, `nextMode`, per-turn system prompt,
  `onCycleMode`, `present_plan` wiring, `SessionMeta.mode`, help text.
- `src/permissions/index.ts` — `getMode` param and precedence logic.
- `src/tools/` — new `present-plan.ts` tool + registry registration; schema-exposure hook.
- `src/agent/loop.ts` — thread the plan-approval / mode context callback.
- `src/ui/app.tsx` — Shift+Tab `useInput` handler, `onCycleMode` prop.
- `src/ui/store.ts` / header — `mode` in `SessionMeta` + status-bar rendering.
- `src/system-prompt.ts` — mode addendum text.
- Tests under `test/` accordingly.
