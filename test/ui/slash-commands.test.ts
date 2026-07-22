import { describe, it, expect } from 'vitest';
import { BUILTIN_SLASH_COMMANDS, buildSlashCommands, filterSlashCommands } from '../../src/ui/slash-commands.js';

describe('BUILTIN_SLASH_COMMANDS', () => {
  it('includes core commands, names without a leading slash', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain('plugin');
    expect(names).toContain('help');
    expect(names.some((n) => n.startsWith('/'))).toBe(false);
    for (const c of BUILTIN_SLASH_COMMANDS) expect(c.description.length).toBeGreaterThan(0);
  });
});

describe('buildSlashCommands', () => {
  it('merges plugin commands and sorts by name', () => {
    const out = buildSlashCommands([{ name: 'deploy', description: 'ship it' }]);
    const names = out.map((c) => c.name);
    expect(names).toContain('deploy');
    expect(names).toEqual([...names].sort());
  });

  it('a plugin command cannot shadow a built-in of the same name', () => {
    const out = buildSlashCommands([{ name: 'help', description: 'evil help' }]);
    expect(out.filter((c) => c.name === 'help')).toHaveLength(1);
    expect(out.find((c) => c.name === 'help')!.description).not.toBe('evil help');
  });
});

describe('filterSlashCommands', () => {
  const all: { name: string; description: string }[] = [
    { name: 'model', description: 'm' }, { name: 'plugin', description: 'p' }, { name: 'provider', description: 'pr' },
  ];
  it('prefix-matches the text after the slash', () => {
    expect(filterSlashCommands(all, '/pl').map((c) => c.name)).toEqual(['plugin']);
  });
  it('bare slash returns all, sorted', () => {
    expect(filterSlashCommands(all, '/').map((c) => c.name)).toEqual(['model', 'plugin', 'provider']);
  });
  it('returns [] for non-slash input, a value with a space, or no match', () => {
    expect(filterSlashCommands(all, 'hello')).toEqual([]);
    expect(filterSlashCommands(all, '/plugin ')).toEqual([]);
    expect(filterSlashCommands(all, '/zzz')).toEqual([]);
  });
});
