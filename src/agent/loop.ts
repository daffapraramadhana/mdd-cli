import type { LLMProvider } from '../providers/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionGate } from '../permissions/index.js';
import type { Message, ContentBlock, ToolUseBlock } from '../types.js';

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
  signal?: AbortSignal;
}

export async function runTurn(messages: Message[], deps: AgentDeps): Promise<Message[]> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const assistant: ContentBlock[] = [];
    const toolUses: ToolUseBlock[] = [];
    let text = '';
    let stop: 'end' | 'tool_use' | 'max_tokens' = 'end';

    for await (const ev of deps.provider.stream(messages, deps.registry.schemas(), {
      model: deps.model, systemPrompt: deps.systemPrompt, maxTokens: 8192, signal: deps.signal,
    })) {
      if (ev.type === 'text') { text += ev.text; deps.onText?.(ev.text); }
      else if (ev.type === 'tool_use') { const b: ToolUseBlock = { type: 'tool_use', id: ev.id, name: ev.name, input: ev.input }; toolUses.push(b); }
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
      if (!tool) { results.push({ type: 'tool_result', toolUseId: use.id, content: `Unknown tool: ${use.name}`, isError: true }); continue; }
      const decision = await deps.gate.check(tool, use.input);
      if (decision === 'deny') { results.push({ type: 'tool_result', toolUseId: use.id, content: 'User denied this tool call.', isError: true }); continue; }
      try {
        const r = await tool.handler(use.input, { cwd: deps.cwd });
        results.push({ type: 'tool_result', toolUseId: use.id, content: r.content, isError: r.isError });
      } catch (err) {
        results.push({ type: 'tool_result', toolUseId: use.id, content: err instanceof Error ? err.message : String(err), isError: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  messages.push({ role: 'assistant', content: [{ type: 'text', text: `Stopped after ${MAX_ROUNDS} tool rounds.` }] });
  return messages;
}
