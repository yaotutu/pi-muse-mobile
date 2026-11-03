import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/errors';
/** 操作状态随连接保留；结果未明时只提供核对入口，绝不自动重发讨论。 */
export function useNewsDiscussion(onDelivered: (agentId: string) => void) {
  const api = useApi(); const active = useRef(true); const pending = useRef(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const [uncertainTarget, setUncertainTarget] = useState<string>();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, [api]);
  const discuss = async (articleId: string) => {
    if (pending.current || uncertainTarget) return;
    pending.current = true; setBusy(true); setError(undefined);
    let target: string | undefined; let submitted = false;
    try {
      target = (await api.listFeatures()).find((feature) => feature.id === 'news')!.targetAgentId;
      submitted = true;
      const receipt = await api.discussNews(articleId);
      if (active.current) onDelivered(receipt.agentId);
    } catch (e) {
      if (!active.current) return;
      const unknown = submitted && (!(e instanceof ApiError) || e.status >= 500 || e.status === 0);
      if (unknown) setUncertainTarget(target);
      setError(unknown ? '带入讨论的结果未明，请进入承接会话核对；不会自动重发。' : e instanceof Error ? e.message : '无法带入讨论');
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  // 用户先查看承接会话，再显式确认；回读成功仅恢复操作，不重发上一次请求。
  const confirmChecked = async () => {
    if (!uncertainTarget || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      await api.getConversation(uncertainTarget);
      if (active.current) { setUncertainTarget(undefined); setError(undefined); }
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : '会话读取失败，请稍后核对');
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return { busy, error, uncertainTarget, discuss, confirmChecked };
}
