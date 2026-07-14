import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({
  plan: z.string().describe('The step-by-step plan to carry out, in markdown. Be concrete: which files change and what each step does.'),
});

export const presentPlanTool: Tool = {
  name: 'present_plan',
  description:
    'Present a concrete implementation plan for the user to approve. Only available in plan mode. On approval, the session switches to normal mode and you continue by executing the plan. If the user asks for changes, revise the plan and call present_plan again.',
  inputSchema: schema,
  mutating: false,
  async handler(input, ctx) {
    const { plan } = schema.parse(input);
    if (!ctx.presentPlan) return { content: 'Plan approval is not available in this context.', isError: true };
    const decision = await ctx.presentPlan(plan);
    if (decision.approved) {
      return { content: 'Plan approved. Now in normal mode — proceed with executing the plan.', isError: false };
    }
    const feedback = decision.feedback?.trim();
    return {
      content: feedback
        ? `User did not approve the plan. They said: ${feedback}. Revise the plan and call present_plan again.`
        : 'User did not approve the plan. Revise it and call present_plan again.',
      isError: false,
    };
  },
};
