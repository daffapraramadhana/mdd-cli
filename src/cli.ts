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
import { UiStore, mountApp, mountFullscreen, shortenCwd, type SessionMeta } from './ui/index.js';
import { ThinkSplitter } from './ui/think.js';
import { THEME_NAMES, DEFAULT_THEME } from './ui/theme.js';
import { formatModels, KNOWN_MODELS } from './models.js';
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
  return { provider, model, config };
}

export function hasKeyFor(config: Config, name: 'anthropic' | 'openai'): boolean {
  return name === 'anthropic' ? !!config.anthropicApiKey : !!config.openaiApiKey;
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

/** Per-turn streaming callbacks: strips <think> from text, tracks tool start/end, flush at end. */
function streamHandlers(store: UiStore) {
  const splitter = new ThinkSplitter();
  return {
    onText: (delta: string): void => { const v = splitter.push(delta); if (v) store.appendStreaming(v); },
    onToolStart: (name: string, input: unknown): void => store.startTool(name, input),
    onToolEnd: (isError: boolean): void => store.endTool(isError ? 'error' : 'ok'),
    flush: (): void => { const rest = splitter.flush(); if (rest) store.appendStreaming(rest); },
  };
}

async function oneShot(prompt: string, opts: RunOpts): Promise<void> {
  const { provider, model, config } = await resolveSetup(opts);
  const cwd = process.cwd();
  const store = new UiStore();
  store.setTheme(config.theme ?? DEFAULT_THEME);
  store.setMeta(sessionMeta(provider.name, model, cwd, !!opts.yes, gitBranch(cwd)));
  const gate = createGate({ prompt: store.requestPrompt, autoApprove: opts.yes });
  const app = mountApp(store, () => {});
  store.addUser(prompt);
  store.setStatus('busy');
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
  const h = streamHandlers(store);
  try {
    await runTurn(messages, {
      provider, registry: buildRegistry(), gate, cwd, model,
      systemPrompt: buildSystemPrompt(cwd),
      onText: h.onText, onToolStart: h.onToolStart, onToolEnd: h.onToolEnd,
    });
    h.flush();
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
  '  /models            pick a model (↑/↓, enter)',
  '  /provider <name>   switch provider: anthropic | openai',
  `  /theme [name]      switch theme: ${THEME_NAMES.join(' | ')}`,
  '  /help              show this help',
  '  /exit              quit (or press Ctrl-C)',
].join('\n');

/** Mutable per-REPL session state that slash commands read and update. */
export interface ReplSession {
  providerName: 'anthropic' | 'openai';
  model: string;
  provider: LLMProvider;
  theme: string;
}

export interface CommandDeps {
  config: Config;
  effectiveConfig: Config;
  store: Pick<UiStore, 'addSystem' | 'setMeta'>;
  refreshMeta: () => void;
  applyTheme: (name: string) => void;
  pickModel: () => void;
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
      deps.pickModel();
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
    case 'theme':
      if (!arg) { deps.store.addSystem(`current theme: ${session.theme}; available: ${THEME_NAMES.join(', ')}`); break; }
      if (!THEME_NAMES.includes(arg)) { deps.store.addSystem(`unknown theme: ${arg} (try: ${THEME_NAMES.join(', ')})`); break; }
      session.theme = arg;
      deps.applyTheme(arg);
      deps.store.addSystem(`→ theme set to ${arg}`);
      break;
    case 'exit':
    case 'quit':
      deps.exit();
      break;
    default:
      deps.store.addSystem(`unknown command: /${cmd} — try /help`);
  }
}

async function repl(opts: RunOpts): Promise<void> {
  let config = await loadConfig();

  // Guided first run: no key configured yet → walk the user through setup, then continue.
  const wanted = opts.provider ?? config.defaultProvider;
  if (!hasKeyFor(config, wanted)) {
    process.stdout.write('\nWelcome to mdd! Let\'s get you set up (one time).\n\n');
    await authLogin();
    process.stdout.write('\n');
    config = await loadConfig();
  }

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
  const themeName = config.theme ?? DEFAULT_THEME;
  store.setTheme(themeName);
  const session: ReplSession = {
    providerName,
    model: resolveModel(providerName, config, opts.model),
    provider: getProvider(providerName, effectiveConfig),
    theme: themeName,
  };

  const refreshMeta = (): void => {
    store.setMeta(sessionMeta(session.providerName, session.model, cwd, !!opts.yes, branch));
  };
  refreshMeta();

  const applyTheme = (name: string): void => { store.setTheme(name); void saveConfig({ theme: name }); };

  const pickModel = (): void => {
    void (async () => {
      const chosen = await store.requestSelect('Select a model  (↑/↓ · enter · esc)', KNOWN_MODELS.map((m) => m.id));
      if (chosen) { session.model = chosen; refreshMeta(); store.addSystem(`→ model set to ${chosen}`); }
    })();
  };

  // Assigned just below; /exit unmounts the app so ink restores the terminal cleanly.
  let app: { unmount(): void; waitUntilExit(): Promise<void> } | undefined;
  const exit = (): void => { if (app) app.unmount(); else process.exit(0); };

  const onSubmit = async (line: string): Promise<void> => {
    if (running) return;
    if (line.startsWith('/')) {
      handleReplCommand(line, session, { config, effectiveConfig, store, refreshMeta, applyTheme, pickModel, exit });
      return;
    }
    running = true;
    store.addUser(line);
    store.setStatus('busy');
    messages.push({ role: 'user', content: [{ type: 'text', text: line }] });
    const h = streamHandlers(store);
    try {
      await runTurn(messages, {
        provider: session.provider, registry, gate, cwd, model: session.model, systemPrompt,
        onText: h.onText, onToolStart: h.onToolStart, onToolEnd: h.onToolEnd,
      });
      h.flush();
    } catch (err) {
      store.appendStreaming(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      store.commitStreaming();
      store.setStatus('idle');
      running = false;
    }
  };

  // Fullscreen REPL; on exit the transcript is dumped to scrollback so history persists.
  app = mountFullscreen(store, (line) => { void onSubmit(line); });
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
