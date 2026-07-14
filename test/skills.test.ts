import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFile, skillsPromptSection, loadSkills } from '../src/skills/index.js';

describe('parseSkillFile', () => {
  it('parses frontmatter name and description with body', () => {
    const raw = `---\nname: Deploy\ndescription: How to deploy the app\n---\n\nStep 1. Do the thing.\n`;
    const r = parseSkillFile(raw, 'fallback');
    expect(r.name).toBe('Deploy');
    expect(r.description).toBe('How to deploy the app');
    expect(r.body).toBe('Step 1. Do the thing.');
  });

  it('falls back to the slug when there is no frontmatter', () => {
    const raw = 'Just a plain body of instructions.';
    const r = parseSkillFile(raw, 'my-skill');
    expect(r.name).toBe('my-skill');
    expect(r.description).toBe('');
    expect(r.body).toBe('Just a plain body of instructions.');
  });

  it('uses the slug when frontmatter omits name', () => {
    const raw = `---\ndescription: only a description\n---\nbody`;
    const r = parseSkillFile(raw, 'slug');
    expect(r.name).toBe('slug');
    expect(r.description).toBe('only a description');
    expect(r.body).toBe('body');
  });

  it('strips matching quotes from values', () => {
    const raw = `---\nname: "Quoted Name"\ndescription: 'single quoted'\n---\nx`;
    const r = parseSkillFile(raw, 'slug');
    expect(r.name).toBe('Quoted Name');
    expect(r.description).toBe('single quoted');
  });

  it('treats an unclosed frontmatter block as plain body', () => {
    const raw = `---\nname: Broken\nno closing fence`;
    const r = parseSkillFile(raw, 'slug');
    expect(r.name).toBe('slug');
    expect(r.body).toBe(raw.trim());
  });

  it('handles a leading BOM', () => {
    const raw = `\uFEFF---\nname: Bom\n---\nbody`;
    const r = parseSkillFile(raw, 'slug');
    expect(r.name).toBe('Bom');
    expect(r.body).toBe('body');
  });
});

describe('skillsPromptSection', () => {
  it('returns empty string when there are no skills', () => {
    expect(skillsPromptSection([])).toBe('');
  });

  it('lists skills with and without descriptions', () => {
    const section = skillsPromptSection([
      { name: 'a', description: 'does a', body: '', source: 'project', path: '' },
      { name: 'b', description: '', body: '', source: 'personal', path: '' },
    ]);
    expect(section).toContain('- a — does a');
    expect(section).toContain('- b');
    expect(section).toContain('use_skill');
  });
});

describe('loadSkills', () => {
  let cfgDir: string;
  let projectCwd: string;
  const prevCfg = process.env.MDD_CONFIG_DIR;

  beforeEach(async () => {
    cfgDir = await mkdtemp(join(tmpdir(), 'mdd-cfg-'));
    projectCwd = await mkdtemp(join(tmpdir(), 'mdd-proj-'));
    process.env.MDD_CONFIG_DIR = cfgDir;
  });

  afterEach(async () => {
    if (prevCfg === undefined) delete process.env.MDD_CONFIG_DIR;
    else process.env.MDD_CONFIG_DIR = prevCfg;
    await rm(cfgDir, { recursive: true, force: true });
    await rm(projectCwd, { recursive: true, force: true });
  });

  async function writeSkill(root: string, slug: string, contents: string): Promise<void> {
    const dir = join(root, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), contents);
  }

  it('returns [] when no skill directories exist', async () => {
    expect(await loadSkills(projectCwd)).toEqual([]);
  });

  it('discovers personal and project skills, sorted by name', async () => {
    await writeSkill(join(cfgDir, 'skills'), 'zeta', `---\nname: zeta\n---\npersonal body`);
    await writeSkill(join(projectCwd, '.mdd', 'skills'), 'alpha', `---\nname: alpha\n---\nproject body`);
    const skills = await loadSkills(projectCwd);
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(skills[0].source).toBe('project');
    expect(skills[1].source).toBe('personal');
  });

  it('project skill overrides a personal skill of the same name', async () => {
    await writeSkill(join(cfgDir, 'skills'), 'dup', `---\nname: dup\n---\npersonal`);
    await writeSkill(join(projectCwd, '.mdd', 'skills'), 'dup', `---\nname: dup\n---\nproject`);
    const skills = await loadSkills(projectCwd);
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe('project');
    expect(skills[0].body).toBe('project');
  });

  it('ignores directories without a SKILL.md', async () => {
    await mkdir(join(projectCwd, '.mdd', 'skills', 'empty'), { recursive: true });
    expect(await loadSkills(projectCwd)).toEqual([]);
  });
});
