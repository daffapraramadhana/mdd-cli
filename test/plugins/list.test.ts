import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPluginsDetailed, formatPluginListing } from '../../src/plugins/manage.js';

describe('listPluginsDetailed + formatPluginListing', () => {
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

  async function writePlugin(root: string, name: string, commands: [string, string][]) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'mdd-plugin.json'), JSON.stringify({ name, description: `${name} desc`, version: '1.2.3' }));
    for (const [slug, body] of commands) {
      await mkdir(join(dir, 'commands'), { recursive: true });
      await writeFile(join(dir, 'commands', `${slug}.md`), body);
    }
  }

  it('resolves each plugin\'s command names, sorted', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'acme', [
      ['review', `---\ndescription: r\n---\nx`],
      ['deploy', `---\ndescription: d\n---\ny`],
    ]);
    const infos = await listPluginsDetailed(cwd);
    expect(infos).toHaveLength(1);
    expect(infos[0].commandNames).toEqual(['deploy', 'review']);
  });

  it('formats a listing line with command names and version', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'acme', [['hi', `---\ndescription: h\n---\nz`]]);
    const [info] = await listPluginsDetailed(cwd);
    const line = formatPluginListing(info);
    expect(line).toContain('acme');
    expect(line).toContain('[global]');
    expect(line).toContain('cmds: /hi');
    expect(line).toContain('v1.2.3');
  });

  it('omits the cmds segment when a plugin has no commands', async () => {
    await writePlugin(join(cfgDir, 'plugins'), 'bare', []);
    const [info] = await listPluginsDetailed(cwd);
    const line = formatPluginListing(info);
    expect(line).not.toContain('cmds:');
    expect(line).toContain('0 commands');
  });
});
