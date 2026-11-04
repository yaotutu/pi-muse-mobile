import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const root = read('workspace/WorkspaceScreen.tsx');

test('检查对象与聊天所有者分离；文件、规则、动态跟随检查对象', () => {
  assert.match(root, /const focusedAgentId = settingsAgentId \?\? agents.currentAgent/);
  assert.match(root, /<FilesProvider currentAgentId={settingsAgentId \?\? agents.currentAgent}/);
  assert.match(root, /<ConversationHost currentAgentId={agents.currentAgent}/);
  for (const pattern of [/useAgentState\(focusedAgentId\)/, /useAgentRuntime\(focusedAgentId\)/, /<AgentPage agentId={focusedAgentId}/, /<SessionPanel agentId={focusedAgentId}/]) assert.match(root, pattern);
  const open = root.slice(root.indexOf('const openAgentSettings ='), root.indexOf('const openNews ='));
  assert.match(open, /setChatReturn\(page\)/);
  assert.match(open, /setSettingsAgentId\(id\)/);
  assert.doesNotMatch(open, /selectAgent|refresh\(|setDraft/);
});

test('设置返回原聊天或管理；离开检查对象必须处理文件草稿', () => {
  const back = root.slice(root.indexOf('const backAgent ='), root.indexOf('useEffect(() => {\n    const subscription = BackHandler'));
  assert.match(back, /agentSection === 'home'\) { changeAgent/);
  assert.match(back, /agentReturn === 'management'/);
  assert.match(back, /setSettingsSubpage\('agents'\)/);
  assert.match(back, /else setPage\(chatReturn\)/);
  assert.match(root, /const returnChat = useCallback\(\(\) => changeAgent/);
  assert.match(root, /sessions.discardSettings\(focusedAgentId/);
});

test('创建不抢走私聊；删除当前聊天才让返回目的地回全部', () => {
  const hook = read('agents/useAgents.ts');
  const create = hook.slice(hook.indexOf('const createAgent ='), hook.indexOf('const removeAgent ='));
  assert.doesNotMatch(create, /selectAgent|setCurrentAgent/);
  assert.match(root, /const deletedCurrentChat = id === agents.currentAgent/);
  assert.match(root, /if \(deletedCurrentChat\) setChatReturn\('group'\)/);
  assert.match(root, /deleteBusy.current \|\| agents.creating\) return true/);
});

test('删除未明先读目录，不重发；管理页锁定增删和设置', () => {
  const check = root.slice(root.indexOf('const checkDeletion ='), root.indexOf('const remove ='));
  assert.match(check, /await api.listAgents\(\)/);
  assert.match(check, /!items.some\(\(item\) => item.id === deleteUncertain\)/);
  assert.doesNotMatch(check, /deleteAgent\(|remove\(/);
  assert.match(root, /if \(deleteBusy.current \|\| deleteUncertain \|\| id === MAIN_AGENT \|\| isBuiltinMember\(id\)\) return/);
  const manager = read('workspace/AgentManagement.tsx');
  assert.match(manager, /disabled={locked \|\| !!uncertain}/);
  assert.match(manager, /member.id !== MAIN_AGENT && !isBuiltinMember\(member.id\)/);
  assert.doesNotMatch(read('workspace/AgentPage.tsx'), /删除|onDelete|onChat/);
});
