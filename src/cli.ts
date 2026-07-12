// src/cli.ts
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { loadConfig, saveConfig, type Config } from './config/index.js';
import { getProvider } from './providers/index.js';
import { buildRegistry } from './tools/index.js';
import { createGate } from './permissions/index.js';
import { runTurn } from './agent/loop.js';
import { buildSystemPrompt } from './system-prompt.js';
import { UiStore, mountApp } from './ui/index.js';
import type { Message } from './types.js';

interface RunOpts { provider?: 'anthropic' | 'openai'; model?: string; yes?: boolean; }

async function resolveSetup(opts: RunOpts) {
  const config = await loadConfig();
  const providerName = opts.provider ?? config.defaultProvider;
  const model =
    opts.model ??
    (providerName === config.defaultProvider ? config.defaultModel : providerName === 'openai' ? 'gpt-5' : 'claude-opus-4-8');
  const provider = getProvider(providerName, config);
  return { provider, model };
}

async function authLogin(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const which = (await rl.question('Configure which provider? [anthropic/openai/both]: ')).trim().toLowerCase();
    const patch: Partial<Config> = {};
    if (which === 'anthropic' || which === 'both') patch.anthropicApiKey = (await rl.question('Anthropic API key: ')).trim();
    if (which === 'openai' || which === 'both') patch.openaiApiKey = (await rl.question('OpenAI API key: ')).trim();
    if (which === 'openai') patch.defaultProvider = 'openai';
    await saveConfig(patch);
    process.stdout.write('Saved to ~/.config/mdd/config.json\n');
  } finally { rl.close(); }
}

async function oneShot(prompt: string, opts: RunOpts): Promise<void> {
  const { provider, model } = await resolveSetup(opts);
  const cwd = process.cwd();
  const store = new UiStore();
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
    store.appendStreaming(`\nError: ${(err as Error).message}\n`);
  } finally {
    store.commitStreaming();
    store.setStatus('idle');
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
      store.appendStreaming(`\nError: ${(err as Error).message}\n`);
    } finally {
      store.commitStreaming();
      store.setStatus('idle');
      running = false;
    }
  };

  const app = mountApp(store, (line) => { void onSubmit(line); });
  await app.waitUntilExit();
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('mdd').description('MDD internal terminal coding assistant');
  program.option('--provider <name>', 'anthropic or openai');
  program.option('--model <name>', 'model id');
  program.option('-y, --yes', 'auto-approve mutating tools');

  program.command('auth').command('login').description('Store your API keys').action(authLogin);

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

void main();
