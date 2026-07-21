// Helpers for reading rate-limit (HTTP 429) info off a thrown provider error.
//
// Both the OpenAI and Anthropic SDKs attach the HTTP `status` and response
// `headers` to their error objects, and 9router additionally embeds the reset
// delay in the error body (e.g. "(reset after 1m 4s)"). We prefer the standard
// `Retry-After` header and fall back to parsing that body text.

function header(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  // A Fetch `Headers` instance (case-insensitive .get)…
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  // …or a plain object of header values.
  const rec = headers as Record<string, string | string[] | undefined>;
  const v = rec[name] ?? rec[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** True when the error is (or looks like) an HTTP 429 rate-limit. */
export function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  if (e?.status === 429) return true;
  return /\b429\b|rate.?limit/i.test(e?.message ?? '');
}

/**
 * Milliseconds to wait before retrying a rate-limited request, or `undefined`
 * if the error carries no reset hint. Order of preference:
 *   1. `retry-after-ms` header (non-standard but precise)
 *   2. `retry-after` header (seconds, per the HTTP spec)
 *   3. a "reset after 1m 4s" / "reset after 8s" phrase in the message body
 */
export function retryAfterMs(err: unknown): number | undefined {
  const e = err as { headers?: unknown; message?: string } | null;

  const ms = header(e?.headers, 'retry-after-ms');
  if (ms != null && !Number.isNaN(parseFloat(ms))) return parseFloat(ms);

  const secs = header(e?.headers, 'retry-after');
  if (secs != null && !Number.isNaN(parseFloat(secs))) return parseFloat(secs) * 1000;

  const m = /reset after\s+(?:(\d+)\s*m\s*)?(?:(\d+)\s*s)?/i.exec(e?.message ?? '');
  if (m && (m[1] || m[2])) return ((parseInt(m[1] ?? '0', 10) * 60) + parseInt(m[2] ?? '0', 10)) * 1000;

  return undefined;
}

/** Render a millisecond duration as a compact "1m 4s" / "8s" string. */
export function humanDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** A clean, user-facing message for a rate-limited turn, with the reset time when known. */
export function rateLimitMessage(model: string, retryMs?: number): string {
  const when = retryMs != null ? ` Retry in ${humanDuration(retryMs)}.` : ' Try again shortly.';
  return `Rate limited on ${model}.${when}`;
}
