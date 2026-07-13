// src/cli.ts
import { createInterface } from 'node:readline/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig, saveConfig, type Config } from './config/index.js';
import { getProvider } from './providers/index.js';
import { buildRegistry } from './tools/index.js';
import { createGate } from './permissions/index.js';
import { runTurn } from './agent/loop.js';
import { buildSystemPrompt } from './system-prompt.js';
import { homedir } from 'node:os';
import { UiStore, mountApp, formatBanner, shortenCwd, type SessionMeta } from './ui/index.js';
import { formatModels } from './models.js';
import type { Message } from './types.js';

const VERSION = '0.1.0';

interface RunOpts { provider?: 'anthropic' | 'openai'; model?: string; yes?: boolean; baseUrl?: string; }

export const PROVIDER_DEFAULT_MODEL: Record<'anthropic' | 'openai', string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-5',
};

export function resolveModel(
  providerName: 'anthropic' | 'openai',
  config: { defaultProvider: 'anthropic' | 'openai'; defaultModel: string },
  optModel?: string,
): string {
  if (optModel) return optModel;
  if (providerName === config.defaultProvider) return config.defaultModel;
  return PROVIDER_DEFAULT_MODEL[providerName];
}

async function resolveSetup(opts: RunOpts) {
  const config = await loadConfig();
  const providerName = opts.provider ?? config.defaultProvider;
  const model = resolveModel(providerName, config, opts.model);
  // Precedence for the OpenAI base URL: --base-url flag > config (file or OPENAI_BASE_URL env) > SDK default.
  const effectiveConfig = opts.baseUrl ? { ...config, openaiBaseUrl: opts.baseUrl } : config;
  const provider = getProvider(providerName, effectiveConfig);
  return { provider, model };
}

async function authLogin(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const which = (await rl.question('Configure which provider? [anthropic/openai/both]: ')).trim().toLowerCase();
    const patch: Partial<Config> = {};
    if (which === 'anthropic' || which === 'both') patch.anthropicApiKey = (await rl.question('Anthropic API key: ')).trim();
    if (which === 'openai' || which === 'both') {
      patch.openaiApiKey = (await rl.question('OpenAI API key: ')).trim();
      const baseUrl = (await rl.question('OpenAI base URL (blank for default; e.g. http://localhost:20128/v1 for 9router): ')).trim();
      if (baseUrl) patch.openaiBaseUrl = baseUrl;
    }
    if (which === 'openai') { patch.defaultProvider = 'openai'; patch.defaultModel = 'gpt-5'; }
    await saveConfig(patch);
    process.stdout.write('Saved to ~/.config/mdd/config.json\n');
  } finally { rl.close(); }
}

function sessionMeta(providerName: string, model: string, cwd: string, opts: RunOpts): SessionMeta {
  return { provider: providerName, model, cwd: shortenCwd(cwd, homedir()), autoApprove: !!opts.yes };
}

async function oneShot(prompt: string, opts: RunOpts): Promise<void> {
  const { provider, model } = await resolveSetup(opts);
  const cwd = process.cwd();
  const store = new UiStore();
  const gate = createGate({ prompt: store.requestPrompt, autoApprove: opts.yes });
  const app = mountApp(store, () => {}, sessionMeta(provider.name, model, cwd, opts));
  store.addUser(prompt);
  store.setStatus('busy');
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
  try {
    await runTurn(messages, {
      provider, registry: buildRegistry(), gate, cwd, model,
      systemPrompt: buildSystemPrompt(cwd), onText: store.appendStreaming, onToolStart: store.addTool,
    });
  } catch (err) {
    store.appendStreaming(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    store.commitStreaming();
    store.setStatus('idle');
    await new Promise((resolve) => setImmediate(resolve));
    app.unmount();
  }
}

async function repl(opts: RunOpts): Promise<void> {
  const { provider, model } = await resolveSetup(opts);
  const cwd = process.cwd();
  const store = new UiStore();
  const gate = createGate({ prompt: store.requestPrompt, autoApprove: opts.yes });
  const registry = buildRegistry();
  const systemPrompt = buildSystemPrompt(cwd);
  const messages: Message[] = [];
  let running = false;

  const onSubmit = async (line: string): Promise<void> => {
    if (running) return;
    running = true;
    store.addUser(line);
    store.setStatus('busy');
    messages.push({ role: 'user', content: [{ type: 'text', text: line }] });
    try {
      await runTurn(messages, {
        provider, registry, gate, cwd, model, systemPrompt,
        onText: store.appendStreaming, onToolStart: store.addTool,
      });
    } catch (err) {
      store.appendStreaming(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      store.commitStreaming();
      store.setStatus('idle');
      running = false;
    }
  };

  process.stdout.write(formatBanner({ version: VERSION }) + '\n');
  const app = mountApp(store, (line) => { void onSubmit(line); }, sessionMeta(provider.name, model, cwd, opts));
  await app.waitUntilExit();
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('mdd').description('MDD internal terminal coding assistant');
  program.version(VERSION);
  program.option('--provider <name>', 'anthropic or openai');
  program.option('--model <name>', 'model id');
  program.option('--base-url <url>', 'OpenAI-compatible base URL (e.g. 9router at http://localhost:20128/v1)');
  program.option('-y, --yes', 'auto-approve mutating tools');

  program.command('auth').command('login').description('Store your API keys').action(authLogin);

  program.command('models').description('List commonly-used model ids').action(() => {
    process.stdout.write(formatModels() + '\n');
  });

  program.argument('[prompt...]', 'one-shot prompt; omit for interactive REPL').action(async (promptWords: string[]) => {
    const opts = program.opts<RunOpts>();
    if (promptWords.length) await oneShot(promptWords.join(' '), opts);
    else await repl(opts);
  });

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    process.stderr.write(`\nError: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  void main();
}
