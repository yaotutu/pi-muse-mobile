import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentViewPreferences, agentHomePage, agentViewPreferenceKey } from '../src/workspace/agent-view-preferences.ts';

const storage = () => {
  const values = new Map();
  return { values, getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } };
};
test('首次新闻默认阅读，普通智能体只有对话；选择写入后重建所有者仍生效', async () => {
  const device = storage(); const prefs = new AgentViewPreferences('http://localhost:12330', device);
  assert.equal(prefs.getSnapshot().ready, false);
  await prefs.load();
  assert.equal(prefs.view('news-internal'), 'reading');
  assert.equal(prefs.view('local-main'), 'chat');
  assert.equal(agentHomePage('news-internal', prefs.view('news-internal')), 'news');
  assert.equal(await prefs.save('news-internal', 'chat'), true);
  const restarted = new AgentViewPreferences('http://localhost:12330/', device);
  await restarted.load();
  assert.equal(restarted.view('news-internal'), 'chat');
  assert.equal(agentHomePage('news-internal', restarted.view('news-internal')), 'chat');
  assert.equal(await restarted.save('local-main', 'reading'), false);
  assert.equal(agentHomePage('local-main', 'reading'), 'chat');
});
test('按服务器隔离，同址重新认证不依赖 token；键只含 SecureStore 允许字符', async () => {
  const device = storage(); const a = new AgentViewPreferences('http://a:12330', device);
  await a.load(); await a.save('news-internal', 'chat');
  const b = new AgentViewPreferences('http://b:12330', device); await b.load();
  assert.equal(b.view('news-internal'), 'reading');
  assert.match(agentViewPreferenceKey('https://example.com/path?value=1'), /^[A-Za-z0-9._-]+$/);
  assert.notEqual(agentViewPreferenceKey('http://a-b'), agentViewPreferenceKey('http://a_b'));
});
test('保存完成前不发布新视图，失败保持原选择并可重试', async () => {
  let finish; let reject;
  const device = storage(); device.setItem = () => new Promise((yes, no) => { finish = yes; reject = no; });
  const prefs = new AgentViewPreferences('http://a', device); await prefs.load();
  const first = prefs.save('news-internal', 'chat');
  assert.equal(prefs.getSnapshot().saving, true); assert.equal(prefs.view('news-internal'), 'reading');
  assert.equal(await prefs.save('news-internal', 'chat'), false);
  reject(new Error('disk')); assert.equal(await first, false);
  assert.equal(prefs.view('news-internal'), 'reading'); assert.match(prefs.getSnapshot().error, /保存失败/);
  const second = prefs.save('news-internal', 'chat'); finish(); assert.equal(await second, true);
  assert.equal(prefs.view('news-internal'), 'chat'); assert.equal(prefs.getSnapshot().error, undefined);
});
test('坏存储与读取失败不能当作未设置，也不能覆盖坏记录', async () => {
  const device = storage(); const key = agentViewPreferenceKey('http://a');
  for (const raw of ['bad-json', '{"version":2,"views":{}}', '{"version":1,"views":{"local-main":"reading"}}']) {
    device.values.set(key, raw); const prefs = new AgentViewPreferences('http://a', device);
    await prefs.load(); assert.equal(prefs.getSnapshot().ready, false);
    assert.match(prefs.getSnapshot().error, /读取失败/);
    assert.equal(await prefs.save('news-internal', 'chat'), false); assert.equal(device.values.get(key), raw);
  }
  device.getItem = async () => { throw new Error('storage'); };
  const prefs = new AgentViewPreferences('http://a', device); await prefs.load();
  assert.equal(prefs.getSnapshot().ready, false);
  device.getItem = async () => null; await prefs.load(); assert.equal(prefs.getSnapshot().ready, true);
});
