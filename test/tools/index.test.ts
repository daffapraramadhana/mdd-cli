import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../../src/tools/index.js';

describe('buildRegistry', () => {
  it('registers all six v1 tools', () => {
    const r = buildRegistry();
    const names = r.list().map((t) => t.name).sort();
    expect(names).toEqual(['edit_file', 'git', 'list_dir', 'read_file', 'run_shell', 'write_file']);
  });
});
