import type { z } from 'zod';
export interface ToolContext { cwd: string; }
export interface ToolResult { content: string; isError: boolean; }
export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  mutating: boolean;
  handler(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
export interface ToolSchema { name: string; description: string; inputSchema: Record<string, unknown>; }
