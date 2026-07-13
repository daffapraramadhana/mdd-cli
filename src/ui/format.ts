// src/ui/format.ts
// Compact, human-readable rendering of a tool call for the transcript.

const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir']);

const TOOL_ICONS: Record<string, string> = {
  read_file: '▤',
  write_file: '✎',
  edit_file: '✎',
  list_dir: '▸',
  run_shell: '❯',
  git: '⎇',
};

export function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? '•';
}

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

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function firstLine(s: string, max = 58): string {
  const line = s.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** One-line dim preview of a tool result, or undefined when there's nothing worth showing. */
export function summarizePreview(name: string, content: string | undefined, isError: boolean): string | undefined {
  if (content === undefined) return undefined;
  if (isError) return firstLine(content) || undefined;

  switch (name) {
    case 'read_file': {
      const lines = content.split('\n').length;
      return `${lines} lines · ${humanBytes(Buffer.byteLength(content))}`;
    }
    case 'list_dir': {
      if (content.trim() === '(empty)') return 'empty';
      const n = content.split('\n').filter((l) => l.trim() !== '').length;
      return `${n} entries`;
    }
    case 'search': {
      if (content.trim() === '(no matches)') return 'no matches';
      const n = content.split('\n').filter((l) => l.trim() !== '').length;
      return `${n} matches`;
    }
    case 'write_file': {
      const m = content.match(/Wrote (\d+) bytes/);
      return m ? `wrote ${humanBytes(Number(m[1]))}` : firstLine(content) || undefined;
    }
    case 'multi_edit': {
      const m = content.match(/Applied (\d+) edit/);
      return m ? `${m[1]} edits` : firstLine(content) || undefined;
    }
    case 'edit_file':
      return undefined;
    default:
      return firstLine(content) || undefined;
  }
}
