import { ApiError } from './errors';
import type { DeleteGoalResult, Goal, GoalStatus, Milestone } from './types';

/** Goals 独立 REST 契约的白名单解析；坏结构与跨 ID 响应统一按 502 暴露。 */
const goalStatuses: GoalStatus[] = ['active', 'paused', 'completed', 'archived'];

function invalid(): never {
  throw new ApiError(502, '长期目标响应格式不正确，请刷新核对服务端状态');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && value.length === 0)) return invalid();
  return value;
}

function parseDate(value: unknown): string {
  const result = text(value, true);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) return invalid();
  const day = result.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return invalid();
  return result;
}

function parseMilestone(value: unknown): Milestone {
  const item = object(value);
  const id = text(item.id, true);
  const title = text(item.title);
  if (typeof item.done !== 'boolean') return invalid();
  if (item.done) {
    if (typeof item.doneAt !== 'string') return invalid();
    return { id, title, done: true, doneAt: parseDate(item.doneAt) };
  }
  if (item.doneAt !== undefined) return invalid();
  return { id, title, done: false };
}

export function parseGoal(value: unknown, expectedId?: string): Goal {
  const item = object(value);
  const id = text(item.id, true);
  if (expectedId !== undefined && id !== expectedId) return invalid();
  const title = text(item.title);
  const description = text(item.description);
  const category = text(item.category);
  if (!goalStatuses.includes(item.status as GoalStatus)) return invalid();
  const status = item.status as GoalStatus;
  if (!Array.isArray(item.milestones)) return invalid();
  const milestones = item.milestones.map(parseMilestone);
  if (new Set(milestones.map((m) => m.id)).size !== milestones.length) return invalid();
  const createdAt = parseDate(item.createdAt);
  const updatedAt = parseDate(item.updatedAt);

  return { id, title, description, category, status, milestones, createdAt, updatedAt };
}

export function parseGoals(value: unknown): Goal[] {
  const page = object(value);
  if (!Array.isArray(page.goals)) return invalid();
  const goals = page.goals.map((item) => parseGoal(item));
  if (new Set(goals.map((g) => g.id)).size !== goals.length) return invalid();
  return goals;
}

export function parseMilestoneToggle(value: unknown, goalId: string, milestoneId: string): Goal {
  const goal = parseGoal(value, goalId);
  if (!goal.milestones.some((m) => m.id === milestoneId)) return invalid();
  return goal;
}

export function parseGoalRemoval(value: unknown, expectedId: string): DeleteGoalResult {
  const result = object(value);
  if (result.ok !== true || result.id !== expectedId) return invalid();
  return { ok: true, id: expectedId };
}
