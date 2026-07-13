// Pure image-attachment helpers for the prompt. No React/Ink/fs imports — the caller injects a
// file reader — so this is fully unit-testable. Detects an image-file path inserted as a chunk
// (drag/paste), formats the `[Image #n: name]` chip, and encodes files to base64 image blocks.
import { basename, extname } from 'node:path';
import type { ImageBlock } from '../types.js';
import { detectPaste } from './paste.js';

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface AttachState { map: Map<number, string>; count: number; }
export function createAttachState(): AttachState { return { map: new Map(), count: 0 }; }

/** Strip matching surrounding quotes and unescape "\ " → " " (how terminals insert dragged paths). */
export function dequotePath(chunk: string): string {
  let s = chunk.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\ /g, ' ');
}

export function isImagePath(chunk: string): boolean {
  if (chunk.includes('\n')) return false;
  const lower = dequotePath(chunk).toLowerCase();
  return IMAGE_EXTS.some((e) => lower.endsWith(e));
}

export function mediaTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  return 'image/webp';
}

export function imageLabel(n: number, path: string): string {
  return `[Image #${n}: ${basename(path)}]`;
}

export function stripImageTokens(display: string): string {
  return display.replace(/\[Image #\d+: [^\]]*\]/g, '');
}

/** If the pure insertion prev→next is an image path, return its position + dequoted path. */
export function detectImageInsert(prev: string, next: string): { path: string; at: number; len: number } | null {
  const d = detectPaste(prev, next);
  if (!d) return null;
  if (!isImagePath(d.inserted.trim())) return null;
  return { path: dequotePath(d.inserted.trim()), at: d.at, len: d.inserted.length };
}

/** Read + base64-encode each path with an INJECTED reader. Oversize/unreadable → an error string. */
export function attachImages(
  paths: string[],
  read: (path: string) => Uint8Array,
): { blocks: ImageBlock[]; errors: string[] } {
  const blocks: ImageBlock[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    try {
      const bytes = read(p);
      if (bytes.length > MAX_IMAGE_BYTES) {
        errors.push(`could not attach ${basename(p)}: larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB`);
        continue;
      }
      blocks.push({ type: 'image', mediaType: mediaTypeFor(p), data: Buffer.from(bytes).toString('base64') });
    } catch (err) {
      errors.push(`could not attach ${basename(p)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { blocks, errors };
}
