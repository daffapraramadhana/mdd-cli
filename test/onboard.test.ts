import { describe, it, expect } from 'vitest';
import { onboardChoice, buildOnboardPatch, NINEROUTER_URL } from '../src/onboard.js';

describe('onboardChoice', () => {
  it('maps 9router (option 1) to openai + cc/ model, with a hardcoded (not asked) base URL', () => {
    const c = onboardChoice('1')!;
    expect(c.id).toBe('9router');
    expect(c.defaultProvider).toBe('openai');
    expect(c.defaultModel).toBe('cc/claude-sonnet-5');
    expect(c.defaultBaseUrl).toBe(NINEROUTER_URL);
    expect(NINEROUTER_URL).toBe('http://192.168.7.8:20128/v1');
    expect(c.askBaseUrl).toBe(false); // hardcoded — no endpoint step
  });
  it('maps anthropic (option 2) with no base-url step', () => {
    const c = onboardChoice('2')!;
    expect(c.defaultProvider).toBe('anthropic');
    expect(c.keyField).toBe('anthropicApiKey');
    expect(c.askBaseUrl).toBe(false);
  });
  it('maps openai (option 3)', () => {
    const c = onboardChoice('3')!;
    expect(c.defaultProvider).toBe('openai');
    expect(c.defaultModel).toBe('gpt-5');
  });
  it('accepts names too, and rejects garbage', () => {
    expect(onboardChoice('9router')!.id).toBe('9router');
    expect(onboardChoice('Anthropic')!.id).toBe('anthropic');
    expect(onboardChoice('x')).toBeNull();
    expect(onboardChoice('')).toBeNull();
  });
});

describe('buildOnboardPatch', () => {
  it('stores the 9router key + base URL under openai', () => {
    const patch = buildOnboardPatch(onboardChoice('1')!, 'sk-9r', NINEROUTER_URL);
    expect(patch).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'cc/claude-sonnet-5',
      openaiApiKey: 'sk-9r',
      openaiBaseUrl: NINEROUTER_URL,
    });
  });
  it('stores an anthropic key with no base URL', () => {
    const patch = buildOnboardPatch(onboardChoice('2')!, 'sk-a');
    expect(patch).toEqual({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-opus-4-8',
      anthropicApiKey: 'sk-a',
    });
    expect(patch.openaiBaseUrl).toBeUndefined();
  });
});
