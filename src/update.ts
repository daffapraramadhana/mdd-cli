// src/update.ts
// A throttled, non-blocking "a newer version is on npm" check. Reads the latest published
// version from the npm registry at most once per TTL (cached in the config dir), compares it
// to the running version, and returns whether an update is available. Silent on any failure —
// offline, timeout, non-200, bad JSON, or a corrupt cache all resolve to null, never an error.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { configDir } from './config/index.js';

const REGISTRY_URL = 'https://registry.npmjs.org/mdd-cli/latest';
const TTL_MS = 24 * 60 * 60 * 1000; // check npm at most once a day
const TIMEOUT_MS = 2000;

export interface UpdateInfo { latest: string; current: string; stale: boolean; }

/** True if semver `a` is strictly greater than `b` (numeric x.y.z; pre-release tags ignored). */
export function semverGt(a: string, b: string): boolean {
  const parse = (v: string): number[] => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

interface Cache { latest: string; checkedAt: number; }

async function readCache(path: string): Promise<Cache | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Cache;
    return typeof parsed.latest === 'string' && typeof parsed.checkedAt === 'number' ? parsed : null;
  } catch { return null; }
}

async function writeCache(path: string, cache: Cache): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache));
  } catch { /* cache is best-effort; ignore write failures */ }
}

export interface CheckDeps {
  fetchFn?: typeof fetch;
  cacheDir?: string;
  now?: () => number;
}

/**
 * Check npm for a newer published version. Uses a cached result while it is fresher than TTL,
 * otherwise fetches (with a short timeout) and rewrites the cache. Returns null on any failure
 * or when disabled via MDD_NO_UPDATE_CHECK — callers should treat null as "no notice".
 */
export async function checkForUpdate(current: string, deps: CheckDeps = {}): Promise<UpdateInfo | null> {
  if (process.env.MDD_NO_UPDATE_CHECK) return null;
  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetchFn ?? fetch;
  const cachePath = join(deps.cacheDir ?? configDir(), 'update-check.json');

  const cached = await readCache(cachePath);
  let latest = cached && now() - cached.checkedAt < TTL_MS ? cached.latest : undefined;

  if (latest === undefined) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
      const res = await fetchFn(REGISTRY_URL, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = (await res.json()) as { version?: string };
      if (!body.version) return null;
      latest = body.version;
      await writeCache(cachePath, { latest, checkedAt: now() });
    } catch { return null; }
  }

  return { latest, current, stale: semverGt(latest, current) };
}
