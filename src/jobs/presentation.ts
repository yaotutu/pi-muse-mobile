import type { JobAction, JobItem, JobStatus, UpdateJobInput } from '../api/types';

export const JOB_PROMPT_LIMIT = 2000;
const pad = (number: number) => String(number).padStart(2, '0');
const absoluteTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
export const jobStatusLabel = (status: JobStatus) => ({ scheduled: '已排期', running: '执行中', paused: '已暂停', succeeded: '上次成功', failed: '上次失败', cancelled: '已取消', queued: '排队中' })[status];
export const jobActionLabel = (action: JobAction | 'delete') => ({ pause: '暂停调度', resume: '恢复调度', cancel: '取消任务', retry: '立即重试', delete: '删除任务' })[action];
export function localJobTime(value?: string): string {
  if (!value) return '未安排';
  const date = new Date(value);
  return !absoluteTime(value) || Number.isNaN(date.getTime()) ? '服务端时间格式异常' : date.toLocaleString();
}
export function availableJobActions(job: JobItem): JobAction[] {
  // 执行中/排队中不提供取消或编辑，避免把调度控制误当作停止模型运行。
  if (job.status === 'running' || job.status === 'queued') return [];
  const actions: JobAction[] = [];
  if (job.enabled) actions.push('pause');
  if (job.status === 'paused') actions.push('resume');
  if (job.status === 'failed') actions.push('retry');
  if (job.status !== 'cancelled' && job.status !== 'succeeded') actions.push('cancel');
  return actions;
}
export type JobEditor = { id: string; prompt: string; daily: boolean; date: string; time: string; original: JobItem };
export function jobEditor(job: JobItem): JobEditor {
  const date = new Date(job.at);
  // 旧服务若返回一次性无偏移时间，不擅自按手机时区解释成另一个绝对时刻。
  const valid = absoluteTime(job.at) && !Number.isNaN(date.getTime());
  return { id: job.id, prompt: job.prompt, daily: job.daily,
    date: !job.daily && valid ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '',
    time: job.daily ? job.at : valid ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '', original: job };
}
export function jobUpdates(editor: JobEditor, now = Date.now()): UpdateJobInput {
  if (!editor.prompt.trim() || editor.prompt.length > JOB_PROMPT_LIMIT) throw new Error(`任务内容须为 1–${JOB_PROMPT_LIMIT} 字符，不能只有空白`);
  const original = jobEditor(editor.original);
  const changed = editor.daily !== original.daily || editor.time !== original.time || (!editor.daily && editor.date !== original.date);
  const updates: UpdateJobInput = {};
  if (editor.prompt !== original.prompt) updates.prompt = editor.prompt;
  if (changed) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(editor.time)) throw new Error('执行时间请填写 HH:mm，例如 09:00');
    if (editor.daily) {
      // 每日时刻原样提交；绝不能先转 UTC，也不把手机时区冒充服务端时区。
      updates.at = editor.time;
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(editor.date)) throw new Error('执行日期请填写 YYYY-MM-DD');
      const [year, month, day] = editor.date.split('-').map(Number);
      const [hour, minute] = editor.time.split(':').map(Number);
      const date = new Date(year, month - 1, day, hour, minute);
      // Date 会宽容进位，须回读年月日/时分，拒绝不存在的日期及夏令时跳跃。
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) throw new Error('日期或本地时间不存在，请重新选择');
      if (date.getTime() <= now) throw new Error('一次性任务请选择未来的时间');
      const offset = -date.getTimezoneOffset();
      updates.at = `${editor.date}T${editor.time}:00${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    }
    updates.daily = editor.daily;
  }
  if (Object.keys(updates).length === 0) throw new Error('尚未修改任务内容或时间');
  return updates;
}
