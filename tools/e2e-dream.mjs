/** 全局 Dream 的真实 HTTP / 外部模型验收入口，仅限可丢弃隔离实例。
 * node --import ./tests/register-source.mjs tools/e2e-dream.mjs
 * 必须设置 E2E_ISOLATED_INSTANCE=1、E2E_BASE_URL、E2E_ACCESS_KEY（或 E2E_TOKEN）。
 * 全局整理可能写资料/记忆/游标，因此禁止对真实实例运行；只清理本轮创建会话及其待决项，恢复原设置。
 * 网络结果未明不自动重发 run 或配置写入；本文件存在不代表已完成真实验收。
 */
import assert from 'node:assert/strict';
import { HttpApiClient } from '../src/api/http-client.ts';
assert.equal(process.env.E2E_ISOLATED_INSTANCE, '1', 'Dream 验收必须使用可丢弃隔离实例');
assert.ok(process.env.E2E_BASE_URL, '必须显式指定隔离实例 URL');
let token = process.env.E2E_TOKEN;
const api = new HttpApiClient(process.env.E2E_BASE_URL, () => token, () => { throw new Error('认证失效'); });
if (!token) token = (await api.createConnectionSession(process.env.E2E_ACCESS_KEY)).token;
const baseline = await api.getDreamOverview(); let session; let settingsChanged = false; let failure;
try {
 session = await api.createSession(`Dream 验收 ${Date.now().toString(36)}`);
 const history = await api.getConversation(session.id);
 let runError;
 await api.runSession({ sessionId: session.id, runId: `dream-input-${Date.now()}`, expectedRevision: history.revision,
  message: { id: `dream-message-${Date.now()}`, content: '这是一条隔离验收消息。请只回复收到，不使用任何工具。' } }, event => { if(event.type === 'RUN_ERROR') runError = event.message; });
 assert.equal(runError, undefined);
 settingsChanged = true;
 const saved = await api.saveDreamSettings({ enabled: false, prompt: '只整理明确可长期保存的事实；不确定内容交给人工，不推测用户偏好。' });
 assert.equal(saved.enabled, false); assert.equal(saved.running, false);
 const result = await api.runDream(); assert.ok(result.lastRun); assert.notEqual(result.lastRun.status, 'failed'); assert.equal(Array.isArray(result.pending), true);
 assert.equal('sessions' in result, false); console.log('PASS global Dream settings, synchronous real-model run and strict response');
} catch(error) { failure = error; }
finally {
 try {
  const current = await api.getDreamOverview();
  for(const item of current.pending) if(session && item.sourceSessionId === session.id) await api.resolveDreamPending(item.id, { action: 'dismiss' });
  if(session) await api.deleteSession(session.id);
  if(settingsChanged) await api.saveDreamSettings({ enabled: baseline.enabled, prompt: baseline.globalPrompt });
 } catch(error) { failure ??= error; }
}
if(failure) throw failure;
console.log('PASS dedicated session/pending cleanup and global settings restoration (isolated instance only)');
