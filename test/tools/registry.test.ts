import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, truncate } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const dummy: Tool = {
  name: 'echo',
  description: 'echoes input',
  inputSchema: z.object({ text: z.string() }),
  mutating: false,
  handler: async (input) => ({ content: (input as { text: string }).text, isError: false }),
};

describe('ToolRegistry', () => {
  it('registers and retrieves tools by name', () => {
    const r = new ToolRegistry();
    r.register(dummy);
    expect(r.get('echo')).toBe(dummy);
    expect(r.get('missing')).toBeUndefined();
    expect(r.list()).toHaveLength(1);
  });

  it('produces JSON-schema tool definitions for providers', () => {
    const r = new ToolRegistry();
    r.register(dummy);
    const [schema] = r.schemas();
    expect(schema.name).toBe('echo');
    expect(schema.inputSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } });
  });
});

describe('truncate', () => {
  it('passes through short strings unchanged', () => {
    expect(truncate('hello')).toBe('hello');
  });
  it('caps long strings and appends a marker', () => {
    const out = truncate('x'.repeat(40_000));
    expect(out.length).toBe(30_000 + '\n[truncated]'.length);
    expect(out.endsWith('\n[truncated]')).toBe(true);
  });
});
