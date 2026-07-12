import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadConfig, saveConfig, configPath } from '../../src/config/index.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); process.env.MDD_CONFIG_DIR = dir; });
afterEach(async () => { delete process.env.MDD_CONFIG_DIR; delete process.env.ANTHROPIC_API_KEY; await rm(dir, { recursive: true, force: true }); });

describe('config', () => {
  it('returns defaults when no file exists', async () => {
    const c = await loadConfig();
    expect(c.defaultProvider).toBe('anthropic');
    expect(c.defaultModel).toBe('claude-opus-4-8');
    expect(c.anthropicApiKey).toBeUndefined();
  });

  it('saves and reloads config, merging partials', async () => {
    await saveConfig({ anthropicApiKey: 'sk-a' });
    await saveConfig({ openaiApiKey: 'sk-o' });
    const c = await loadConfig();
    expect(c.anthropicApiKey).toBe('sk-a');
    expect(c.openaiApiKey).toBe('sk-o');
  });

  it('writes the config file with 0600 permissions', async () => {
    await saveConfig({ anthropicApiKey: 'sk-a' });
    const mode = (await stat(configPath())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('lets env vars override the stored key', async () => {
    await saveConfig({ anthropicApiKey: 'sk-file' });
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    const c = await loadConfig();
    expect(c.anthropicApiKey).toBe('sk-env');
  });

  it('treats a malformed config file as defaults instead of throwing, and recovers on next save', async () => {
    const path = configPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'not json{', 'utf8');

    const c = await loadConfig();
    expect(c.defaultProvider).toBe('anthropic');
    expect(c.defaultModel).toBe('claude-opus-4-8');

    await saveConfig({ anthropicApiKey: 'sk-x' });
    const c2 = await loadConfig();
    expect(c2.anthropicApiKey).toBe('sk-x');
  });
});
