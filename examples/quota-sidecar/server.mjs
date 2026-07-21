// quota-sidecar — a tiny service that lets mdd-cli show 9router quota using each
// user's model API key, WITHOUT putting the dashboard password on user machines.
//
// Flow for GET /api/usage/me:
//   1. Read the caller's 9router API key from the Authorization: Bearer header.
//   2. Validate it against 9router's model API (GET /v1/models) — proves it's a real key.
//   3. Log into the dashboard SERVER-SIDE with a service-account password (kept only here),
//      caching the session cookie.
//   4. Fetch the account's connections + per-connection usage, assemble the shape mdd wants.
//   5. Return { connections: [...] }, cached briefly so many users ≈ one dashboard hit.
//
// The dashboard password lives ONLY in this process's env (put it in your host's secret
// manager). Users authenticate with their own API key — no shared secret is distributed.
//
// Run:  DASHBOARD_URL=… DASHBOARD_PASSWORD=… API_URL=…/v1 node server.mjs
// Node 20+ (built-in fetch + Headers.getSetCookie). No dependencies.

import { createServer } from 'node:http';

const {
  PORT = '8080',
  DASHBOARD_URL = 'https://ai-router.mdd.co.id',       // where /api/auth/login + /api/usage live
  API_URL = 'https://ai-router.mdd.co.id/v1',           // OpenAI-compatible base, for key validation
  DASHBOARD_EMAIL = '',                                 // optional; some deployments need email + password
  DASHBOARD_PASSWORD,                                   // REQUIRED — service-account password (secret)
  QUOTA_TTL_MS = '30000',                               // cache assembled quota this long
  KEY_TTL_MS = '300000',                                // cache a key's validity this long
} = process.env;

if (!DASHBOARD_PASSWORD) { console.error('DASHBOARD_PASSWORD is required'); process.exit(1); }

const base = DASHBOARD_URL.replace(/\/+$/, '');
const apiBase = API_URL.replace(/\/+$/, '');

// --- tiny caches -----------------------------------------------------------
let session = null;                 // { cookie, expiresAt }
let quotaCache = null;              // { body, expiresAt }
const keyCache = new Map();        // apiKey -> expiresAt (validated-until)

const now = () => Date.now();

// --- validate the caller's API key against the model API -------------------
async function keyIsValid(apiKey) {
  const cachedUntil = keyCache.get(apiKey);
  if (cachedUntil && cachedUntil > now()) return true;
  try {
    const res = await fetch(`${apiBase}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (res.ok) { keyCache.set(apiKey, now() + Number(KEY_TTL_MS)); return true; }
    return false;
  } catch { return false; }
}

// --- server-side dashboard session (login with the service password) -------
function cookieHeaderFrom(setCookies) {
  const pairs = setCookies.map((c) => c.split(';')[0].trim()).filter(Boolean);
  return pairs.length ? pairs.join('; ') : null;
}
function sessionExpiry(setCookies) {
  let soonest = Infinity;
  for (const c of setCookies) {
    const maxAge = /max-age=(\d+)/i.exec(c);
    const expires = /expires=([^;]+)/i.exec(c);
    if (maxAge) soonest = Math.min(soonest, now() + Number(maxAge[1]) * 1000);
    else if (expires) { const t = Date.parse(expires[1]); if (!Number.isNaN(t)) soonest = Math.min(soonest, t); }
  }
  return Number.isFinite(soonest) ? soonest : now() + 6 * 60 * 60 * 1000; // 6h default
}
async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(DASHBOARD_EMAIL ? { email: DASHBOARD_EMAIL, password: DASHBOARD_PASSWORD } : { password: DASHBOARD_PASSWORD }),
  });
  if (!res.ok) throw new Error(`dashboard login failed: ${res.status}`);
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookie = cookieHeaderFrom(setCookies);
  if (!cookie) throw new Error('dashboard login returned no session cookie');
  session = { cookie, expiresAt: sessionExpiry(setCookies) };
  return session.cookie;
}
async function getCookie() {
  if (session && session.expiresAt - 30_000 > now()) return session.cookie;
  return login();
}

// --- fetch + assemble quota (two-step, cookie-authenticated) ---------------
async function dget(path, cookie) {
  const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json', cookie } });
  if (res.status === 401) return { retry: true };
  return { body: res.ok ? await res.json() : null };
}
async function fetchQuota() {
  if (quotaCache && quotaCache.expiresAt > now()) return quotaCache.body;

  let cookie = await getCookie();
  const listPath = '/api/providers/client?page=1&pageSize=50&accountStatus=all&sort=priority';
  let list = await dget(listPath, cookie);
  if (list.retry) { cookie = await login(); list = await dget(listPath, cookie); } // session expired → re-login once

  const connections = [];
  for (const c of list.body?.connections ?? []) {
    if (!c?.id) continue;
    const usage = await dget(`/api/usage/${c.id}`, cookie);
    connections.push({
      id: c.id,
      provider: c.provider,
      name: c.name ?? c.email ?? c.id,
      testStatus: c.testStatus,
      limitReached: !!usage.body?.limitReached,
      quotas: usage.body?.quotas ?? {},
    });
  }
  const body = { connections };
  quotaCache = { body, expiresAt: now() + Number(QUOTA_TTL_MS) };
  return body;
}

// --- http ------------------------------------------------------------------
const bearer = (req) => (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
  if (req.method !== 'GET' || path !== '/api/usage/me') return json(res, 404, { error: 'not found' });

  const key = bearer(req);
  if (!key) return json(res, 401, { error: 'missing api key' });
  if (!(await keyIsValid(key))) return json(res, 401, { error: 'invalid api key' });

  try {
    return json(res, 200, await fetchQuota());
  } catch (err) {
    return json(res, 502, { error: String(err?.message || err) });
  }
}).listen(Number(PORT), () => console.log(`quota-sidecar on :${PORT} → ${base}`));
