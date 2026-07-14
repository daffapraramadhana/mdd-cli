// src/models.ts
// A curated list of commonly-used model ids for discoverability. `--model` accepts
// ANY string; these are just the ones `mdd models` prints. The `cc/*` ids are Claude
// models served over 9router's OpenAI-compatible endpoint.
export interface KnownModel {
  provider: 'anthropic' | 'openai';
  id: string;
  note: string;
}

export const KNOWN_MODELS: KnownModel[] = [
  { provider: 'anthropic', id: 'claude-opus-4-8', note: 'native Anthropic (default)' },
  { provider: 'openai', id: 'gpt-5', note: 'native OpenAI (default)' },
  { provider: 'openai', id: 'cc/claude-fable-5', note: '9router' },
  { provider: 'openai', id: 'cc/claude-sonnet-5', note: '9router' },
  { provider: 'openai', id: 'cc/claude-opus-4-8', note: '9router' },
  { provider: 'openai', id: 'cc/claude-opus-4-7', note: '9router' },
  { provider: 'openai', id: 'cc/claude-haiku-4-5-20251001', note: '9router' },
  { provider: 'openai', id: 'cx/gpt-5.5', note: '9router' },
  { provider: 'openai', id: 'cx/gpt-5.4', note: '9router' },
  { provider: 'openai', id: 'cx/gpt-5.4-mini', note: '9router' },
  { provider: 'openai', id: 'cx/gpt-5.3-codex-spark', note: '9router' },
  { provider: 'openai', id: 'mdd-free-combo', note: '9router' },
];

export function formatModels(models: KnownModel[] = KNOWN_MODELS): string {
  const width = Math.max(...models.map((m) => m.id.length));
  const lines = models.map((m) => `  ${m.id.padEnd(width)}  ${m.note}`);
  return [
    'Known models (--model accepts any id; these are the common ones):',
    ...lines,
    '',
    '9router (cc/*) models are served over the OpenAI-compatible endpoint — use:',
    '  mdd --provider openai --base-url http://localhost:20128/v1 --model <id>',
  ].join('\n');
}
