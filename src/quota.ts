// src/quota.ts
// Fetches the 9router account's subscription quota (usage + reset time) for the
// status-bar indicator. Two-step, mirroring the dashboard:
//   1. GET /api/providers/client        → the list of provider connections (subs)
//   2. GET /api/usage/{id}              → that sub's quota windows + resetAt
// Non-blocking and silent on any failure (offline, timeout, non-200, auth, bad
// JSON) — every failure path resolves to null so it can never break the REPL.
// Disable entirely with MDD_NO_QUOTA.

// Where the quota endpoint (GET /api/usage/me) lives by default — the mdd-ai-router
// sidecar. Override per-user with MDD_ROUTER_URL / routerBaseUrl.
export const DEFAULT_QUOTA_URL = 'http://192.168.7.8:8080';
// The 9router dashboard origin — used only by the admin cookie-login fallback.
export const DEFAULT_ROUTER_URL = 'https://ai-router.mdd.co.id';
const TIMEOUT_MS = 3000;

export interface QuotaWindow {
  name: string;        // "session" | "weekly" | …
  used: number;
  total: number;
  remaining: number;
  resetAt: string;     // ISO timestamp the window resets
  unlimited: boolean;
}

export interface ConnectionQuota {
  id: string;
  provider: string;    // "claude" | "codex"
  name: string;        // account email / label
  active: boolean;     // isActive && testStatus === "active"
  limitReached: boolean;
  windows: QuotaWindow[];
}

export interface QuotaSummary { connections: ConnectionQuota[]; fetchedAt: number; }

export interface QuotaDeps {
  /** Router dashboard origin; defaults to $MDD_ROUTER_URL or ai-router.mdd.co.id. */
  baseUrl?: string;
  /** Model API key (the same one used for inference). Primary auth: a single GET /api/usage/me. */
  apiKey?: string;
  /** Session cookie (`name=value; …`) from the dashboard login — admin fallback (see router-auth). */
  cookie?: string;
  /** Called on a 401 to obtain a fresh session cookie; the request is retried once with it. */
  reauth?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}

/** Fetch and normalize the account's quota, or null on any failure / when disabled. */
export async function fetchQuota(deps: QuotaDeps = {}): Promise<QuotaSummary | null> {
  if (process.env.MDD_NO_QUOTA) return null;
  const baseUrl = (deps.baseUrl ?? process.env.MDD_ROUTER_URL ?? DEFAULT_QUOTA_URL).replace(/\/+$/, '');
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;

  const httpGet = async (path: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
      deps.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
      const res = await fetchFn(`${baseUrl}${path}`, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal });
      clearTimeout(timer);
      return { status: res.status, body: res.ok ? await res.json() : null };
    } catch { return { status: 0, body: null }; }
  };

  // Primary: a single call authenticated by the model API key — no dashboard login,
  // no per-user setup. Returns the account's connections with quotas embedded.
  if (deps.apiKey) {
    const me = await httpGet('/api/usage/me', { authorization: `Bearer ${deps.apiKey}` });
    const conns = (me.body as { connections?: RawConnection[] } | null)?.connections;
    if (conns?.length) return { connections: conns.map(toConnection), fetchedAt: now() };
    // 404 (route not deployed yet) / 401 / empty → fall through to the cookie fallback.
  }

  // Fallback: dashboard cookie session (two-step). For admins before /api/usage/me exists.
  if (!deps.cookie && !deps.reauth) return null;
  let cookie = deps.cookie;
  const getViaCookie = async (path: string): Promise<unknown | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await httpGet(path, cookie ? { cookie } : {});
      if (r.status === 401 && deps.reauth && attempt === 0) {
        cookie = (await deps.reauth()) ?? undefined;
        if (!cookie) return null;
        continue;
      }
      return r.body;
    }
    return null;
  };

  const list = (await getViaCookie('/api/providers/client?page=1&pageSize=50&accountStatus=all&sort=priority')) as
    | { connections?: RawConnection[] }
    | null;
  if (!list?.connections?.length) return null;

  const connections: ConnectionQuota[] = [];
  for (const c of list.connections) {
    if (!c?.id) continue;
    const usage = (await getViaCookie(`/api/usage/${c.id}`)) as RawUsage | null;
    connections.push(toConnection({ ...c, limitReached: usage?.limitReached, quotas: usage?.quotas }));
  }
  return { connections, fetchedAt: now() };
}

interface RawConnection {
  id?: string;
  provider?: string;
  name?: string | null;
  email?: string | null;
  isActive?: boolean;
  testStatus?: string;
  limitReached?: boolean;
  quotas?: Record<string, { used?: number; total?: number; remaining?: number; resetAt?: string; unlimited?: boolean }>;
}
interface RawUsage {
  limitReached?: boolean;
  quotas?: Record<string, { used?: number; total?: number; remaining?: number; resetAt?: string; unlimited?: boolean }>;
}

/** Normalize a raw connection (from /api/usage/me or the two-step fallback) into a ConnectionQuota. */
function toConnection(c: RawConnection): ConnectionQuota {
  return {
    id: c.id ?? '',
    provider: c.provider ?? 'unknown',
    name: c.name ?? c.email ?? c.id ?? '',
    active: c.isActive !== false && (c.testStatus === undefined || c.testStatus === 'active'),
    limitReached: !!c.limitReached,
    windows: c.quotas
      ? Object.entries(c.quotas).map(([name, q]) => ({
          name,
          used: q.used ?? 0,
          total: q.total ?? 0,
          remaining: q.remaining ?? 0,
          resetAt: q.resetAt ?? '',
          unlimited: !!q.unlimited,
        }))
      : [],
  };
}

/** Map an mdd/9router model id to its provider (cc/* → claude, cx/* → codex). */
export function providerForModel(model: string): 'claude' | 'codex' | null {
  if (model.startsWith('cc/')) return 'claude';
  if (model.startsWith('cx/')) return 'codex';
  return null;
}

/** Compact "5d 21h" / "3h 28m" / "44m" / "now" for a remaining-ms countdown. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface QuotaLine { text: string; warn: boolean; }

/**
 * Build the status-bar line for the connection backing `model`, picking that
 * provider's soonest-resetting window. Returns null when the model isn't a 9router
 * model, there's no matching connection, or there's no usable window to show.
 */
export function formatQuota(summary: QuotaSummary | null, model: string, now: number = Date.now()): QuotaLine | null {
  if (!summary) return null;
  const provider = providerForModel(model);
  if (!provider) return null;

  const conns = summary.connections.filter((c) => c.provider === provider);
  if (!conns.length) return null;
  const conn = conns.find((c) => c.active) ?? conns[0];

  const windows = conn.windows
    .filter((w) => !w.unlimited && w.resetAt)
    .sort((a, b) => Date.parse(a.resetAt) - Date.parse(b.resetAt));
  const soonest = windows[0];

  if (conn.limitReached) {
    const when = soonest ? ` · resets ${formatCountdown(Date.parse(soonest.resetAt) - now)}` : '';
    return { text: `⚠ ${provider} limit reached${when}`, warn: true };
  }
  if (!soonest) return null;

  const pct = soonest.total ? Math.round((soonest.used / soonest.total) * 100) : 0;
  return {
    text: `${provider} ${soonest.name} ${soonest.used}/${soonest.total} · resets ${formatCountdown(Date.parse(soonest.resetAt) - now)}`,
    warn: pct >= 90,
  };
}
