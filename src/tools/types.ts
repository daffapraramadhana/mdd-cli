import type { z } from 'zod';
import type { Skill } from '../skills/index.js';
export type PlanDecision = { approved: true } | { approved: false; feedback?: string };
export interface ToolContext {
  cwd: string;
  ask?: (question: string, options?: string[]) => Promise<string>;
  web?: { searchEndpoint?: string; apiKey?: string };
  presentPlan?: (plan: string) => Promise<PlanDecision>;
  skills?: Skill[];
}
export interface ToolResult { content: string; isError: boolean; }
export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  mutating: boolean;
  handler(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
export interface ToolSchema { name: string; description: string; inputSchema: Record<string, unknown>; }
