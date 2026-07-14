import { ToolRegistry } from './registry.js';
import type { Tool } from './types.js';
import { readFileTool } from './read-file.js';
import { listDirTool } from './list-dir.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { runShellTool } from './run-shell.js';
import { gitTool } from './git.js';
import { searchTool } from './search.js';
import { multiEditTool } from './multi-edit.js';
import { askUserTool } from './ask-user.js';
import { webFetchTool } from './web-fetch.js';
import { webSearchTool } from './web-search.js';
import { presentPlanTool } from './present-plan.js';

export const allTools: Tool[] = [
  readFileTool, listDirTool, searchTool, writeFileTool, editFileTool, multiEditTool, runShellTool, gitTool, askUserTool, webFetchTool, webSearchTool, presentPlanTool,
];

export function buildRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const t of allTools) r.register(t);
  return r;
}
