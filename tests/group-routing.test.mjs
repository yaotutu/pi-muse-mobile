import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupComposer } from '../src/group/group-composer.ts';
import { RoutingSettingsStore } from '../src/group/routing-settings-store.ts';
import { parseGroupSettings, parseGroupEvent, parseAgentCapability, parseGroup } from '../src/group/contracts.ts';
const config = { name: '全部', purpose: '协作', memberIds: ['local-main', 'sms-internal'], defaultAgentId: 'local-main', instructions: '' };
const suggestion = { type: 'suggestion', id: 'one', content: '我不感兴趣', targetAgentIds: ['local-main', 'sms-internal'], reason: '请选择对象' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('路由配置与建议严格校验成员、默认与原文；默认回复者不再固定 main', () => {
  assert.deepEqual(parseGroupSettings(config), config);
  assert.deepEqual(parseGroupEvent(suggestion), suggestion);
  for (const targetAgentIds of [[], ['sms-internal', 'sms-internal'], ['../other']]) assert.throws(() => parseGroupEvent({ ...suggestion, targetAgentIds }));
  for (const change of [{ memberIds: [] }, { defaultAgentId: 'missing' }, { memberIds: ['local-main', 'local-main'] }]) assert.throws(() => parseGroupSettings({ ...config, ...change }));
  assert.throws(() => parseAgentCapability({ agentId: 'other', capability: 'wrong' }, 'sms-internal'));
  const group = { id: 'main', memberIds: config.memberIds, defaultAgentId: 'sms-internal', turns: [], notifications: [], running: null };
  assert.deepEqual(parseGroup(group), group);
});
test('模糊建议只接纳原提交，取消不产生执行；确认使用新 ID 与原文，不清掉下一条草稿', () => {
  const composer = new GroupComposer(); composer.setDraft(suggestion.content); composer.submit({ id: 'one', content: suggestion.content });
  composer.setDraft('下一条新消息'); composer.setTarget('local-main');
  composer.suggest({ ...suggestion, id: 'stale' }); assert.equal(composer.getSnapshot().suggestion, undefined);
  composer.suggest({ ...suggestion, content: '篡改原文' }); assert.equal(composer.getSnapshot().suggestion, undefined);
  composer.suggest(suggestion);
  composer.reconcile({ turns: [], running: null });
  assert.equal(composer.getSnapshot().suggestion.id, 'one'); assert.equal(composer.getSnapshot().pending, undefined);
  assert.equal(composer.submit({ id: 'not-yet', content: 'new' }), false);
  assert.equal(composer.confirmSuggestion('new-id', 'missing'), undefined);
  assert.deepEqual(composer.confirmSuggestion('new-id', 'sms-internal'), { id: 'new-id', targetAgentId: 'sms-internal', content: suggestion.content });
  assert.equal(composer.getSnapshot().draft, '下一条新消息'); assert.equal(composer.getSnapshot().target, 'local-main');
  assert.equal(composer.confirmSuggestion('duplicate', 'sms-internal'), undefined);
  composer.accept('new-id'); assert.equal(composer.getSnapshot().pending, undefined);
  const cancelled = new GroupComposer(); cancelled.submit({ id: 'one', content: suggestion.content }); cancelled.suggest(suggestion); cancelled.cancelSuggestion();
  assert.equal(cancelled.getSnapshot().suggestion, undefined); assert.equal(cancelled.getSnapshot().pending, undefined);
});
test('含首尾空白的原文可以接纳建议，确认不改写缩进或末尾换行', () => {
  const composer = new GroupComposer(); const content = '  原始缩进\n';
  composer.setDraft(content); composer.submit({ id: 'one', content }); composer.suggest({ ...suggestion, content });
  assert.equal(composer.getSnapshot().suggestion.content, content);
  assert.equal(composer.confirmSuggestion('confirmed', 'sms-internal').content, content);
});
test('连接内保留设置草稿，自动读取不解锁未明保存；显式核对后最后保存生效', async () => {
  let remote = config; let fail = true; let writes = 0;
  const store = new RoutingSettingsStore({ getGroupSettings: async () => remote, saveGroupSettings: async (value) => { writes++; remote = value; if (fail) throw new Error('断流'); return value; },
    getAgentCapability: async (agentId) => ({ agentId, capability: 'original' }) });
  await store.reloadGroup(true); store.editGroup({ ...config, purpose: '草稿' });
  await store.reloadGroup(true); assert.equal(store.group().draft.purpose, '草稿');
  await store.saveGroup(); assert.equal(store.group().needsReadback, true);
  await store.reloadGroup(true); await store.saveGroup(); assert.equal(writes, 1);
  await store.reloadGroup(); assert.equal(store.group().needsReadback, false); assert.equal(store.group().saved.purpose, '草稿');
  fail = false; store.editGroup({ ...config, purpose: '最后保存' }); await store.saveGroup(); assert.equal(remote.purpose, '最后保存');
  await store.reloadCapability('sms-internal', true); store.editCapability({ agentId: 'sms-internal', capability: '未保存' });
  await store.reloadCapability('news-internal', true); await store.reloadCapability('sms-internal', true);
  assert.equal(store.capability('sms-internal').draft.capability, '未保存'); assert.equal(store.capability('news-internal').draft.capability, 'original'); store.dispose();
});
test('保存先废弃旧 GET，离页中的保存仍归原资源；换连接销毁后迟到结果不回写', async () => {
  const stale = deferred(), saving = deferred(); let reads = 0;
  const store = new RoutingSettingsStore({ getGroupSettings: async () => ++reads === 1 ? config : stale.promise, saveGroupSettings: async () => saving.promise });
  await store.reloadGroup(); const reading = store.reloadGroup(); store.editGroup({ ...config, purpose: 'new' }); const writing = store.saveGroup();
  stale.resolve(config); await reading; assert.equal(store.group().draft.purpose, 'new');
  saving.resolve({ ...config, purpose: 'new' }); await writing; assert.equal(store.group().saved.purpose, 'new');
  const late = deferred(); const second = new RoutingSettingsStore({ getGroupSettings: () => late.promise });
  const pending = second.reloadGroup(); second.dispose(); const prior = second.group(); late.resolve(config); await pending; assert.equal(second.group(), prior); store.dispose();
});
