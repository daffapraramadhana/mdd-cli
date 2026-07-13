import { describe, it, expect } from 'vitest';
import { handleReplCommand, type ReplSession, type CommandDeps } from '../src/cli.js';
import { UiStore } from '../src/ui/store.js';
import type { Config } from '../src/config/index.js';
import type { LLMProvider } from '../src/providers/index.js';

const fakeProvider = (name: string): LLMProvider => ({ name, async *stream() {} });

function setup(config: Partial<Config> = {}, initial: Partial<ReplSession> = {}) {
  const store = new UiStore();
  let refreshed = 0;
  let exited = false;
  const session: ReplSession = {
    providerName: 'anthropic',
    model: 'claude-opus-4-8',
    provider: fakeProvider('anthropic'),
    ...initial,
  };
  const fullConfig: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8', ...config };
  const deps: CommandDeps = {
    config: fullConfig,
    effectiveConfig: fullConfig,
    store,
    refreshMeta: () => { refreshed++; },
    exit: () => { exited = true; },
  };
  const lastSystem = () => {
    const items = store.getState().transcript.filter((t) => t.kind === 'system') as { text: string }[];
    return items.at(-1)?.text ?? '';
  };
  return { store, session, deps, lastSystem, refreshedCount: () => refreshed, exited: () => exited };
}

describe('handleReplCommand', () => {
  it('/help prints the command list', () => {
    const t = setup();
    handleReplCommand('/help', t.session, t.deps);
    expect(t.lastSystem()).toContain('/model');
  });

  it('/models lists known model ids', () => {
    const t = setup();
    handleReplCommand('/models', t.session, t.deps);
    expect(t.lastSystem()).toContain('cc/claude-opus-4-8');
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
});
