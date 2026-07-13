import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from './types.js';
import type { TranscriptItem } from './ui/store.js';

export interface SessionRecord {
  id: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  title: string;
  messages: Message[];
  transcript: TranscriptItem[];
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  model: string;
  messageCount: number;
}

/** Make a cwd safe to use as a directory name. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Sortable, unique session id: `${timestamp}-${rand}`. */
export function makeSessionId(now: number, rand: string): string {
  return `${now}-${rand}`;
}

/** First line of text, capped at ~60 chars with a trailing ellipsis when truncated. */
export function truncateTitle(text: string, max = 60): string {
  const firstLine = text.split('\n', 1)[0].trim();
  if (firstLine.length <= max) return firstLine;
  return firstLine.slice(0, max).trimEnd() + '…';
}

/**
 * Persists REPL sessions as one JSON file per session under `<baseDir>/<project-slug>/<id>.json`.
 * Constructed with a base directory so it is fully unit-testable. No React/Ink imports.
 */
export class SessionStore {
  constructor(private baseDir: string) {}

  private dir(cwd: string): string {
    return join(this.baseDir, projectSlug(cwd));
  }

  /** Atomic write (temp + rename). No-op when the record has no messages. */
  async save(record: SessionRecord): Promise<void> {
    if (!record.messages.length) return;
    const dir = this.dir(record.cwd);
    await mkdir(dir, { recursive: true });
    const finalPath = join(dir, record.id + '.json');
    const tmpPath = finalPath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(record), 'utf8');
    await rename(tmpPath, finalPath);
  }

  /** Newest-first summaries. Missing dir → []. Corrupt/unreadable files are skipped. */
  async list(cwd: string): Promise<SessionSummary[]> {
    const dir = this.dir(cwd);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const summaries: SessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, name), 'utf8');
        const r = JSON.parse(raw) as SessionRecord;
        summaries.push({
          id: r.id,
          title: r.title,
          updatedAt: r.updatedAt,
          model: r.model,
          messageCount: r.messages.length,
        });
      } catch {
        // skip corrupt/unreadable files
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
  }

  /** Load one session by id, or null on any error (missing/corrupt). */
  async load(cwd: string, id: string): Promise<SessionRecord | null> {
    try {
      const raw = await readFile(join(this.dir(cwd), id + '.json'), 'utf8');
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  /** The most recently updated session for a project, or null if none. */
  async mostRecent(cwd: string): Promise<SessionRecord | null> {
    const summaries = await this.list(cwd);
    if (!summaries.length) return null;
    return this.load(cwd, summaries[0].id);
  }
}
