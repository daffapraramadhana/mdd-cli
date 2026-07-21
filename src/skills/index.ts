import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir } from '../config/index.js';

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: 'project' | 'personal' | 'plugin';
  plugin?: string;
  path: string;
}

/**
 * Parse a SKILL.md file: an optional leading frontmatter block delimited by `---`
 * lines with `name:`/`description:` keys, followed by the markdown instruction body.
 * When there's no frontmatter, the fallback (directory slug) is the name and the
 * whole file is the body.
 */
export function parseSkillFile(
  raw: string,
  fallbackName: string,
): { name: string; description: string; body: string } {
  const normalized = raw.replace(/^\uFEFF/, '');
  const fm = matchFrontmatter(normalized);
  if (!fm) {
    return { name: fallbackName, description: '', body: normalized.trim() };
  }
  const meta = parseFrontmatterKeys(fm.frontmatter);
  return {
    name: meta.name || fallbackName,
    description: meta.description || '',
    body: fm.body.trim(),
  };
}

/** Split a document into its frontmatter block and body, or null if none is present. */
function matchFrontmatter(text: string): { frontmatter: string; body: string } | null {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return {
        frontmatter: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
      };
    }
  }
  return null; // opened but never closed → treat as no frontmatter
}

/** Read simple `key: value` pairs from a frontmatter block (strips matching quotes). */
function parseFrontmatterKeys(block: string): { name: string; description: string } {
  const out: { name: string; description: string } = { name: '', description: '' };
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = unquote(m[2].trim());
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
  }
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** The two roots skills are discovered in: project-local first, then personal. */
function skillRoots(cwd: string): { dir: string; source: Skill['source'] }[] {
  return [
    { dir: join(cwd, '.mdd', 'skills'), source: 'project' },
    { dir: join(configDir(), 'skills'), source: 'personal' },
  ];
}

/** Load one root's skills. Missing directories are skipped; unreadable files are ignored. */
async function loadRoot(dir: string, source: Skill['source']): Promise<Skill[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // missing/unreadable root → no skills
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, 'SKILL.md');
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue; // no SKILL.md in this directory
    }
    const { name, description, body } = parseSkillFile(raw, entry.name);
    skills.push({ name, description, body, source, path });
  }
  return skills;
}

/**
 * Discover all available skills. Project skills override personal skills that
 * share a name. Result is sorted by name.
 */
export async function loadSkills(cwd: string): Promise<Skill[]> {
  const roots = skillRoots(cwd);
  const perRoot = await Promise.all(roots.map((r) => loadRoot(r.dir, r.source)));
  // roots are listed project-first; the first occurrence of a name wins.
  const byName = new Map<string, Skill>();
  for (const skills of perRoot) {
    for (const skill of skills) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A compact system-prompt section advertising the available skills. Returns an
 * empty string when there are none, so callers can append unconditionally.
 */
export function skillsPromptSection(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => (s.description ? `- ${s.name} — ${s.description}` : `- ${s.name}`));
  return [
    '',
    'Available skills (expandable instructions you can load on demand):',
    ...lines,
    'When a task matches a skill, call the use_skill tool with its name to load its full instructions before proceeding.',
  ].join('\n');
}

/** Exported for tests that need a stable reference to the personal skills dir. */
export function personalSkillsDir(): string {
  return join(configDir(), 'skills');
}
