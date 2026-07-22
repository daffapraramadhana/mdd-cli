export interface SlashCommand {
  name: string;
  description: string;
}

/** Canonical built-in commands for the `/` menu. Names omit the leading slash.
 *  Descriptions mirror the short forms shown in `HELP` (src/cli.ts). */
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'summarize older history to free up context' },
  { name: 'exit', description: 'quit the session' },
  { name: 'help', description: 'show help' },
  { name: 'model', description: 'show or switch the model' },
  { name: 'models', description: 'pick a model' },
  { name: 'plugin', description: 'manage plugins (add/list/remove/update)' },
  { name: 'provider', description: 'switch provider: anthropic | openai' },
  { name: 'resume', description: 'resume a past session in this project' },
  { name: 'theme', description: 'switch theme' },
];

/** Built-ins plus plugin commands, deduped by name (built-in wins), sorted by name. */
export function buildSlashCommands(
  pluginCommands: Iterable<{ name: string; description: string }>,
): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const c of BUILTIN_SLASH_COMMANDS) byName.set(c.name, c);
  for (const c of pluginCommands) if (!byName.has(c.name)) byName.set(c.name, { name: c.name, description: c.description });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Prefix-filter by the text after a leading '/'. Returns [] unless `value` starts with '/'
 *  and has no space. Bare '/' returns everything. Result sorted by name. */
export function filterSlashCommands(all: SlashCommand[], value: string): SlashCommand[] {
  if (!value.startsWith('/') || value.includes(' ')) return [];
  const token = value.slice(1).toLowerCase();
  return all
    .filter((c) => c.name.toLowerCase().startsWith(token))
    .sort((a, b) => a.name.localeCompare(b.name));
}
