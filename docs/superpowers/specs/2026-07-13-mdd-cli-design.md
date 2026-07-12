# mdd CLI — Design (v1)

**Date:** 2026-07-13
**Status:** Approved design, ready for implementation planning

## Summary

`mdd` is MDD's internal, terminal-based AI coding assistant, built from scratch in
TypeScript/Node.js. It runs as an interactive REPL when launched bare (`mdd`) and as a
one-shot command when given a prompt (`mdd "fix the failing test"`). It is
**multi-provider**: the agent loop talks to a neutral `LLMProvider` interface with
Anthropic and OpenAI implementations, so users can pick Claude or OpenAI models.

v1 focuses on the **coding-assistant** capability (files, shell, git). Company ops
integrations (GitLab, Odoo) are explicitly deferred to v2.

## Goals

- A real, brandable `mdd` binary MDD engineers install and run in their terminal.
- Multi-turn agent loop calling the LLM directly (no external agent framework).
- Provider-agnostic: default Anthropic (`claude-opus-4-8`), switchable to OpenAI.
- Confirmation-gated mutations so it's safe to run on real repos.
- A clean tool-registry seam so GitLab/Odoo tools drop in later without loop changes.

## Non-Goals (v1)

- GitLab tools, Odoo tools, or any write-actions to those systems (→ v2).
- Central secrets service / Vault integration (→ later).
- Multi-agent / subagents.
- A rich TUI (v1 uses plain streamed text + readline prompts; ink is a later upgrade).
- A hard filesystem jail (confirm-on-mutate is the practical safety net for v1).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What is it | Company CLI agent; blend of coding assistant + ops agent |
| Build approach | From scratch — own agent loop calling LLM APIs directly |
| Language/runtime | TypeScript / Node.js |
| First ops systems | GitLab + Odoo — **deferred to v2** |
| v1 read/write posture | Read-only core, safe writes (e.g. MR/issue comments) as later stretch |
| Auth model | Per-user local config; actions run as that user's identity |
| Interaction | Both — REPL when bare, one-shot when given a prompt |
| v1 focus | Coding-first (files/shell/git); GitLab/Odoo in v2 |
| Providers | Multi-provider via `LLMProvider` abstraction (Anthropic + OpenAI) |

## Architecture

```
mdd (entry)
  → CLI parser (REPL vs one-shot; auth; flags)
    → Agent loop (neutral messages + tool dispatch)
      → Provider (LLMProvider interface)
          ├─ AnthropicProvider (@anthropic-ai/sdk)
          └─ OpenAIProvider (openai)
      → Tool registry (file, shell, git)
      → Permission gate (confirm mutations)
    → Config store (~/.config/mdd)
    → Terminal UI (streaming output, prompts)
```

Dependency flow is one-directional: `cli → agent → {providers, tools, permissions} → ui`,
with `config` as a leaf. No cycles; each unit is understandable and testable on its own.

**The provider seam:** the agent, tools, and permission gate deal only with our own
neutral `Message` / `ToolCall` / `ToolResult` types. Providers are the *only* code that
knows SDK-specific structures (Anthropic `tool_use`/`tool_result` blocks vs OpenAI
`tool_calls`/`tool` role messages; differing streaming events). The agent loop is
identical regardless of provider.

## Components

Each unit has one job; listed as *does / how used / depends on*.

1. **`cli/` — entry & argument parsing**
   - Parses `argv`; decides REPL vs one-shot; handles `mdd auth login`, `mdd --help`,
     `mdd --version`, and `--provider` / `--model` / `--yes` flags. Uses `commander`.
   - Depends on: config store, agent loop, terminal UI.

2. **`config/` — per-user config store** (leaf)
   - Reads/writes `~/.config/mdd/config.json`: `anthropicApiKey`, `openaiApiKey`,
     `defaultProvider`, `defaultModel`. Env overrides: `ANTHROPIC_API_KEY`,
     `OPENAI_API_KEY`. `auth login` writes with `0600` perms.
   - Depends on: nothing.

3. **`providers/` — LLM provider abstraction**
   - `LLMProvider` interface: `stream(messages, tools, opts)` → async iterable of neutral
     events (text deltas, tool-call requests, stop reason).
   - `AnthropicProvider` and `OpenAIProvider`, each translating the neutral message/tool
     format ↔ its SDK. `getProvider(name)` factory. Adding a 3rd provider = one new file.
   - Depends on: `@anthropic-ai/sdk`, `openai`.

4. **`agent/` — the agent loop**
   - Owns the conversation. Sends neutral messages + tool schemas to the provider,
     receives tool-use requests, dispatches through registry + permission gate, appends
     results, loops until a final text answer. Handles streaming. Bounded by a
     max-iterations cap.
   - Depends on: providers, tool registry, permission gate, terminal UI.

5. **`tools/` — tool registry + individual tools**
   - Each tool exports `{ name, description, inputSchema (Zod), mutating: boolean,
     handler }`. Registry collects them and produces the provider-neutral tools array.
     v1 tools: `read_file`, `write_file`, `edit_file`, `list_dir`, `run_shell`, `git`.
   - Depends on: Node `fs`, `child_process`. Each tool independently testable.

6. **`permissions/` — the permission gate**
   - Before executing a `mutating` tool, prompts `[y]es once / [n]o / [a]lways this
     session`. Supports session-level "always allow" per tool. Non-mutating tools run
     without prompting. `--yes`/config can pre-approve (CI); default is prompt-on-mutate.
   - Depends on: terminal UI.

7. **`ui/` — terminal rendering**
   - Streams assistant text, renders tool-call activity ("↳ running: npm test"), shows
     confirmation prompts, formats errors. v1 = plain streamed text + readline prompts.
   - Depends on: `readline`/stdout.

8. **`system-prompt.ts`** — mdd identity, cwd, OS, guidelines injected as the system prompt.

## Data Flow (one full turn)

Example: `mdd "add a health-check endpoint and run the tests"`

1. `cli` parses argv → one-shot mode, prompt captured.
2. `cli` loads config (provider, model, key). Missing key → error: "run `mdd auth login`".
3. `agent` builds initial request: system prompt + `[{ role: user, content: prompt }]` +
   neutral tools array.
4. `agent` calls the selected provider (streaming). Provider streams text + emits neutral
   tool-call requests.
5. For each tool call:
   a. look up tool in registry;
   b. if `tool.mutating` → permission gate prompts (unless "always"/`--yes`); denied →
      return `ToolResult { error: "user denied" }`;
   c. run handler → capture result (truncate if huge, ~30KB, with `[truncated]` marker);
   d. append `ToolResult` to messages.
6. `agent` sends messages back to the provider (loop to step 4).
7. Provider returns only text, no tool calls → final answer.
8. `ui` prints final answer; one-shot exits (code 0), REPL returns to prompt.

Key properties:
- **Bounded loop** — max tool rounds (e.g. 50); on hitting it, stop and report.
- **Size-capped tool results** — protect the context window.
- **REPL and one-shot share the exact same loop** — one-shot seeds one message and exits;
  REPL keeps the `messages` array alive and reads the next line back into step 3.
- **Errors are values** — a throwing tool returns `{ error }` as its result, so the model
  adapts rather than the process dying.

## Error Handling, Permissions & Safety

**Permission model**
- Every tool declares `mutating`. Read-only tools never prompt.
- Mutating tools prompt before running: `[y]es once / [n]o / [a]lways this session`.
- `--yes`/`--auto` flag + config setting pre-approve for trusted/CI contexts; default is
  prompt-on-mutate.
- `run_shell` shows the exact command before running. A small hard denylist (e.g.
  `rm -rf /`, fork bombs, disk formatting) is blocked regardless of approval.

**Error handling (layered)**
- **Tool errors** → returned as `ToolResult { error }`; never crash the process.
- **API errors** → typed: `401` → "check your API key (`mdd auth login`)"; `429`/overloaded
  → exponential backoff + retry, then a clean message; network errors → retry then report.
- **Config errors** → actionable message pointing at `mdd auth login`, not a stack trace.
- **User interrupt (Ctrl-C)** → cancels current turn / in-flight tool cleanly; returns to
  REPL prompt (or exits one-shot) without corrupting state.
- **Unexpected crashes** → top-level handler prints a friendly error + `--debug` hint for
  the full stack; optional log file at `~/.config/mdd/logs/`.

**Secret safety**
- API keys stored `0600`, never printed, never passed to tools, scrubbed from debug logs.

**Boundaries (v1)**
- Tools operate relative to cwd; cwd is surfaced in the system prompt. No hard filesystem
  jail in v1 — confirm-on-mutate is the safety net.

## Project Structure

```
mdd-cli/
  package.json            # bin: { "mdd": "./dist/cli.js" }
  tsconfig.json
  src/
    cli.ts                # entry, arg parsing, REPL vs one-shot
    config/               # config store (leaf)
    providers/
      index.ts            # LLMProvider interface + getProvider factory
      anthropic.ts
      openai.ts
    agent/                # agent loop
    tools/
      registry.ts
      read-file.ts  write-file.ts  edit-file.ts
      list-dir.ts  run-shell.ts  git.ts
    permissions/          # permission gate
    ui/                   # terminal rendering
    system-prompt.ts
  test/                   # mirrors src/
  README.md               # install + usage for MDD engineers
```

**Dependencies:** `@anthropic-ai/sdk`, `openai`, `commander`, `zod`. Dev: `vitest`,
`typescript`, `tsup` (or `tsc`).

**Distribution:** internal npm (private registry or git install); `npm i -g` gives
engineers the `mdd` binary. Built with `tsup`/`tsc`.

## Testing Strategy (test-driven)

- **Unit tests (the bulk):** each tool in isolation against a temp dir (`write_file`
  writes; `run_shell` captures output; `edit_file` handles missing match). Config store
  tested with a temp `HOME`. Permission gate tested with a mocked prompt.
- **Provider translation tests:** feed a neutral tool-call, assert correct SDK payload;
  feed a mocked SDK stream, assert correct neutral events. One suite per provider.
- **Agent-loop tests:** run against a **fake provider** implementing `LLMProvider`. Feed a
  scripted sequence (tool-call → tool-result → final text); assert the loop dispatches
  tools, appends results, respects the iteration cap, terminates. No real API in CI.
- **End-to-end smoke tests (opt-in, real keys, not default CI):** `mdd "list files in this
  dir"` returns sensibly; a one-shot write round-trips through the permission gate with
  `--yes`.
- **Framework:** `vitest`.

## Definition of Done (v1)

An MDD engineer can `npm i -g`, run `mdd auth login` (Anthropic and/or OpenAI), then use
both `mdd "..."` and the REPL to read/edit files and run shell/git in a real repo — with a
choice of provider/model, and all mutations gated by confirmation — covered by unit +
provider + mocked-loop tests.

## Future (v2+)

- GitLab tools (read-only first: repos, MRs, issues, pipelines, diffs; then safe writes
  like MR/issue comments).
- Odoo tools (read-only: customers, orders, inventory, invoices, reports; then safe writes).
- Central secrets service (Vault/SSO) as an alternative to per-user local config.
- Richer TUI (ink), subagents, additional providers.
