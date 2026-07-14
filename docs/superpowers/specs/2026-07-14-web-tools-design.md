# Web tools: `web_search` + `web_fetch`

**Date:** 2026-07-14
**Status:** Approved (design)

## Goal

Give the mdd agent reach beyond the local machine: let it search the web and read
web pages. Two tools, split by concern so the fetch path stays dependency- and
key-free while search rides on infrastructure the team already runs.

## Background

mdd's tools are static `Tool` singletons (see `src/tools/`), each with a zod
`inputSchema`, a `mutating` flag, and a `handler(input, ctx)`. Mutating tools pass
through the confirm gate in `src/permissions/index.ts` (ask first, with an
"always allow this session" option). The OpenAI-compatible provider already stores
a 9router base URL (`config.openaiBaseUrl`) and API key (`config.openaiApiKey`) via
the setup wizard.

The 9Router proxy exposes a free, self-hosted **SearXNG** web-search endpoint at
`{openaiBaseUrl}/search`. Routing search through it means zero new config, no
external SaaS, no per-query cost, and queries stay inside MDD infrastructure.

## Tools

### `web_fetch` — read a web page as text

- **Dependency-free:** uses Node's built-in global `fetch()`. No API key.
- **Input schema:**
  - `url` (string, required) — the page to fetch.
- **Behaviour:**
  1. Validate the URL (see SSRF guard). Reject before any network call if it fails.
  2. `fetch(url)` with a short timeout (e.g. 15s via `AbortSignal.timeout`) and a
     normal browser-ish `User-Agent`.
  3. If the `Content-Type` is HTML: strip `<script>` and `<style>` blocks, remove
     remaining tags, decode common HTML entities, collapse runs of whitespace →
     readable text. If it's already text/JSON, pass through as-is.
  4. Run the result through the shared `truncate()` (30k cap) from
     `src/tools/registry.ts`.
- **Errors:** network failure, non-2xx status, or a blocked URL return
  `{ isError: true }` with a short message; never throw.

### `web_search` — search the web via 9Router SearXNG

- **Backed by 9Router:** POST `{openaiBaseUrl}/search`.
  - Headers: `Content-Type: application/json`, `Authorization: Bearer {openaiApiKey}`.
  - Body: `{ model: "searxng", query, search_type, max_results }`.
  - Response: `{ results: [ { title, url, snippet } ] }`.
- **Input schema:**
  - `query` (string, required).
  - `search_type` (enum `web` | `news`, default `web`).
  - `max_results` (int, default 5, clamped to `1..10` to bound token cost).
- **Output:** a compact text block, one entry per result:
  ```
  1. {title}
     {url}
     {snippet}
  ```
  then `truncate()`. Empty results → `"(no results)"`.
- **Missing-endpoint handling:** if the search endpoint or key is unavailable
  (e.g. the user is on the raw Anthropic provider with no 9router configured),
  return a clear, non-throwing message: web_search needs a 9router endpoint —
  run setup / switch provider.

## Wiring

Credentials reach the tool through `ToolContext`, mirroring the existing optional
`ask` field. Add:

```ts
export interface ToolContext {
  cwd: string;
  ask?: (question: string, options?: string[]) => Promise<string>;
  web?: { searchEndpoint?: string; apiKey?: string };
}
```

Where the agent loop builds the `ToolContext`, populate `web` from config:
`searchEndpoint = openaiBaseUrl ? \`${openaiBaseUrl}/search\` : undefined`,
`apiKey = openaiApiKey`. `web_fetch` ignores `ctx.web` entirely.

Both tools are added to `allTools` in `src/tools/index.ts` and picked up by
`buildRegistry()` — no factory needed; they remain static singletons.

The system prompt (`src/system-prompt.ts`) gains one line noting that web tools are
available and require user confirmation.

## Safety

Gating choice: **confirm first, allow-for-session.**

- Both tools set `mutating: true`, so they pass through the existing confirm gate.
  The consent surface shows the URL (`web_fetch`) or the query (`web_search`).
  `formatToolCall` already renders these compactly; no permission-layer change
  beyond the tools existing.
- **SSRF guard (`web_fetch` only):** before fetching, reject
  - non-`http:`/`https:` schemes (blocks `file:`, `ftp:`, etc.), and
  - hosts that are loopback / private / link-local: `localhost`, `127.0.0.0/8`,
    `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`,
    `fc00::/7`, `fe80::/10`.
  Parse the host from the URL and match literal IPs against these ranges; reject
  obvious hostnames (`localhost`). (Full DNS-resolution SSRF hardening is out of
  scope — this blocks the common accidental/naive cases.)
- `web_search` only ever contacts the configured 9router host, so it needs no
  SSRF guard.

## Testing

Vitest, `fetch` mocked, following the existing `test/` style:

- `web_search`: maps a sample `{ results: [...] }` payload into the expected text
  block; clamps `max_results` above 10; returns the missing-endpoint message when
  `ctx.web?.searchEndpoint` is undefined; sends the correct body and auth header.
- `web_fetch`: converts a sample HTML document to clean text (scripts/styles gone,
  entities decoded); **rejects a private-IP / localhost URL before fetching**;
  handles a non-2xx response as an error.

## Out of scope (YAGNI)

- Web-*fetch*/extract via a 9router endpoint — `/v1/search` is search-only today;
  `web_fetch` does its own fetching. Revisit if 9router adds an extract endpoint.
- A pluggable multi-provider search abstraction (Tavily/Brave/etc.). One backend.
- DNS-resolution-based SSRF hardening and per-domain allowlists.
- Caching of fetched pages or search results.
