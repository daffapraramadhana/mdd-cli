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
    const m = /clone --depth 1 '[^']*' "([^"]+)"/.exec(cmd);
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

  it('rejects a spec containing shell metacharacters', async () => {
    await expect(addPlugin('a; rm -rf ~ #', { run: fakeRun })).rejects.toThrow(/suspicious/);
  });

  it('rejects a cloned manifest with an unsafe name and cleans up staging', async () => {
    const evilRun = async (cmd: string) => {
      const m = /clone --depth 1 '[^']*' "([^"]+)"/.exec(cmd);
      if (m) { await mkdir(m[1], { recursive: true }); await writeFile(join(m[1], 'mdd-plugin.json'), JSON.stringify({ name: '../evil' })); }
      return { ok: true, output: '' };
    };
    await expect(addPlugin('acme/acme', { run: evilRun })).rejects.toThrow(/unsafe name/);
    const left = (await readdir(join(cfgDir, 'plugins')).catch(() => [])).filter((d) => d.startsWith('.staging'));
    expect(left).toEqual([]);
  });

  it('cleans up staging when the clone fails', async () => {
    const failRun = async () => ({ ok: false, output: 'fatal: repository not found' });
    await expect(addPlugin('acme/acme', { run: failRun })).rejects.toThrow(/clone failed/);
    const left = (await readdir(join(cfgDir, 'plugins')).catch(() => [])).filter((d) => d.startsWith('.staging'));
    expect(left).toEqual([]);
  });
});

describe('removePlugin', () => {
  it('refuses to remove a name containing path traversal', async () => {
    const r = await removePlugin('../../etc');
    expect(r.removed).toBe(false);
    expect(r.message).toMatch(/invalid/);
  });
});
