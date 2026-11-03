import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { HttpApiClient } from '../src/api/http-client.ts';
import { parseFeatures, parseFeatureSource } from '../src/features/contracts.ts';
import { parseConversationSnapshot } from '../src/api/contracts.ts';
import { projectHistory } from '../src/chat/chat-state.ts';
const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const bindings = { features: [{ id: 'news', name: '新闻', targetSpaceId: 'local-main' }, { id: 'sms', name: '短信', targetSpaceId: 'research' }] };

test('feature binding/source parsing rejects unknown features, internal targets and forged source shapes', () => {
  assert.deepEqual(parseFeatures(bindings), bindings.features);
  assert.throws(() => parseFeatures({ features: [bindings.features[0], bindings.features[0]] }));
  assert.throws(() => parseFeatures({ features: [bindings.features[0], { ...bindings.features[1], targetSpaceId: 'sms-internal' }] }));
  assert.deepEqual(parseFeatureSource({ featureId: 'sms', itemIds: ['item-one'] }), { featureId: 'sms', itemIds: ['item-one'] });
  assert.throws(() => parseFeatureSource({ featureId: 'sms', itemIds: ['../private'] }));
  assert.throws(() => parseFeatureSource({ featureId: 'sms', itemIds: ['item-one'], spaceId: 'other' }));
});

test('verified feature source survives history parsing and bubble projection, never inferred from text', () => {
  const message = { id: 'notice-one', role: 'assistant', content: '来自短信', metadata: { createdAt: '2026-11-02T00:00:00.000Z', source: 'notification', runId: null, jobId: null, notificationId: 'notice-one', feedbackAvailable: true, featureSource: { featureId: 'sms', itemIds: ['item-one'] } }, feedback: { reaction: null, comments: [] } };
  const snapshot = parseConversationSnapshot({ sessionId: 'session-one', revision: 'rev-one', messages: [message] });
  assert.deepEqual(projectHistory(snapshot.messages)[0].featureSource, message.metadata.featureSource);
  const plain = { ...message, metadata: { ...message.metadata } };
  delete plain.metadata.featureSource;
  assert.equal(projectHistory(parseConversationSnapshot({ sessionId: 'session-one', revision: 'rev-one', messages: [plain] }).messages)[0].featureSource, undefined);
  assert.throws(() => parseConversationSnapshot({ sessionId: 'session-one', revision: 'rev-one', messages: [{ ...message, metadata: { ...message.metadata, source: 'chat' } }] }));
});

test('features client uses feature facade and never sends the selected workspace id for SMS', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: new URL(url).pathname, method: init.method ?? 'GET', body });
    if (url.endsWith('/binding')) return Response.json({ id: 'news', name: '新闻', targetSpaceId: 'research' });
    if (url.endsWith('/discussions')) return Response.json({ spaceId: 'research', sessionId: 'session-one', notificationId: 'notice-one', messageId: 'notice-one' });
    if (url.endsWith('/settings')) return Response.json({ enabled: true, batchWindowSeconds: 15 });
    if (url.endsWith('/preferences')) return Response.json({ notes: '', feedbackExamples: [] });
    if (url.includes('/items')) return Response.json({ items: [] });
    return Response.json(bindings);
  };
  try {
    const api = new HttpApiClient('http://127.0.0.1:12343', () => 'isolated-token', () => {});
    assert.equal((await api.listFeatures())[1].targetSpaceId, 'research');
    await api.bindFeature('news', 'research');
    assert.equal((await api.discussNews('article-one')).spaceId, 'research');
    await api.getSmsSettings(); await api.saveSmsSettings({ enabled: true, batchWindowSeconds: 15 });
    await api.getSmsPreferences(); await api.saveSmsPreferences({ notes: '仅提醒重要短信' });
    await api.listSmsItems(); await api.ingestSmsItems([{ source: 'sms', externalId: 'one', content: '原文' }]); await api.triggerSmsRun();
    assert.ok(calls.slice(3).every((call) => call.path.startsWith('/api/features/sms/')));
    assert.ok(calls.every((call) => !Object.hasOwn(call.body ?? {}, 'spaceId') || call.path.endsWith('/binding')));
    assert.equal(calls.filter((call) => call.path.endsWith('/discussions')).length, 1);
  } finally { globalThis.fetch = original; }
});

test('feature settings are separate from space UI and SMS listener lives for the connection, not a settings page', () => {
  assert.doesNotMatch(read('workspace/SpacePage.tsx'), /InformationSettingsCard|SmsSettingsCard|section.*information/);
  assert.match(read('workspace/WorkspaceScreen.tsx'), /<SmsProvider><FilesProvider/);
  assert.match(read('workspace/MemberDirectory.tsx'), /label="打开全局设置"/);
  assert.match(read('information/sms-store.ts'), /api\.ingestSmsItems\(\[/);
  assert.doesNotMatch(read('information/useSmsInformation.ts'), /spaceId|\.catch\(\(\) => \(\{ items: \[\]/);
  assert.match(read('information/useSmsInformation.ts'), /hasSmsPermission !== true/);
  assert.match(read('features/useNewsDiscussion.ts'), /pending\.current \|\| uncertainTarget/);
  assert.match(read('features/useNewsDiscussion.ts'), /await api\.getConversation\(uncertainTarget\)/);
  assert.match(read('workspace/WorkspaceScreen.tsx'), /discussion\.confirmChecked\(\)/);
  assert.match(read('workspace/ConversationView.tsx'), /message\.featureSource/);
  assert.match(read('workspace/ConversationView.tsx'), /featureSourceLabel: \{ .*color: c\.muted/);
});

test('feature settings belong to member profiles; RSS returns to feature settings', () => {
  const screen = read('workspace/WorkspaceScreen.tsx');
  const profile = read('workspace/SpacePage.tsx');
  const settings = screen.slice(screen.indexOf('function SettingsPage'), screen.indexOf('function DisconnectedWorkspace'));
  assert.doesNotMatch(settings, /管理新闻功能|管理短信功能|FeaturePage/);
  assert.match(profile, /isBuiltinMember\(spaceId\)/);
  assert.match(profile, /onPress={onFeatureSettings}/);
  assert.match(screen, /spaces={spaces.sourceSpaces.filter/);
  assert.match(screen, /<NewsSourcesPage store={news} onBack={\(\) => setSettingsSubpage\('news-feature'\)}/);
  assert.match(screen, /page === 'feature' && settingsSubpage === 'news-sources'/);
  assert.match(screen, /if \(newsVisible\) news.open\(\)/);
});

test('native SMS assembles multipart bodies before emitting one event per sender and timestamp', () => {
  const native = readFileSync(new URL('../modules/sms-receiver/android/src/main/java/com/yaotutu/pimusemobile/sms/SmsReceiverModule.kt', import.meta.url), 'utf8');
  assert.match(native, /messages\.groupBy/);
  assert.match(native, /Pair\(msg\.displayOriginatingAddress.*msg\.timestampMillis\)/);
  assert.match(native, /parts\.joinToString\(""\)/);
  assert.ok(native.indexOf('parts.joinToString') < native.indexOf('this@SmsReceiverModule.sendEvent'));
  assert.doesNotMatch(native, /for \(msg in messages\)/);
});
