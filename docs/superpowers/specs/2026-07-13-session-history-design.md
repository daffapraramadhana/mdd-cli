# Session History & Resume — Design

**Date:** 2026-07-13
**Status:** Approved for planning (implementation pending)
**Area:** `src/session.ts` (new), `src/cli.ts`, `src/ui/store.ts`

## Problem

mdd keeps a conversation only in memory (`messages: Message[]` in `src/cli.ts`, and the
`UiStore` transcript). Quitting and relaunching starts fresh — there is no way to resume a
past conversation. Only `~/.config/mdd/config.json` (keys/model/theme) persists today.

Goal: persist REPL conversations per project and let the user resume them via
`mdd --continue`, `mdd --resume`, and an in-REPL `/resume`.

## Decisions (locked)

- **Entry points:** all three — `--continue` (most recent), `--resume` (picker), `/resume` (in-REPL).
- **Scope:** per project (current working directory), like Claude Code.
- **What is saved:** both the LLM `messages` (context) AND the full `transcript` (byte-identical
  redisplay incl. tool durations).
- **Resume restores the record's `model`** so the conversation continues as left; provider stays
  as the current session's (user can `/model`).
- **REPL only** — one-shot `mdd "prompt"` stays ephemeral (never saved).

## Storage

One JSON file per session:

```
~/.config/mdd/sessions/<project-slug>/<id>.json
```

- `<project-slug>` = cwd made filesystem-safe (`cwd.replace(/[^a-zA-Z0-9]/g, '-')`). The full
  `cwd` is also stored inside the file for display.
- `<id>` = `${timestamp}-${rand}` (sortable, unique). `timestamp` from `Date.now()`.

File shape (`SessionRecord`):

```ts
interface SessionRecord {
  id: string;
  cwd: string;
  createdAt: number;   // epoch ms
  updatedAt: number;   // epoch ms
  provider: string;
  model: string;
  title: string;       // first user message, truncated ~60 chars
  messages: Message[];      // from src/types.ts — LLM context
  transcript: TranscriptItem[]; // from src/ui/store.ts — UI items incl tool durations
}
```

Written **atomically**: write to `<id>.json.tmp`, then `rename` over `<id>.json`. Rewrites the
whole file after each completed turn (files are KB-sized; simplicity over append-log). A session
with zero messages is never written (no empty files).

## New module: `src/session.ts`

A focused `SessionStore` class, constructed with a base directory so it is fully unit-testable
(real `~/.config/mdd/sessions` in production, a temp dir in tests). No React/Ink imports.

```ts
interface SessionSummary { id: string; title: string; updatedAt: number; model: string; messageCount: number; }

class SessionStore {
  constructor(private baseDir: string) {}
  async save(record: SessionRecord): Promise<void>;              // atomic; skips empty
  async list(cwd: string): Promise<SessionSummary[]>;            // newest first; skips corrupt files
  async load(cwd: string, id: string): Promise<SessionRecord | null>;
  async mostRecent(cwd: string): Promise<SessionRecord | null>;
}
```

`list` reads the project dir and parses each file's summary fields; unreadable/corrupt files are
skipped (try/catch per file), never throwing.

## Store change

Add to `UiStore`:

```ts
loadTranscript(items: TranscriptItem[]): void; // replace transcript wholesale, clear streaming
```

Used on resume to restore saved transcript.

## Integration (`src/cli.ts`)

- Construct `const sessions = new SessionStore(join(configDir(), 'sessions'))` (reuse the config
  dir helper; add one if needed).
- At REPL start, determine the active session:
  - default: new record — fresh `id`, `createdAt = now`, empty title.
  - `--continue` / `-c`: `sessions.mostRecent(cwd)`; if present, seed `messages` and
    `store.loadTranscript(record.transcript)`, set `currentId = record.id`, restore `session.model`.
    If none, start fresh with a system note.
  - `--resume` / `-r`: a **pre-mount** numbered picker (readline, same style as the onboarding
    wizard) listing `sessions.list(cwd)`; on pick, seed as above. No sessions → note + fresh.
- Keep a mutable `currentId`, `createdAt`, and `title`.
- In `onSubmit`'s `finally` (after `commitStreaming` / `setStatus('idle')`): fire-and-forget
  `void sessions.save({ id: currentId, cwd, createdAt, updatedAt: Date.now(), provider:
  session.providerName, model: session.model, title, messages, transcript: store.getState().transcript })`.
  Set `title` from the first user message if still empty.
- `/resume` command (in `handleReplCommand`): `store.requestSelect(...)` over `sessions.list(cwd)`
  labels (`"<title>  ·  <relative time>  ·  <n> msgs"`); on pick, `load` it, replace `messages`
  contents in place, `store.loadTranscript(record.transcript)`, set `currentId`/`createdAt`/`title`
  and `session.model` from the record. Current session is already saved after its last turn.

Add commander options on the root command: `-c, --continue` and `-r, --resume`. Both apply to the
REPL path only (ignored when a one-shot prompt is given).

Label → id mapping for pickers: build a parallel `ids: string[]` alongside the option strings and
map by index (labels include the timestamp so are effectively unique).

## Data flow

Start → pick session (new | most-recent | picked) → seed memory if resumed. Each completed turn →
atomic `save`. `/resume` → save-then-load-swap → continue. Provider/keys unchanged; only the
conversation + model id are restored.

## Error handling

- Corrupt/unreadable session file → skipped in `list`, `load` returns `null`.
- `--continue` with no prior session, `--resume`/`/resume` with none → system note, continue fresh.
- Save failures are swallowed (fire-and-forget) but logged to a `store.addSystem` note on error so
  the user knows persistence failed.
- Atomic write prevents partial/corrupt files on crash mid-write.

## Testing

- `test/session.test.ts` (temp base dir): save→list→load roundtrip; `mostRecent`; title truncation;
  empty session not written; corrupt file skipped by `list`; per-project isolation (two cwds).
- `test/ui/store.test.ts`: `loadTranscript` replaces transcript and clears streaming.
- `test/cli.*.test.ts`: `--resume` list formatting / label building (pure helper extracted for testability).

## Scope boundaries (YAGNI)

- No delete / rename / search of sessions.
- No global (cross-project) list.
- One-shot prompts not persisted.
- No migration/versioning of the on-disk format (add a `version` field only if a change is needed).
