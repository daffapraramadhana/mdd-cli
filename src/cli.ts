// src/cli.ts
import { createInterface } from 'node:readline/promises';
import { realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Command } from 'commander';
import { loadConfig, saveConfig, type Config } from './config/index.js';
import { getProvider, type LLMProvider } from './providers/index.js';
import { buildRegistry } from './tools/index.js';
import { createGate } from './permissions/index.js';
import { runTurn } from './agent/loop.js';
import { buildSystemPrompt } from './system-prompt.js';
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

function gitBranch(cwd: string): string | undefined {
  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    return b && b !== 'HEAD' ? b : undefined;
  } catch { return undefined; }
}

function sessionMeta(providerName: string, model: string, cwd: string, autoApprove: boolean, branch?: string): SessionMeta {
  return { provider: providerName, model, cwd: shortenCwd(cwd, homedir()), autoApprove, branch };
}

async function oneShot(prompt: string, opts: RunOpts): Promise<void> {
  const { provider, model } = await resolveSetup(opts);
  const cwd = process.cwd();
  const store = new UiStore();
  store.setMeta(sessionMeta(provider.name, model, cwd, !!opts.yes, gitBranch(cwd)));
  const gate = createGate({ prompt: store.requestPrompt, autoApprove: opts.yes });
  const app = mountApp(store, () => {});
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

export const HELP = [
  'commands:',
  '  /model [id]        show or switch the model (takes effect next turn)',
  '  /models            list common model ids',
  '  /provider <name>   switch provider: anthropic | openai',
  '  /help              show this help',
  '  /exit              quit (or press Ctrl-C)',
].join('\n');

/** Mutable per-REPL session state that slash commands read and update. */
export interface ReplSession {
  providerName: 'anthropic' | 'openai';
  model: string;
  provider: LLMProvider;
}

export interface CommandDeps {
  config: Config;
  effectiveConfig: Config;
  store: Pick<UiStore, 'addSystem' | 'setMeta'>;
  refreshMeta: () => void;
  exit: () => void;
}

/** Execute a `/command` line, mutating `session` and reporting via the store. */
export function handleReplCommand(input: string, session: ReplSession, deps: CommandDeps): void {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case 'help':
      deps.store.addSystem(HELP);
      break;
    case 'models':
      deps.store.addSystem(formatModels());
      break;
    case 'model':
      if (!arg) { deps.store.addSystem(`current model: ${session.model}`); break; }
      session.model = arg;
      deps.refreshMeta();
      deps.store.addSystem(`→ model set to ${arg}`);
      break;
    case 'provider': {
      if (arg !== 'anthropic' && arg !== 'openai') {
        deps.store.addSystem('usage: /provider anthropic | openai');
        break;
      }
      try {
        session.provider = getProvider(arg, deps.effectiveConfig);
        session.providerName = arg;
        session.model = resolveModel(arg, deps.config, undefined);
        deps.refreshMeta();
        deps.store.addSystem(`→ provider set to ${arg} (model ${session.model})`);
      } catch (err) {
        deps.store.addSystem(`✗ ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }
    case 'exit':
    case 'quit':
      deps.exit();
      break;
    default:
      deps.store.addSystem(`unknown command: /${cmd} — try /help`);
  }
}

async function repl(opts: RunOpts): Promise<void> {
  const config = await loadConfig();
  const cwd = process.cwd();
  const branch = gitBranch(cwd);
  const store = new UiStore();
  const gate = createGate({ prompt: store.requestPrompt, autoApprove: opts.yes });
  const registry = buildRegistry();
  const systemPrompt = buildSystemPrompt(cwd);
  const messages: Message[] = [];
  let running = false;

  const providerName = opts.provider ?? config.defaultProvider;
  const effectiveConfig = opts.baseUrl ? { ...config, openaiBaseUrl: opts.baseUrl } : config;
  const session: ReplSession = {
    providerName,
    model: resolveModel(providerName, config, opts.model),
    provider: getProvider(providerName, effectiveConfig),
  };

  const refreshMeta = (): void => {
    store.setMeta(sessionMeta(session.providerName, session.model, cwd, !!opts.yes, branch));
  };
  refreshMeta();

  const onSubmit = async (line: string): Promise<void> => {
    if (running) return;
    if (line.startsWith('/')) {
      handleReplCommand(line, session, { config, effectiveConfig, store, refreshMeta, exit: () => process.exit(0) });
      return;
    }
    running = true;
    store.addUser(line);
    store.setStatus('busy');
    messages.push({ role: 'user', content: [{ type: 'text', text: line }] });
    try {
      await runTurn(messages, {
        provider: session.provider, registry, gate, cwd, model: session.model, systemPrompt,
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

  const bannerLines = formatBanner({ version: VERSION }).split('\n');
  const subtitle = bannerLines.pop() ?? '';
  // Logo in bold magenta, subtitle dim, then a blank line.
  process.stdout.write(`\x1b[1m\x1b[35m${bannerLines.join('\n')}\x1b[0m\n\x1b[2m${subtitle}\x1b[0m\n\n`);
  const app = mountApp(store, (line) => { void onSubmit(line); });
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
