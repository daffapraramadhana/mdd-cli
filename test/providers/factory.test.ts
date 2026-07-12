import { describe, it, expect } from 'vitest';
import { getProvider } from '../../src/providers/index.js';
import type { Config } from '../../src/config/index.js';

describe('getProvider', () => {
  it('returns the anthropic provider when configured', () => {
    const config: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8', anthropicApiKey: 'sk-a' };
    const provider = getProvider('anthropic', config);
    expect(provider.name).toBe('anthropic');
  });

  it('returns the openai provider when configured', () => {
    const config: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8', openaiApiKey: 'sk-o' };
    const provider = getProvider('openai', config);
    expect(provider.name).toBe('openai');
  });

  it('throws when no anthropic API key is configured', () => {
    const config: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' };
    expect(() => getProvider('anthropic', config)).toThrow(/No Anthropic API key/);
  });

  it('throws when no openai API key is configured', () => {
    const config: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' };
    expect(() => getProvider('openai', config)).toThrow(/No OpenAI API key/);
  });
});
