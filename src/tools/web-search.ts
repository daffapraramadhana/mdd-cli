import { z } from 'zod';
import type { Tool } from './types.js';
import type { Config } from '../config/index.js';
import { truncate } from './registry.js';

const schema = z.object({
  query: z.string().describe('The search query'),
  search_type: z.enum(['web', 'news']).default('web').describe('Search category: web or news'),
  max_results: z.number().int().default(5).describe('How many results to return (1-10)'),
});

interface SearchResult { title?: string; url?: string; snippet?: string; }

/** 9router search backend model. SearXNG is self-hosted; tavily is the managed backend. */
const SEARCH_MODEL = 'tavily';

/** Derive the web-search context from stored 9router credentials. */
export function webCtxFromConfig(config: Config): { searchEndpoint?: string; apiKey?: string } {
  const base = config.openaiBaseUrl?.replace(/\/+$/, '');
  return {
    ...(base ? { searchEndpoint: `${base}/search` } : {}),
    ...(config.openaiApiKey ? { apiKey: config.openaiApiKey } : {}),
  };
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web via the 9router search endpoint. Returns titles, URLs, and snippets. Requires confirmation.',
  inputSchema: schema,
  mutating: true,
  handler: async (input, ctx) => {
    try {
      const { query, search_type, max_results } = schema.parse(input);
      const endpoint = ctx.web?.searchEndpoint;
      if (!endpoint) {
        return { content: 'web_search needs a 9router endpoint. Configure the openai provider base URL (run setup) or switch provider.', isError: true };
      }
      const n = Math.min(10, Math.max(1, max_results));
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ctx.web?.apiKey ? { Authorization: `Bearer ${ctx.web.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: SEARCH_MODEL, query, search_type, max_results: n }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { content: `Search failed: HTTP ${res.status} ${res.statusText}`, isError: true };
      const data = (await res.json()) as { results?: SearchResult[] };
      const results = data.results ?? [];
      if (results.length === 0) return { content: '(no results)', isError: false };
      const text = results
        .map((r, i) => `${i + 1}. ${r.title ?? '(untitled)'}\n   ${r.url ?? ''}\n   ${r.snippet ?? ''}`)
        .join('\n\n');
      return { content: truncate(text), isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
