import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionStore,
  projectSlug,
  makeSessionId,
  truncateTitle,
  type SessionRecord,
} from '../src/session.js';
import type { Message } from '../src/types.js';
import type { TranscriptItem } from '../src/ui/store.js';

const msg = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });
const transcript: TranscriptItem[] = [
  { kind: 'user', text: 'hi' },
  { kind: 'assistant', text: 'hello' },
];

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'id-1',
    cwd: '/home/me/proj',
    createdAt: 1000,
    updatedAt: 2000,
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    title: 'first message',
    messages: [msg('hi')],
    transcript,
    ...over,
  };
}

describe('session helpers', () => {
  it('projectSlug replaces non-alphanumerics with dashes', () => {
    expect(projectSlug('/home/me/proj')).toBe('-home-me-proj');
    expect(projectSlug('C:\\Users\\me')).toBe('C--Users-me');
  });

  it('makeSessionId combines timestamp and random', () => {
    expect(makeSessionId(1700000000000, 'abc123')).toBe('1700000000000-abc123');
  });

  it('truncateTitle takes the first line and caps length with an ellipsis', () => {
    expect(truncateTitle('one line')).toBe('one line');
    expect(truncateTitle('first line\nsecond line')).toBe('first line');
    const long = 'x'.repeat(200);
    const t = truncateTitle(long);
    expect(t.length).toBeLessThanOrEqual(61); // ~60 + ellipsis
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('SessionStore', () => {
  let base: string;
  let store: SessionStore;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'mdd-sessions-'));
    store = new SessionStore(base);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('roundtrips save → list → load', async () => {
    const r = record();
    await store.save(r);

    const summaries = await store.list(r.cwd);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt,
      model: r.model,
      messageCount: 1,
    });

    const loaded = await store.load(r.cwd, r.id);
    expect(loaded).toEqual(r);
  });

  it('never writes a session with zero messages', async () => {
    await store.save(record({ messages: [] }));
    expect(await store.list('/home/me/proj')).toEqual([]);
  });

  it('mostRecent returns the highest updatedAt record', async () => {
    await store.save(record({ id: 'a', updatedAt: 1000 }));
    await store.save(record({ id: 'b', updatedAt: 3000 }));
    await store.save(record({ id: 'c', updatedAt: 2000 }));
    const r = await store.mostRecent('/home/me/proj');
    expect(r?.id).toBe('b');
  });

  it('list is newest-first', async () => {
    await store.save(record({ id: 'a', updatedAt: 1000 }));
    await store.save(record({ id: 'b', updatedAt: 3000 }));
    await store.save(record({ id: 'c', updatedAt: 2000 }));
    const ids = (await store.list('/home/me/proj')).map((s) => s.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('skips corrupt files in list without throwing', async () => {
    const r = record();
    await store.save(r);
    const dir = join(base, projectSlug(r.cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'broken.json'), '{ not valid json');
    const summaries = await store.list(r.cwd);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe(r.id);
  });

  it('load returns null for a missing session', async () => {
    expect(await store.load('/home/me/proj', 'nope')).toBeNull();
  });

  it('list returns [] for a project with no sessions', async () => {
    expect(await store.list('/never/used')).toEqual([]);
  });

  it('keeps different cwds isolated', async () => {
    await store.save(record({ id: 'a', cwd: '/proj/one' }));
    await store.save(record({ id: 'b', cwd: '/proj/two' }));
    expect((await store.list('/proj/one')).map((s) => s.id)).toEqual(['a']);
    expect((await store.list('/proj/two')).map((s) => s.id)).toEqual(['b']);
  });
});
