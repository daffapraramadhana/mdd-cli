// src/onboard.ts
// Pure logic behind the first-run onboarding wizard (the interactive I/O lives in cli.ts).
import type { Config } from './config/index.js';

export const NINEROUTER_URL = 'http://localhost:20128/v1';

export interface OnboardChoice {
  id: '9router' | 'anthropic' | 'openai';
  label: string;
  defaultProvider: 'anthropic' | 'openai';
  defaultModel: string;
  keyField: 'anthropicApiKey' | 'openaiApiKey';
  keyLabel: string;
  askBaseUrl: boolean;
  defaultBaseUrl?: string;
}

/** Map a Step-1 menu answer (number or name) to a provider choice, or null if invalid. */
export function onboardChoice(input: string): OnboardChoice | null {
  const c = input.trim().toLowerCase();
  if (c === '1' || c === '9router' || c === 'nine') {
    return { id: '9router', label: '9router', defaultProvider: 'openai', defaultModel: 'cc/claude-sonnet-5', keyField: 'openaiApiKey', keyLabel: '9router', askBaseUrl: true, defaultBaseUrl: NINEROUTER_URL };
  }
  if (c === '2' || c === 'anthropic' || c === 'claude') {
    return { id: 'anthropic', label: 'Anthropic', defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8', keyField: 'anthropicApiKey', keyLabel: 'Anthropic', askBaseUrl: false };
  }
  if (c === '3' || c === 'openai' || c === 'gpt') {
    return { id: 'openai', label: 'OpenAI', defaultProvider: 'openai', defaultModel: 'gpt-5', keyField: 'openaiApiKey', keyLabel: 'OpenAI', askBaseUrl: true };
  }
  return null;
}

/** Build the config patch to save from the wizard answers. */
export function buildOnboardPatch(choice: OnboardChoice, apiKey: string, baseUrl?: string): Partial<Config> {
  const patch: Partial<Config> = {
    defaultProvider: choice.defaultProvider,
    defaultModel: choice.defaultModel,
  };
  patch[choice.keyField] = apiKey;
  if (choice.defaultProvider === 'openai' && baseUrl) patch.openaiBaseUrl = baseUrl;
  return patch;
}
