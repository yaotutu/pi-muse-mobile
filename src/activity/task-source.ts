/**
 * 任务来源选择与表单校验纯函数。
 *
 * 边界：来源列表只允许出现在 sourceThreads（服务端已持久化，永远含 local-main）；
 * currentThread 即便在客户端表示中能解析到，也未必在 sourceThreads 中——
 * 未持久化会话不能作为通知来源，默认回退到 local-main，并交由 UI 文案解释。
 */

import type { ThreadInfo } from '../api/types';

/** 客户端"主会话"哨兵：服务端在 sourceThreads 中始终输出该项。 */
export const LOCAL_MAIN_ID = 'local-main';

/** 任务指令最大长度，避免误粘超长文本撑爆请求/通知正文。 */
export const PROMPT_MAX = 12000;
/** 任务标题最大长度；超长将被服务端截断，校验在客户端先拦。 */
export const TITLE_MAX = 160;

export type TaskInputDraft = { prompt: string; title?: string };

export type ValidationErrors = { prompt?: string; title?: string };

export type NormalizedTaskInput = {
  prompt: string;
  title?: string;
  errors: ValidationErrors;
};

/** 同步提交前的 trim/长度校验；空 prompt 视为非法，超长也非法（不让服务端再返回 400 体验）。 */
export function normalizeTaskInput(input: TaskInputDraft): NormalizedTaskInput {
  // trim 后再做长度判断，避免"全是空格"被算成 0 字符以外通过。
  const prompt = input.prompt.trim();
  const title = input.title?.trim();
  const errors: ValidationErrors = {};
  if (!prompt) errors.prompt = '任务指令不能为空';
  else if (prompt.length > PROMPT_MAX) errors.prompt = `指令最多 ${PROMPT_MAX} 字`;
  if (title && title.length > TITLE_MAX) errors.title = `标题最多 ${TITLE_MAX} 字`;
  return { prompt, title: title || undefined, errors };
}

/** 无错返回 true；用于让提交按钮决定可点态，不重复读 errors 字段。 */
export function isValid(errors: ValidationErrors): boolean {
  return !errors.prompt && !errors.title;
}

/**
 * 选默认来源：currentThread 在 sourceThreads 中则沿用，否则回退到 local-main。
 * 同步纯函数：UI 打开表单时一次决定；之后来源变更只走用户点击，不重新读取 currentThread。
 */
export function defaultSourceId(
  sourceThreads: readonly ThreadInfo[],
  currentThread: string,
): string {
  if (sourceThreads.some((t) => t.id === currentThread)) return currentThread;
  return LOCAL_MAIN_ID;
}

/** 当前会话是否已存在于 sourceThreads：仅用于 UI 显示"未保存"提示文案。 */
export function isCurrentPersisted(
  sourceThreads: readonly ThreadInfo[],
  currentThread: string,
): boolean {
  return sourceThreads.some((t) => t.id === currentThread);
}

/**
 * 防御性补 local-main：服务端承诺列表含 local-main，但客户端不应假设。
 * 重复不去重/不排序，纯插入头部——保持可读性。
 */
export function ensureLocalMain(sourceThreads: readonly ThreadInfo[]): ThreadInfo[] {
  if (sourceThreads.some((t) => t.id === LOCAL_MAIN_ID)) return [...sourceThreads];
  return [{ id: LOCAL_MAIN_ID, updatedAt: '' }, ...sourceThreads];
}
