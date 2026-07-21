# Design: user-installable plugins (skills + slash commands)

Date: 2026-07-21
Status: approved (design), pending implementation plan

## Goal

Let users install, manage, and share bundles of **skills** and **slash commands** —
called *plugins* — without editing mdd-cli's source. Skills already work when a user
manually drops a `SKILL.md` folder into `.mdd/skills/` or `~/.config/mdd/skills/`; this
feature adds (a) an installer that fetches plugins from git, (b) plugin-contributed slash
commands, and (c) live management from both the CLI and the REPL.

Non-goals: MCP servers, native JS/TS tools, an npm-based or hosted-marketplace install
path. A plugin ships markdown only; the sole code-execution path is command *shell
prefill*, which is fully gated (see §5).

## Decisions (from brainstorming)

- Plugin scope: **skills + slash commands**.
- Install source: **git URL / GitHub `owner/repo` shorthand** (clone; update = pull).
- Command format: **markdown prompt template with shell prefill** (`` !`cmd` ``).
- Prefill trust: **routed through the existing permission gate** (`src/permissions`).
- Management surface: **both `mdd plugin …` and in-REPL `/plugin …`**.
- Activation: **global by default** (`~/.config/mdd/plugins/`), **project can add more**
  (`.mdd/plugins/`).

## Architecture

Chosen approach: **a plugin is a directory that contributes skills and commands**, reusing
the existing skill machinery. `loadSkills()` gains a third source, `'plugin'`, so plugin
skills flow through the existing `use_skill` tool with no change to that tool. Commands
are a new, parallel registry consulted by the REPL command handler.

Rejected alternatives:
- *Unified extension model* (a bare skill folder is an anonymous plugin): rewrites working
  code and changes existing on-disk layout for no user-visible gain.
- *Fully separate plugin subsystem*: duplicates frontmatter parsing, name-collision, and
  precedence logic — two code paths to keep in sync.

### On-disk layout

```
~/.config/mdd/plugins/<name>/     # global — installed by `mdd plugin add`
.mdd/plugins/<name>/              # project-local — committed with the repo
  mdd-plugin.json                 # { name, description, version?, homepage? }
  skills/<slug>/SKILL.md          # zero or more skills
  commands/<slug>.md              # zero or more commands
```

A plugin missing or with an unparseable `mdd-plugin.json` is **skipped with a warning**,
never a crash — matching the forgiving posture of the current `loadRoot`. The manifest's
`name` (falling back to the directory name) is the plugin's identity.

### Resolution & precedence

On a **name collision**, first-wins in this order:

1. **Local skill files** — the existing `loadSkills()` result (`.mdd/skills/` then
   `~/.config/mdd/skills/`). Your own skill files always outrank anything a plugin brings in.
2. **Project plugins** — `.mdd/plugins/*/` (skills and commands).
3. **Global plugins** — `~/.config/mdd/plugins/*/` (skills and commands).

Rationale for this simpler tiering (vs. fully interleaving local files and plugins): a clean
two-list merge — local skills, then plugin skills — is trivial to implement and reason about,
and the interleaved case (the *same* name existing as both a local file and a plugin entry)
is a rare edge. Within plugins, the project root is scanned before the global root, so a
project plugin wins over a global one. Commands come only from plugins, so their order reduces
to project-plugin over global-plugin.

Built-in slash commands (`/model`, `/theme`, …) always outrank plugin commands — a plugin
cannot shadow a built-in.

### Module boundaries

- `src/plugins/index.ts` — **discovery**. Reads plugin roots, parses manifests, returns
  the plugin skills (as `Skill[]`) and the command registry. Depends on: `config`,
  `skills/index.ts` (`parseSkillFile`), fs. Pure/read-only.
- `src/plugins/commands.ts` — **command model + parsing**. Parses `commands/*.md`
  frontmatter (`description`, `argument-hint`) and body; renders a command against args
  (`$ARGUMENTS`, `$1`…), returning the rendered text plus the list of prefill spans found.
  No fs, no execution — trivially unit-testable.
- `src/plugins/manage.ts` — **installer core**: `add`, `list`, `remove`, `update`. Only
  ever shells out to `git`. Returns structured results; printing/prompting is the caller's
  job (CLI vs REPL).
- Wiring: `src/skills/index.ts` extends `Skill.source` to include `'plugin'` and adds an
  optional `plugin?: string`; `src/cli.ts` loads plugins alongside skills, threads the
  command registry into the REPL, and adds the `mdd plugin` subcommand.

### Data types

```ts
// skills/index.ts
export interface Skill {
  name: string; description: string; body: string;
  source: 'project' | 'personal' | 'plugin';
  plugin?: string;            // set when source === 'plugin'
  path: string;
}

// plugins/commands.ts
export interface Command {
  name: string;               // slug, from filename
  description: string;
  argumentHint?: string;
  body: string;               // raw template, prefill spans intact
  source: 'project' | 'personal' | 'plugin';
  plugin?: string;
  path: string;
}

// plugins/index.ts
export interface LoadedPlugins {
  skills: Skill[];            // merged into the existing skill list by cli.ts
  commands: Map<string, Command>;
  warnings: string[];         // surfaced to the user, non-fatal
}
```

## Slash commands

### Command file

```markdown
---
description: Review the current diff and suggest concrete fixes
argument-hint: "[base-branch]"
---
Review this diff and list concrete fixes:

!`git diff $ARGUMENTS`
```

### Rendering

- `/foo a b c` → `$ARGUMENTS` becomes the raw arg string `a b c`; `$1`,`$2`,`$3` become
  positional args; unmatched positionals become empty string.
- Substitution happens **before** prefill spans are scanned, so `$ARGUMENTS` can appear
  inside a `` !`…` `` span (as in the example).
- A prefill span is `` !`<shell command>` ``. Each is executed (see §5) and replaced by
  its stdout (trailing newline trimmed). Spans are independent; ordering is left-to-right.

### Submission flow

The rendered text is **submitted as a user turn** — identical to the user typing it. In
`src/cli.ts`, `onSubmit`'s slash branch becomes async. On an unknown `/name`:

1. Look up the command registry (built-ins already handled by the `switch`).
2. If found, render + run prefill, then re-enter the normal user-turn path with the
   rendered text as `input.text` (reusing the existing message-append + `runTurn` code).
3. If not found, keep today's `unknown command: /x — try /help`.

`handleReplCommand`'s signature changes from `void` to `Promise<void>`; its deps gain the
command registry and a way to submit a synthesized user turn. The single caller already
`void`s it.

### Discoverability

- `/help` lists plugin commands with their descriptions and argument hints, grouped after
  built-ins.
- The `HINTS` line and `/help` note that `/plugin` manages installs.

## Installer

Core verbs in `src/plugins/manage.ts`, wrapped by CLI (`mdd plugin <verb>`) and REPL
(`/plugin <verb>`):

| Verb | Behavior |
|---|---|
| `add <owner/repo \| git-url>` | `git clone --depth 1 <resolved-url> ~/.config/mdd/plugins/<name>`. `owner/repo` → `https://github.com/owner/repo`. Clone into a staging dir under the plugins root, read the manifest `name`, then rename to `~/.config/mdd/plugins/<name>`. Refuse (and clean up staging) if the final dir already exists — tell the user to `update`. |
| `list` | All plugins from both roots: name · scope (global/project) · #skills · #commands · version. |
| `remove <name>` | Delete the **global** plugin dir after confirmation. Project plugins live in-repo and are not removed by this command (message says so). |
| `update [name]` | `git pull --ff-only` in the named global plugin dir, or all of them when omitted. Skips project plugins and non-git dirs with a note. |

`/plugin` reloads skills + commands live after any mutating verb, so the running session
picks up changes without a restart.

CLI shape (commander): `mdd plugin add|list|remove|update`, consistent with existing
subcommands in `src/cli.ts`.

## Security & error handling

- **Install** runs only `git`. Cloning executes no plugin code — no npm install, no
  lifecycle hooks. (`git clone` of a hostile repo is treated as data.)
- **Prefill** is the only execution path. Each span is routed through the existing
  `PermissionGate` by constructing a synthetic `run_shell`-shaped check, so the user sees
  the same `before this runs, it needs your ok` prompt — with `yes` / `no` /
  `always allow run_shell this session`. `always allow run_shell` already granted (to the
  agent) also covers prefill, matching one mental model of "this session trusts shell".
- **Denied prefill** → the span resolves to empty string, a `⚠ skipped: <cmd>` note is
  added, and the turn still submits with the rest of the rendered text.
- Malformed manifest, bad `SKILL.md`/command frontmatter, or a failed clone/pull →
  surfaced as a user-facing message; discovery of the remaining plugins continues.
- Prefill execution reuses the same shell-invocation code as the `run_shell` tool (same
  cwd, same timeout posture) rather than a second ad-hoc `execSync`.

## Testing

- `plugins/commands.ts`: frontmatter parsing; `$ARGUMENTS`/`$N` substitution incl. empty
  and extra args; prefill-span extraction incl. `$ARGUMENTS` inside a span; no-span case.
- `plugins/index.ts`: discovery across both roots; precedence/first-wins with a name in
  two roots; skip + warn on missing/bad manifest; empty roots → empty result.
- `plugins/manage.ts`: URL resolution (`owner/repo` → github https, full URL passthrough);
  `add` refusing an existing dir; `list` shape. Git calls stubbed/faked — no network.
- Gate integration: a denied prefill yields empty substitution + a warning and still
  submits; an approved one substitutes stdout.
- `skills/index.ts`: existing tests still pass with the widened `source` union.

## User-facing changelog (Unreleased / Added)

- `mdd plugin add|list|remove|update` and in-REPL `/plugin` to install and manage plugins.
- Plugins can contribute skills and `/slash` commands (markdown prompt templates with
  optional, permission-gated shell prefill).
```
