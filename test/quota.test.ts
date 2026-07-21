import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchQuota, formatQuota, providerForModel, formatCountdown, type QuotaSummary } from '../src/quota.js';
import { login } from '../src/router-auth.js';

let tmpCacheDir: string;
beforeEach(async () => { tmpCacheDir = await mkdtemp(join(tmpdir(), 'mdd-quota-')); });

const LIST_PATH = '/api/providers/client?page=1&pageSize=50&accountStatus=all&sort=priority';

function fakeFetch(routes: Record<string, unknown>, onHeaders?: (h: Record<string, string>) => void): typeof fetch {
  return (async (url: string, init?: { headers?: Record<string, string> }) => {
    if (onHeaders && init?.headers) onHeaders(init.headers);
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path in routes) {
      const body = routes[path];
      if (body === 'ERR') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const LIST = {
  connections: [
    { id: 'claude-1', provider: 'claude', name: 'dev@x.com', isActive: true, testStatus: 'active' },
    { id: 'codex-1', provider: 'codex', name: 'agus@x.com', isActive: true, testStatus: 'active' },
  ],
};
const CLAUDE_USAGE = {
  limitReached: false,
  quotas: {
    session: { used: 7, total: 100, remaining: 93, resetAt: '2026-07-18T00:00:00.000Z', unlimited: false },
    weekly: { used: 25, total: 100, remaining: 75, resetAt: '2026-07-20T00:00:00.000Z', unlimited: false },
  },
};
const CODEX_USAGE = {
  limitReached: false,
  quotas: { session: { used: 31, total: 100, remaining: 69, resetAt: '2026-07-23T00:00:00.000Z', unlimited: false } },
};

const ROUTES = { [LIST_PATH]: LIST, '/api/usage/claude-1': CLAUDE_USAGE, '/api/usage/codex-1': CODEX_USAGE };

// The single-call /api/usage/me shape: connections with quotas embedded.
const ME = {
  connections: [
    { id: 'claude-1', provider: 'claude', name: 'dev@x.com', testStatus: 'active', limitReached: false, quotas: CLAUDE_USAGE.quotas },
    { id: 'codex-1', provider: 'codex', name: 'agus@x.com', testStatus: 'active', limitReached: false, quotas: CODEX_USAGE.quotas },
  ],
};

afterEach(async () => { delete process.env.MDD_NO_QUOTA; delete process.env.MDD_ROUTER_URL; await rm(tmpCacheDir, { recursive: true, force: true }); });

describe('fetchQuota', () => {
  it('primary path: one API-key call to /api/usage/me (no cookie, no login)', async () => {
    let seen: Record<string, string> = {};
    const summary = await fetchQuota({ baseUrl: 'https://r', apiKey: 'sk-key', fetchFn: fakeFetch({ '/api/usage/me': ME }, (h) => { seen = h; }), now: () => 1 });
    expect(seen['authorization']).toBe('Bearer sk-key');
    expect(seen['cookie']).toBeUndefined();
    expect(summary?.connections.map((c) => c.provider)).toEqual(['claude', 'codex']);
    expect(summary?.connections[0].windows.map((w) => w.name)).toEqual(['session', 'weekly']);
  });

  it('defaults the quota endpoint to the sidecar URL when nothing is configured', async () => {
    let calledUrl = '';
    const fetchFn = (async (url: string) => { calledUrl = String(url); return { ok: true, status: 200, json: async () => ME }; }) as unknown as typeof fetch;
    await fetchQuota({ apiKey: 'sk-key', fetchFn });
    expect(calledUrl).toBe('http://192.168.7.8:8080/api/usage/me');
  });

  it('falls back to the cookie two-step when /api/usage/me is unavailable (404)', async () => {
    // ROUTES has no /api/usage/me, so the API-key call 404s and the cookie path takes over.
    const summary = await fetchQuota({ baseUrl: 'https://r', apiKey: 'sk-key', cookie: 'session=abc', fetchFn: fakeFetch(ROUTES), now: () => 1 });
    expect(summary?.connections).toHaveLength(2);
  });

  it('walks the two-step API and normalizes connections + windows', async () => {
    const summary = await fetchQuota({ baseUrl: 'https://r', cookie: 'session=abc', fetchFn: fakeFetch(ROUTES), now: () => 1000 });
    expect(summary?.fetchedAt).toBe(1000);
    expect(summary?.connections).toHaveLength(2);
    const claude = summary!.connections.find((c) => c.provider === 'claude')!;
    expect(claude).toMatchObject({ id: 'claude-1', name: 'dev@x.com', active: true, limitReached: false });
    expect(claude.windows.map((w) => w.name)).toEqual(['session', 'weekly']);
    expect(claude.windows[0]).toMatchObject({ used: 7, total: 100, remaining: 93, resetAt: '2026-07-18T00:00:00.000Z' });
  });

  it('sends the session as a Cookie header', async () => {
    let seen: Record<string, string> = {};
    await fetchQuota({ baseUrl: 'https://r', cookie: 'session=abc', fetchFn: fakeFetch(ROUTES, (h) => { seen = h; }) });
    expect(seen['cookie']).toBe('session=abc');
  });

  it('refreshes the session cookie on a 401 and retries once', async () => {
    let reauths = 0;
    const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      // First hit to the list endpoint is unauthorized until the cookie is refreshed.
      if (path === LIST_PATH && init?.headers?.['cookie'] !== 'session=fresh') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      const body = (ROUTES as Record<string, unknown>)[path];
      return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const summary = await fetchQuota({
      baseUrl: 'https://r', cookie: 'session=stale', fetchFn,
      reauth: async () => { reauths++; return 'session=fresh'; },
    });
    expect(reauths).toBe(1);
    expect(summary?.connections).toHaveLength(2);
  });

  it('end-to-end: login sets a cookie, which authenticates the quota fetch', async () => {
    // One fetch double serving BOTH the login (Set-Cookie) and the cookie-gated API,
    // exercising the real path: login → cookie → providers/client → usage/{id}.
    const fetchFn = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      if (path === '/api/auth/login' && init?.method === 'POST') {
        return { ok: true, status: 200, headers: { getSetCookie: () => ['session=live; Max-Age=3600'], get: () => null }, json: async () => ({ success: true }) };
      }
      if (init?.headers?.['cookie'] !== 'session=live') return { ok: false, status: 401, json: async () => ({}) };
      const body = (ROUTES as Record<string, unknown>)[path];
      return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const cookie = (await login({ baseUrl: 'https://r', getPassword: async () => 'pw' }, { fetchFn, cacheDir: tmpCacheDir }))!.cookie;
    const summary = await fetchQuota({ baseUrl: 'https://r', cookie, fetchFn });
    expect(cookie).toBe('session=live');
    expect(summary?.connections.map((c) => c.provider)).toEqual(['claude', 'codex']);
  });

  it('returns null (silent) when the list endpoint fails', async () => {
    const summary = await fetchQuota({ baseUrl: 'https://r', fetchFn: fakeFetch({ [LIST_PATH]: 'ERR' }) });
    expect(summary).toBeNull();
  });

  it('returns null when disabled via MDD_NO_QUOTA', async () => {
    process.env.MDD_NO_QUOTA = '1';
    const summary = await fetchQuota({ baseUrl: 'https://r', fetchFn: fakeFetch(ROUTES) });
    expect(summary).toBeNull();
  });
});

describe('providerForModel', () => {
  it('maps 9router prefixes and ignores native ids', () => {
    expect(providerForModel('cc/claude-sonnet-5')).toBe('claude');
    expect(providerForModel('cx/gpt-5.4')).toBe('codex');
    expect(providerForModel('claude-opus-4-8')).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('renders day, hour, and minute scales', () => {
    expect(formatCountdown(5 * 86400_000 + 21 * 3600_000)).toBe('5d 21h');
    expect(formatCountdown(3 * 3600_000 + 28 * 60_000)).toBe('3h 28m');
    expect(formatCountdown(44 * 60_000)).toBe('44m');
    expect(formatCountdown(-1)).toBe('now');
  });
});

describe('formatQuota', () => {
  const now = Date.parse('2026-07-17T00:00:00.000Z');
  const summary: QuotaSummary = {
    fetchedAt: now,
    connections: [
      { id: 'claude-1', provider: 'claude', name: 'dev@x.com', active: true, limitReached: false, windows: CLAUDE_USAGE.quotas ? [
        { name: 'session', used: 7, total: 100, remaining: 93, resetAt: '2026-07-18T00:00:00.000Z', unlimited: false },
        { name: 'weekly', used: 25, total: 100, remaining: 75, resetAt: '2026-07-20T00:00:00.000Z', unlimited: false },
      ] : [] },
      { id: 'codex-1', provider: 'codex', name: 'agus@x.com', active: true, limitReached: false, windows: [
        { name: 'session', used: 31, total: 100, remaining: 69, resetAt: '2026-07-23T00:00:00.000Z', unlimited: false },
      ] },
    ],
  };

  it('shows the soonest-resetting window for the model\'s provider', () => {
    expect(formatQuota(summary, 'cc/claude-sonnet-5', now)).toEqual({ text: 'claude session 7/100 · resets 1d 0h', warn: false });
    expect(formatQuota(summary, 'cx/gpt-5.4', now)).toEqual({ text: 'codex session 31/100 · resets 6d 0h', warn: false });
  });

  it('returns null for a non-9router model or missing connection', () => {
    expect(formatQuota(summary, 'claude-opus-4-8', now)).toBeNull();
    expect(formatQuota({ fetchedAt: now, connections: [] }, 'cc/claude-sonnet-5', now)).toBeNull();
    expect(formatQuota(null, 'cc/claude-sonnet-5', now)).toBeNull();
  });

  it('flags warn when near the cap or the limit is reached', () => {
    const near: QuotaSummary = { fetchedAt: now, connections: [
      { id: 'c', provider: 'claude', name: 'dev', active: true, limitReached: false, windows: [
        { name: 'session', used: 95, total: 100, remaining: 5, resetAt: '2026-07-18T00:00:00.000Z', unlimited: false },
      ] },
    ] };
    expect(formatQuota(near, 'cc/claude-sonnet-5', now)?.warn).toBe(true);

    const reached: QuotaSummary = { fetchedAt: now, connections: [
      { id: 'c', provider: 'claude', name: 'dev', active: true, limitReached: true, windows: [
        { name: 'session', used: 100, total: 100, remaining: 0, resetAt: '2026-07-18T00:00:00.000Z', unlimited: false },
      ] },
    ] };
    const line = formatQuota(reached, 'cc/claude-sonnet-5', now);
    expect(line?.warn).toBe(true);
    expect(line?.text).toMatch(/limit reached/);
  });
});
