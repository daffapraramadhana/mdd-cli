import { z } from 'zod';
import type { Tool } from './types.js';
import { truncate } from './registry.js';

const schema = z.object({
  url: z.string().describe('The http(s) URL to fetch and read as text'),
});

/** Block loopback / private / link-local hosts to avoid naive SSRF. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch an http(s) URL and return its readable text (HTML stripped to text). Blocks private/localhost addresses. Requires confirmation.',
  inputSchema: schema,
  mutating: true,
  handler: async (input) => {
    try {
      const { url } = schema.parse(input);
      let parsed: URL;
      try { parsed = new URL(url); } catch { return { content: `Invalid URL: ${url}`, isError: true }; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { content: `Unsupported URL scheme: ${parsed.protocol}`, isError: true };
      }
      if (isBlockedHost(parsed.hostname)) {
        return { content: `Refusing to fetch a private/localhost address: ${parsed.hostname}`, isError: true };
      }
      const res = await fetch(url, {
        headers: { 'User-Agent': 'mdd-cli/web_fetch' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { content: `Fetch failed: HTTP ${res.status} ${res.statusText}`, isError: true };
      const ct = res.headers.get('content-type') ?? '';
      const body = await res.text();
      const text = /html/i.test(ct) ? htmlToText(body) : body;
      return { content: truncate(text || '(empty response)'), isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
