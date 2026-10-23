import type { ApiClient, GoalInput } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type { Goal, GoalStatus, GoalsQuery } from '../api/types';

export type GoalClient = Pick<
  ApiClient,
  'listGoals' | 'createGoal' | 'setGoalStatus' | 'toggleMilestone' | 'removeGoal'
>;

export type GoalCreator = {
  title: string;
  description: string;
  category: string;
  milestonesText: string;
};

export type GoalSnapshot = {
  query: GoalsQuery;
  goals: readonly Goal[];
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  creator?: GoalCreator;
  deleteTarget?: { id: string; title: string };
  writing: boolean;
  uncertain: boolean;
  reviewed: boolean;
  error?: string;
  notice?: string;
};

const initial = (): GoalSnapshot => ({
  query: { sort: 'updatedAt', order: 'desc' },
  goals: [],
  loaded: false,
  loading: false,
  stale: true,
  writing: false,
  uncertain: false,
  reviewed: false,
});

export function goalStatusLabel(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return '进行中';
    case 'paused':
      return '已暂停';
    case 'completed':
      return '已完成';
    case 'archived':
      return '已归档';
  }
}

export function goalStatusTone(status: GoalStatus): 'accent' | 'warning' | 'success' | 'neutral' {
  switch (status) {
    case 'active':
      return 'accent';
    case 'paused':
      return 'warning';
    case 'completed':
      return 'success';
    case 'archived':
      return 'neutral';
  }
}

/**
 * 长期目标（/api/goals）端点的连接内状态。
 * 没有 Goals 专属 SSE 或周期轮询；仅在页面可见且前台时按需读取。
 * 离开页面取消在途只读请求；写入中断或超时判定为结果未明并锁定重提，草稿保留，必须人工刷新核对后解锁。
 */
export class GoalStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private readGeneration = 0;
  private writeGeneration = 0;
  private readController?: AbortController;
  private writeController?: AbortController;

  constructor(private readonly client: GoalClient) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<GoalSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private cancelRead() {
    this.readGeneration++;
    this.readController?.abort();
    this.readController = undefined;
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    const hadWrite = this.state.writing;
    this.active = active;
    if (!active) {
      this.cancelRead();
      this.writeGeneration++;
      this.writeController?.abort();
      this.writeController = undefined;
      this.publish({
        loading: false,
        stale: true,
        deleteTarget: undefined,
        writing: false,
        ...(hadWrite
          ? {
              uncertain: true,
              reviewed: false,
              error: '提交结果未明，请刷新目标列表核对；不会自动重试。',
            }
          : {}),
      });
    } else if (this.visible) {
      void this.refresh();
    }
  }

  open() {
    if (this.disposed) return;
    this.visible = true;
    void this.refresh();
  }

  close() {
    this.visible = false;
    this.cancelRead();
    this.publish({ loading: false, stale: true, deleteTarget: undefined });
  }

  canWrite() {
    return (
      this.active &&
      this.visible &&
      this.state.loaded &&
      !this.state.loading &&
      !this.state.stale &&
      !this.state.writing &&
      !this.state.uncertain
    );
  }

  setQuery = (query: GoalsQuery) => {
    if (this.state.writing || this.state.uncertain || this.state.creator) return;
    this.cancelRead();
    this.publish({
      query,
      goals: [],
      loaded: false,
      stale: true,
      deleteTarget: undefined,
      error: undefined,
      notice: undefined,
    });
    void this.refresh();
  };

  invalidate = () => {
    this.publish({ stale: true, deleteTarget: undefined, reviewed: false });
    if (this.visible && !this.state.writing) void this.refresh();
  };

  refresh = async () => {
    if (!this.active || !this.visible || this.state.writing || this.disposed) return;
    this.cancelRead();
    const generation = this.readGeneration;
    const controller = new AbortController();
    this.readController = controller;
    this.publish({ loading: true, deleteTarget: undefined, error: undefined });
    try {
      const goals = await this.client.listGoals(this.state.query, controller.signal);
      if (generation !== this.readGeneration || controller.signal.aborted || this.disposed) return;
      this.publish({
        goals,
        loaded: true,
        stale: false,
        reviewed: this.state.uncertain,
      });
    } catch (error) {
      if (generation !== this.readGeneration || controller.signal.aborted || isRequestCancelled(error)) return;
      this.publish({
        stale: true,
        error: error instanceof Error ? error.message : '目标读取失败，请重试',
      });
    } finally {
      if (generation === this.readGeneration) {
        this.readController = undefined;
        this.publish({ loading: false });
      }
    }
  };

  startCreate = () => {
    if (this.canWrite()) {
      this.publish({
        creator: { title: '', description: '', category: '', milestonesText: '' },
        deleteTarget: undefined,
        error: undefined,
        notice: undefined,
      });
    }
  };

  setCreator = (patch: Partial<GoalCreator>) => {
    if (this.state.creator && !this.state.writing && !this.state.uncertain) {
      this.publish({ creator: { ...this.state.creator, ...patch } });
    }
  };

  cancelCreate = () => {
    if (!this.state.writing && !this.state.uncertain) {
      this.publish({ creator: undefined, error: undefined });
    }
  };

  saveCreate = async () => {
    const creator = this.state.creator;
    if (!creator || !this.canWrite()) return false;
    const title = creator.title.trim();
    if (!title) {
      this.publish({ error: '目标标题不能为空' });
      return false;
    }
    const description = creator.description.trim();
    const category = creator.category.trim();
    const milestones = creator.milestonesText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const input: GoalInput = {
      title,
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
      ...(milestones.length > 0 ? { milestones } : {}),
    };

    return this.write((signal) => this.client.createGoal(input, signal), '目标已创建');
  };

  setStatus = async (id: string, status: GoalStatus) => {
    if (!this.canWrite()) return false;
    const goal = this.state.goals.find((g) => g.id === id);
    if (!goal || goal.status === status) return false;
    return this.write(
      (signal) => this.client.setGoalStatus(id, status, signal),
      `目标状态已更新为${goalStatusLabel(status)}`,
    );
  };

  toggleMilestone = async (goalId: string, milestoneId: string) => {
    if (!this.canWrite()) return false;
    const goal = this.state.goals.find((g) => g.id === goalId);
    if (!goal) return false;
    const milestone = goal.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return false;
    return this.write(
      (signal) => this.client.toggleMilestone(goalId, milestoneId, signal),
      `里程碑“${milestone.title}”状态已更新`,
    );
  };

  requestDelete = (id: string) => {
    if (!this.canWrite()) return;
    const goal = this.state.goals.find((g) => g.id === id);
    if (goal) {
      this.publish({
        deleteTarget: { id: goal.id, title: goal.title },
        error: undefined,
        notice: undefined,
      });
    }
  };

  cancelDelete = () => {
    if (!this.state.writing) {
      this.publish({ deleteTarget: undefined });
    }
  };

  confirmDelete = async () => {
    const target = this.state.deleteTarget;
    if (!target || !this.canWrite()) return false;
    return this.write(
      (signal) => this.client.removeGoal(target.id, signal),
      '目标已删除',
    );
  };

  private async write(action: (signal: AbortSignal) => Promise<unknown>, notice: string) {
    this.cancelRead();
    const generation = ++this.writeGeneration;
    const controller = new AbortController();
    this.writeController = controller;
    this.publish({ writing: true, error: undefined, notice: undefined });
    let success = false;
    try {
      await action(controller.signal);
      if (generation !== this.writeGeneration || controller.signal.aborted || this.disposed) return false;
      success = true;
      this.publish({ creator: undefined, deleteTarget: undefined, stale: true, notice });
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain =
        isRequestCancelled(error) ||
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status === 408 ||
        error.status >= 500;
      this.publish({
        uncertain,
        reviewed: false,
        deleteTarget: undefined,
        stale: true,
        error: uncertain
          ? '提交结果未明，请刷新目标列表核对；不会自动重试。'
          : error instanceof Error ? error.message : '目标操作失败',
      });
    } finally {
      if (generation === this.writeGeneration) {
        this.writeController = undefined;
        this.publish({ writing: false });
        if (success) void this.refresh();
      }
    }
    return success;
  }

  acknowledgeReviewed = () => {
    if (
      this.active &&
      this.visible &&
      this.state.uncertain &&
      this.state.reviewed &&
      !this.state.loading &&
      !this.state.stale
    ) {
      this.publish({
        uncertain: false,
        reviewed: false,
        error: undefined,
        notice: '已解除提交锁定。再次操作会发起新的请求，请确认没有重复。',
      });
    }
  };

  dispose() {
    this.setActive(false);
    this.disposed = true;
    this.visible = false;
    this.state = initial();
    this.listeners.clear();
  }
}
