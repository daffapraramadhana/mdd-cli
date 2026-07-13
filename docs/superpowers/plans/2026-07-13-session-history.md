# Session History & Resume — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. TDD throughout. Read the spec
> first: `docs/superpowers/specs/2026-07-13-session-history-design.md`.

**Goal:** Persist REPL conversations per project and resume them via `mdd --continue`,
`mdd --resume`, and an in-REPL `/resume`.

**Architecture:** New pure `SessionStore` (JSON-per-session, atomic writes) + a `UiStore.loadTranscript`
setter + `cli.ts` wiring (session lifecycle, flags, save-per-turn, `/resume`).

**Tech Stack:** TypeScript ESM, Node fs/promises, vitest. No new dependencies.

## Global Constraints

- No new runtime dependencies.
- `src/session.ts` must not import React/Ink; it takes a base dir for testability.
- Persist REPL sessions only; one-shot (`mdd "prompt"`) stays ephemeral.
- Atomic writes (temp + rename). Never write a session with zero messages.

---

### Task 1: `SessionStore` module

**Files:**
- Create: `src/session.ts`
- Test: `test/session.test.ts`

**Interfaces (Produces):**
```ts
import type { Message } from './types.js';
import type { TranscriptItem } from './ui/store.js';

export interface SessionRecord {
  id: string; cwd: string; createdAt: number; updatedAt: number;
  provider: string; model: string; title: string;
  messages: Message[]; transcript: TranscriptItem[];
}
export interface SessionSummary { id: string; title: string; updatedAt: number; model: string; messageCount: number; }

export function projectSlug(cwd: string): string;      // cwd.replace(/[^a-zA-Z0-9]/g, '-')
export function makeSessionId(now: number, rand: string): string; // `${now}-${rand}`
export function truncateTitle(text: string, max?: number): string; // first line, ~60 chars, ellipsis

export class SessionStore {
  constructor(baseDir: string);
  save(record: SessionRecord): Promise<void>;           // atomic; no-op if messages.length === 0
  list(cwd: string): Promise<SessionSummary[]>;          // newest-first; skips unreadable files
  load(cwd: string, id: string): Promise<SessionRecord | null>;
  mostRecent(cwd: string): Promise<SessionRecord | null>;
}
```

**Steps:**
- [ ] Write `test/session.test.ts` with a temp base dir (`fs.mkdtemp` in `os.tmpdir()`):
  roundtrip save→list→load; `mostRecent` returns highest `updatedAt`; `truncateTitle` cuts at ~60 with `…`;
  `save` with `messages: []` writes nothing (`list` stays empty); a hand-written corrupt `.json`
  file is skipped by `list`; two different `cwd`s stay isolated.
- [ ] Run to confirm failure: `npx vitest run test/session.test.ts`.
- [ ] Implement `src/session.ts`:
  - `dir(cwd) = join(baseDir, projectSlug(cwd))`.
  - `save`: skip if `!record.messages.length`; `mkdir(dir, {recursive:true})`; write JSON to
    `join(dir, id + '.json.tmp')` then `rename` to `id + '.json'`.
  - `list`: `readdir(dir)` (catch ENOENT → `[]`); for each `*.json`, `readFile`+`JSON.parse` in a
    try/catch (skip on error), map to summary (`messageCount = messages.length`); sort by
    `updatedAt` desc.
  - `load`: read `join(dir, id + '.json')`, parse, return null on any error.
  - `mostRecent`: `list(cwd)[0]` then `load` its id (or read directly).
- [ ] Run to confirm pass. Commit.

### Task 2: `UiStore.loadTranscript`

**Files:**
- Modify: `src/ui/store.ts`
- Test: `test/ui/store.test.ts`

**Interfaces (Produces):** `loadTranscript(items: TranscriptItem[]): void` — replaces `transcript`,
clears `streaming` to `''`.

**Steps:**
- [ ] Write failing test: after `appendStreaming('x')` then `loadTranscript([{kind:'user',text:'hi'}])`,
  `getState().transcript` equals the passed items and `streaming === ''`.
- [ ] Run to confirm failure.
- [ ] Implement: `loadTranscript = (items) => { this.set({ transcript: items, streaming: '' }); };`
- [ ] Run to confirm pass. Commit.

### Task 3: cli lifecycle + `--continue` / `--resume`

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/config/index.ts` (export a `configDir(): string` helper if not present, returning
  the `~/.config/mdd` dir the config file lives in)
- Test: `test/cli.session.test.ts`

**Interfaces (Consumes):** `SessionStore` (Task 1), `UiStore.loadTranscript` (Task 2).
**Produces (pure helper for testability):**
`sessionOptionLabel(s: SessionSummary, now: number): string` → `"<title>  ·  <relative time>  ·  <n> msgs"`.

**Steps:**
- [ ] Add `-c, --continue` and `-r, --resume` to the root command options; extend `RunOpts` with
  `continue?: boolean; resume?: boolean`.
- [ ] In `repl(opts)`, after building `store`/`messages`, construct
  `const sessions = new SessionStore(join(configDir(), 'sessions'));` and lifecycle state:
  `let currentId = makeSessionId(Date.now(), Math.random().toString(36).slice(2, 8));`
  `let createdAt = Date.now(); let title = '';`
- [ ] Seeding helper `seed(record)`: `messages.splice(0, messages.length, ...record.messages);`
  `store.loadTranscript(record.transcript); currentId = record.id; createdAt = record.createdAt;`
  `title = record.title; session.model = record.model; refreshMeta();`
- [ ] If `opts.continue`: `const r = await sessions.mostRecent(cwd); if (r) seed(r); else store.addSystem('No previous session in this project — starting fresh.')`.
- [ ] Else if `opts.resume`: `const items = await sessions.list(cwd);` if empty →
  `store.addSystem('No sessions to resume — starting fresh.')`; else print a numbered readline
  picker (reuse the onboarding readline pattern: `createInterface`, print
  `sessionOptionLabel(...)` per line, read a number, `load` the chosen id, `seed`).
  NOTE: do the picker BEFORE `mountApp`.
- [ ] Write `sessionOptionLabel` + a `relativeTime(then, now)` helper (`"3m ago"`, `"2h ago"`,
  `"just now"`); unit-test both in `test/cli.session.test.ts`.
- [ ] In `onSubmit`: set `if (!title) title = truncateTitle(line);` right after `store.addUser(line)`.
- [ ] In `onSubmit`'s `finally` (after `commitStreaming()`): fire-and-forget save:
  ```ts
  void sessions.save({
    id: currentId, cwd, createdAt, updatedAt: Date.now(),
    provider: session.providerName, model: session.model, title,
    messages, transcript: store.getState().transcript,
  }).catch(() => store.addSystem('⚠ could not save session history'));
  ```
- [ ] Confirm one-shot path (`oneShot`) is untouched (no persistence).
- [ ] Run `npx vitest run test/cli.session.test.ts`. Commit.

### Task 4: in-REPL `/resume`

**Files:**
- Modify: `src/cli.ts` (`handleReplCommand` + its `CommandDeps`)
- Test: extend `test/cli.commands.test.ts`

**Steps:**
- [ ] Add a `resumeSession` callback to `CommandDeps` (like `pickModel`), wired in `repl()` to:
  `const items = await sessions.list(cwd);` build labels + parallel `ids`; if empty →
  `store.addSystem('No sessions to resume.')`; else
  `const chosen = await store.requestSelect('Resume a session  (↑/↓ · enter · esc)', labels);`
  map `labels.indexOf(chosen)` → id → `load` → `seed` → `store.addSystem('→ resumed: ' + title)`.
- [ ] Add a `case '/resume':` in `handleReplCommand` calling `deps.resumeSession()`.
- [ ] Add `/resume` to the `HINTS` string in `src/ui/app.tsx` and the `/help` output.
- [ ] Extend `test/cli.commands.test.ts`: `/resume` invokes the `resumeSession` dep.
- [ ] Run the command test. Commit.

### Task 5: full verify + build

- [ ] `npx vitest run` — all green.
- [ ] `npx tsc --noEmit` — no errors.
- [ ] `npm run build` — success.
- [ ] Manual smoke: `mdd`, chat a turn, `/exit`; relaunch `mdd --continue` → prior transcript
  restored; `mdd --resume` → picker lists it; in-REPL `/resume` swaps sessions.
- [ ] Commit.

## Notes for the implementer

- `Date.now()` / `Math.random()` are fine here (this is Node runtime, not a workflow script).
- `configDir()` should return the directory of the config file (`dirname` of the config path in
  `src/config/index.ts`) so sessions live under `~/.config/mdd/sessions/`.
- Keep `SessionStore` free of Ink/React so `test/session.test.ts` runs without a terminal.
- The design rationale and locked decisions are in the spec — do not re-litigate them.
