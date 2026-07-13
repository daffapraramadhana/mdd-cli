import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({
  question: z.string().describe('The question to ask the user.'),
  options: z.array(z.string()).optional().describe('Optional suggested answers the user can pick from.'),
});

export const askUserTool: Tool = {
  name: 'ask_user',
  description:
    'Ask the user a question when you need a decision only they can make (a preference, an ambiguous requirement, a missing detail). Provide 2-4 suggested options when you can; the user may also type their own answer. Prefer asking over guessing when getting it wrong would waste work.',
  inputSchema: schema,
  mutating: false,
  async handler(input, ctx) {
    const { question, options } = schema.parse(input);
    if (!ctx.ask) return { content: 'User interaction is not available in this context.', isError: true };
    const answer = await ctx.ask(question, options);
    return { content: answer, isError: false };
  },
};
