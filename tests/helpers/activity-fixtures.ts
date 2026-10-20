import type { ActivityDetail, ActivityOverview, ActivityStep } from '../../src/activities/types';

export const activityFixture = (overrides: Partial<ActivityOverview> = {}): ActivityOverview => ({
  id: 'activity-a', threadId: 'thread-a', title: '真实工作', goal: '完成检查', deliverable: '检查摘要', status: 'awaiting_continuation', progress: '本轮结束，等待明确继续', result: null,
  runIds: ['run-a'], currentRunId: null, createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:01:00.000Z', finishedAt: null, ...overrides,
});
export const stepFixture = (overrides: Partial<ActivityStep> = {}): ActivityStep => ({ id: 'step-a', runId: 'run-a', parentId: null, kind: 'execution', title: '执行', status: 'succeeded', startedAt: '2026-10-20T01:00:00.000Z', finishedAt: '2026-10-20T01:01:00.000Z', result: null, ...overrides });
export const detailFixture = (activity = activityFixture(), steps = [stepFixture()]): ActivityDetail => ({ activity, steps });
export const activityPage = (activities = [activityFixture()], nextCursor: string | null = null) => ({ activities, hasMore: nextCursor !== null, nextCursor });
