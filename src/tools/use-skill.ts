import { z } from 'zod';
import type { Tool } from './types.js';
import { truncate } from './registry.js';

const schema = z.object({
  name: z.string().describe('The exact name of the skill to load, as listed in the system prompt'),
});

export const useSkillTool: Tool = {
  name: 'use_skill',
  description:
    'Load the full instructions for one of the available skills into context. Pass the skill name exactly as listed. Read-only.',
  inputSchema: schema,
  mutating: false,
  handler: async (input, ctx) => {
    try {
      const { name } = schema.parse(input);
      const skills = ctx.skills ?? [];
      if (skills.length === 0) {
        return { content: 'No skills are available in this project.', isError: true };
      }
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const names = skills.map((s) => s.name).join(', ');
        return { content: `Unknown skill: ${name}. Available skills: ${names}`, isError: true };
      }
      return { content: truncate(skill.body), isError: false };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  },
};
