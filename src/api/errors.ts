export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly payload?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 删除中的 409 不能作为普通版本冲突引导用户重试原会话。 */
export function responseError(status: number, payload: unknown, fallback = `请求失败 (${status})`): ApiError {
  const data = payload && typeof payload === 'object' ? payload as { error?: unknown; code?: unknown } : undefined;
  const code = typeof data?.code === 'string' ? data.code : undefined;
  const message = status === 409 && code === 'THREAD_DELETING'
    ? '会话正在删除，请刷新会话列表后重新选择，不要重试原会话'
    : typeof data?.error === 'string' ? data.error : fallback;
  // 审批 409 含当前完整视图；由审批边界校验后消费，不日志记录或持久化错误正文。
  return new ApiError(status, message, code, status === 409 ? payload : undefined);
}

export function requestCancelled() {
  const error = new Error('请求已取消，未确认的操作请刷新后核对');
  error.name = 'AbortError';
  return error;
}

export function isRequestCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
