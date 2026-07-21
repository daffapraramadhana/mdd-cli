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

  it('discovers a Claude Code plugin via .claude-plugin/plugin.json when mdd-plugin.json is absent', async () => {
    const dir = join(cfgDir, 'plugins', 'superpowers');
    await mkdir(join(dir, '.claude-plugin'), { recursive: true });
    await writeFile(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'superpowers', description: 'core skills', version: '6.1.1' }));
    await mkdir(join(dir, 'skills', 'tdd'), { recursive: true });
    await writeFile(join(dir, 'skills', 'tdd', 'SKILL.md'), `---\nname: tdd\ndescription: test-first\n---\nRed green refactor.`);
    const r = await loadPlugins(cwd);
    expect(r.warnings).toEqual([]);
    expect(r.plugins[0]).toMatchObject({ name: 'superpowers', version: '6.1.1', scope: 'global', skillCount: 1 });
    expect(r.skills.find((s) => s.name === 'tdd')?.source).toBe('plugin');
  });

  it('prefers mdd-plugin.json over .claude-plugin/plugin.json when both exist', async () => {
    const dir = join(cfgDir, 'plugins', 'dual');
    await mkdir(join(dir, '.claude-plugin'), { recursive: true });
    await writeFile(join(dir, 'mdd-plugin.json'), JSON.stringify({ name: 'from-mdd' }));
    await writeFile(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'from-claude' }));
    const r = await loadPlugins(cwd);
    expect(r.plugins[0].name).toBe('from-mdd');
  });

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

  it('skips a plugin whose manifest is valid JSON but not an object', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'nul', { manifest: 'null' });
    await writePlugin(join(cfgDir, 'plugins'), 'arr', { manifest: '[1,2,3]' });
    const r = await loadPlugins(cwd);
    expect(r.plugins).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('project plugin skill overrides a global one of the same name', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'g', { skills: [['dup', `---\nname: dup\n---\nGLOBAL`]] });
    await writePlugin(join(cwd, '.mdd', 'plugins'), 'p', { skills: [['dup', `---\nname: dup\n---\nPROJECT`]] });
    const r = await loadPlugins(cwd);
    const dup = r.skills.filter((s) => s.name === 'dup');
    expect(dup).toHaveLength(1);
    expect(dup[0].body).toBe('PROJECT');
  });

  it('tolerates a valid plugin with no skills or commands subdirs', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'bare', {}); // manifest only
    const r = await loadPlugins(cwd);
    expect(r.warnings).toEqual([]);
    expect(r.plugins).toHaveLength(1);
    expect(r.plugins[0]).toMatchObject({ name: 'bare', skillCount: 0, commandCount: 0 });
  });
});
