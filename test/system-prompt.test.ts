import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('names the assistant and includes the working directory', () => {
    const p = buildSystemPrompt('/tmp/project');
    expect(p).toMatch(/mdd/);
    expect(p).toContain('/tmp/project');
    expect(p.toLowerCase()).toContain('coding assistant');
  });

  it('mentions the web tools', () => {
    const p = buildSystemPrompt('/repo');
    expect(p).toMatch(/web_search|web_fetch/);
  });
});
