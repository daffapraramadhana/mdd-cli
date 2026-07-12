import { ToolRegistry } from './registry.js';
import type { Tool } from './types.js';
import { readFileTool } from './read-file.js';
import { listDirTool } from './list-dir.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { runShellTool } from './run-shell.js';
import { gitTool } from './git.js';

export const allTools: Tool[] = [readFileTool, listDirTool, writeFileTool, editFileTool, runShellTool, gitTool];

export function buildRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const t of allTools) r.register(t);
  return r;
}
