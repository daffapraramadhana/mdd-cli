import type { Tool } from '../tools/types.js';
import type { PromptSpec, ChoiceResult } from '../ui/select.js';
import { formatToolCall, toolIcon } from '../ui/format.js';

export type ConfirmFn = (spec: PromptSpec) => Promise<ChoiceResult>;
export interface GateDecision { allow: boolean; reason?: string; }
export interface PermissionGate { check(tool: Tool, input: unknown): Promise<GateDecision>; }

export function createGate(opts: { confirm: ConfirmFn; autoApprove?: boolean }): PermissionGate {
  const always = new Set<string>();
  return {
    async check(tool, input) {
      if (!tool.mutating || opts.autoApprove || always.has(tool.name)) return { allow: true };
      const spec: PromptSpec = {
        title: 'before this runs, it needs your ok',
        body: [`${toolIcon(tool.name)} ${formatToolCall(tool.name, input)}`],
        options: [
          { label: 'yes, run it', value: 'yes' },
          { label: 'no — tell it what to do instead', value: 'no', opensInput: true, inputPlaceholder: 'what should it do instead?' },
          { label: `always allow ${tool.name} this session`, value: 'always' },
        ],
      };
      const result = await opts.confirm(spec);
      if (result?.value === 'always') { always.add(tool.name); return { allow: true }; }
      if (result?.value === 'yes') return { allow: true };
      return { allow: false, ...(result?.text ? { reason: result.text } : {}) }; // 'no' or cancel
    },
  };
}
