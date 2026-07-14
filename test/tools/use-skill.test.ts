import { describe, it, expect } from 'vitest';
import { useSkillTool } from '../../src/tools/use-skill.js';
import type { Skill } from '../../src/skills/index.js';

const skills: Skill[] = [
  { name: 'deploy', description: 'ship it', body: 'Run the deploy pipeline.', source: 'project', path: '/deploy/SKILL.md' },
];

describe('use_skill', () => {
  it('returns the skill body for a known name', async () => {
    const r = await useSkillTool.handler({ name: 'deploy' }, { cwd: '/', skills });
    expect(r.isError).toBe(false);
    expect(r.content).toBe('Run the deploy pipeline.');
  });

  it('errors with available names for an unknown skill', async () => {
    const r = await useSkillTool.handler({ name: 'nope' }, { cwd: '/', skills });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Unknown skill: nope');
    expect(r.content).toContain('deploy');
  });

  it('errors when no skills are available', async () => {
    const r = await useSkillTool.handler({ name: 'deploy' }, { cwd: '/', skills: [] });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('No skills are available');
  });

  it('is a read-only tool', () => {
    expect(useSkillTool.mutating).toBe(false);
  });
});
