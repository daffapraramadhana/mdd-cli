import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleReplCommand, type ReplSession, type CommandDeps } from '../src/cli.js';
import { UiStore } from '../src/ui/store.js';
import type { Config } from '../src/config/index.js';
import type { LLMProvider } from '../src/providers/index.js';
import type { Command } from '../src/plugins/commands.js';
import type { PermissionGate } from '../src/permissions/index.js';

const fakeProvider = (name: string): LLMProvider => ({ name, async *stream() {} });

function setup(config: Partial<Config> = {}, initial: Partial<ReplSession> = {}) {
  const store = new UiStore();
  let refreshed = 0;
  let exited = false;
  let appliedTheme: string | null = null;
  let pickedModel = 0;
  let resumedSession = 0;
  const session: ReplSession = {
    providerName: 'anthropic',
    model: 'claude-opus-4-8',
    provider: fakeProvider('anthropic'),
    theme: 'neon',
    mode: 'normal',
    ...initial,
  };
  const fullConfig: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8', ...config };
  const deps: CommandDeps = {
    config: fullConfig,
    effectiveConfig: fullConfig,
    store,
    refreshMeta: () => { refreshed++; },
    applyTheme: (name) => { appliedTheme = name; },
    pickModel: () => { pickedModel++; },
    resumeSession: () => { resumedSession++; },
    exit: () => { exited = true; },
  };
  const lastSystem = () => {
    const items = store.getState().transcript.filter((t) => t.kind === 'system') as { text: string }[];
    return items.at(-1)?.text ?? '';
  };
  return { store, session, deps, lastSystem, refreshedCount: () => refreshed, exited: () => exited, appliedTheme: () => appliedTheme, pickedModel: () => pickedModel, resumedSession: () => resumedSession };
}

describe('handleReplCommand', () => {
  it('/help prints the command list', () => {
    const t = setup();
    handleReplCommand('/help', t.session, t.deps);
    expect(t.lastSystem()).toContain('/model');
  });

  it('/models opens the interactive model picker', () => {
    const t = setup();
    handleReplCommand('/models', t.session, t.deps);
    expect(t.pickedModel()).toBe(1);
  });

  it('/model with no arg reports the current model', () => {
    const t = setup();
    handleReplCommand('/model', t.session, t.deps);
    expect(t.lastSystem()).toBe('current model: claude-opus-4-8');
  });

  it('/model <id> switches the model and refreshes meta', () => {
    const t = setup();
    handleReplCommand('/model cc/claude-sonnet-5', t.session, t.deps);
    expect(t.session.model).toBe('cc/claude-sonnet-5');
    expect(t.refreshedCount()).toBe(1);
    expect(t.lastSystem()).toBe('→ model set to cc/claude-sonnet-5');
  });

  it('/provider openai switches provider and picks that provider default model (key present)', () => {
    const t = setup({ openaiApiKey: 'sk-o' });
    handleReplCommand('/provider openai', t.session, t.deps);
    expect(t.session.providerName).toBe('openai');
    expect(t.session.provider.name).toBe('openai');
    expect(t.session.model).toBe('gpt-5');
    expect(t.lastSystem()).toContain('→ provider set to openai');
  });

  it('/provider openai reports the auth error when the key is missing (no crash)', () => {
    const t = setup(); // no openaiApiKey
    handleReplCommand('/provider openai', t.session, t.deps);
    expect(t.session.providerName).toBe('anthropic'); // unchanged
    expect(t.lastSystem()).toMatch(/No OpenAI API key/);
  });

  it('/provider with a bad name shows usage', () => {
    const t = setup();
    handleReplCommand('/provider gemini', t.session, t.deps);
    expect(t.lastSystem()).toContain('usage: /provider');
  });

  it('/theme <name> applies a known theme', () => {
    const t = setup();
    handleReplCommand('/theme ocean', t.session, t.deps);
    expect(t.session.theme).toBe('ocean');
    expect(t.appliedTheme()).toBe('ocean');
    expect(t.lastSystem()).toBe('→ theme set to ocean');
  });

  it('/theme with an unknown name is rejected', () => {
    const t = setup();
    handleReplCommand('/theme rainbow', t.session, t.deps);
    expect(t.appliedTheme()).toBeNull();
    expect(t.lastSystem()).toContain('unknown theme: rainbow');
  });

  it('/resume invokes the resumeSession hook', () => {
    const t = setup();
    handleReplCommand('/resume', t.session, t.deps);
    expect(t.resumedSession()).toBe(1);
  });

  it('/exit calls the exit hook', () => {
    const t = setup();
    handleReplCommand('/exit', t.session, t.deps);
    expect(t.exited()).toBe(true);
  });

  it('an unknown command is reported', () => {
    const t = setup();
    handleReplCommand('/frobnicate', t.session, t.deps);
    expect(t.lastSystem()).toContain('unknown command: /frobnicate');
  });

  it('runs a plugin command: renders body and submits it as a user turn', async () => {
    const t = setup();
    let submitted = '';
    const cmd: Command = { name: 'greet', description: '', body: 'Hello $ARGUMENTS', source: 'plugin', plugin: 'p', path: '' };
    const gate: PermissionGate = { async check() { return { allow: true }; } };
    await handleReplCommand('/greet world', t.session, {
      ...t.deps,
      commands: new Map([['greet', cmd]]),
      gate,
      cwd: process.cwd(),
      runCommandLine: (text) => { submitted = text; },
    });
    expect(submitted).toBe('Hello world');
  });

  it('runs a plugin command with prefill through the gate before submitting', async () => {
    const t = setup();
    let submitted = '';
    const cmd: Command = { name: 'echoer', description: '', body: 'out: !`printf hi`', source: 'plugin', plugin: 'p', path: '' };
    const gate: PermissionGate = { async check() { return { allow: true }; } };
    await handleReplCommand('/echoer', t.session, {
      ...t.deps,
      commands: new Map([['echoer', cmd]]),
      gate,
      cwd: process.cwd(),
      runCommandLine: (text: string) => { submitted = text; },
    });
    expect(submitted).toBe('out: hi');
  });

  it('still reports unknown for a name with no built-in and no plugin command', async () => {
    const t = setup();
    await handleReplCommand('/nope', t.session, { ...t.deps, commands: new Map() });
    expect(t.lastSystem()).toContain('unknown command: /nope');
  });

  it('/plugin list reports installed plugins', async () => {
    // Isolate config + project dirs so the assertion doesn't depend on what's
    // actually installed on the machine running the tests.
    const cfgDir = await mkdtemp(join(tmpdir(), 'mdd-cfg-'));
    const projDir = await mkdtemp(join(tmpdir(), 'mdd-proj-'));
    const prev = process.env.MDD_CONFIG_DIR;
    process.env.MDD_CONFIG_DIR = cfgDir;
    try {
      const t = setup();
      await handleReplCommand('/plugin list', t.session, { ...t.deps, cwd: projDir, commands: new Map() });
      expect(t.lastSystem()).toContain('no plugins');
    } finally {
      if (prev === undefined) delete process.env.MDD_CONFIG_DIR; else process.env.MDD_CONFIG_DIR = prev;
      await rm(cfgDir, { recursive: true, force: true });
      await rm(projDir, { recursive: true, force: true });
    }
  });
});
