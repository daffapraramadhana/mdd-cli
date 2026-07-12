import { z } from 'zod';
import type { Tool, ToolSchema } from './types.js';

const MAX = 30_000;
export function truncate(s: string): string {
  return s.length <= MAX ? s : s.slice(0, MAX) + '\n[truncated]';
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(t: Tool): void { this.tools.set(t.name, t); }
  get(name: string): Tool | undefined { return this.tools.get(name); }
  list(): Tool[] { return [...this.tools.values()]; }
  schemas(): ToolSchema[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.inputSchema) as Record<string, unknown>,
    }));
  }
}
