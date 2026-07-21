import type { LLMProvider } from '../providers/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionGate } from '../permissions/index.js';
import type { Message, ContentBlock, ToolUseBlock } from '../types.js';
import type { PlanDecision } from '../tools/types.js';
import type { Skill } from '../skills/index.js';
import { isRateLimit, retryAfterMs, rateLimitMessage } from '../providers/rate-limit.js';

const MAX_ROUNDS = 50;
const MAX_STREAM_RETRIES = 2;
// Auto-wait through short rate-limit resets; anything longer surfaces a clean
// message with the reset time rather than silently blocking the turn.
const RATE_LIMIT_MAX_WAIT_MS = 10_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}

export interface AgentDeps {
  provider: LLMProvider;
  registry: ToolRegistry;
  gate: PermissionGate;
  cwd: string;
  model: string;
  systemPrompt: string;
  onText?: (t: string) => void;
  onToolStart?: (name: string, input: unknown) => void;
  onToolEnd?: (isError: boolean, content?: string) => void;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  signal?: AbortSignal;
  ask?: (question: string, options?: string[]) => Promise<string>;
  web?: { searchEndpoint?: string; apiKey?: string };
  toolFilter?: (name: string) => boolean;
  presentPlan?: (plan: string) => Promise<PlanDecision>;
  skills?: Skill[];
}

// Drain one provider stream, retrying a stream that dies BEFORE emitting anything.
// A transient truncation (dropped connection / router hiccup) throws with nothing
// yet emitted — safe to re-request. Once any text or tool call has streamed out,
// retrying would duplicate it, so we rethrow. A user abort is never retried.
async function streamRound(deps: AgentDeps, messages: Message[]): Promise<{ text: string; toolUses: ToolUseBlock[]; stop: 'end' | 'tool_use' | 'max_tokens' }> {
  for (let attempt = 0; ; attempt++) {
    const toolUses: ToolUseBlock[] = [];
    let text = '';
    let stop: 'end' | 'tool_use' | 'max_tokens' = 'end';
    try {
      for await (const ev of deps.provider.stream(messages, deps.registry.schemas(deps.toolFilter), {
        model: deps.model, systemPrompt: deps.systemPrompt, maxTokens: 8192, signal: deps.signal,
      })) {
        if (ev.type === 'text') { text += ev.text; deps.onText?.(ev.text); }
        else if (ev.type === 'tool_use') toolUses.push({ type: 'tool_use', id: ev.id, name: ev.name, input: ev.input });
        else if (ev.type === 'usage') deps.onUsage?.(ev.inputTokens, ev.outputTokens);
        else if (ev.type === 'done') stop = ev.stopReason;
      }
      return { text, toolUses, stop };
    } catch (err) {
      const emittedNothing = text === '' && toolUses.length === 0;
      // Never retry after partial output (would duplicate it) or on user abort.
      if (!emittedNothing || deps.signal?.aborted) throw err;
      if (isRateLimit(err)) {
        // The SDK already backed off and retried; wait once more only if the
        // reset is short, otherwise surface a clean message with the reset time.
        const waitMs = retryAfterMs(err);
        if (attempt < 1 && waitMs != null && waitMs <= RATE_LIMIT_MAX_WAIT_MS) {
          await sleep(waitMs, deps.signal);
          continue;
        }
        throw new Error(rateLimitMessage(deps.model, waitMs));
      }
      if (attempt < MAX_STREAM_RETRIES) continue;
      throw err;
    }
  }
}

export async function runTurn(messages: Message[], deps: AgentDeps): Promise<Message[]> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const assistant: ContentBlock[] = [];
    const { text, toolUses, stop } = await streamRound(deps, messages);

    if (text) assistant.push({ type: 'text', text });
    assistant.push(...toolUses);
    if (assistant.length) messages.push({ role: 'assistant', content: assistant });

    if (stop !== 'tool_use' || toolUses.length === 0) return messages;

    const results: ContentBlock[] = [];
    for (const use of toolUses) {
      deps.onToolStart?.(use.name, use.input);
      const tool = deps.registry.get(use.name);
      if (!tool) {
        results.push({ type: 'tool_result', toolUseId: use.id, content: `Unknown tool: ${use.name}`, isError: true });
        deps.onToolEnd?.(true, `Unknown tool: ${use.name}`);
        continue;
      }
      const decision = await deps.gate.check(tool, use.input);
      if (!decision.allow) {
        const msg = decision.reason
          ? `User denied this tool call. They said: ${decision.reason}`
          : 'User denied this tool call.';
        results.push({ type: 'tool_result', toolUseId: use.id, content: msg, isError: true });
        deps.onToolEnd?.(true, msg);
        continue;
      }
      try {
        const r = await tool.handler(use.input, { cwd: deps.cwd, ask: deps.ask, web: deps.web, presentPlan: deps.presentPlan, skills: deps.skills });
        results.push({ type: 'tool_result', toolUseId: use.id, content: r.content, isError: r.isError });
        deps.onToolEnd?.(r.isError, r.content);
      } catch (err) {
        results.push({ type: 'tool_result', toolUseId: use.id, content: err instanceof Error ? err.message : String(err), isError: true });
        deps.onToolEnd?.(true, err instanceof Error ? err.message : String(err));
      }
    }
    messages.push({ role: 'user', content: results });
  }
  messages.push({ role: 'assistant', content: [{ type: 'text', text: `Stopped after ${MAX_ROUNDS} tool rounds.` }] });
  return messages;
}
