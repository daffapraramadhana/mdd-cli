// src/cli.ts
import { createInterface } from 'node:readline/promises';
import { realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { loadConfig, saveConfig, configDir, type Config } from './config/index.js';
import { SessionStore, makeSessionId, truncateTitle, type SessionRecord, type SessionSummary } from './session.js';
import { readFileSync } from 'node:fs';
import { attachImages } from './ui/attach.js';
import type { ContentBlock } from './types.js';
import { getProvider, type LLMProvider } from './providers/index.js';
import { buildRegistry } from './tools/index.js';
import { webCtxFromConfig } from './tools/web-search.js';
import type { PlanDecision } from './tools/types.js';
import { createGate } from './permissions/index.js';
import { runTurn } from './agent/loop.js';
import { buildSystemPrompt, effectiveSystemPrompt } from './system-prompt.js';
import { loadSkills } from './skills/index.js';
import { nextMode, type Mode } from './modes.js';
import { UiStore, mountApp, shortenCwd, type SessionMeta, type SubmitInput } from './ui/index.js';
import { ThinkSplitter } from './ui/think.js';
import { getTheme, gradientText, THEME_NAMES, DEFAULT_THEME } from './ui/theme.js';
import { LOGO } from './ui/banner.js';
import { onboardChoice, buildOnboardPatch, type OnboardChoice } from './onboard.js';
import { formatModels, KNOWN_MODELS } from './models.js';
import { VERSION } from './version.js';
import { checkForUpdate } from './update.js';
import type { Message } from './types.js';
import { splitForCompaction, summaryInput, buildCompacted, shouldCompact, SUMMARY_SYSTEM } from './agent/compact.js';

// Small ANSI helpers for the pre-TUI onboarding output.
const A = (s: string): string => `\x1b[1m\x1b[35m${s}\x1b[0m`; // bold magenta accent
const D = (s: string): string => `\x1b[2m${s}\x1b[0m`;         // dim
const G = (s: string): string => `\x1b[32m${s}\x1b[0m`;        // green

interface RunOpts {
  provider?: 'anthropic' | 'openai';
  model?: string;
  yes?: boolean;
  baseUrl?: string;
  continue?: boolean;
  resume?: boolean;
}

/** Compact "3m ago" / "2h ago" / "just now" relative time for session pickers. */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** A one-line label for a session in the resume picker. */
export function sessionOptionLabel(s: SessionSummary, now: number): string {
  const title = s.title || '(untitled)';
  const count = `${s.messageCount} msg${s.messageCount === 1 ? '' : 's'}`;
  return `${title}  ·  ${relativeTime(s.updatedAt, now)}  ·  ${count}`;
}

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
  return { provider, model, config: effectiveConfig };
}

export function hasKeyFor(config: Config, name: 'anthropic' | 'openai'): boolean {
  return name === 'anthropic' ? !!config.anthropicApiKey : !!config.openaiApiKey;
}

async function authLogin(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const w = (s: string): void => { process.stdout.write(s); };
  try {
    // Splash — gradient MDD logo + welcome.
    w('\n' + gradientText(LOGO.join('\n'), getTheme(DEFAULT_THEME).gradient) + '\n');
    w(A('Welcome to mdd') + ' — your terminal coding assistant.\n');
    w(D("Let's get you set up. Takes about a minute.") + '\n\n');

    // Step 1 · provider (numbered menu).
    w(A('Step 1') + D(' · Choose your provider') + '\n');
    w(`  ${A('1')}) 9router     ${D('Claude models via the company proxy  (recommended)')}\n`);
    w(`  ${A('2')}) Anthropic   ${D('Claude, direct')}\n`);
    w(`  ${A('3')}) OpenAI      ${D('GPT models, direct')}\n`);
    let choice: OnboardChoice | null = null;
    while (!choice) {
      choice = onboardChoice(await rl.question('  › '));
      if (!choice) w(D('  Please enter 1, 2, or 3.\n'));
    }

    // Step 2 · API key.
    w('\n' + A('Step 2') + D(' · Your API key') + '\n');
    const from = choice.id === '9router' ? ' (from the 9router dashboard)' : '';
    w(D(`  Paste your ${choice.keyLabel} key${from}:`) + '\n');
    w(D('  (ask Daffa for the API key)') + '\n');
    let apiKey = '';
    while (!apiKey) {
      apiKey = (await rl.question('  › ')).trim();
      if (!apiKey) w(D('  A key is required.\n'));
    }

    // Step 3 · endpoint. 9router is hardcoded (defaultBaseUrl); only direct OpenAI asks.
    let baseUrl: string | undefined = choice.defaultBaseUrl;
    if (choice.askBaseUrl) {
      w('\n' + A('Step 3') + D(' · Endpoint') + '\n');
      const ans = (await rl.question('  base URL (blank for api.openai.com): ')).trim();
      baseUrl = ans || choice.defaultBaseUrl;
    }

    const patch = buildOnboardPatch(choice, apiKey, baseUrl);
    await saveConfig(patch);

    // Success screen.
    const via = choice.id === '9router' ? ' via 9router' : '';
    w('\n' + G('✓ All set') + D(' — saved to ~/.config/mdd/config.json') + '\n');
    w(D(`  Using: ${patch.defaultProvider} · ${patch.defaultModel}${via}`) + '\n\n');
    w(D('  Try:  ') + A('/models') + D(' pick a model    ') + A('/theme') + D(' colors    ') + A('/help') + D(' all commands') + '\n\n');
  } finally { rl.close(); }
}

function gitBranch(cwd: string): string | undefined {
  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    return b && b !== 'HEAD' ? b : undefined;
  } catch { return undefined; }
}

function sessionMeta(providerName: string, model: string, cwd: string, autoApprove: boolean, mode: Mode, branch?: string): SessionMeta {
  return { provider: providerName, model, cwd: shortenCwd(cwd, homedir()), autoApprove, mode, branch };
}

/** Per-turn streaming callbacks: splits <think> reasoning from answer text, tracks tools, flush at end. */
export function streamHandlers(store: UiStore) {
  const splitter = new ThinkSplitter();
  return {
    onText: (delta: string): void => {
      const { visible, thinking } = splitter.push(delta);
      if (thinking) store.appendReasoning(thinking);
      if (visible) store.appendStreaming(visible);
    },
    onToolStart: (name: string, input: unknown): void => store.startTool(name, input),
    onToolEnd: (isError: boolean, content?: string): void => store.endTool(isError ? 'error' : 'ok', content),
    onUsage: (inTok: number, outTok: number): void => store.addUsage(inTok, outTok),
    flush: (): void => {
      const { visible, thinking } = splitter.flush();
      if (thinking) store.appendReasoning(thinking);
      if (visible) store.appendStreaming(visible);
    },
  };
}

async function oneShot(prompt: string, opts: RunOpts): Promise<void> {
  const { provider, model, config } = await resolveSetup(opts);
  const cwd = process.cwd();
  const skills = await loadSkills(cwd);
  const store = new UiStore();
  store.setTheme(config.theme ?? DEFAULT_THEME);
  store.setMeta(sessionMeta(provider.name, model, cwd, !!opts.yes, 'normal', gitBranch(cwd)));
  const gate = createGate({ confirm: store.requestChoice, autoApprove: opts.yes });
  const app = mountApp(store, () => {});
  store.addUser(prompt);
  store.setStatus('busy');
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
  const h = streamHandlers(store);
  try {
    await runTurn(messages, {
      provider, registry: buildRegistry(), gate, cwd, model,
      systemPrompt: effectiveSystemPrompt(buildSystemPrompt(cwd), 'normal', skills),
      toolFilter: (name) => name !== 'present_plan',
      onText: h.onText, onToolStart: h.onToolStart, onToolEnd: h.onToolEnd, onUsage: h.onUsage,
      ask: store.requestAsk,
      web: webCtxFromConfig(config),
      skills,
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
  '  /resume            resume a past session in this project (↑/↓, enter)',
  '  /compact           summarize older history to free up context',
  '  /provider <name>   switch provider: anthropic | openai',
  `  /theme [name]      switch theme: ${THEME_NAMES.join(' | ')}`,
  '  /help              show this help',
  '  shift+tab          cycle mode: normal · auto-accept edits · plan',
  '  /exit              quit (or press Ctrl-C)',
].join('\n');

/** Mutable per-REPL session state that slash commands read and update. */
export interface ReplSession {
  providerName: 'anthropic' | 'openai';
  model: string;
  provider: LLMProvider;
  theme: string;
  mode: Mode;
}

export interface CommandDeps {
  config: Config;
  effectiveConfig: Config;
  store: Pick<UiStore, 'addSystem' | 'setMeta'>;
  refreshMeta: () => void;
  applyTheme: (name: string) => void;
  pickModel: () => void;
  resumeSession: () => void;
  exit: () => void;
  compact: () => void;
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
    case 'resume':
      deps.resumeSession();
      break;
    case 'compact':
      deps.compact();
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

  // Guided first run: no key configured yet → the welcoming wizard, then continue.
  const wanted = opts.provider ?? config.defaultProvider;
  if (!hasKeyFor(config, wanted)) {
    await authLogin();
    process.stdout.write(D('Starting mdd…') + '\n');
    config = await loadConfig();
  }

  const cwd = process.cwd();
  const branch = gitBranch(cwd);
  const skills = await loadSkills(cwd);
  const store = new UiStore();
  const registry = buildRegistry();
  const baseSystemPrompt = buildSystemPrompt(cwd);
  const messages: Message[] = [];
  let running = false;
  let lastInputTokens = 0;

  const providerName = opts.provider ?? config.defaultProvider;
  const effectiveConfig = opts.baseUrl ? { ...config, openaiBaseUrl: opts.baseUrl } : config;
  const themeName = config.theme ?? DEFAULT_THEME;
  store.setTheme(themeName);
  const session: ReplSession = {
    providerName,
    model: resolveModel(providerName, config, opts.model),
    provider: getProvider(providerName, effectiveConfig),
    theme: themeName,
    mode: 'normal',
  };

  const gate = createGate({ confirm: store.requestChoice, autoApprove: opts.yes, getMode: () => session.mode });

  const refreshMeta = (): void => {
    store.setMeta(sessionMeta(session.providerName, session.model, cwd, !!opts.yes, session.mode, branch));
  };
  refreshMeta();

  const cycleMode = (): void => {
    session.mode = nextMode(session.mode);
    // Mode lives in the bottom status bar (refreshMeta → formatStatus), so a
    // manual shift+tab cycle updates that in place instead of appending a line
    // to the conversation on every toggle.
    refreshMeta();
  };

  // Drives the present_plan approval prompt. On approval, flip to normal so the same turn
  // continues under normal-mode gating; otherwise return the user's feedback to the agent.
  const presentPlan = async (plan: string): Promise<PlanDecision> => {
    const result = await store.requestChoice({
      title: 'Approve this plan?',
      body: plan.split('\n'),
      options: [
        { label: '✅ yes, run it', value: 'yes' },
        { label: '✍ no — keep planning', value: 'no', opensInput: true, inputPlaceholder: 'what should change?' },
      ],
    });
    if (result?.value === 'yes') {
      session.mode = 'normal';
      refreshMeta();
      store.addSystem('→ plan approved · normal mode');
      return { approved: true };
    }
    return { approved: false, ...(result?.text ? { feedback: result.text } : {}) };
  };

  // Non-blocking: if a newer version is on npm, nudge in the status bar. Throttled to once a
  // day via a cache file and silent on any failure (offline/timeout) — never blocks startup.
  void checkForUpdate(VERSION).then((u) => { if (u?.stale) store.setUpdate(u); }).catch(() => {});

  // Session persistence: one record per REPL conversation, saved after each completed turn.
  const sessions = new SessionStore(join(configDir(), 'sessions'));
  let currentId = makeSessionId(Date.now(), Math.random().toString(36).slice(2, 8));
  let createdAt = Date.now();
  let title = '';

  // Replace the live conversation with a saved record (memory, transcript, model, lifecycle ids).
  const seed = (record: SessionRecord): void => {
    messages.splice(0, messages.length, ...record.messages);
    store.loadTranscript(record.transcript);
    currentId = record.id;
    createdAt = record.createdAt;
    title = record.title;
    session.model = record.model;
    refreshMeta();
  };

  const applyTheme = (name: string): void => { store.setTheme(name); void saveConfig({ theme: name }); };

  const pickModel = (): void => {
    void (async () => {
      const result = await store.requestChoice({
        title: 'Select a model  (↑/↓ · enter · esc)',
        options: KNOWN_MODELS.map((m) => ({ label: m.id, value: m.id })),
      });
      const chosen = result?.value;
      if (chosen) { session.model = chosen; refreshMeta(); store.addSystem(`→ model set to ${chosen}`); }
    })();
  };

  const resumeSession = (): void => {
    void (async () => {
      const summaries = await sessions.list(cwd);
      if (!summaries.length) { store.addSystem('No sessions to resume.'); return; }
      const now = Date.now();
      const labels = summaries.map((s) => sessionOptionLabel(s, now));
      const result = await store.requestChoice({
        title: 'Resume a session  (↑/↓ · enter · esc)',
        options: labels.map((l) => ({ label: l, value: l })),
      });
      const chosen = result?.value;
      if (!chosen) return;
      const idx = labels.indexOf(chosen);
      if (idx < 0) return;
      const record = await sessions.load(cwd, summaries[idx].id);
      if (!record) { store.addSystem('Could not load that session.'); return; }
      seed(record);
      store.addSystem(`→ resumed: ${record.title || '(untitled)'}`);
    })();
  };

  // Assigned just below; /exit unmounts the app so ink restores the terminal cleanly.
  let app: { unmount(): void; waitUntilExit(): Promise<void> } | undefined;
  const exit = (): void => { if (app) app.unmount(); else process.exit(0); };

  // Shrink the model-facing history in place: summarize everything but the last couple of
  // exchanges, keep the tail verbatim. Only `messages` changes; the visible transcript is
  // left intact with a system note appended. Fail-safe: on any error the history is
  // untouched.
  const compactConversation = async (auto: boolean): Promise<void> => {
    const { head, tail } = splitForCompaction(messages);
    if (head.length === 0) {
      store.addSystem('Nothing to compact yet.');
      lastInputTokens = 0;
      return;
    }
    const before = lastInputTokens;
    const controller = new AbortController();
    store.setAbort(() => controller.abort());
    try {
      let summary = '';
      for await (const ev of session.provider.stream(summaryInput(head), [], {
        model: session.model, systemPrompt: SUMMARY_SYSTEM, maxTokens: 8192, signal: controller.signal,
      })) {
        if (ev.type === 'text') summary += ev.text;
      }
      if (!summary.trim()) { store.addSystem('⚠ compaction failed: empty summary'); return; }
      messages.splice(0, messages.length, ...buildCompacted(summary, tail));
      const note = auto
        ? '✻ Auto-compacted context to stay under the model\'s token limit'
        : '✻ Compacted context';
      const freed = before > 0 ? `  (was ~${Math.round(before / 1000)}k input tokens)` : '';
      store.addSystem(`${note}${freed}`);
      lastInputTokens = 0;
      void sessions.save({
        id: currentId, cwd, createdAt, updatedAt: Date.now(),
        provider: session.providerName, model: session.model, title,
        messages, transcript: store.getState().transcript,
      }).catch(() => store.addSystem('⚠ could not save session history'));
    } catch (err) {
      store.addSystem(`⚠ compaction failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      store.setAbort(null);
    }
  };

  const onSubmit = async (input: SubmitInput): Promise<void> => {
    if (running) return;
    if (input.display.startsWith('/')) {
      handleReplCommand(input.display, session, {
        config, effectiveConfig, store, refreshMeta, applyTheme, pickModel, resumeSession, exit,
        compact: () => {
          if (running) return;
          running = true;
          store.setStatus('busy');
          void compactConversation(false).finally(() => { store.setStatus('idle'); running = false; });
        },
      });
      return;
    }
    const { blocks, errors } = attachImages(input.imagePaths, (p) => readFileSync(p));
    for (const err of errors) store.addSystem(`⚠ ${err}`);
    if (!input.text && !blocks.length) { return; } // every image failed and no text — nothing to send
    running = true;
    store.addUser(input.display);
    if (!title) title = truncateTitle(input.display);
    store.setStatus('busy');
    const controller = new AbortController();
    let interrupted = false;
    store.setAbort(() => { interrupted = true; controller.abort(); });
    const content: ContentBlock[] = [
      ...(input.text ? [{ type: 'text' as const, text: input.text }] : []),
      ...blocks,
    ];
    messages.push({ role: 'user', content });
    const h = streamHandlers(store);
    try {
      await runTurn(messages, {
        provider: session.provider, registry, gate, cwd, model: session.model,
        systemPrompt: effectiveSystemPrompt(baseSystemPrompt, session.mode, skills),
        toolFilter: (name) => name !== 'present_plan' || session.mode === 'plan',
        onText: h.onText, onToolStart: h.onToolStart, onToolEnd: h.onToolEnd,
        onUsage: (inTok: number, outTok: number) => { lastInputTokens = inTok; h.onUsage(inTok, outTok); },
        signal: controller.signal,
        ask: store.requestAsk,
        presentPlan,
        web: webCtxFromConfig(effectiveConfig),
        skills,
      });
      h.flush();
    } catch (err) {
      if (interrupted) { store.commitStreaming(); store.addSystem('⊘ interrupted'); }
      else store.appendStreaming(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      store.setAbort(null);
      store.commitStreaming();
      store.setStatus('idle');
      running = false;
      // Fire-and-forget atomic save of the completed turn.
      void sessions.save({
        id: currentId, cwd, createdAt, updatedAt: Date.now(),
        provider: session.providerName, model: session.model, title,
        messages, transcript: store.getState().transcript,
      }).catch(() => store.addSystem('⚠ could not save session history'));
      if (!interrupted && shouldCompact(lastInputTokens, session.model)) {
        running = true;
        store.setStatus('busy');
        void compactConversation(true).finally(() => { store.setStatus('idle'); running = false; });
      }
    }
  };

  // Resume a prior conversation before the TUI mounts (readline pickers need the plain terminal).
  if (opts.continue) {
    const r = await sessions.mostRecent(cwd);
    if (r) seed(r);
    else store.addSystem('No previous session in this project — starting fresh.');
  } else if (opts.resume) {
    const summaries = await sessions.list(cwd);
    if (!summaries.length) {
      store.addSystem('No sessions to resume — starting fresh.');
    } else {
      const now = Date.now();
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        process.stdout.write('\n' + A('Resume a session') + '\n');
        summaries.forEach((s, i) => {
          process.stdout.write(`  ${A(String(i + 1))}) ${sessionOptionLabel(s, now)}\n`);
        });
        process.stdout.write(D('  (enter a number, or blank to start fresh)') + '\n');
        const ans = (await rl.question('  › ')).trim();
        const idx = Number(ans) - 1;
        if (Number.isInteger(idx) && idx >= 0 && idx < summaries.length) {
          const r = await sessions.load(cwd, summaries[idx].id);
          if (r) seed(r);
          else store.addSystem('Could not load that session — starting fresh.');
        }
      } finally { rl.close(); }
    }
  }

  // Interactive REPL in the normal terminal buffer: native smooth scroll, banner at the top
  // of scrollback, status pinned at the bottom. History persists in scrollback after exit.
  app = mountApp(store, (input) => { void onSubmit(input); }, { showHeader: true, onCycleMode: cycleMode });
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
  program.option('-c, --continue', 'resume the most recent session in this project');
  program.option('-r, --resume', 'pick a past session in this project to resume');

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
