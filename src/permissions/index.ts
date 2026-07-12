import type { Tool } from '../tools/types.js';

export type PromptFn = (message: string) => Promise<string>;
export interface PermissionGate { check(tool: Tool, input: unknown): Promise<'allow' | 'deny'>; }

export function createGate(opts: { prompt: PromptFn; autoApprove?: boolean }): PermissionGate {
  const always = new Set<string>();
  return {
    async check(tool, input) {
      if (!tool.mutating || opts.autoApprove || always.has(tool.name)) return 'allow';
      const preview = JSON.stringify(input);
      const answer = (await opts.prompt(`Allow ${tool.name}? ${preview} [y]es / [n]o / [a]lways: `)).trim().toLowerCase();
      if (answer === 'a' || answer === 'always') { always.add(tool.name); return 'allow'; }
      if (answer === 'y' || answer === 'yes') return 'allow';
      return 'deny';
    },
  };
}
