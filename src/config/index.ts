import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
  defaultProvider: 'anthropic' | 'openai';
  defaultModel: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** Custom OpenAI-compatible base URL, e.g. http://localhost:20128/v1 for 9router. */
  openaiBaseUrl?: string;
  /** 9router dashboard origin for the quota indicator, e.g. https://ai-router.mdd.co.id. */
  routerBaseUrl?: string;
  /** 9router dashboard login email (optional; some deployments log in with password only). */
  routerEmail?: string;
  /** 9router dashboard login password for the quota indicator. Prefer routerPasswordCommand or a vault. */
  routerPassword?: string;
  /** Command whose stdout is the 9router password, fetched at login from your vault
   *  (e.g. `op read op://Private/9router/password`). Preferred over a stored password. */
  routerPasswordCommand?: string;
  /** TUI theme name (neon | ocean | mono). */
  theme?: string;
}

const DEFAULTS: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' };

/** The directory mdd stores its config (and sessions) in: ~/.config/mdd, or $MDD_CONFIG_DIR. */
export function configDir(): string {
  return process.env.MDD_CONFIG_DIR ?? join(homedir(), '.config', 'mdd');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

async function readFileConfig(): Promise<Partial<Config>> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<Config> {
  const file = await readFileConfig();
  const merged: Config = { ...DEFAULTS, ...file };
  if (process.env.ANTHROPIC_API_KEY) merged.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) merged.openaiApiKey = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) merged.openaiBaseUrl = process.env.OPENAI_BASE_URL;
  if (process.env.MDD_ROUTER_URL) merged.routerBaseUrl = process.env.MDD_ROUTER_URL;
  if (process.env.MDD_ROUTER_EMAIL) merged.routerEmail = process.env.MDD_ROUTER_EMAIL;
  if (process.env.MDD_ROUTER_PASSWORD) merged.routerPassword = process.env.MDD_ROUTER_PASSWORD;
  if (process.env.MDD_ROUTER_PASSWORD_CMD) merged.routerPasswordCommand = process.env.MDD_ROUTER_PASSWORD_CMD;
  return merged;
}

export async function saveConfig(partial: Partial<Config>): Promise<void> {
  const existing = await readFileConfig();
  const next = { ...existing, ...partial };
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), { mode: 0o600 });
}
