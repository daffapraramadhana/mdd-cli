# Design: slash-command autocomplete menu in the REPL

Date: 2026-07-22
Status: approved (design), pending implementation plan

## Goal

When the user types `/` at the REPL prompt, show a live dropdown of available commands —
built-ins and installed plugins' `/slash` commands — filtered as they type, so commands are
discoverable without memorizing them or running `/help`.

Non-goals: fuzzy matching, argument-hint previews inside the menu, autocomplete for anything
other than the leading command token (no arg/path completion), mouse interaction.

## Decisions (from brainstorming)

- **Keys:** `↑/↓` move the highlight, `Tab` completes the highlighted command into the input,
  `Enter` runs whatever is in the box (unchanged), `Esc` dismisses the menu. `shift+Tab`
  remains "cycle mode".
- **Contents:** built-ins + plugin commands, built-in wins on a name collision.
- **Matching:** prefix match on the text after `/`, sorted alphabetically. Bare `/` shows all.

## Behavior

The menu is visible when **all** hold:
- `state.status === 'idle'` (not mid-turn),
- no `pendingChoice` and no `pendingPrompt` (no modal/prompt owns the input),
- `value` starts with `/` and contains no space yet (still typing the command name),
- the menu has not been dismissed with `Esc` for the current command token,
- at least one command matches.

Typing a space (entering args) or any non-`/` first character hides it. Rendered as a compact
list directly above the `> ` prompt line, capped at **8** rows; when more match, an 8th-row
`+N more` affordance replaces the last shown item's slot (i.e. show 7 + a `+N more` line).

`Tab` rewrites the input to `/<name> ` (trailing space, ready for args) via the existing
`setInput`; the trailing space then hides the menu. `Esc` sets a dismissed flag that resets as
soon as the command token changes (any edit to `value`), so the menu can reappear.

## Architecture

Four focused pieces; the two new UI modules keep `app.tsx` from absorbing list logic.

### `src/ui/slash-commands.ts` (new) — data + pure helpers

```ts
export interface SlashCommand { name: string; description: string }

// The canonical built-in commands shown in the menu. Names are WITHOUT the leading slash.
export const BUILTIN_SLASH_COMMANDS: SlashCommand[]

// Merge built-ins with the session's plugin commands; built-in wins on name collision.
// Plugin commands come from the repl's command registry (name + description).
export function buildSlashCommands(
  pluginCommands: Iterable<{ name: string; description: string }>,
): SlashCommand[]

// Prefix-filter by the text after a leading '/', sorted by name. `value` is the raw input
// (e.g. "/pl"). Returns [] when value doesn't start with '/' or contains a space.
export function filterSlashCommands(all: SlashCommand[], value: string): SlashCommand[]
```

`BUILTIN_SLASH_COMMANDS` lists: `model`, `models`, `resume`, `compact`, `provider`, `plugin`,
`theme`, `help`, `exit` — descriptions mirroring the `HELP` text in `src/cli.ts` (short forms).
`buildSlashCommands` dedupes by name (built-in wins) and returns them plus plugin commands,
sorted. `filterSlashCommands` lowercases the token, keeps commands whose `name` starts with it,
sorts by `name`.

### `src/ui/command-menu.tsx` (new) — presentational

```ts
export function CommandMenu(props: {
  commands: SlashCommand[]; // already filtered
  highlight: number;        // index into commands
  theme: Theme;
  max?: number;             // default 8
}): ReactNode
```

Renders up to `max` rows: `  /name   description`, the highlighted row using the theme accent
(same treatment `SelectList` uses). If `commands.length > max`, render `max - 1` rows then a dim
`  +N more` line. No `useInput` — purely visual. Returns `null` for an empty list.

### `src/ui/app.tsx` — wiring

- New prop: `commands: SlashCommand[]`.
- Derive, each render, from `value`: `const menuCommands = filterSlashCommands(commands, value)`.
- Menu-open state: `menuOpen = status idle && !pendingChoice && !pendingPrompt && value.startsWith('/') && !value.includes(' ') && !menuDismissed && menuCommands.length > 0`.
- `highlight` index in `useState`, clamped to `menuCommands.length`; reset to 0 whenever the
  filtered set changes (track by the joined command names or length+first-name).
- `menuDismissed` in `useState`, reset to `false` inside the `onChange` handler (any edit).
- Render `<CommandMenu commands={menuCommands} highlight={highlight} theme={theme} />` inside the
  bottom input block, above the `> ` line (only when `menuOpen`).
- Extend the existing `useInput` handler: when `menuOpen`, handle
  - `key.downArrow` → `highlight = (highlight + 1) % len`
  - `key.upArrow` → `highlight = (highlight - 1 + len) % len`
  - `key.tab && !key.shift` → `setInput('/' + menuCommands[highlight].name + ' ')`
  - `key.escape` → `setMenuDismissed(true)`
  and `return` after handling so these don't fall through. The existing `key.tab && key.shift`
  (cycle mode) and `key.escape` (abort while busy) branches are unaffected because `menuOpen`
  requires idle status and is checked first.
- `Enter` is untouched: `handleSubmit` runs the current input as today. The menu never intercepts
  Enter.

`ink-text-input` ignores up/down arrows, so intercepting them for navigation does not disturb the
cursor. `Tab` is not consumed by `ink-text-input`.

### `src/ui/index.tsx` (`mountApp`) + `src/cli.ts`

- `mountApp` gains `commands: SlashCommand[]` in its `opts`, passed to `<App commands=… />`.
- In `repl()` (`src/cli.ts`), after the plugin `commands` map is loaded, build the list once:
  `const slashCommands = buildSlashCommands([...commands.values()])` and pass it to `mountApp`.
  The one-shot path renders no interactive input and is unchanged.

## Data flow

```
repl(): built-ins + plugin commands map
   └─ buildSlashCommands(...) → SlashCommand[]  (static for the session)
        └─ mountApp(..., { commands })
             └─ <App commands=…>
                  └─ per keystroke: filterSlashCommands(commands, value)
                       └─ <CommandMenu> renders; Tab → setInput rewrites value
```

## Error handling / edge cases

- Empty filtered list → menu hidden (no empty box).
- A plugin command whose name equals a built-in is dropped by `buildSlashCommands` (built-in wins),
  matching the runtime precedence (built-ins outrank plugin commands).
- Very long descriptions: rows are single-line; rely on the terminal to clip. No wrapping.
- Narrow terminals: the menu uses the same width context as the input; no special handling beyond
  single-line rows (consistent with existing hint/status lines).
- `highlight` out of range after the list shrinks: clamp/reset to 0 when the filtered set changes.

## Testing

Unit (vitest, pure — no ink):
- `filterSlashCommands`: `/pl` → `[plugin]`; `/` → all sorted; `/zzz` → `[]`; non-slash → `[]`;
  a value with a space → `[]`.
- `buildSlashCommands`: merges built-ins + plugin commands; a plugin command named `help` does
  not shadow the built-in `help`; result sorted by name; plugin descriptions preserved.

Component (ink-testing-library, already a devDependency):
- Render `<App>` with a known `commands` list, type `/pl`, assert the frame contains `/plugin`
  and its description and does not contain a non-matching command.
- Type `/` then a space (`/x `), assert the menu is gone.

Key interception (`↑/↓/Tab/Esc`) is verified by reasoning and a manual smoke, consistent with how
the existing input-key behavior in `app.tsx` is covered.

## User-facing changelog (Unreleased / Added)

- Typing `/` at the prompt now shows a live menu of available commands (built-ins and installed
  plugins'), filtered as you type. `↑/↓` to choose, `Tab` to complete, `Enter` to run, `Esc` to
  dismiss.
