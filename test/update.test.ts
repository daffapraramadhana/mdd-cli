import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { semverGt, checkForUpdate } from '../src/update.js';

describe('semverGt', () => {
  it('compares numeric semver parts', () => {
    expect(semverGt('0.4.0', '0.3.0')).toBe(true);
    expect(semverGt('0.3.1', '0.3.0')).toBe(true);
    expect(semverGt('1.0.0', '0.9.9')).toBe(true);
    expect(semverGt('0.3.0', '0.3.0')).toBe(false);
    expect(semverGt('0.3.0', '0.4.0')).toBe(false);
  });
  it('ignores pre-release tags and uneven lengths', () => {
    expect(semverGt('0.3.0-beta.1', '0.3.0')).toBe(false);
    expect(semverGt('0.3', '0.3.0')).toBe(false);
    expect(semverGt('0.3.1', '0.3')).toBe(true);
  });
});

describe('checkForUpdate', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-upd-')); delete process.env.MDD_NO_UPDATE_CHECK; });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  const okFetch = (version: string) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ version }) }) as unknown as Response);

  it('fetches when there is no cache, writes the cache, and reports stale', async () => {
    const fetchFn = okFetch('0.4.0');
    const info = await checkForUpdate('0.3.0', { fetchFn, cacheDir: dir, now: () => 1000 });
    expect(info).toEqual({ latest: '0.4.0', current: '0.3.0', stale: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const cache = JSON.parse(await readFile(join(dir, 'update-check.json'), 'utf8'));
    expect(cache).toEqual({ latest: '0.4.0', checkedAt: 1000 });
  });

  it('reports not-stale when the latest equals the current', async () => {
    const info = await checkForUpdate('0.4.0', { fetchFn: okFetch('0.4.0'), cacheDir: dir, now: () => 1 });
    expect(info).toEqual({ latest: '0.4.0', current: '0.4.0', stale: false });
  });

  it('uses a fresh cache without fetching', async () => {
    await writeFile(join(dir, 'update-check.json'), JSON.stringify({ latest: '0.5.0', checkedAt: 1000 }));
    const fetchFn = okFetch('9.9.9');
    // now is only 1h past checkedAt (< 24h TTL) → cache is fresh
    const info = await checkForUpdate('0.3.0', { fetchFn, cacheDir: dir, now: () => 1000 + 3_600_000 });
    expect(info).toEqual({ latest: '0.5.0', current: '0.3.0', stale: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('re-fetches when the cache is older than the TTL', async () => {
    await writeFile(join(dir, 'update-check.json'), JSON.stringify({ latest: '0.5.0', checkedAt: 0 }));
    const fetchFn = okFetch('0.6.0');
    const info = await checkForUpdate('0.3.0', { fetchFn, cacheDir: dir, now: () => 25 * 3_600_000 });
    expect(info?.latest).toBe('0.6.0');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns null on a network error', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline'); });
    expect(await checkForUpdate('0.3.0', { fetchFn, cacheDir: dir, now: () => 0 })).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response);
    expect(await checkForUpdate('0.3.0', { fetchFn, cacheDir: dir, now: () => 0 })).toBeNull();
  });

  it('returns null when disabled via MDD_NO_UPDATE_CHECK', async () => {
    process.env.MDD_NO_UPDATE_CHECK = '1';
    const fetchFn = okFetch('0.4.0');
    expect(await checkForUpdate('0.3.0', { fetchFn, cacheDir: dir, now: () => 0 })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
