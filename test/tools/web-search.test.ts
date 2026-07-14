import { describe, it, expect, vi, afterEach } from 'vitest';
import { webSearchTool, webCtxFromConfig } from '../../src/tools/web-search.js';
import type { Config } from '../../src/config/index.js';

afterEach(() => vi.restoreAllMocks());

const ctx = { cwd: '/tmp', web: { searchEndpoint: 'https://r.example/v1/search', apiKey: 'sk-test' } };

describe('webCtxFromConfig', () => {
  it('builds the /search endpoint from the base url and strips trailing slash', () => {
    const c = { openaiBaseUrl: 'https://ai-router.mdd.co.id/v1/', openaiApiKey: 'sk-x' } as Config;
    expect(webCtxFromConfig(c)).toEqual({ searchEndpoint: 'https://ai-router.mdd.co.id/v1/search', apiKey: 'sk-x' });
  });
  it('omits the endpoint when no base url is set', () => {
    expect(webCtxFromConfig({} as Config).searchEndpoint).toBeUndefined();
  });
});

describe('webSearchTool', () => {
  it('is mutating', () => { expect(webSearchTool.mutating).toBe(true); });

  it('errors clearly when no endpoint is configured', async () => {
    const r = await webSearchTool.handler({ query: 'hi' }, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/9router|endpoint/i);
  });

  it('posts to the endpoint and formats results', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ results: [{ title: 'T1', url: 'http://a', snippet: 'S1' }] }),
      { status: 200 },
    ));
    const r = await webSearchTool.handler({ query: 'ai news' }, ctx);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('T1');
    expect(r.content).toContain('http://a');
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://r.example/v1/search');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse((init as any).body);
    expect(body).toMatchObject({ model: 'tavily', query: 'ai news', search_type: 'web' });
  });

  it('clamps max_results to 10', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await webSearchTool.handler({ query: 'q', max_results: 50 }, ctx);
    const body = JSON.parse((spy.mock.calls[0][1] as any).body);
    expect(body.max_results).toBe(10);
  });

  it('reports an empty result set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const r = await webSearchTool.handler({ query: 'q' }, ctx);
    expect(r.content).toBe('(no results)');
  });
});
