import { describe, it, expect } from 'vitest';
import { isRateLimit, retryAfterMs, humanDuration, rateLimitMessage } from '../../src/providers/rate-limit.js';

describe('isRateLimit', () => {
  it('detects a 429 by status', () => {
    expect(isRateLimit({ status: 429 })).toBe(true);
  });
  it('detects a rate limit from the message when status is absent', () => {
    expect(isRateLimit(new Error('429 [claude/claude-sonnet-5] [429]: {"type":"ratelimiterror"}'))).toBe(true);
    expect(isRateLimit(new Error('This request would exceed your account\'s rate limit.'))).toBe(true);
  });
  it('is false for unrelated errors', () => {
    expect(isRateLimit(new Error('truncated upstream'))).toBe(false);
    expect(isRateLimit({ status: 500 })).toBe(false);
  });
});

describe('retryAfterMs', () => {
  it('prefers the retry-after-ms header (plain object)', () => {
    expect(retryAfterMs({ headers: { 'retry-after-ms': '8000' } })).toBe(8000);
  });
  it('reads retry-after seconds from a Fetch Headers instance', () => {
    const headers = new Headers({ 'retry-after': '64' });
    expect(retryAfterMs({ headers })).toBe(64000);
  });
  it('falls back to parsing "(reset after 1m 4s)" from the message body', () => {
    expect(retryAfterMs(new Error('… [429]: {…} (reset after 1m 4s)'))).toBe(64000);
    expect(retryAfterMs(new Error('… (reset after 8s)'))).toBe(8000);
  });
  it('returns undefined when there is no reset hint', () => {
    expect(retryAfterMs(new Error('429 rate limited'))).toBeUndefined();
    expect(retryAfterMs({})).toBeUndefined();
  });
});

describe('humanDuration', () => {
  it('renders sub-minute and minute durations', () => {
    expect(humanDuration(8000)).toBe('8s');
    expect(humanDuration(64000)).toBe('1m 4s');
    expect(humanDuration(60000)).toBe('1m');
  });
});

describe('rateLimitMessage', () => {
  it('includes the model and the reset time when known', () => {
    expect(rateLimitMessage('cc/claude-sonnet-5', 64000)).toBe('Rate limited on cc/claude-sonnet-5. Retry in 1m 4s.');
  });
  it('degrades gracefully when the reset time is unknown', () => {
    expect(rateLimitMessage('cc/claude-sonnet-5')).toBe('Rate limited on cc/claude-sonnet-5. Try again shortly.');
  });
});
