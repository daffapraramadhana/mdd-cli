// src/ui/banner.ts
// Pure string builders for the welcome banner and the status/footer line.
// Kept free of ink/React so they are trivially unit-testable.

export interface SessionMeta {
  provider: string;
  model: string;
  cwd: string;
  autoApprove?: boolean;
  branch?: string;
}

/** A boxed MDD header, printed once to stdout at REPL start (above ink's output). */
export function formatBanner(opts: { version: string }): string {
  const inner = `  MDD · terminal coding assistant   v${opts.version}  `;
  const width = inner.length;
  const top = '╭' + '─'.repeat(width) + '╮';
  const mid = '│' + inner + '│';
  const bot = '╰' + '─'.repeat(width) + '╯';
  return [top, mid, bot].join('\n');
}

/** Replace a leading home-directory prefix with `~` for a compact cwd. */
export function shortenCwd(cwd: string, home: string): string {
  if (home && (cwd === home || cwd.startsWith(home + '/'))) return '~' + cwd.slice(home.length);
  return cwd;
}

/** The status-line content next to the `mdd` badge: `provider · model[ · auto-approve]`. */
export function formatStatus(meta: SessionMeta): string {
  const parts = [meta.provider, meta.model];
  if (meta.autoApprove) parts.push('auto-approve');
  return parts.join(' · ');
}

/** The path line: `cwd[ (branch)]`. */
export function formatPath(meta: SessionMeta): string {
  return meta.branch ? `${meta.cwd} (${meta.branch})` : meta.cwd;
}
