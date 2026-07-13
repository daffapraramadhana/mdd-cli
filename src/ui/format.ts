// src/ui/format.ts
// Compact, human-readable rendering of a tool call for the transcript.

const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir']);

export function formatToolCall(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined);

  let arg: string | undefined;
  if (PATH_TOOLS.has(name)) arg = str('path');
  else if (name === 'run_shell') arg = str('command');
  else if (name === 'git') arg = str('args');

  if (arg === undefined) arg = JSON.stringify(input ?? {});
  const oneLine = arg.replace(/\s+/g, ' ').trim();
  const short = oneLine.length > 60 ? oneLine.slice(0, 57) + '…' : oneLine;
  return `${name}(${short})`;
}
