import type { ApiClient, ApprovalDecision, GoalInput, IdentityInput, MonitorAction, Profile, RunInput, TaskAction, TaskControlTarget } from '../../src/api/contracts';
import { ApiError } from '../../src/api/errors';
import type { AgentTask, AgUiEvent, ApprovalNotification, ConversationMessage, Goal, GoalStatus, MemoryItem, Monitor, TaskDetails, WorkspaceSnapshot } from '../../src/api/types';
import { demoWorkspace } from './demo-fixtures';

type DemoThread = { id: string; title: string; archived: boolean; updatedAt: string; version: number; messages: ConversationMessage[] };
type ActiveRun = { id: string; controller: AbortController };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const stamp = () => new Date().toISOString();

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const error = new Error('演示运行已停止');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** 无网络、无持久化；额外演示操作不扩展真实 ApiClient 的服务端契约。 */
export class DemoApiClient implements ApiClient {
  private workspace: WorkspaceSnapshot;
  private profile: Profile = { soul: '温和、清晰。先给结论，再给可执行的下一步。', user: '这是演示用户画像，不包含真实个人信息。' };
  private threads = new Map<string, DemoThread>();
  private runs = new Map<string, ActiveRun>();
  private finished = new Map<string, string>();
  private timelines = new Map<string, TaskDetails['events']>();
  private readApprovals = new Set<string>();
  private sequence = 0;

  constructor(empty = false, private readonly tickMs = 100) {
    this.workspace = demoWorkspace(empty);
    this.thread('local-main');
    if (!empty) {
      const thread = this.thread('demo-weekend');
      thread.title = '周末旅行计划';
      thread.messages = [{ id: 'demo-greeting', role: 'assistant', content: '路线、车票和待办可以放在这个独立会话里。这里的所有内容都是演示素材。' }];
      thread.version = 1;
    }
    for (const task of this.workspace.tasks) this.timelines.set(task.id, [
      { id: `${task.id}-plan`, taskId: task.id, date: task.createdAt, kind: 'plan', title: '明确任务范围', detail: task.prompt },
      { id: `${task.id}-status`, taskId: task.id, date: task.updatedAt, kind: task.error ? 'error' : 'status', title: task.error ? '需要重试' : '已记录任务状态', detail: task.error ?? '本条时间线为演示数据。' },
    ]);
  }

  private id(prefix: string) { return `demo-${prefix}-${++this.sequence}`; }
  private thread(id: string) {
    let item = this.threads.get(id);
    if (!item) {
      item = { id, title: id === 'local-main' ? '主会话' : '新的会话', archived: false, updatedAt: stamp(), version: 0, messages: [] };
      this.threads.set(id, item);
    }
    return item;
  }
  private find<T extends { id: string }>(items: T[], id: string): T {
    const value = items.find((item) => item.id === id);
    if (!value) throw new ApiError(404, '演示条目不存在');
    return value;
  }

  async createSession() { return { token: 'demo-not-a-service-credential', mode: 'demo' }; }
  async listThreads() { return copy([...this.threads.values()].filter((t) => !t.archived).map(({ id, updatedAt }) => ({ id, updatedAt }))); }
  listDemoThreads() { return copy([...this.threads.values()].map(({ id, title, archived, updatedAt }) => ({ id, title, archived, updatedAt }))); }
  renameThread(id: string, title: string) { this.thread(id).title = title.trim() || '新的会话'; }
  archiveThread(id: string, archived: boolean) { if (id !== 'local-main') this.thread(id).archived = archived; }
  async getConversation(id: string) {
    const thread = this.thread(id);
    return { revision: `demo:${thread.version}`, messages: copy(thread.messages) };
  }
  async getSnapshot() { return copy({ ...this.workspace, notifications: this.workspace.notifications.filter((n) => n.status === 'pending') }); }
  approvalHistory() { return copy(this.workspace.notifications.filter((n) => n.status !== 'pending')); }
  isApprovalRead(id: string) { return this.readApprovals.has(id); }
  markApprovalRead(id: string) { this.readApprovals.add(id); }

  async runAgent(input: RunInput, onEvent: (event: AgUiEvent) => void, signal?: AbortSignal) {
    const thread = this.thread(input.threadId);
    const key = `${input.threadId}:${input.runId}`;
    const signature = JSON.stringify(input);
    if (this.finished.has(key)) {
      if (this.finished.get(key) !== signature) throw new ApiError(409, '演示运行 ID 已被使用');
      onEvent({ type: 'MESSAGES_SNAPSHOT', messages: copy(thread.messages) });
      onEvent({ type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId });
      return;
    }
    if (input.expectedRevision !== `demo:${thread.version}` || this.runs.has(input.threadId)) throw new ApiError(409, '演示会话已更新，请重新加载');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.runs.set(input.threadId, { id: input.runId, controller });
    const assistant: ConversationMessage = { id: this.id('assistant'), role: 'assistant', content: '' };
    const messages: ConversationMessage[] = [...copy(thread.messages), { ...input.message, role: 'user' }, assistant];
    let pending: ApprovalNotification | undefined;
    let completed = false;
    const emit = (event: AgUiEvent) => { if (!controller.signal.aborted) onEvent(event); };
    const text = async (value: string) => {
      for (const delta of value.match(/.{1,8}/gs) ?? []) {
        await pause(this.tickMs, controller.signal);
        assistant.content += delta;
        emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: assistant.id, delta });
      }
    };
    try {
      emit({ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId });
      emit({ type: 'TEXT_MESSAGE_START', messageId: assistant.id, role: 'assistant' });
      await pause(this.tickMs, controller.signal);
      const prompt = input.message.content;
      let name = '';
      let args: Record<string, unknown> = {};
      let result: unknown;
      if (/搜索|搜一下/.test(prompt)) {
        name = 'search_web'; args = { query: 'Expo 移动应用开发' };
        result = { results: [{ title: 'Expo SDK 57 文档', url: 'https://docs.expo.dev/versions/v57.0.0/', snippet: '演示来源卡片：了解移动端开发与原生能力。' }, { title: 'React 文档', url: 'https://react.dev/', snippet: '演示来源卡片：组件与交互的基础。' }] };
      } else if (/天气/.test(prompt)) {
        name = 'get_weather'; args = { location: '杭州' };
        result = { location: '杭州', temperature: 23, condition: '晴间多云', low: 18, high: 25, humidity: 62, wind: '东风 2 级', summary: '仅为演示天气，不是实时预报。' };
      } else if (/记住|记忆/.test(prompt)) {
        name = 'memory'; args = { text: '喜欢周末户外散步' };
      } else if (/定时|简报/.test(prompt)) {
        name = 'schedule'; args = { title: '每周回顾', prompt: '每周整理目标进展。' };
      } else if (/监控|车票/.test(prompt)) {
        name = 'monitor'; args = { url: 'https://example.com/travel', title: '关注旅行页面' };
      } else if (/后台|任务|旅行/.test(prompt)) {
        name = 'delegate_task'; args = { prompt: '整理一个轻松的周末旅行计划', title: '周末旅行计划' };
      } else if (/预览|读取/.test(prompt)) {
        name = 'read'; args = { path: 'weekend-plan.md' }; result = { content: '# 周末计划\n\n- 周六：沿河散步\n- 周日：博物馆与咖啡\n\n此内容是内存演示素材，没有读取真实文件。' };
      } else if (/写入|审批/.test(prompt)) {
        name = 'write'; args = { path: 'weekend-plan.md', content: '周末计划演示内容，不会写入真实文件。' };
      }
      if (name) {
        const callId = this.id('tool');
        const argumentsText = JSON.stringify(args);
        assistant.toolCalls = [{ id: callId, type: 'function', function: { name, arguments: argumentsText } }];
        emit({ type: 'TOOL_CALL_START', toolCallId: callId, toolCallName: name, parentMessageId: assistant.id });
        emit({ type: 'TOOL_CALL_ARGS', toolCallId: callId, delta: argumentsText });
        emit({ type: 'TOOL_CALL_END', toolCallId: callId });
        await pause(this.tickMs * 3, controller.signal);
        if (name === 'memory') result = { ...await this.addMemory(String(args.text), '演示对话'), success: true };
        if (name === 'delegate_task') result = { ...await this.createTask(String(args.prompt), String(args.title)), success: true };
        if (name === 'schedule') {
          const task = await this.createTask(String(args.prompt), String(args.title));
          const stored = this.find(this.workspace.tasks, task.id);
          stored.kind = 'job'; stored.status = 'scheduled'; stored.nextRunAt = new Date(Date.now() + 86_400_000).toISOString();
          result = { ...stored, success: true };
        }
        if (name === 'monitor') {
          const monitor: Monitor = { id: this.id('monitor'), title: String(args.title), url: String(args.url), condition: 'change', intervalMinutes: 60, status: 'active', createdAt: stamp(), checks: 0 };
          this.workspace.monitors.unshift(monitor); result = { ...monitor, success: true };
        }
        if (name === 'write') {
          pending = { id: this.id('approval'), kind: 'file_write', title: '保存周末计划（演示）', payload: { path: String(args.path), content: String(args.content) }, status: 'pending', createdAt: stamp(), threadId: input.threadId, runId: input.runId };
          this.workspace.notifications.unshift(pending);
          while (pending.status === 'pending') await pause(this.tickMs, controller.signal);
          result = { success: pending.status === 'approved', status: pending.status, message: pending.status === 'approved' ? '已批准演示操作，没有写入真实文件。' : '已拒绝，没有执行操作。' };
        }
        const content = JSON.stringify(result);
        messages.push({ id: this.id('result'), role: 'tool', toolCallId: callId, content });
        emit({ type: 'TOOL_CALL_RESULT', toolCallId: callId, content });
      }
      if (/失败/.test(prompt)) throw new ApiError(503, '这是可复现的演示失败；重新加载后可以再发一条消息。');
      await text(name ? '结果已整理在工具卡中。你可以打开对应页面继续查看和调整；这里的所有操作都只影响演示工作区。' : /慢流/.test(prompt) ? '这是慢速回复演示。你可以切换到其他页面，回复会继续生成；也可以点击停止，再开始下一轮对话。'.repeat(3) : '你好，我是 Pi Muse。我们可以一起整理任务、跟进目标，或记住对你重要的事情。想从哪件小事开始？');
      emit({ type: 'TEXT_MESSAGE_END', messageId: assistant.id });
      emit({ type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId });
      completed = true;
      this.finished.set(key, signature);
    } catch (e) {
      if (pending?.status === 'pending') pending.status = 'cancelled';
      if (!controller.signal.aborted) emit({ type: 'RUN_ERROR', message: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      thread.messages = messages;
      thread.version++;
      thread.updatedAt = stamp();
      signal?.removeEventListener('abort', abort);
      if (this.runs.get(input.threadId)?.controller === controller) this.runs.delete(input.threadId);
      // 未收到工具结果的中断历史不伪造成功；聚合器按未完成调用展示。
      if (!completed && !assistant.content && !assistant.toolCalls) thread.messages = messages.filter((m) => m !== assistant);
    }
  }

  async stopRun(threadId: string, runId: string) {
    const run = this.runs.get(threadId);
    if (!run || run.id !== runId || run.controller.signal.aborted) return false;
    run.controller.abort(); return true;
  }
  dispose() { for (const run of this.runs.values()) run.controller.abort(); }

  async createTask(prompt: string, title?: string) {
    const task: AgentTask = { id: this.id('task'), title: title || prompt, prompt, kind: 'task', status: 'queued', createdAt: stamp(), updatedAt: stamp(), error: null };
    this.workspace.tasks.unshift(task);
    this.timelines.set(task.id, [{ id: this.id('event'), taskId: task.id, date: stamp(), kind: 'plan', title: '已加入演示队列', detail: prompt }]);
    return copy(task);
  }
  advanceTask(id: string) {
    const task = this.find(this.workspace.tasks, id);
    if (task.kind !== 'task' || !['queued', 'running'].includes(task.status)) throw new ApiError(409, '此任务不能推进演示状态');
    task.status = task.status === 'queued' ? 'running' : 'succeeded';
    task.updatedAt = stamp();
    if (task.status === 'succeeded') task.result = '演示任务已完成。这里没有运行真实后台工作。';
    const events = this.timelines.get(id) ?? [];
    events.push({ id: this.id('event'), taskId: id, date: stamp(), kind: task.status === 'succeeded' ? 'result' : 'step', title: task.status === 'succeeded' ? '演示任务完成' : '演示任务开始', detail: task.result ?? '正在整理演示素材。' });
    this.timelines.set(id, events);
  }
  async getTask(id: string) { return copy({ task: this.find(this.workspace.tasks, id), events: this.timelines.get(id) ?? [] }); }
  async controlTask(id: string, action: TaskAction, target: TaskControlTarget) {
    const task = this.find(this.workspace.tasks, id);
    if (task.kind !== target) throw new ApiError(409, '任务类型不匹配');
    const allowed = target === 'job' ? (action === 'pause' && task.status === 'scheduled') || (action === 'resume' && task.status === 'paused') || (action === 'cancel' && ['scheduled', 'paused', 'running'].includes(task.status)) : (action === 'retry' && ['failed', 'cancelled'].includes(task.status)) || (action === 'cancel' && ['queued', 'running'].includes(task.status));
    if (!allowed) throw new ApiError(409, '当前状态不能执行此操作');
    task.status = action === 'pause' ? 'paused' : action === 'resume' ? 'scheduled' : action === 'cancel' ? 'cancelled' : 'succeeded';
    task.updatedAt = stamp(); task.error = null;
    if (action === 'retry') task.result = '演示重试完成，没有执行真实后台工作。';
    const events = this.timelines.get(id) ?? [];
    events.push({ id: this.id('event'), taskId: id, date: stamp(), kind: 'status', title: '任务状态已更新', detail: task.status });
    this.timelines.set(id, events);
    return copy(task);
  }
  async controlMonitor(id: string, action: MonitorAction) {
    const item = this.find(this.workspace.monitors, id);
    if (item.status === 'stopped') throw new ApiError(409, '已停止的监控不能恢复');
    item.status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped'; return copy(item);
  }
  async decideAction(id: string, decision: ApprovalDecision) {
    const item = this.find(this.workspace.notifications, id);
    if (item.status !== 'pending') throw new ApiError(409, '审批已经处理');
    item.status = decision === 'approve' ? 'approved' : 'denied'; item.decidedAt = stamp(); return copy(item);
  }
  async createGoal(input: GoalInput) {
    const goal: Goal = { id: this.id('goal'), title: input.title, description: input.description ?? '', category: input.category ?? '', status: 'active', milestones: (input.milestones ?? []).map((title) => ({ id: this.id('milestone'), title, done: false })), createdAt: stamp(), updatedAt: stamp() };
    this.workspace.goals.unshift(goal); return copy(goal);
  }
  async updateGoal(id: string, input: Partial<Omit<GoalInput, 'milestones'>>) { const item = this.find(this.workspace.goals, id); Object.assign(item, input, { updatedAt: stamp() }); return copy(item); }
  async setGoalStatus(id: string, status: GoalStatus) {
    const item = this.find(this.workspace.goals, id); item.status = status; item.updatedAt = stamp();
    if (status === 'completed') for (const milestone of item.milestones) { milestone.done = true; milestone.doneAt ??= stamp(); }
    return copy(item);
  }
  async toggleMilestone(goalId: string, milestoneId: string) {
    const goal = this.find(this.workspace.goals, goalId); const milestone = this.find(goal.milestones, milestoneId);
    milestone.done = !milestone.done; milestone.doneAt = milestone.done ? stamp() : undefined; goal.updatedAt = stamp(); return copy(goal);
  }
  async removeGoal(id: string) { this.find(this.workspace.goals, id); this.workspace.goals = this.workspace.goals.filter((item) => item.id !== id); }
  async saveIdentity(input: IdentityInput) { Object.assign(this.workspace.identity, input); return copy(this.workspace.identity); }
  async addMemory(text: string, source = '演示工作区') {
    const item: MemoryItem = { id: this.id('memory'), text, source, createdAt: stamp(), updatedAt: stamp() };
    this.workspace.memories.unshift(item); return copy(item);
  }
  async editMemory(id: string, text: string) { const item = this.find(this.workspace.memories, id); item.text = text; item.updatedAt = stamp(); return copy(item); }
  async forgetMemory(id: string) { this.find(this.workspace.memories, id); this.workspace.memories = this.workspace.memories.filter((item) => item.id !== id); }
  async getProfile() { return copy(this.profile); }
  async saveProfile(profile: Profile) { this.profile = copy(profile); return copy(this.profile); }
}
