import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login, getSession, routerCreds, cookieHeaderFrom, sessionExpiry, runPasswordCommand } from '../src/router-auth.js';

const pw = (p: string) => async () => p; // a literal password source, for tests

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-auth-')); });
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.MDD_ROUTER_PASSWORD;
  delete process.env.MDD_ROUTER_PASSWORD_CMD;
  delete process.env.MDD_ROUTER_EMAIL;
  delete process.env.MDD_ROUTER_URL;
});

// A fetch double whose response exposes getSetCookie(), like undici's Headers.
function loginResponder(setCookies: string[], opts: { ok?: boolean; status?: number; onBody?: (b: string) => void } = {}): typeof fetch {
  return (async (_url: string, init?: { body?: string }) => {
    opts.onBody?.(init?.body ?? '');
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      headers: { getSetCookie: () => setCookies, get: () => null },
      json: async () => ({ success: true, mustChangePassword: false }),
    };
  }) as unknown as typeof fetch;
}

describe('cookieHeaderFrom', () => {
  it('keeps only the name=value of each Set-Cookie and joins them', () => {
    expect(cookieHeaderFrom(['session=abc; Path=/; HttpOnly', 'csrf=xyz; Secure'])).toBe('session=abc; csrf=xyz');
    expect(cookieHeaderFrom([])).toBeNull();
  });
});

describe('sessionExpiry', () => {
  const now = 1_000_000;
  it('uses Max-Age / Expires when present, else a default TTL', () => {
    expect(sessionExpiry(['s=a; Max-Age=3600'], now)).toBe(now + 3600_000);
    expect(sessionExpiry([`s=a; Expires=${new Date(now + 7200_000).toUTCString()}`], now)).toBe(Math.floor((now + 7200_000) / 1000) * 1000);
    expect(sessionExpiry(['s=a; HttpOnly'], now)).toBe(now + 6 * 60 * 60 * 1000);
  });
});

describe('login', () => {
  it('posts { password } and caches the Set-Cookie session', async () => {
    let body = '';
    const fetchFn = loginResponder(['session=abc; Path=/; HttpOnly; Max-Age=3600'], { onBody: (b) => { body = b; } });
    const session = await login({ baseUrl: 'https://r', getPassword: pw('pw') }, { fetchFn, now: () => 5000, cacheDir: dir });
    expect(session?.cookie).toBe('session=abc');
    expect(JSON.parse(body)).toEqual({ password: 'pw' }); // no email sent when none configured
    // getSession serves it from cache without another login.
    const cached = await getSession(null, { cacheDir: dir, now: () => 6000, fetchFn: (() => { throw new Error('no fetch'); }) as unknown as typeof fetch });
    expect(cached).toBe('session=abc');
  });

  it('includes email in the body when configured', async () => {
    let body = '';
    const fetchFn = loginResponder(['session=abc'], { onBody: (b) => { body = b; } });
    await login({ baseUrl: 'https://r', email: 'me@x.com', getPassword: pw('pw') }, { fetchFn, cacheDir: dir });
    expect(JSON.parse(body)).toEqual({ email: 'me@x.com', password: 'pw' });
  });

  it('does not call the server when the password source yields nothing', async () => {
    let fetched = false;
    const fetchFn = (async () => { fetched = true; return { ok: true, status: 200, headers: { getSetCookie: () => ['s=a'], get: () => null }, json: async () => ({}) }; }) as unknown as typeof fetch;
    expect(await login({ baseUrl: 'https://r', getPassword: async () => null }, { fetchFn, cacheDir: dir })).toBeNull();
    expect(fetched).toBe(false);
  });

  it('returns null when login succeeds but sets no cookie', async () => {
    const fetchFn = loginResponder([], { ok: true, status: 200 });
    expect(await login({ baseUrl: 'https://r', getPassword: pw('pw') }, { fetchFn, cacheDir: dir })).toBeNull();
  });

  it('returns null (silent) on a non-200 login', async () => {
    const fetchFn = loginResponder(['session=abc'], { ok: false, status: 401 });
    expect(await login({ baseUrl: 'https://r', getPassword: pw('bad') }, { fetchFn, cacheDir: dir })).toBeNull();
  });
});

describe('runPasswordCommand', () => {
  it('returns the trimmed stdout of the command', async () => {
    expect(await runPasswordCommand("printf 'sekret\\n'")).toBe('sekret');
  });
  it('returns null when the command fails', async () => {
    expect(await runPasswordCommand('exit 3')).toBeNull();
  });
});

describe('getSession', () => {
  it('logs in when there is no cache, then reuses the cached cookie', async () => {
    let logins = 0;
    const fetchFn = (async () => { logins++; return { ok: true, status: 200, headers: { getSetCookie: () => ['session=fresh; Max-Age=3600'], get: () => null }, json: async () => ({}) }; }) as unknown as typeof fetch;
    const creds = { baseUrl: 'https://r', getPassword: pw('pw') };
    expect(await getSession(creds, { fetchFn, cacheDir: dir, now: () => 1000 })).toBe('session=fresh');
    expect(await getSession(creds, { fetchFn, cacheDir: dir, now: () => 2000 })).toBe('session=fresh');
    expect(logins).toBe(1);
  });

  it('re-logins when the cached session is past expiry', async () => {
    await writeFile(join(dir, 'router-session.json'), JSON.stringify({ cookie: 'session=old', expiresAt: 10_000 }));
    const fetchFn = loginResponder(['session=new; Max-Age=3600']);
    expect(await getSession({ baseUrl: 'https://r', getPassword: pw('pw') }, { fetchFn, cacheDir: dir, now: () => 20_000 })).toBe('session=new');
  });

  it('returns null when no credentials are configured', async () => {
    expect(await getSession(null, { cacheDir: dir })).toBeNull();
  });
});

describe('routerCreds', () => {
  it('resolves the password from env when config is empty', async () => {
    process.env.MDD_ROUTER_PASSWORD = 'envpw';
    const creds = routerCreds({})!;
    expect(creds.baseUrl).toBe('https://ai-router.mdd.co.id');
    expect(await creds.getPassword()).toBe('envpw');
  });

  it('prefers a vault command over env and stored password', async () => {
    process.env.MDD_ROUTER_PASSWORD = 'envpw';
    const creds = routerCreds({ routerPassword: 'cfgpw', routerPasswordCommand: "printf 'from-vault'" })!;
    expect(await creds.getPassword()).toBe('from-vault');
  });

  it('falls back to the stored password, and returns null when nothing is configured', async () => {
    const creds = routerCreds({ routerBaseUrl: 'https://r', routerPassword: 'cfgpw' })!;
    expect(creds.baseUrl).toBe('https://r');
    expect(await creds.getPassword()).toBe('cfgpw');
    expect(routerCreds({})).toBeNull();
  });
});
