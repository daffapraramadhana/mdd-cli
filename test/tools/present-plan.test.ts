import { describe, it, expect } from 'vitest';
import { presentPlanTool } from '../../src/tools/present-plan.js';
import type { PlanDecision, ToolContext } from '../../src/tools/types.js';

const ctx = (presentPlan?: ToolContext['presentPlan']): ToolContext => ({ cwd: '/tmp', presentPlan });

describe('present_plan tool', () => {
  it('is non-mutating and named present_plan', () => {
    expect(presentPlanTool.name).toBe('present_plan');
    expect(presentPlanTool.mutating).toBe(false);
  });

  it('returns a proceed result when the user approves', async () => {
    const r = await presentPlanTool.handler({ plan: '1. do a thing' }, ctx(async () => ({ approved: true })));
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/approved/i);
  });

  it('returns the feedback as tool output when the user keeps planning', async () => {
    const decision: PlanDecision = { approved: false, feedback: 'also handle errors' };
    const r = await presentPlanTool.handler({ plan: '1. do a thing' }, ctx(async () => decision));
    expect(r.isError).toBe(false);
    expect(r.content).toContain('also handle errors');
  });

  it('errors when no presentPlan callback is available', async () => {
    const r = await presentPlanTool.handler({ plan: 'x' }, ctx(undefined));
    expect(r.isError).toBe(true);
  });
});
