export interface Command {
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  source: 'project' | 'personal' | 'plugin';
  plugin?: string;
  path: string;
}

const PREFILL_RE = /!`([^`]*)`/g;

export function parseCommandFile(
  raw: string,
  _fallbackName: string,
): { description: string; argumentHint?: string; body: string } {
  const normalized = raw.replace(/^\ufeff/, '');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { description: '', body: normalized.trim() };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { description: '', body: normalized.trim() };
  const out: { description: string; argumentHint?: string; body: string } = {
    description: '',
    body: lines.slice(end + 1).join('\n').trim(),
  };
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = unquote(m[2].trim());
    if (key === 'description') out.description = value;
    else if (key === 'argument-hint') out.argumentHint = value;
  }
  return out;
}

export function renderCommand(body: string, args: string): { text: string; prefill: string[] } {
  const positional = args.trim().length ? args.trim().split(/\s+/) : [];
  const text = body.replace(/\$ARGUMENTS|\$(\d+)/g, (_m, n) =>
    n === undefined ? args : (positional[Number(n) - 1] ?? ''),
  );
  const prefill: string[] = [];
  for (const m of text.matchAll(PREFILL_RE)) prefill.push(m[1]);
  return { text, prefill };
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}
