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
  schemas(filter?: (name: string) => boolean): ToolSchema[] {
    return this.list()
      .filter((t) => (filter ? filter(t.name) : true))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: z.toJSONSchema(t.inputSchema) as Record<string, unknown>,
      }));
  }
}
