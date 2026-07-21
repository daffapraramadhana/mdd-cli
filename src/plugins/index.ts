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
        const parsed: unknown = JSON.parse(await readFile(join(dir, 'mdd-plugin.json'), 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('manifest must be a JSON object');
        }
        manifest = parsed as { name?: string; description?: string; version?: string };
      } catch {
        warnings.push(`⚠ plugin '${entry.name}' skipped: missing or invalid mdd-plugin.json`);
        continue;
      }
      const name = manifest.name || entry.name;
      const skillCount = await loadPluginSkills(dir, name, skillByName);
      const commandCount = await loadPluginCommands(dir, name, commands);
      plugins.push({
        name,
        description: manifest.description ?? '',
        version: manifest.version,
        scope: root.scope,
        dir,
        skillCount,
        commandCount,
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
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }
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
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseCommandFile(raw, slug);
    count++;
    if (!into.has(slug)) {
      into.set(slug, {
        name: slug,
        description: parsed.description,
        argumentHint: parsed.argumentHint,
        body: parsed.body,
        source: 'plugin',
        plugin,
        path,
      });
    }
  }
  return count;
}
