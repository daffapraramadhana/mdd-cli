import type { LLMProvider } from '../providers/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionGate } from '../permissions/index.js';
import type { Message, ContentBlock, ToolUseBlock } from '../types.js';
import type { PlanDecision } from '../tools/types.js';

const MAX_ROUNDS = 50;

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
}

export async function runTurn(messages: Message[], deps: AgentDeps): Promise<Message[]> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const assistant: ContentBlock[] = [];
    const toolUses: ToolUseBlock[] = [];
    let text = '';
    let stop: 'end' | 'tool_use' | 'max_tokens' = 'end';

    for await (const ev of deps.provider.stream(messages, deps.registry.schemas(deps.toolFilter), {
      model: deps.model, systemPrompt: deps.systemPrompt, maxTokens: 8192, signal: deps.signal,
    })) {
      if (ev.type === 'text') { text += ev.text; deps.onText?.(ev.text); }
      else if (ev.type === 'tool_use') { const b: ToolUseBlock = { type: 'tool_use', id: ev.id, name: ev.name, input: ev.input }; toolUses.push(b); }
      else if (ev.type === 'usage') deps.onUsage?.(ev.inputTokens, ev.outputTokens);
      else if (ev.type === 'done') stop = ev.stopReason;
    }

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
        const r = await tool.handler(use.input, { cwd: deps.cwd, ask: deps.ask, web: deps.web, presentPlan: deps.presentPlan });
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
