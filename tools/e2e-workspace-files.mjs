/** 扁平工作区真实 HTTP 验收，仅供显式指定的可丢弃隔离实例。
 * node --import ./tests/register-source.mjs tools/e2e-workspace-files.mjs
 * 必须设置 E2E_ISOLATED_INSTANCE=1、E2E_BASE_URL、E2E_ACCESS_KEY（或 E2E_TOKEN）。
 * 只创建并清理本轮唯一文件，不枚举删除其它文件；未明写入只读核对，不自动重发。
 * 此脚本不构成 Android 或真实模型验收。
 */
import assert from 'node:assert/strict';
import { HttpApiClient } from '../src/api/http-client.ts';
import { FilesStore } from '../src/files/files-store.ts';
assert.equal(process.env.E2E_ISOLATED_INSTANCE, '1', '必须明确使用可丢弃隔离实例');
assert.ok(process.env.E2E_BASE_URL, '必须显式指定隔离实例 URL');
let token = process.env.E2E_TOKEN;
const api = new HttpApiClient(process.env.E2E_BASE_URL, () => token, () => { throw new Error('认证失效'); });
if (!token) token = (await api.createConnectionSession(process.env.E2E_ACCESS_KEY)).token;
const path = `mobile-files-${Date.now().toString(36)}.txt`;
const target = { path }; let owned = false; let failed;
const store = new FilesStore(api);
const waitFor = async (condition) => { const end = Date.now() + 15000; while (!condition()) { assert.ok(Date.now() < end, '文件状态等待超时'); await new Promise(resolve => setTimeout(resolve, 25)); } };
try {
 const before = await api.listWorkspaceFiles({ path: '.' }); assert.ok(!before.entries.some(item => item.path === path));
 store.setActive(true); store.open(); await waitFor(() => store.getSnapshot().loaded && !store.getSnapshot().loading);
 store.beginCreate(); store.setDraftPath(path); store.setDraftContent('before\n完整原文');
 assert.equal(store.requestSave(), true); assert.equal(store.getSnapshot().savePreview.before, ''); assert.equal(store.getSnapshot().savePreview.after, 'before\n完整原文');
 owned = true; assert.equal(await store.confirmSave(), true); await waitFor(() => !store.getSnapshot().loading);
 const first = await api.readWorkspaceFile(target); assert.equal(first.content, 'before\n完整原文'); assert.equal('scope' in first, false);
 store.editFileContent('after\n完整新文'); assert.equal(store.requestSave(), true); assert.equal(store.getSnapshot().savePreview.before, first.content); assert.equal(store.getSnapshot().savePreview.after, 'after\n完整新文');
 assert.equal(await store.confirmSave(), true); assert.equal((await api.readWorkspaceFile(target)).content, 'after\n完整新文');
 console.log('PASS flat workspace HTTP, full before/after confirmation, create/read/update');
} catch(error) { failed = error; }
finally {
 store.dispose();
 if (owned) {
  // 删除只针对本轮唯一文件；先核对是否存在，不重复提交不明删除。
  try { await api.readWorkspaceFile(target); await api.deleteWorkspaceFile(target); } catch(error) { if (error.status !== 404) failed ??= error; }
 }
}
if (failed) throw failed;
console.log('PASS cleaned only the dedicated file');
