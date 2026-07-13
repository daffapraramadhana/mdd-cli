import { describe, it, expect } from 'vitest';
import { hasKeyFor } from '../src/cli.js';
import type { Config } from '../src/config/index.js';

const base: Config = { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' };

describe('hasKeyFor (guided first-run gate)', () => {
  it('is false when the provider has no key (triggers onboarding)', () => {
    expect(hasKeyFor(base, 'anthropic')).toBe(false);
    expect(hasKeyFor(base, 'openai')).toBe(false);
  });
  it('is true once the matching key is present', () => {
    expect(hasKeyFor({ ...base, anthropicApiKey: 'sk-a' }, 'anthropic')).toBe(true);
    expect(hasKeyFor({ ...base, openaiApiKey: 'sk-o' }, 'openai')).toBe(true);
    expect(hasKeyFor({ ...base, anthropicApiKey: 'sk-a' }, 'openai')).toBe(false);
  });
});
