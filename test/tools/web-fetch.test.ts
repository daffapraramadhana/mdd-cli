import { describe, it, expect, vi, afterEach } from 'vitest';
import { webFetchTool, isBlockedHost, htmlToText } from '../../src/tools/web-fetch.js';

afterEach(() => vi.restoreAllMocks());

describe('isBlockedHost', () => {
  it('blocks loopback and private ranges', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.7.8', '169.254.1.1', '::1', '[::1]', 'fe80::1']) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });
  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', 'ai-router.mdd.co.id']) {
      expect(isBlockedHost(h)).toBe(false);
    }
  });
});

describe('htmlToText', () => {
  it('drops scripts/styles/tags and decodes entities', () => {
    const out = htmlToText('<style>.x{}</style><p>Hello&nbsp;&amp; <b>world</b></p><script>evil()</script>');
    expect(out).toContain('Hello & world');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('<');
  });
});

describe('webFetchTool', () => {
  it('is mutating', () => { expect(webFetchTool.mutating).toBe(true); });

  it('rejects a private-IP url before fetching', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const r = await webFetchTool.handler({ url: 'http://192.168.7.8/secret' }, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a non-http scheme', async () => {
    const r = await webFetchTool.handler({ url: 'file:///etc/passwd' }, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
  });

  it('returns text for a fetched html page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<html><body><h1>Docs</h1><p>content here</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));
    const r = await webFetchTool.handler({ url: 'https://example.com' }, { cwd: '/tmp' });
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Docs');
    expect(r.content).toContain('content here');
  });

  it('reports a non-2xx response as an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    const r = await webFetchTool.handler({ url: 'https://example.com/missing' }, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/404/);
  });
});
