import type { WorkspaceSnapshot } from '../../src/api/types';

/** 演示素材只存于客户端内存，不对应真实任务、记忆或审批。 */
export function demoWorkspace(empty = false): WorkspaceSnapshot {
  const now = new Date().toISOString();
  const before = new Date(Date.now() - 45 * 60_000).toISOString();
  const base = {
    identity: { name: 'Pi Muse', tone: 'warm', avatar: 'sky', showChatUpdates: true },
    worker: { running: true },
  };
  if (empty) return { ...base, tasks: [], goals: [], monitors: [], memories: [], notifications: [] };
  return {
    ...base,
    tasks: [
      { id: 'demo-research', title: '整理周末短途旅行方案', prompt: '对比交通、住宿和两日路线，给出一份可执行的计划。', kind: 'task', status: 'running', createdAt: before, updatedAt: now, error: null },
      { id: 'demo-digest', title: '每天早上整理科技简报', prompt: '每天早上 8 点汇总值得关注的科技新闻。', kind: 'job', status: 'scheduled', createdAt: before, updatedAt: before, nextRunAt: new Date(Date.now() + 3_600_000).toISOString(), error: null },
      { id: 'demo-done', title: '准备本周阅读清单', prompt: '整理三篇适合周末阅读的文章。', kind: 'task', status: 'succeeded', createdAt: before, updatedAt: before, result: '阅读清单已整理：\n\n1. 把复杂任务拆成可以开始的小步骤\n2. 为注意力安排一段不被打扰的时间\n3. 用每周回顾连接目标与行动\n\n这是一份演示结果，没有读取或保存真实文档。', error: null },
      { id: 'demo-failed', title: '检查旅行页面更新', prompt: '查看行程页面是否有变化。', kind: 'task', status: 'failed', createdAt: before, updatedAt: before, error: '演示网络超时。可以重试，查看成功后的状态。' },
    ],
    goals: [
      { id: 'demo-health', title: '把运动变成每周的习惯', description: '从容易坚持的计划开始，不追求一次做到完美。', category: 'health', status: 'active', milestones: [{ id: 'demo-m1', title: '选好两条散步路线', done: true, doneAt: before }, { id: 'demo-m2', title: '每周运动三次', done: false }, { id: 'demo-m3', title: '完成一次月度回顾', done: false }], createdAt: before, updatedAt: now },
      { id: 'demo-finance', title: '完成本月预算回顾', description: '为下一步留一点余地。', category: 'finance', status: 'completed', milestones: [{ id: 'demo-m4', title: '整理支出分类', done: true, doneAt: before }], createdAt: before, updatedAt: before },
    ],
    monitors: [{ id: 'demo-watch', title: '关注周末车票价格', url: 'https://example.com/travel', condition: 'change', intervalMinutes: 60, status: 'active', createdAt: before, lastCheckedAt: now, checks: 12 }],
    memories: [
      { id: 'demo-memory1', text: '喜欢简洁的中文回复，重要结论放在前面。', source: '演示素材', createdAt: before, updatedAt: before },
      { id: 'demo-memory2', text: '周末更偏好轻松的户外活动。', source: '演示素材', createdAt: before, updatedAt: before },
    ],
    notifications: [{ id: 'demo-approval', kind: 'file_write', title: '保存周末旅行计划', payload: { path: 'weekend-plan.md', content: '# 周末旅行\n\n周六散步，周日参观博物馆。\n\n仅用于审批界面演示，不会写入真实文件。' }, status: 'pending', createdAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }],
  };
}
