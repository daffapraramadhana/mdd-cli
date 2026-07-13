import { describe, it, expect } from 'vitest';
import { KNOWN_MODELS, formatModels } from '../src/models.js';

describe('KNOWN_MODELS', () => {
  it('includes the native defaults and all five 9router cc/ models', () => {
    const ids = KNOWN_MODELS.map((m) => m.id);
    expect(ids).toContain('claude-opus-4-8');
    expect(ids).toContain('gpt-5');
    expect(ids).toContain('cc/claude-fable-5');
    expect(ids).toContain('cc/claude-sonnet-5');
    expect(ids).toContain('cc/claude-opus-4-8');
    expect(ids).toContain('cc/claude-opus-4-7');
    expect(ids).toContain('cc/claude-haiku-4-5-20251001');
  });

  it('marks every cc/* model as the openai provider (9router uses the OpenAI schema)', () => {
    for (const m of KNOWN_MODELS.filter((x) => x.id.startsWith('cc/'))) {
      expect(m.provider).toBe('openai');
    }
  });
});

describe('formatModels', () => {
  it('renders every known id and the 9router usage hint', () => {
    const out = formatModels();
    for (const m of KNOWN_MODELS) expect(out).toContain(m.id);
    expect(out).toMatch(/--base-url/);
    expect(out).toMatch(/--provider openai/);
  });
});
