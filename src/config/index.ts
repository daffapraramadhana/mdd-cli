import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  defaultProvider: 'anthropic' | 'openai';
  defaultModel: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

const DEFAULTS: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' };

export function configPath(): string {
  const base = process.env.MDD_CONFIG_DIR ?? join(homedir(), '.config', 'mdd');
  return join(base, 'config.json');
}

async function readFileConfig(): Promise<Partial<Config>> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as Partial<Config>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function loadConfig(): Promise<Config> {
  const file = await readFileConfig();
  const merged: Config = { ...DEFAULTS, ...file };
  if (process.env.ANTHROPIC_API_KEY) merged.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) merged.openaiApiKey = process.env.OPENAI_API_KEY;
  return merged;
}

export async function saveConfig(partial: Partial<Config>): Promise<void> {
  const existing = await readFileConfig();
  const next = { ...existing, ...partial };
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), { mode: 0o600 });
}
