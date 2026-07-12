export type Role = 'user' | 'assistant';
export interface TextBlock { type: 'text'; text: string; }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; }
export interface ToolResultBlock { type: 'tool_result'; toolUseId: string; content: string; isError: boolean; }
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
export interface Message { role: Role; content: ContentBlock[]; }
