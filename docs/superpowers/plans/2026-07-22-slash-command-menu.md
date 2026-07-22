# Slash-Command Autocomplete Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `/` at the REPL prompt shows a live, filtered dropdown of available commands (built-ins + installed plugins'), navigable with the keyboard.

**Architecture:** A pure data/helper module (`slash-commands.ts`) supplies and filters the command list; a presentational `CommandMenu` renders it; `app.tsx` derives the filtered list per keystroke, renders the menu above the input, and intercepts `↑/↓/Tab/Esc` in its existing `useInput`; `mountApp`/`cli.ts` thread the session's command list in.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React + ink, ink-text-input, ink-testing-library, vitest. Node ≥20.

## Global Constraints

- Language: TypeScript, ESM. Import specifiers end in `.js` even for `.ts`/`.tsx` files.
- Test runner: `vitest`. Single file: `npx vitest run test/<file>`. Build check: `npm run build`.
- Command names in `SlashCommand` are stored WITHOUT the leading slash (`plugin`, not `/plugin`).
- Built-in commands outrank plugin commands on a name collision (built-in wins).
- The menu never intercepts `Enter`; `handleSubmit` behavior is unchanged.
- `shift+Tab` remains "cycle mode"; only plain `Tab` (no shift) completes.
- Highlight styling matches the existing `SelectList`: highlighted row is `❯ ` + text in the theme `accent` color, bold; other rows are `  ` + text.

---

### Task 1: `slash-commands.ts` — data + pure helpers

**Files:**
- Create: `src/ui/slash-commands.ts`
- Test: `test/ui/slash-commands.test.ts`

**Interfaces:**
- Produces:
  - `interface SlashCommand { name: string; description: string }`
  - `const BUILTIN_SLASH_COMMANDS: SlashCommand[]`
  - `function buildSlashCommands(pluginCommands: Iterable<{ name: string; description: string }>): SlashCommand[]`
  - `function filterSlashCommands(all: SlashCommand[], value: string): SlashCommand[]`

Behavior: `buildSlashCommands` returns built-ins plus every plugin command whose `name` is not already a built-in (built-in wins), sorted by `name`. `filterSlashCommands` returns `[]` unless `value` starts with `/` and contains no space; otherwise it lowercases the text after `/` and returns commands whose `name` starts with that text, sorted by `name` (bare `/` → all).

- [ ] **Step 1: Write the failing tests**

```ts
// test/ui/slash-commands.test.ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_SLASH_COMMANDS, buildSlashCommands, filterSlashCommands } from '../../src/ui/slash-commands.js';

describe('BUILTIN_SLASH_COMMANDS', () => {
  it('includes core commands, names without a leading slash', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain('plugin');
    expect(names).toContain('help');
    expect(names.some((n) => n.startsWith('/'))).toBe(false);
    for (const c of BUILTIN_SLASH_COMMANDS) expect(c.description.length).toBeGreaterThan(0);
  });
});

describe('buildSlashCommands', () => {
  it('merges plugin commands and sorts by name', () => {
    const out = buildSlashCommands([{ name: 'deploy', description: 'ship it' }]);
    const names = out.map((c) => c.name);
    expect(names).toContain('deploy');
    expect(names).toEqual([...names].sort());
  });

  it('a plugin command cannot shadow a built-in of the same name', () => {
    const out = buildSlashCommands([{ name: 'help', description: 'evil help' }]);
    expect(out.filter((c) => c.name === 'help')).toHaveLength(1);
    expect(out.find((c) => c.name === 'help')!.description).not.toBe('evil help');
  });
});

describe('filterSlashCommands', () => {
  const all: { name: string; description: string }[] = [
    { name: 'model', description: 'm' }, { name: 'plugin', description: 'p' }, { name: 'provider', description: 'pr' },
  ];
  it('prefix-matches the text after the slash', () => {
    expect(filterSlashCommands(all, '/pl').map((c) => c.name)).toEqual(['plugin']);
  });
  it('bare slash returns all, sorted', () => {
    expect(filterSlashCommands(all, '/').map((c) => c.name)).toEqual(['model', 'plugin', 'provider']);
  });
  it('returns [] for non-slash input, a value with a space, or no match', () => {
    expect(filterSlashCommands(all, 'hello')).toEqual([]);
    expect(filterSlashCommands(all, '/plugin ')).toEqual([]);
    expect(filterSlashCommands(all, '/zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ui/slash-commands.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/slash-commands.js`.

- [ ] **Step 3: Implement `src/ui/slash-commands.ts`**

```ts
export interface SlashCommand {
  name: string;
  description: string;
}

/** Canonical built-in commands for the `/` menu. Names omit the leading slash.
 *  Descriptions mirror the short forms shown in `HELP` (src/cli.ts). */
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'summarize older history to free up context' },
  { name: 'exit', description: 'quit the session' },
  { name: 'help', description: 'show help' },
  { name: 'model', description: 'show or switch the model' },
  { name: 'models', description: 'pick a model' },
  { name: 'plugin', description: 'manage plugins (add/list/remove/update)' },
  { name: 'provider', description: 'switch provider: anthropic | openai' },
  { name: 'resume', description: 'resume a past session in this project' },
  { name: 'theme', description: 'switch theme' },
];

/** Built-ins plus plugin commands, deduped by name (built-in wins), sorted by name. */
export function buildSlashCommands(
  pluginCommands: Iterable<{ name: string; description: string }>,
): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const c of BUILTIN_SLASH_COMMANDS) byName.set(c.name, c);
  for (const c of pluginCommands) if (!byName.has(c.name)) byName.set(c.name, { name: c.name, description: c.description });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Prefix-filter by the text after a leading '/'. Returns [] unless `value` starts with '/'
 *  and has no space. Bare '/' returns everything. Result sorted by name. */
export function filterSlashCommands(all: SlashCommand[], value: string): SlashCommand[] {
  if (!value.startsWith('/') || value.includes(' ')) return [];
  const token = value.slice(1).toLowerCase();
  return all
    .filter((c) => c.name.toLowerCase().startsWith(token))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/ui/slash-commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/slash-commands.ts test/ui/slash-commands.test.ts
git commit -m "feat(ui): slash command list + filter helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `CommandMenu` presentational component

**Files:**
- Create: `src/ui/command-menu.tsx`
- Test: `test/ui/command-menu.test.tsx`

**Interfaces:**
- Consumes: `SlashCommand` from `./slash-commands.js`; `Theme` from `./theme.js`.
- Produces: `function CommandMenu(props: { commands: SlashCommand[]; highlight: number; theme: Theme; max?: number }): ReactNode`

Behavior: renders nothing (`null`) for an empty list. Otherwise renders up to `max` (default 8) rows `  /name   description`; the row at index `highlight` is `❯ /name   description` in `theme.accent`, bold. When `commands.length > max`, render the first `max - 1` rows then a dim `  +N more` line where `N = commands.length - (max - 1)`.

- [ ] **Step 1: Write the failing test**

```tsx
// test/ui/command-menu.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { CommandMenu } from '../../src/ui/command-menu.js';
import { getTheme } from '../../src/ui/theme.js';

const theme = getTheme('neon');
const cmd = (name: string) => ({ name, description: `${name} desc` });

describe('CommandMenu', () => {
  it('renders nothing for an empty list', () => {
    const { lastFrame } = render(<CommandMenu commands={[]} highlight={0} theme={theme} />);
    expect(lastFrame()).toBe('');
  });

  it('lists commands and marks the highlighted row', () => {
    const { lastFrame } = render(<CommandMenu commands={[cmd('model'), cmd('plugin')]} highlight={1} theme={theme} />);
    const frame = lastFrame()!;
    expect(frame).toContain('/model');
    expect(frame).toContain('/plugin');
    expect(frame).toContain('❯ /plugin');
  });

  it('caps rows and shows a +N more line', () => {
    const many = Array.from({ length: 10 }, (_, i) => cmd(`c${i}`));
    const { lastFrame } = render(<CommandMenu commands={many} highlight={0} theme={theme} max={8} />);
    expect(lastFrame()).toContain('+3 more'); // shows 7 rows, then +3 more (10 - 7)
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ui/command-menu.test.tsx`
Expected: FAIL — cannot resolve `../../src/ui/command-menu.js`.

- [ ] **Step 3: Implement `src/ui/command-menu.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { SlashCommand } from './slash-commands.js';
import type { Theme } from './theme.js';

export function CommandMenu({ commands, highlight, theme, max = 8 }: {
  commands: SlashCommand[];
  highlight: number;
  theme: Theme;
  max?: number;
}): ReactNode {
  if (commands.length === 0) return null;
  const overflow = commands.length > max;
  const shown = overflow ? commands.slice(0, max - 1) : commands.slice(0, max);
  const moreCount = commands.length - shown.length;
  return (
    <Box flexDirection="column">
      {shown.map((c, i) =>
        i === highlight
          ? <Text key={c.name} color={theme.accent} bold>{`❯ /${c.name}   ${c.description}`}</Text>
          : <Text key={c.name}>{`  /${c.name}   ${c.description}`}</Text>,
      )}
      {overflow ? <Text dimColor>{`  +${moreCount} more`}</Text> : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ui/command-menu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/command-menu.tsx test/ui/command-menu.test.tsx
git commit -m "feat(ui): CommandMenu presentational component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the menu into `App` (render + keys) and thread the list through `mountApp`/`cli.ts`

**Files:**
- Modify: `src/ui/app.tsx` (the `App` component: props, `useInput`, the `bottom` input block)
- Modify: `src/ui/index.tsx` (`mountApp` opts + `<App>` call)
- Modify: `src/cli.ts` (build the list, pass it to `mountApp` at the REPL call ~line 672)
- Test: `test/ui/command-menu-app.test.tsx`

**Interfaces:**
- Consumes: `SlashCommand`, `buildSlashCommands`, `filterSlashCommands` from `./slash-commands.js`; `CommandMenu` from `./command-menu.js`; the plugin `commands` map already in `repl()` scope (`Map<string, { name; description }>`).
- Produces: `App` accepts a `commands: SlashCommand[]` prop; `mountApp`'s opts accept `commands?: SlashCommand[]`.

- [ ] **Step 1: Write the failing component test**

```tsx
// test/ui/command-menu-app.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/app.js';
import { UiStore } from '../../src/ui/store.js';

const cmds = [
  { name: 'model', description: 'switch model' },
  { name: 'plugin', description: 'manage plugins' },
];

function setupStore(): UiStore {
  const store = new UiStore();
  store.setMeta({ provider: 'openai', model: 'gpt-5', mode: 'normal', cwd: '/tmp', themeName: 'neon' } as never);
  return store;
}

describe('App slash menu', () => {
  it('shows matching commands when the input starts with a slash', async () => {
    const store = setupStore();
    const { stdin, lastFrame } = render(<App store={store} onSubmit={() => {}} commands={cmds} />);
    stdin.write('/pl');
    await new Promise((r) => setTimeout(r, 20));
    const frame = lastFrame()!;
    expect(frame).toContain('/plugin');
    expect(frame).not.toContain('/model'); // filtered out by the 'pl' prefix
  });

  it('hides the menu once a space starts the args', async () => {
    const store = setupStore();
    const { stdin, lastFrame } = render(<App store={store} onSubmit={() => {}} commands={cmds} />);
    stdin.write('/plugin ');
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).not.toContain('manage plugins');
  });
});
```

Note: if `store.setMeta`'s exact shape differs, read `src/ui/store.ts` for the `SessionMeta` type and adjust the object — the test only needs `meta` non-null so the status bar renders; the menu itself depends on `status === 'idle'` (the store's default) and the `value`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ui/command-menu-app.test.tsx`
Expected: FAIL — `App` doesn't accept `commands` / menu not rendered.

- [ ] **Step 3: Add the prop, state, and derived list to `App`**

In `src/ui/app.tsx`:

Add imports near the other `./` imports:

```tsx
import { CommandMenu } from './command-menu.js';
import { filterSlashCommands, type SlashCommand } from './slash-commands.js';
```

Change the `App` signature to accept `commands` (default `[]` so existing callers/tests without it still work):

```tsx
export function App({ store, onSubmit, showHeader = false, onCycleMode, commands = [] }: { store: UiStore; onSubmit: (input: SubmitInput) => void; showHeader?: boolean; onCycleMode?: () => void; commands?: SlashCommand[] }) {
```

After the existing `const [value, setValue] = useState('');` line, add:

```tsx
  const [highlight, setHighlight] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
```

After `const theme = getTheme(state.themeName);` add the derived menu state:

```tsx
  const menuCommands = filterSlashCommands(commands, value);
  const menuOpen =
    state.status === 'idle' &&
    state.pendingChoice === null &&
    state.pendingPrompt === null &&
    !menuDismissed &&
    menuCommands.length > 0;
  // Keep the highlight in range as the filtered set shrinks/grows.
  const clampedHighlight = menuCommands.length ? Math.min(highlight, menuCommands.length - 1) : 0;
```

- [ ] **Step 4: Intercept the menu keys in the existing `useInput`**

In `src/ui/app.tsx`, replace the existing `useInput((_input, key) => { ... })` body so the menu keys are handled first (only when `menuOpen`). The existing `shift+Tab` cycle-mode and `escape`-abort branches stay:

```tsx
  useInput((_input, key) => {
    if (menuOpen) {
      const len = menuCommands.length;
      if (key.downArrow) { setHighlight((h) => (Math.min(h, len - 1) + 1) % len); return; }
      if (key.upArrow) { setHighlight((h) => (Math.min(h, len - 1) - 1 + len) % len); return; }
      if (key.tab && !key.shift) { setInput(`/${menuCommands[clampedHighlight].name} `); setHighlight(0); return; }
      if (key.escape) { setMenuDismissed(true); return; }
    }
    if (key.tab && key.shift && state.pendingChoice === null && state.pendingPrompt === null) {
      onCycleMode?.();
      return;
    }
    if (key.escape && state.status === 'busy' && state.pendingChoice === null && state.pendingPrompt === null) {
      store.requestAbort();
    }
  });
```

- [ ] **Step 5: Reset `menuDismissed` on edit and render the menu**

In the `TextInput`'s `onChange` handler in the `bottom` block, add `setMenuDismissed(false);` as the FIRST statement (so any edit re-opens a dismissed menu):

```tsx
          onChange={(next) => {
            setMenuDismissed(false);
            const prev = valueRef.current;
            // ... existing body unchanged ...
```

Then render the menu just above the `> ` prompt line. Locate this block inside `bottom`:

```tsx
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(width)}</Text>
      <Box paddingLeft={1}>
        <Text color={theme.accent}>{'> '}</Text>
```

and insert the menu between the top rule and the `> ` box:

```tsx
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(width)}</Text>
      {menuOpen ? (
        <Box paddingLeft={1}>
          <CommandMenu commands={menuCommands} highlight={clampedHighlight} theme={theme} />
        </Box>
      ) : null}
      <Box paddingLeft={1}>
        <Text color={theme.accent}>{'> '}</Text>
```

- [ ] **Step 6: Run the component test to verify it passes**

Run: `npx vitest run test/ui/command-menu-app.test.tsx`
Expected: PASS.

- [ ] **Step 7: Thread `commands` through `mountApp`**

In `src/ui/index.tsx`, add `commands` to the opts and pass it to `<App>`:

```tsx
export function mountApp(
  store: UiStore,
  onSubmit: (input: SubmitInput) => void,
  opts: { showHeader?: boolean; onCycleMode?: () => void; commands?: SlashCommand[] } = {},
): { unmount(): void; waitUntilExit(): Promise<void> } {
  if (opts.showHeader) process.stdout.write(CLEAR_ALL);
  const instance = render(<App store={store} onSubmit={onSubmit} showHeader={opts.showHeader} onCycleMode={opts.onCycleMode} commands={opts.commands ?? []} />);
```

Add the import at the top of `src/ui/index.tsx`:

```tsx
import type { SlashCommand } from './slash-commands.js';
```

- [ ] **Step 8: Build the list in `cli.ts` and pass it in**

In `src/cli.ts`, add the import:

```ts
import { buildSlashCommands } from './ui/slash-commands.js';
```

In `repl()`, after `const commands = loaded.commands;` (from the plugin-loading task), build the list:

```ts
  const slashCommands = buildSlashCommands([...commands.values()]);
```

Update the REPL `mountApp` call (currently `app = mountApp(store, (input) => { void onSubmit(input); }, { showHeader: true, onCycleMode: cycleMode });`) to include `commands`:

```ts
  app = mountApp(store, (input) => { void onSubmit(input); }, { showHeader: true, onCycleMode: cycleMode, commands: slashCommands });
```

- [ ] **Step 9: Build and run the full suite**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `npx vitest run`
Expected: all suites PASS (existing + new UI tests).

- [ ] **Step 10: Commit**

```bash
git add src/ui/app.tsx src/ui/index.tsx src/cli.ts test/ui/command-menu-app.test.tsx
git commit -m "feat(ui): live slash-command menu in the REPL input

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Changelog + manual smoke

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Added` in `CHANGELOG.md` (create the `### Added` subsection if the current Unreleased is empty):

```markdown
- Typing `/` at the prompt shows a live menu of available commands (built-ins and installed plugins'), filtered as you type. `↑/↓` to choose, `Tab` to complete, `Enter` to run, `Esc` to dismiss.
```

- [ ] **Step 2: Manual smoke (optional but recommended)**

```bash
npm run build
node dist/cli.js   # in a repo; type '/', then '/pl', press Tab, see '/plugin ' fill in; press Esc to dismiss
```

Expected: the menu appears on `/`, filters on `/pl` to `/plugin`, `↑/↓` moves the highlight, `Tab` completes to `/plugin `, `Esc` hides it, and `Enter` still submits normally.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): slash-command menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
