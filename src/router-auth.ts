// src/router-auth.ts
// Authenticates to the 9router dashboard for the quota indicator. The dashboard
// uses a COOKIE SESSION: POST /api/auth/login returns `{ success: true }` and a
// Set-Cookie header; that cookie authenticates the subsequent /api/* calls.
//
// Credentials are read from config/env by the caller — never hardcoded here or
// written to the repo. The session cookie is cached (with its expiry) in the
// config dir at 0600 and reused until it expires or a request returns 401, at
// which point we log in again. Lazy + reactive refresh: no login per request, no
// login on a timer.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { configDir } from './config/index.js';
import { DEFAULT_ROUTER_URL } from './quota.js';

const pexec = promisify(exec);

const TIMEOUT_MS = 5000;
const CMD_TIMEOUT_MS = 5000;
const EXPIRY_SKEW_MS = 30_000;              // treat a session as expired 30s early
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;  // fallback lifetime when the cookie sets no expiry

// The password is fetched from its source (vault command / env / config) only at
// login time, so the secret is never held in memory for the whole session.
export interface RouterCreds { baseUrl: string; email?: string; getPassword: () => Promise<string | null>; }
export interface Session { cookie: string; expiresAt: number; } // cookie = "name=value; name2=value2"

export interface AuthDeps { fetchFn?: typeof fetch; now?: () => number; cacheDir?: string; }

function cachePath(dir?: string): string { return join(dir ?? configDir(), 'router-session.json'); }

async function readCache(dir: string | undefined, now: () => number): Promise<Session | null> {
  try {
    const s = JSON.parse(await readFile(cachePath(dir), 'utf8')) as Session;
    if (typeof s.cookie === 'string' && s.cookie && typeof s.expiresAt === 'number' && s.expiresAt - EXPIRY_SKEW_MS > now()) return s;
  } catch { /* missing / corrupt cache → treat as no session */ }
  return null;
}

async function writeCache(s: Session, dir?: string): Promise<void> {
  try {
    await mkdir(dirname(cachePath(dir)), { recursive: true });
    await writeFile(cachePath(dir), JSON.stringify(s), { mode: 0o600 });
  } catch { /* cache is best-effort */ }
}

/** Read the Set-Cookie list off a response, tolerant of the getSetCookie() API vs a single header. */
function readSetCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

/** Collapse Set-Cookie strings into a `name=value; name2=value2` Cookie header value. */
export function cookieHeaderFrom(setCookies: string[]): string | null {
  const pairs = setCookies.map((c) => c.split(';')[0].trim()).filter(Boolean);
  return pairs.length ? pairs.join('; ') : null;
}

/** Soonest expiry across the cookies (Max-Age / Expires), or a default TTL when none say. */
export function sessionExpiry(setCookies: string[], now: number): number {
  let soonest = Number.POSITIVE_INFINITY;
  for (const c of setCookies) {
    const maxAge = /max-age=(\d+)/i.exec(c);
    const expires = /expires=([^;]+)/i.exec(c);
    if (maxAge) soonest = Math.min(soonest, now + parseInt(maxAge[1], 10) * 1000);
    else if (expires) { const t = Date.parse(expires[1]); if (!Number.isNaN(t)) soonest = Math.min(soonest, t); }
  }
  return Number.isFinite(soonest) ? soonest : now + DEFAULT_TTL_MS;
}

/** POST credentials to /api/auth/login, cache and return the session cookie, or null on failure. */
export async function login(creds: RouterCreds, deps: AuthDeps = {}): Promise<Session | null> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    const password = await creds.getPassword();
    if (!password) { clearTimeout(timer); return null; }
    const res = await fetchFn(`${creds.baseUrl.replace(/\/+$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(creds.email ? { email: creds.email, password } : { password }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const setCookies = readSetCookies(res);
    const cookie = cookieHeaderFrom(setCookies);
    if (!cookie) return null; // login "succeeded" but gave us no session cookie → can't authenticate
    const session: Session = { cookie, expiresAt: sessionExpiry(setCookies, now()) };
    await writeCache(session, deps.cacheDir);
    return session;
  } catch { return null; }
}

/** A valid session cookie: cached if still fresh, otherwise a fresh login. Null if no creds / failure. */
export async function getSession(creds: RouterCreds | null, deps: AuthDeps = {}): Promise<string | null> {
  const now = deps.now ?? Date.now;
  const cached = await readCache(deps.cacheDir, now);
  if (cached) return cached.cookie;
  if (!creds) return null;
  return (await login(creds, deps))?.cookie ?? null;
}

/** Run a vault command and return its stdout (trimmed) as the password, or null on failure. */
export async function runPasswordCommand(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await pexec(cmd, { timeout: CMD_TIMEOUT_MS, maxBuffer: 1 << 20 });
    return String(stdout).trim() || null;
  } catch { return null; }
}

export interface RouterCredConfig {
  routerBaseUrl?: string;
  routerEmail?: string;
  routerPassword?: string;
  /** Command whose stdout is the password (e.g. `op read op://…`); preferred over a stored password. */
  routerPasswordCommand?: string;
}

/**
 * A password source, resolved lazily at login time. Order of preference:
 *   1. a vault command (config `routerPasswordCommand` or $MDD_ROUTER_PASSWORD_CMD)
 *   2. $MDD_ROUTER_PASSWORD
 *   3. config `routerPassword`
 * Returns null when nothing is configured.
 */
function passwordSource(cfg: RouterCredConfig): (() => Promise<string | null>) | null {
  const cmd = cfg.routerPasswordCommand ?? process.env.MDD_ROUTER_PASSWORD_CMD;
  if (cmd) return () => runPasswordCommand(cmd);
  const envPw = process.env.MDD_ROUTER_PASSWORD;
  if (envPw) return () => Promise.resolve(envPw);
  if (cfg.routerPassword) { const pw = cfg.routerPassword; return () => Promise.resolve(pw); }
  return null;
}

/** Build router credentials from config/env, or null when no password source is configured. */
export function routerCreds(cfg: RouterCredConfig): RouterCreds | null {
  const getPassword = passwordSource(cfg);
  if (!getPassword) return null;
  return {
    baseUrl: cfg.routerBaseUrl ?? process.env.MDD_ROUTER_URL ?? DEFAULT_ROUTER_URL,
    email: cfg.routerEmail ?? process.env.MDD_ROUTER_EMAIL,
    getPassword,
  };
}
