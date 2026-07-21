# User-Installable Plugins (Skills + Slash Commands) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users install and manage git-hosted plugins that contribute skills and `/slash` commands to mdd-cli.

**Architecture:** A plugin is a directory (`mdd-plugin.json` + `skills/` + `commands/`) discovered from a global root (`~/.config/mdd/plugins/`) and a project root (`.mdd/plugins/`). Plugin skills reuse the existing skill machinery via a new `source: 'plugin'`; commands are a new registry the REPL consults after built-ins. Command bodies are markdown templates with `$ARGUMENTS`/`$N` substitution and permission-gated `` !`shell` `` prefill.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod, commander, vitest. Node ≥20.

## Global Constraints

- Language: TypeScript, ESM. Import specifiers end in `.js` even for `.ts` files.
- Test runner: `vitest`. Run a single file with `npx vitest run test/<file>`.
- Config dir is `configDir()` from `src/config/index.js`, overridable via `MDD_CONFIG_DIR` (tests rely on this).
- Discovery must never crash on malformed input — skip with a warning, matching `loadRoot` in `src/skills/index.ts`.
- Shell execution goes through `runCommand(command, cwd)` from `src/tools/exec.js`; prefill is gated through `PermissionGate` from `src/permissions/index.js`.
- Built-in slash commands always outrank plugin commands.
- CHANGELOG discipline: user-facing entries go under `## [Unreleased]` in `CHANGELOG.md` in the same commit (see project `CLAUDE.md`).

---

### Task 1: Command model + template rendering

Pure parsing/rendering of command files. No fs, no execution.

**Files:**
- Create: `src/plugins/commands.ts`
- Test: `test/plugins/commands.test.ts`

**Interfaces:**
- Consumes: `parseSkillFile`-style frontmatter parsing — but implement locally; do not import skill internals.
- Produces:
  - `interface Command { name: string; description: string; argumentHint?: string; body: string; source: 'project' | 'personal' | 'plugin'; plugin?: string; path: string; }`
  - `parseCommandFile(raw: string, fallbackName: string): { description: string; argumentHint?: string; body: string }`
  - `renderCommand(body: string, args: string): { text: string; prefill: string[] }`

Rendering rules: substitute `$ARGUMENTS` (raw arg string) and `$1`,`$2`,… (whitespace-split positionals; missing → empty string) **first**, then scan the result for prefill spans `` !`<cmd>` `` and return them in `prefill` (left-to-right, in order). `renderCommand` does NOT execute anything; the returned `text` still contains the raw spans, which Task 3 replaces.

- [ ] **Step 1: Write failing tests**

```ts
// test/plugins/commands.test.ts
import { describe, it, expect } from 'vitest';
import { parseCommandFile, renderCommand } from '../../src/plugins/commands.js';

describe('parseCommandFile', () => {
  it('reads description and argument-hint from frontmatter', () => {
    const raw = `---\ndescription: Review the diff\nargument-hint: "[base]"\n---\nBody $ARGUMENTS`;
    const r = parseCommandFile(raw, 'review');
    expect(r.description).toBe('Review the diff');
    expect(r.argumentHint).toBe('[base]');
    expect(r.body).toBe('Body $ARGUMENTS');
  });

  it('defaults description to empty and body to whole file when no frontmatter', () => {
    const r = parseCommandFile('just a body', 'x');
    expect(r.description).toBe('');
    expect(r.argumentHint).toBeUndefined();
    expect(r.body).toBe('just a body');
  });
});

describe('renderCommand', () => {
  it('substitutes $ARGUMENTS and positional $1/$2', () => {
    const r = renderCommand('all=$ARGUMENTS first=$1 second=$2', 'a b');
    expect(r.text).toBe('all=a b first=a second=b');
    expect(r.prefill).toEqual([]);
  });

  it('missing positionals become empty string', () => {
    const r = renderCommand('x=$1 y=$2', 'only');
    expect(r.text).toBe('x=only y=');
  });

  it('extracts prefill spans in order, after arg substitution', () => {
    const r = renderCommand('diff:\n!`git diff $ARGUMENTS`\nlog:\n!`git log -1`', 'main');
    expect(r.prefill).toEqual(['git diff main', 'git log -1']);
    expect(r.text).toContain('!`git diff main`');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/plugins/commands.test.ts`
Expected: FAIL — cannot resolve `../../src/plugins/commands.js`.

- [ ] **Step 3: Implement `src/plugins/commands.ts`**

```ts
export interface Command {
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  source: 'project' | 'personal' | 'plugin';
  plugin?: string;
  path: string;
}

const PREFILL_RE = /!`([^`]*)`/g;

export function parseCommandFile(
  raw: string,
  _fallbackName: string,
): { description: string; argumentHint?: string; body: string } {
  const normalized = raw.replace(/^﻿/, '');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { description: '', body: normalized.trim() };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { description: '', body: normalized.trim() };
  const out: { description: string; argumentHint?: string; body: string } = {
    description: '',
    body: lines.slice(end + 1).join('\n').trim(),
  };
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = unquote(m[2].trim());
    if (key === 'description') out.description = value;
    else if (key === 'argument-hint') out.argumentHint = value;
  }
  return out;
}

export function renderCommand(body: string, args: string): { text: string; prefill: string[] } {
  const positional = args.trim().length ? args.trim().split(/\s+/) : [];
  const text = body
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$(\d+)/g, (_, n: string) => positional[Number(n) - 1] ?? '');
  const prefill: string[] = [];
  for (const m of text.matchAll(PREFILL_RE)) prefill.push(m[1]);
  return { text, prefill };
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/plugins/commands.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/commands.ts test/plugins/commands.test.ts
git commit -m "feat(plugins): command file parsing and template rendering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Widen `Skill.source` to include `'plugin'`

Small enabling change so plugin skills can flow through the existing skill list.

**Files:**
- Modify: `src/skills/index.ts:5-11` (the `Skill` interface)
- Test: `test/skills.test.ts` (existing suite must still pass)

**Interfaces:**
- Produces: `Skill.source` becomes `'project' | 'personal' | 'plugin'`; adds optional `plugin?: string`.

- [ ] **Step 1: Edit the interface**

In `src/skills/index.ts`, change the `Skill` interface to:

```ts
export interface Skill {
  name: string;
  description: string;
  body: string;
  source: 'project' | 'personal' | 'plugin';
  plugin?: string;
  path: string;
}
```

- [ ] **Step 2: Run the existing skills + system-prompt suites**

Run: `npx vitest run test/skills.test.ts test/system-prompt.test.ts`
Expected: PASS (unchanged behavior — the union only widened).

- [ ] **Step 3: Commit**

```bash
git add src/skills/index.ts
git commit -m "refactor(skills): allow 'plugin' as a skill source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Prefill execution, gated through the permission gate

A function that resolves a command's prefill spans into stdout, asking the gate for each.

**Files:**
- Create: `src/plugins/prefill.ts`
- Test: `test/plugins/prefill.test.ts`

**Interfaces:**
- Consumes: `PermissionGate` (`src/permissions/index.js`), `runCommand` (`src/tools/exec.js`), the `run_shell` tool (`src/tools/run-shell.js`) as the gate's `tool` argument so the confirm prompt shows the shell command.
- Produces:
  - `interface PrefillResult { text: string; warnings: string[]; }`
  - `runPrefill(rendered: { text: string; prefill: string[] }, opts: { gate: PermissionGate; cwd: string }): Promise<PrefillResult>`

Behavior: for each span, call `gate.check(runShellTool, { command })`. If allowed, run `runCommand(command, cwd)` and replace the **first remaining** `` !`<span>` `` occurrence in `text` with the trimmed stdout. If denied, replace it with empty string and push `⚠ skipped prefill: <command>` to `warnings`. Replace occurrences positionally so duplicate spans are handled left-to-right.

- [ ] **Step 1: Write failing tests**

```ts
// test/plugins/prefill.test.ts
import { describe, it, expect } from 'vitest';
import { runPrefill } from '../../src/plugins/prefill.js';
import type { PermissionGate } from '../../src/permissions/index.js';

const allowGate: PermissionGate = { async check() { return { allow: true }; } };
const denyGate: PermissionGate = { async check() { return { allow: false, reason: 'no' }; } };

describe('runPrefill', () => {
  it('replaces an allowed span with command stdout', async () => {
    const rendered = { text: 'out: !`echo hello`', prefill: ['echo hello'] };
    const r = await runPrefill(rendered, { gate: allowGate, cwd: process.cwd() });
    expect(r.text).toBe('out: hello');
    expect(r.warnings).toEqual([]);
  });

  it('drops a denied span and records a warning', async () => {
    const rendered = { text: 'x !`echo hi` y', prefill: ['echo hi'] };
    const r = await runPrefill(rendered, { gate: denyGate, cwd: process.cwd() });
    expect(r.text).toBe('x  y');
    expect(r.warnings[0]).toContain('echo hi');
  });

  it('returns text unchanged when there are no spans', async () => {
    const r = await runPrefill({ text: 'plain', prefill: [] }, { gate: denyGate, cwd: process.cwd() });
    expect(r.text).toBe('plain');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/plugins/prefill.test.ts`
Expected: FAIL — cannot resolve `prefill.js`.

- [ ] **Step 3: Implement `src/plugins/prefill.ts`**

```ts
import type { PermissionGate } from '../permissions/index.js';
import { runCommand } from '../tools/exec.js';
import { runShellTool } from '../tools/run-shell.js';

export interface PrefillResult { text: string; warnings: string[]; }

export async function runPrefill(
  rendered: { text: string; prefill: string[] },
  opts: { gate: PermissionGate; cwd: string },
): Promise<PrefillResult> {
  let text = rendered.text;
  const warnings: string[] = [];
  for (const command of rendered.prefill) {
    const token = '!`' + command + '`';
    const decision = await opts.gate.check(runShellTool, { command });
    let replacement = '';
    if (decision.allow) {
      const res = await runCommand(command, opts.cwd);
      replacement = res.content.trim();
    } else {
      warnings.push(`⚠ skipped prefill: ${command}`);
    }
    text = text.replace(token, replacement);
  }
  return { text, warnings };
}
```

Note: `String.prototype.replace` with a string first-arg replaces the first occurrence, giving positional left-to-right substitution across duplicate spans.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/plugins/prefill.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/prefill.ts test/plugins/prefill.test.ts
git commit -m "feat(plugins): permission-gated shell prefill for commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Plugin discovery

Read both plugin roots, parse manifests, return plugin skills + command registry + warnings.

**Files:**
- Create: `src/plugins/index.ts`
- Test: `test/plugins/index.test.ts`

**Interfaces:**
- Consumes: `configDir()` (`src/config/index.js`), `parseSkillFile` (`src/skills/index.js`), `parseCommandFile` + `Command` (`src/plugins/commands.js`), `Skill` (`src/skills/index.js`).
- Produces:
  - `interface PluginInfo { name: string; description: string; version?: string; scope: 'global' | 'project'; dir: string; skillCount: number; commandCount: number; }`
  - `interface LoadedPlugins { skills: Skill[]; commands: Map<string, Command>; warnings: string[]; plugins: PluginInfo[]; }`
  - `loadPlugins(cwd: string): Promise<LoadedPlugins>`
  - `pluginRoots(cwd: string): { dir: string; scope: 'global' | 'project' }[]`
  - `globalPluginsDir(): string`

Roots, project first: `.mdd/plugins` (project) then `join(configDir(), 'plugins')` (global). Within a root, each subdirectory with a readable, JSON-valid `mdd-plugin.json` is a plugin; its `name` falls back to the directory name. For each plugin, read `skills/<slug>/SKILL.md` (via `parseSkillFile`) and `commands/<slug>.md` (via `parseCommandFile`), tagging `source: 'plugin'` and `plugin: <name>`. First occurrence of a skill/command name wins (project root scanned before global). A missing/unparseable manifest pushes a warning and skips that dir. Missing `skills/` or `commands/` subdir is fine (no entries).

- [ ] **Step 1: Write failing tests**

```ts
// test/plugins/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugins } from '../../src/plugins/index.js';

describe('loadPlugins', () => {
  let cfgDir: string;
  let cwd: string;
  const prev = process.env.MDD_CONFIG_DIR;

  beforeEach(async () => {
    cfgDir = await mkdtemp(join(tmpdir(), 'mdd-cfg-'));
    cwd = await mkdtemp(join(tmpdir(), 'mdd-proj-'));
    process.env.MDD_CONFIG_DIR = cfgDir;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.MDD_CONFIG_DIR; else process.env.MDD_CONFIG_DIR = prev;
    await rm(cfgDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  async function writePlugin(root: string, name: string, opts: { manifest?: string; skills?: [string, string][]; commands?: [string, string][] }) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'mdd-plugin.json'), opts.manifest ?? JSON.stringify({ name, description: `${name} desc` }));
    for (const [slug, body] of opts.skills ?? []) {
      await mkdir(join(dir, 'skills', slug), { recursive: true });
      await writeFile(join(dir, 'skills', slug, 'SKILL.md'), body);
    }
    for (const [slug, body] of opts.commands ?? []) {
      await mkdir(join(dir, 'commands'), { recursive: true });
      await writeFile(join(dir, 'commands', `${slug}.md`), body);
    }
  }

  it('returns empty result when no plugin roots exist', async () => {
    const r = await loadPlugins(cwd);
    expect(r.skills).toEqual([]);
    expect(r.commands.size).toBe(0);
    expect(r.plugins).toEqual([]);
  });

  it('loads skills and commands from a global plugin', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'acme', {
      skills: [['deploy', `---\nname: deploy\ndescription: how\n---\nbody`]],
      commands: [['review', `---\ndescription: rev\n---\nReview $ARGUMENTS`]],
    });
    const r = await loadPlugins(cwd);
    expect(r.skills.map((s) => s.name)).toEqual(['deploy']);
    expect(r.skills[0].source).toBe('plugin');
    expect(r.skills[0].plugin).toBe('acme');
    expect(r.commands.get('review')?.description).toBe('rev');
    expect(r.plugins[0]).toMatchObject({ name: 'acme', scope: 'global', skillCount: 1, commandCount: 1 });
  });

  it('project plugin command overrides a global one of the same name', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'g', { commands: [['x', `---\ndescription: global\n---\nG`]] });
    await writePlugin(join(cwd, '.mdd', 'plugins'), 'p', { commands: [['x', `---\ndescription: project\n---\nP`]] });
    const r = await loadPlugins(cwd);
    expect(r.commands.get('x')?.description).toBe('project');
  });

  it('skips a plugin with an unparseable manifest and warns', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'bad', { manifest: '{ not json' });
    const r = await loadPlugins(cwd);
    expect(r.plugins).toEqual([]);
    expect(r.warnings.join(' ')).toContain('bad');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/plugins/index.test.ts`
Expected: FAIL — cannot resolve `../../src/plugins/index.js`.

- [ ] **Step 3: Implement `src/plugins/index.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir } from '../config/index.js';
import { parseSkillFile, type Skill } from '../skills/index.js';
import { parseCommandFile, type Command } from './commands.js';

export interface PluginInfo {
  name: string;
  description: string;
  version?: string;
  scope: 'global' | 'project';
  dir: string;
  skillCount: number;
  commandCount: number;
}

export interface LoadedPlugins {
  skills: Skill[];
  commands: Map<string, Command>;
  warnings: string[];
  plugins: PluginInfo[];
}

export function globalPluginsDir(): string {
  return join(configDir(), 'plugins');
}

export function pluginRoots(cwd: string): { dir: string; scope: 'global' | 'project' }[] {
  return [
    { dir: join(cwd, '.mdd', 'plugins'), scope: 'project' },
    { dir: globalPluginsDir(), scope: 'global' },
  ];
}

export async function loadPlugins(cwd: string): Promise<LoadedPlugins> {
  const skillByName = new Map<string, Skill>();
  const commands = new Map<string, Command>();
  const warnings: string[] = [];
  const plugins: PluginInfo[] = [];

  for (const root of pluginRoots(cwd)) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(root.dir, { withFileTypes: true });
    } catch {
      continue; // missing root
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root.dir, entry.name);
      let manifest: { name?: string; description?: string; version?: string };
      try {
        manifest = JSON.parse(await readFile(join(dir, 'mdd-plugin.json'), 'utf8'));
      } catch {
        warnings.push(`⚠ plugin '${entry.name}' skipped: missing or invalid mdd-plugin.json`);
        continue;
      }
      const name = manifest.name || entry.name;
      const skills = await loadPluginSkills(dir, name, skillByName);
      const cmds = await loadPluginCommands(dir, name, commands);
      plugins.push({
        name,
        description: manifest.description ?? '',
        version: manifest.version,
        scope: root.scope,
        dir,
        skillCount: skills,
        commandCount: cmds,
      });
    }
  }

  const skills = [...skillByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { skills, commands, warnings, plugins };
}

async function loadPluginSkills(dir: string, plugin: string, into: Map<string, Skill>): Promise<number> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(join(dir, 'skills'), { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, 'skills', entry.name, 'SKILL.md');
    let raw: string;
    try { raw = await readFile(path, 'utf8'); } catch { continue; }
    const { name, description, body } = parseSkillFile(raw, entry.name);
    count++;
    if (!into.has(name)) into.set(name, { name, description, body, source: 'plugin', plugin, path });
  }
  return count;
}

async function loadPluginCommands(dir: string, plugin: string, into: Map<string, Command>): Promise<number> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(join(dir, 'commands'), { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const slug = entry.name.replace(/\.md$/, '');
    const path = join(dir, 'commands', entry.name);
    let raw: string;
    try { raw = await readFile(path, 'utf8'); } catch { continue; }
    const parsed = parseCommandFile(raw, slug);
    count++;
    if (!into.has(slug)) {
      into.set(slug, { name: slug, description: parsed.description, argumentHint: parsed.argumentHint, body: parsed.body, source: 'plugin', plugin, path });
    }
  }
  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/plugins/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/index.ts test/plugins/index.test.ts
git commit -m "feat(plugins): discover plugin skills and commands from both roots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Installer core (`add` / `list` / `remove` / `update`)

Structured verbs that shell out to `git`; printing/prompting is the caller's job.

**Files:**
- Create: `src/plugins/manage.ts`
- Test: `test/plugins/manage.test.ts`

**Interfaces:**
- Consumes: `globalPluginsDir`, `loadPlugins`, `PluginInfo` (`src/plugins/index.js`).
- Produces:
  - `resolveGitUrl(spec: string): string`
  - `type Runner = (cmd: string, cwd: string) => Promise<{ ok: boolean; output: string }>`
  - `addPlugin(spec: string, opts: { run?: Runner; cwd?: string }): Promise<{ name: string; message: string }>`
  - `listPlugins(cwd: string): Promise<PluginInfo[]>`
  - `removePlugin(name: string): Promise<{ removed: boolean; message: string }>`
  - `updatePlugin(name: string | undefined, opts: { run?: Runner }): Promise<{ message: string }>`

`resolveGitUrl`: `owner/repo` → `https://github.com/owner/repo`; anything containing `://` or `git@` passes through unchanged. `addPlugin` clones into a staging dir under the global root, reads the manifest name, renames to `<global>/<name>`; refuses (cleaning staging) if the final dir exists. `Runner` defaults to a wrapper over `runCommand`; tests inject a fake so no network/git is needed.

- [ ] **Step 1: Write failing tests**

```ts
// test/plugins/manage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGitUrl, addPlugin, listPlugins, removePlugin } from '../../src/plugins/manage.js';

describe('resolveGitUrl', () => {
  it('expands owner/repo to a github https url', () => {
    expect(resolveGitUrl('acme/cool-plugin')).toBe('https://github.com/acme/cool-plugin');
  });
  it('passes through a full url', () => {
    expect(resolveGitUrl('https://gitlab.com/a/b.git')).toBe('https://gitlab.com/a/b.git');
    expect(resolveGitUrl('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
  });
});

describe('addPlugin', () => {
  let cfgDir: string;
  const prev = process.env.MDD_CONFIG_DIR;
  beforeEach(async () => { cfgDir = await mkdtemp(join(tmpdir(), 'mdd-cfg-')); process.env.MDD_CONFIG_DIR = cfgDir; });
  afterEach(async () => { if (prev === undefined) delete process.env.MDD_CONFIG_DIR; else process.env.MDD_CONFIG_DIR = prev; await rm(cfgDir, { recursive: true, force: true }); });

  // Fake runner: "clones" by writing a manifest into the staging dir.
  const fakeRun = async (cmd: string) => {
    const m = /clone --depth 1 \S+ "([^"]+)"/.exec(cmd);
    if (m) { await mkdir(m[1], { recursive: true }); await writeFile(join(m[1], 'mdd-plugin.json'), JSON.stringify({ name: 'acme' })); }
    return { ok: true, output: '' };
  };

  it('clones, reads the manifest name, installs under the global root', async () => {
    const r = await addPlugin('acme/acme', { run: fakeRun });
    expect(r.name).toBe('acme');
    const dirs = await readdir(join(cfgDir, 'plugins'));
    expect(dirs).toContain('acme');
  });

  it('refuses when the plugin already exists', async () => {
    await addPlugin('acme/acme', { run: fakeRun });
    await expect(addPlugin('acme/acme', { run: fakeRun })).rejects.toThrow(/already installed/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/plugins/manage.test.ts`
Expected: FAIL — cannot resolve `manage.js`.

- [ ] **Step 3: Implement `src/plugins/manage.ts`**

```ts
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../tools/exec.js';
import { globalPluginsDir, loadPlugins, type PluginInfo } from './index.js';

export type Runner = (cmd: string, cwd: string) => Promise<{ ok: boolean; output: string }>;

const defaultRun: Runner = async (cmd, cwd) => {
  const res = await runCommand(cmd, cwd);
  return { ok: !res.isError, output: res.content };
};

export function resolveGitUrl(spec: string): string {
  if (spec.includes('://') || spec.startsWith('git@')) return spec;
  if (/^[\w.-]+\/[\w.-]+$/.test(spec)) return `https://github.com/${spec}`;
  return spec;
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

export async function addPlugin(spec: string, opts: { run?: Runner } = {}): Promise<{ name: string; message: string }> {
  const run = opts.run ?? defaultRun;
  const root = globalPluginsDir();
  await mkdir(root, { recursive: true });
  const staging = join(root, `.staging-${spec.replace(/[^\w-]/g, '_')}`);
  await rm(staging, { recursive: true, force: true });
  const url = resolveGitUrl(spec);
  const res = await run(`git clone --depth 1 ${url} "${staging}"`, root);
  if (!res.ok) { await rm(staging, { recursive: true, force: true }); throw new Error(`clone failed: ${res.output}`); }
  let name: string;
  try {
    const manifest = JSON.parse(await readFile(join(staging, 'mdd-plugin.json'), 'utf8'));
    name = manifest.name || spec.split('/').pop() || spec;
  } catch {
    await rm(staging, { recursive: true, force: true });
    throw new Error('plugin has no valid mdd-plugin.json');
  }
  const dest = join(root, name);
  if (await exists(dest)) { await rm(staging, { recursive: true, force: true }); throw new Error(`'${name}' is already installed — use 'mdd plugin update ${name}'`); }
  await rename(staging, dest);
  return { name, message: `installed ${name}` };
}

export async function listPlugins(cwd: string): Promise<PluginInfo[]> {
  return (await loadPlugins(cwd)).plugins;
}

export async function removePlugin(name: string): Promise<{ removed: boolean; message: string }> {
  const dest = join(globalPluginsDir(), name);
  if (!(await exists(dest))) return { removed: false, message: `no global plugin named '${name}' (project plugins live in .mdd/plugins and are managed in-repo)` };
  await rm(dest, { recursive: true, force: true });
  return { removed: true, message: `removed ${name}` };
}

export async function updatePlugin(name: string | undefined, opts: { run?: Runner } = {}): Promise<{ message: string }> {
  const run = opts.run ?? defaultRun;
  const root = globalPluginsDir();
  const infos = (await loadPlugins(process.cwd())).plugins.filter((p) => p.scope === 'global' && (!name || p.name === name));
  if (name && infos.length === 0) return { message: `no global plugin named '${name}'` };
  const done: string[] = [];
  for (const info of infos) {
    if (!(await exists(join(info.dir, '.git')))) { done.push(`skipped ${info.name} (not a git checkout)`); continue; }
    const res = await run('git pull --ff-only', info.dir);
    done.push(res.ok ? `updated ${info.name}` : `failed ${info.name}: ${res.output}`);
  }
  return { message: done.join('\n') || 'nothing to update' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/plugins/manage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/manage.ts test/plugins/manage.test.ts
git commit -m "feat(plugins): add/list/remove/update installer core

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire discovery into the REPL and one-shot paths

Load plugins alongside skills, merge plugin skills into the skill list, keep the command registry available.

**Files:**
- Modify: `src/cli.ts` — the one-shot path near `src/cli.ts:182` and the REPL path near `src/cli.ts:315` (both call `loadSkills`).
- Test: covered indirectly by Task 7's command-execution test + existing `test/cli.smoke.test.ts`.

**Interfaces:**
- Consumes: `loadPlugins` (`src/plugins/index.js`).
- Produces: a `commands: Map<string, Command>` in REPL scope for Task 7; a merged `skills` array passed to `runTurn`/`effectiveSystemPrompt`.

- [ ] **Step 1: Import and load plugins in the REPL**

At the top of `src/cli.ts`, add:

```ts
import { loadPlugins } from './plugins/index.js';
import type { Command } from './plugins/commands.js';
```

In `repl()`, replace the existing `const skills = await loadSkills(cwd);` (around `src/cli.ts:315`) with:

```ts
const baseSkills = await loadSkills(cwd);
const loaded = await loadPlugins(cwd);
for (const w of loaded.warnings) store.addSystem(w);
const skills = mergeSkills(baseSkills, loaded.skills);
const commands = loaded.commands;
```

Add this helper near the other top-level helpers in `src/cli.ts` (skills already win over plugins on name collision — skills are the user's explicit local files):

```ts
import type { Skill } from './skills/index.js';
function mergeSkills(base: Skill[], plugin: Skill[]): Skill[] {
  const byName = new Map<string, Skill>();
  for (const s of base) byName.set(s.name, s);
  for (const s of plugin) if (!byName.has(s.name)) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

Note: `store` is created before this point in `repl()`; if `loadPlugins` currently runs before `store` exists, move the plugin load to just after `store` is constructed. Verify by reading the surrounding lines before editing.

- [ ] **Step 2: Mirror the load in the one-shot path**

In the one-shot branch (around `src/cli.ts:182`, the other `loadSkills` call), apply the same merge. Warnings there can be written with `console.error`:

```ts
const baseSkills = await loadSkills(cwd);
const loaded = await loadPlugins(cwd);
for (const w of loaded.warnings) console.error(w);
const skills = mergeSkills(baseSkills, loaded.skills);
```

(The one-shot path has no interactive command registry; it only needs the merged skills.)

- [ ] **Step 3: Typecheck / build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Run the smoke suite**

Run: `npx vitest run test/cli.smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(plugins): load plugin skills and commands in cli sessions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Execute plugin slash commands in the REPL

Make `handleReplCommand` async and route unknown `/names` to the command registry: render → prefill → submit as a user turn.

**Files:**
- Modify: `src/cli.ts` — `CommandDeps` interface, `handleReplCommand` signature + `default` branch, and `onSubmit`'s slash branch (`src/cli.ts:493-505`).
- Test: `test/cli.commands.test.ts` (extend).

**Interfaces:**
- Consumes: `renderCommand` (`src/plugins/commands.js`), `runPrefill` (`src/plugins/prefill.js`), the REPL `commands` map + `gate` + `cwd` from Task 6.
- Produces: `CommandDeps` gains `commands?: Map<string, Command>`, `runCommandLine?: (text: string) => void`, `gate?: PermissionGate`, `cwd?: string`. `handleReplCommand` returns `Promise<void>`.

Extract the user-turn body of `onSubmit` into a local `submitUserTurn(text: string, display: string)` so a command can reuse it. `runCommandLine` in deps calls `submitUserTurn(text, text)`.

- [ ] **Step 1: Write a failing test for the unknown-vs-plugin-command branch**

```ts
// add to test/cli.commands.test.ts
import type { Command } from '../src/plugins/commands.js';
import type { PermissionGate } from '../src/permissions/index.js';

it('runs a plugin command: renders body and submits it as a user turn', async () => {
  const t = setup();
  let submitted = '';
  const cmd: Command = { name: 'greet', description: '', body: 'Hello $ARGUMENTS', source: 'plugin', plugin: 'p', path: '' };
  const gate: PermissionGate = { async check() { return { allow: true }; } };
  await handleReplCommand('/greet world', t.session, {
    ...t.deps,
    commands: new Map([['greet', cmd]]),
    gate,
    cwd: process.cwd(),
    runCommandLine: (text) => { submitted = text; },
  });
  expect(submitted).toBe('Hello world');
});

it('still reports unknown for a name with no built-in and no plugin command', async () => {
  const t = setup();
  await handleReplCommand('/nope', t.session, { ...t.deps, commands: new Map() });
  expect(t.lastSystem()).toContain('unknown command: /nope');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/cli.commands.test.ts`
Expected: FAIL — `handleReplCommand` doesn't accept `commands`/`runCommandLine`, doesn't render.

- [ ] **Step 3: Update `CommandDeps` and `handleReplCommand`**

In `src/cli.ts`, add to the `CommandDeps` interface:

```ts
  commands?: Map<string, Command>;
  runCommandLine?: (text: string) => void;
  gate?: import('./permissions/index.js').PermissionGate;
  cwd?: string;
```

Add the imports:

```ts
import { renderCommand } from './plugins/commands.js';
import { runPrefill } from './plugins/prefill.js';
```

Change the signature to `export async function handleReplCommand(...): Promise<void>` and replace the `default:` branch with:

```ts
    default: {
      const command = deps.commands?.get(cmd);
      if (!command) { deps.store.addSystem(`unknown command: /${cmd} — try /help`); break; }
      const rendered = renderCommand(command.body, arg);
      if (rendered.prefill.length && deps.gate && deps.cwd !== undefined) {
        const result = await runPrefill(rendered, { gate: deps.gate, cwd: deps.cwd });
        for (const w of result.warnings) deps.store.addSystem(w);
        deps.runCommandLine?.(result.text);
      } else {
        deps.runCommandLine?.(rendered.text);
      }
    }
```

- [ ] **Step 4: Extract `submitUserTurn` and wire the slash branch**

In `repl()`, refactor `onSubmit` (`src/cli.ts:492`) so the user-turn logic (from `running = true; store.addUser(...)` through the `finally` block) lives in a local `async function submitUserTurn(text: string, display: string)`. `onSubmit`'s non-slash path calls `submitUserTurn(input.text, input.display)` (after image handling). Update the slash branch to:

```ts
    if (input.display.startsWith('/')) {
      void handleReplCommand(input.display, session, {
        config, effectiveConfig, store, refreshMeta, applyTheme, pickModel, resumeSession, exit,
        compact: () => { /* unchanged */ },
        commands,
        gate,
        cwd,
        runCommandLine: (text) => { if (!running) void submitUserTurn(text, text); },
      });
      return;
    }
```

(Keep the existing `compact` closure exactly as it was.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/cli.commands.test.ts`
Expected: PASS (all existing + 2 new). Existing sync-style built-in tests still pass because built-in branches have no `await` before their `break`.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts test/cli.commands.test.ts
git commit -m "feat(plugins): execute plugin slash commands with gated prefill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `mdd plugin` CLI subcommand + `/plugin` REPL verb + discoverability

Expose the installer verbs from both surfaces and surface commands in `/help`.

**Files:**
- Modify: `src/cli.ts` — commander setup near `src/cli.ts:604-610`; `handleReplCommand` (add a `case 'plugin'`); `HELP` and `HINTS` (`src/ui/app.tsx:23`).
- Test: extend `test/cli.commands.test.ts` for `/plugin list`.

**Interfaces:**
- Consumes: `addPlugin`, `listPlugins`, `removePlugin`, `updatePlugin` (`src/plugins/manage.js`).

- [ ] **Step 1: Add the `mdd plugin` commander subcommand**

Before `program.argument('[prompt...]', …)` in `src/cli.ts`, add:

```ts
const plugin = program.command('plugin').description('manage plugins (skills + slash commands)');
plugin.command('add <source>').description('install a plugin from owner/repo or a git url').action(async (source: string) => {
  try { const r = await addPlugin(source); console.log(`✓ ${r.message}`); }
  catch (err) { console.error(`✗ ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; }
});
plugin.command('list').description('list installed plugins').action(async () => {
  const infos = await listPlugins(process.cwd());
  if (!infos.length) { console.log('no plugins installed'); return; }
  for (const p of infos) console.log(`${p.name}  [${p.scope}]  ${p.skillCount} skills, ${p.commandCount} commands${p.version ? `  v${p.version}` : ''}`);
});
plugin.command('remove <name>').description('remove a global plugin').action(async (name: string) => {
  const r = await removePlugin(name); console.log(r.removed ? `✓ ${r.message}` : `✗ ${r.message}`);
});
plugin.command('update [name]').description('git pull one or all global plugins').action(async (name?: string) => {
  const r = await updatePlugin(name); console.log(r.message);
});
```

Add the import: `import { addPlugin, listPlugins, removePlugin, updatePlugin } from './plugins/manage.js';`

- [ ] **Step 2: Write a failing test for `/plugin list`**

```ts
// add to test/cli.commands.test.ts
it('/plugin list reports installed plugins', async () => {
  const t = setup();
  await handleReplCommand('/plugin list', t.session, { ...t.deps, commands: new Map() });
  // With no plugins installed in the test env, it reports none:
  expect(t.lastSystem()).toContain('no plugins');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/cli.commands.test.ts -t "plugin list"`
Expected: FAIL — `/plugin` falls through to unknown-command.

- [ ] **Step 4: Add `case 'plugin'` to `handleReplCommand`**

Add before the `default:` branch (uses `rest` from the existing `const [cmd, ...rest] = …`):

```ts
    case 'plugin': {
      const [verb, ...vrest] = rest;
      const target = vrest.join(' ').trim();
      try {
        if (verb === 'list' || !verb) {
          const infos = await listPlugins(deps.cwd ?? process.cwd());
          deps.store.addSystem(infos.length ? infos.map((p) => `${p.name}  [${p.scope}]  ${p.skillCount} skills, ${p.commandCount} commands`).join('\n') : 'no plugins installed');
        } else if (verb === 'add' && target) {
          const r = await addPlugin(target); deps.store.addSystem(`✓ ${r.message} — restart or it loads on next session`);
        } else if (verb === 'remove' && target) {
          const r = await removePlugin(target); deps.store.addSystem(r.removed ? `✓ ${r.message}` : `✗ ${r.message}`);
        } else if (verb === 'update') {
          const r = await updatePlugin(target || undefined); deps.store.addSystem(r.message);
        } else {
          deps.store.addSystem('usage: /plugin add <source> | list | remove <name> | update [name]');
        }
      } catch (err) { deps.store.addSystem(`✗ ${err instanceof Error ? err.message : String(err)}`); }
      break;
    }
```

Add imports at the top of `src/cli.ts` (if not already from Task 8 Step 1): `addPlugin, listPlugins, removePlugin, updatePlugin` from `./plugins/manage.js`.

- [ ] **Step 5: Surface commands in `/help` and hints**

In the `HELP` string in `src/cli.ts`, add a line: `'  /plugin <add|list|remove|update>  manage plugins',`. In `src/ui/app.tsx:23`, update `HINTS` to include `/plugin`:

```ts
const HINTS = '/model  /plugin  /resume  /theme  /help    shift+tab cycle mode';
```

Additionally, in `HELP`, append a dynamic note is not required — keep it static. (Plugin commands are discoverable by the model via the system prompt; for the user, `/help` mentions `/plugin`.)

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run test/cli.commands.test.ts && npm run build`
Expected: PASS, no build errors.

- [ ] **Step 7: Update CHANGELOG and commit**

Add under `## [Unreleased]` → `### Added` in `CHANGELOG.md`:

```markdown
- `mdd plugin add|list|remove|update` and in-REPL `/plugin` to install and manage plugins.
- Plugins can contribute skills and `/slash` commands (markdown prompt templates with optional, permission-gated shell prefill).
```

Then:

```bash
git add src/cli.ts src/ui/app.tsx CHANGELOG.md test/cli.commands.test.ts
git commit -m "feat(plugins): mdd plugin CLI + /plugin REPL command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Manual smoke of discovery (optional but recommended)**

```bash
mkdir -p /tmp/mdd-e2e/.mdd/plugins/demo/commands
printf '{ "name": "demo", "description": "demo" }' > /tmp/mdd-e2e/.mdd/plugins/demo/mdd-plugin.json
printf -- '---\ndescription: echo test\n---\nSay hello to $ARGUMENTS' > /tmp/mdd-e2e/.mdd/plugins/demo/commands/hi.md
cd /tmp/mdd-e2e && node <repo>/dist/cli.js
# In the REPL: /plugin list   → shows "demo [project] 0 skills, 1 commands"
#              /hi there      → submits "Say hello to there" as a user turn
```

Expected: `/plugin list` shows the demo plugin; `/hi there` submits the rendered text.

- [ ] **Step 4: No commit** (verification only). If any step failed, return to the relevant task.
