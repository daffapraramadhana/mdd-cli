import { describe, it, expect } from 'vitest';
import { resolveModel } from '../src/cli.js';

describe('resolveModel', () => {
  it('uses the stored defaultModel when resolving the configured default provider', () => {
    expect(resolveModel('openai', { defaultProvider: 'openai', defaultModel: 'gpt-5' })).toBe('gpt-5');
    expect(resolveModel('anthropic', { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' })).toBe(
      'claude-opus-4-8',
    );
  });

  it('falls back to the requested provider\'s own default when overriding the configured provider', () => {
    expect(resolveModel('anthropic', { defaultProvider: 'openai', defaultModel: 'gpt-5' })).toBe('claude-opus-4-8');
    expect(resolveModel('openai', { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' })).toBe('gpt-5');
  });

  it('lets an explicit --model override win over any default', () => {
    expect(resolveModel('openai', { defaultProvider: 'openai', defaultModel: 'gpt-5' }, 'gpt-4o')).toBe('gpt-4o');
  });
});
