import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../../src/tools/index.js';

describe('buildRegistry', () => {
  it('registers all tools', () => {
    const r = buildRegistry();
    const names = r.list().map((t) => t.name).sort();
    expect(names).toEqual([
      'ask_user', 'edit_file', 'git', 'list_dir', 'multi_edit', 'present_plan', 'read_file', 'run_shell', 'search', 'use_skill', 'web_fetch', 'web_search', 'write_file',
    ]);
  });
});
