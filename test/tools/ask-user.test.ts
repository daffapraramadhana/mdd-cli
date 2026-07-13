import { describe, it, expect } from 'vitest';
import { askUserTool } from '../../src/tools/ask-user.js';

describe('askUserTool', () => {
  it('is non-mutating', () => { expect(askUserTool.mutating).toBe(false); });

  it('returns the ask() answer as content', async () => {
    const r = await askUserTool.handler(
      { question: 'which pm?', options: ['pnpm', 'npm'] },
      { cwd: '/tmp', ask: async (q, o) => `${q}|${o?.join(',')}` },
    );
    expect(r).toEqual({ content: 'which pm?|pnpm,npm', isError: false });
  });

  it('errors cleanly when ask is unavailable', async () => {
    const r = await askUserTool.handler({ question: 'q' }, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not available/i);
  });
});
