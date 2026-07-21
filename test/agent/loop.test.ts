import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runTurn } from '../../src/agent/loop.js';
import { buildRegistry } from '../../src/tools/index.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createGate } from '../../src/permissions/index.js';
import { FakeProvider } from '../../src/providers/fake.js';
import type { Message } from '../../src/types.js';
import type { Tool } from '../../src/tools/types.js';
import type { LLMProvider } from '../../src/providers/index.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mdd-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('runTurn', () => {
  it('dispatches a tool call, feeds the result back, and returns the final text', async () => {
    await writeFile(join(dir, 'a.txt'), 'FILEBODY');
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'a.txt' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'The file says FILEBODY.' }, { type: 'done', stopReason: 'end' }],
    ]);
    const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'read a.txt' }] }];
    const out = await runTurn(messages, {
      provider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
    });
    const toolResult = out.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: string } | undefined;
    expect(toolResult?.content).toBe('FILEBODY');
    const last = out.at(-1)!;
    expect(last.role).toBe('assistant');
    expect(last.content.some((b) => b.type === 'text' && b.text.includes('FILEBODY'))).toBe(true);
  });

  it('fires onToolStart then onToolEnd (isError=false on success, true on denial)', async () => {
    await writeFile(join(dir, 'a.txt'), 'X');
    const events: string[] = [];
    // success: read_file allowed
    const okProvider = new FakeProvider([
      [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.txt' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end' }],
    ]);
    await runTurn([{ role: 'user', content: [{ type: 'text', text: 'read' }] }], {
      provider: okProvider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
      onToolStart: (name) => events.push(`start:${name}`),
      onToolEnd: (isError) => events.push(`end:${isError}`),
    });
    expect(events).toEqual(['start:read_file', 'end:false']);

    // denial: write_file denied → onToolEnd(true)
    const denyEvents: string[] = [];
    const denyProvider = new FakeProvider([
      [{ type: 'tool_use', id: 't2', name: 'write_file', input: { path: 'x.txt', content: 'no' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'skipped' }, { type: 'done', stopReason: 'end' }],
    ]);
    await runTurn([{ role: 'user', content: [{ type: 'text', text: 'write' }] }], {
      provider: denyProvider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'no' }) }),
      cwd: dir, model: 'x', systemPrompt: 's',
      onToolStart: (name) => denyEvents.push(`start:${name}`),
      onToolEnd: (isError) => denyEvents.push(`end:${isError}`),
    });
    expect(denyEvents).toEqual(['start:write_file', 'end:true']);
  });

  it('returns a denial tool_result when the gate denies a mutating tool', async () => {
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'x.txt', content: 'no' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'ok, skipped' }, { type: 'done', stopReason: 'end' }],
    ]);
    const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'write x' }] }], {
      provider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'no' }) }),
      cwd: dir, model: 'x', systemPrompt: 's',
    });
    const tr = out.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: string; isError: boolean } | undefined;
    expect(tr?.isError).toBe(true);
    expect(tr?.content).toMatch(/denied/i);
  });

  it('turns a throwing tool handler into an error tool_result instead of rejecting', async () => {
    const registry = new ToolRegistry();
    const throwingTool: Tool = {
      name: 'boom',
      description: 'always throws, for testing defense-in-depth try/catch',
      inputSchema: z.object({}),
      mutating: false,
      handler: async () => { throw new Error('kaboom'); },
    };
    registry.register(throwingTool);
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: 'tu1', name: 'boom', input: {} }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'handled' }, { type: 'done', stopReason: 'end' }],
    ]);
    const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'trigger boom' }] }], {
      provider, registry, gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
    });
    const tr = out.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: string; isError: boolean } | undefined;
    expect(tr?.isError).toBe(true);
    expect(tr?.content).toBe('kaboom');
    expect(out.at(-1)?.role).toBe('assistant');
  });

  it('surfaces a request for an unregistered tool as an error tool_result and completes the turn', async () => {
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: 'tu1', name: 'does_not_exist', input: {} }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end' }],
    ]);
    const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'call a bogus tool' }] }], {
      provider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
    });
    const tr = out.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: string; isError: boolean } | undefined;
    expect(tr?.isError).toBe(true);
    expect(tr?.content).toMatch(/unknown tool/i);
    expect(out.at(-1)?.role).toBe('assistant');
  });

  it('passes the tool result content to onToolEnd', async () => {
    await writeFile(join(dir, 'a.txt'), 'FILEBODY');
    const seen: Array<{ isError: boolean; content?: string }> = [];
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.txt' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end' }],
    ]);
    await runTurn([{ role: 'user', content: [{ type: 'text', text: 'read' }] }], {
      provider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
      onToolEnd: (isError, content) => seen.push({ isError, content }),
    });
    expect(seen).toEqual([{ isError: false, content: 'FILEBODY' }]);
  });

  it('stops after MAX_ROUNDS instead of looping forever when the provider keeps requesting tool calls', async () => {
    await writeFile(join(dir, 'a.txt'), 'x');
    const infiniteProvider: LLMProvider = {
      name: 'infinite',
      async *stream() {
        yield { type: 'tool_use', id: 'tu', name: 'read_file', input: { path: 'a.txt' } };
        yield { type: 'done', stopReason: 'tool_use' };
      },
    };
    const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'keep going forever' }] }], {
      provider: infiniteProvider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
    });
    const last = out.at(-1)!;
    expect(last.role).toBe('assistant');
    expect(last.content.some((b) => b.type === 'text' && /stopped after 50/i.test(b.text))).toBe(true);
  });

  it('retries a stream that dies before emitting anything, then completes', async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      async *stream() {
        calls++;
        if (calls === 1) throw new Error('truncated upstream');
        yield { type: 'text', text: 'recovered' };
        yield { type: 'done', stopReason: 'end' };
      },
    };
    const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], {
      provider: flaky, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
    });
    expect(calls).toBe(2);
    expect(out.at(-1)!.content.some((b) => b.type === 'text' && b.text.includes('recovered'))).toBe(true);
  });

  it('does not retry once text has already streamed out (avoids duplication)', async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      async *stream() {
        calls++;
        yield { type: 'text', text: 'partial' };
        throw new Error('died mid-stream');
      },
    };
    await expect(runTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], {
      provider: flaky, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
    })).rejects.toThrow(/died mid-stream/);
    expect(calls).toBe(1);
  });

  it('gives up after MAX_STREAM_RETRIES and rethrows a persistently failing stream', async () => {
    let calls = 0;
    const dead: LLMProvider = {
      name: 'dead',
      // eslint-disable-next-line require-yield
      async *stream() { calls++; throw new Error('always truncated'); },
    };
    await expect(runTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], {
      provider: dead, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'x', systemPrompt: 's',
    })).rejects.toThrow(/always truncated/);
    expect(calls).toBe(3); // initial attempt + 2 retries
  });

  it('auto-waits through a short rate-limit reset, then completes', async () => {
    let calls = 0;
    const limited: LLMProvider = {
      name: 'limited',
      async *stream() {
        calls++;
        if (calls === 1) {
          const e = Object.assign(new Error('429 rate limit'), { status: 429, headers: { 'retry-after-ms': '20' } });
          throw e;
        }
        yield { type: 'text', text: 'recovered after wait' };
        yield { type: 'done', stopReason: 'end' };
      },
    };
    const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], {
      provider: limited, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'cc/claude-sonnet-5', systemPrompt: 's',
    });
    expect(calls).toBe(2);
    expect(out.at(-1)!.content.some((b) => b.type === 'text' && b.text.includes('recovered'))).toBe(true);
  });

  it('surfaces a clean message with the reset time on a long rate-limit reset (no hammering)', async () => {
    let calls = 0;
    const limited: LLMProvider = {
      name: 'limited',
      // eslint-disable-next-line require-yield
      async *stream() {
        calls++;
        throw new Error('429 [claude/claude-sonnet-5] [429]: {"type":"ratelimiterror"} (reset after 1m 4s)');
      },
    };
    await expect(runTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], {
      provider: limited, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }), autoApprove: true }),
      cwd: dir, model: 'cc/claude-sonnet-5', systemPrompt: 's',
    })).rejects.toThrow('Rate limited on cc/claude-sonnet-5. Retry in 1m 4s.');
    expect(calls).toBe(1); // no immediate retry against a hard limit
  });

  it('routes an ask_user tool call to the ask() dep and feeds the answer back', async () => {
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: 'q1', name: 'ask_user', input: { question: 'which pm?', options: ['pnpm', 'npm'] } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'ok, pnpm it is' }, { type: 'done', stopReason: 'end' }],
    ]);
    const out = await runTurn([{ role: 'user', content: [{ type: 'text', text: 'set up scripts' }] }], {
      provider, registry: buildRegistry(), gate: createGate({ confirm: async () => ({ value: 'yes' }) }),
      cwd: dir, model: 'x', systemPrompt: 's',
      ask: async () => 'pnpm',
    });
    const tr = out.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: string } | undefined;
    expect(tr?.content).toBe('pnpm');
  });
});
