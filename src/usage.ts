// src/usage.ts
// Token accounting + a (clearly-approximate) cost estimate. Token counts come straight
// from the provider; cost is an ESTIMATE from the table below — adjust to your real rates.
// 9router (cc/*) models are priced as their underlying Claude tier.

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// USD per 1,000,000 tokens (approximate list prices — edit as needed).
export const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-opus-4-7': { in: 15, out: 75 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 0.8, out: 4 },
  'gpt-5': { in: 1.25, out: 10 },
};

/** Estimated USD cost, or null if we don't have a price for the model. */
export function estimateCost(model: string, u: TokenUsage): number | null {
  const key = model.replace(/^cc\//, ''); // 9router prefixes Claude ids with cc/
  const p = MODEL_PRICING[key];
  if (!p) return null;
  return (u.inputTokens * p.in + u.outputTokens * p.out) / 1_000_000;
}

/** 950 → "950", 12345 → "12.3k". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
}

/** Compact meter, e.g. "12.3k↑ 4.5k↓ ~$0.05" (cost omitted when unknown). */
export function formatUsage(u: TokenUsage, model: string): string {
  const parts = [`${formatTokens(u.inputTokens)}↑`, `${formatTokens(u.outputTokens)}↓`];
  const cost = estimateCost(model, u);
  if (cost !== null) parts.push(`~$${cost.toFixed(cost < 1 ? 4 : 2)}`);
  return parts.join(' ');
}
