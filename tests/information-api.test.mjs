import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import {
  parseInformationSettings,
  parseInformationPreferences,
  parseInformationItem,
  parseInformationIngestResult,
  parseInformationItemsPage,
} from '../src/information/contracts.ts';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('parseInformationSettings validates shape and rejects illegal values', () => {
  assert.deepEqual(parseInformationSettings({ enabled: true, batchWindowSeconds: 15 }), {
    enabled: true,
    batchWindowSeconds: 15,
  });
  assert.throws(() => parseInformationSettings({ enabled: 'true', batchWindowSeconds: 15 }), ApiError);
  assert.throws(() => parseInformationSettings({ enabled: true, batchWindowSeconds: -1 }), ApiError);
  assert.throws(() => parseInformationSettings({ enabled: true, batchWindowSeconds: 3601 }), ApiError);
});

test('parseInformationPreferences parses valid notes and feedback examples', () => {
  const payload = {
    notes: '整理重要快递',
    feedbackExamples: [{
      runId: 'run-1',
      notificationId: 'notif-1',
      text: '已发现快递取件码',
      reaction: 'like',
      comments: ['很有用'],
      commentsTruncated: false,
      items: [{
        id: 'item-1',
        source: 'sms',
        title: '顺丰速运',
        content: '您的快递已送达',
        contentTruncated: false,
      }],
    }],
  };
  const parsed = parseInformationPreferences(payload);
  assert.equal(parsed.notes, '整理重要快递');
  assert.equal(parsed.feedbackExamples.length, 1);
  assert.equal(parsed.feedbackExamples[0].reaction, 'like');
  assert.equal(parsed.feedbackExamples[0].items[0].source, 'sms');

  assert.throws(() => parseInformationPreferences({ notes: 123, feedbackExamples: [] }), ApiError);
});

test('parseInformationItem and ingest results parse valid items', () => {
  const rawItem = {
    id: 'item-100',
    spaceId: 'local-main',
    source: 'sms',
    externalId: 'ext-100',
    title: '银行通知',
    content: '您的账户到账 1000 元',
    receivedAt: '2026-10-31T00:00:00Z',
    acceptedAt: '2026-10-31T00:00:01Z',
    status: 'pending',
  };
  const item = parseInformationItem(rawItem);
  assert.equal(item.id, 'item-100');
  assert.equal(item.status, 'pending');
  assert.equal(item.source, 'sms');

  const ingestResult = parseInformationIngestResult({ items: [rawItem] });
  assert.equal(ingestResult.length, 1);
  assert.equal(ingestResult[0].id, 'item-100');

  const pageResult = parseInformationItemsPage({ items: [rawItem], nextCursor: 'cursor-abc' });
  assert.equal(pageResult.items.length, 1);
  assert.equal(pageResult.nextCursor, 'cursor-abc');
});

test('HttpApiClient routes information API calls with correct methods and endpoints', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.includes('/information/settings') && init?.method === 'PUT') {
      return json({ enabled: true, batchWindowSeconds: 20 });
    }
    if (url.includes('/information/settings')) {
      return json({ enabled: false, batchWindowSeconds: 15 });
    }
    if (url.includes('/information/preferences') && init?.method === 'PUT') {
      return json({ notes: '新偏好', feedbackExamples: [] });
    }
    if (url.includes('/information/preferences')) {
      return json({ notes: '旧偏好', feedbackExamples: [] });
    }
    if (url.includes('/information/items') && init?.method === 'POST') {
      return json({ items: [{
        id: 'new-1',
        spaceId: 'space-test',
        source: 'sms',
        externalId: 'ext-1',
        content: '短信内容',
        receivedAt: '2026-10-31T00:00:00Z',
        acceptedAt: '2026-10-31T00:00:00Z',
        status: 'pending',
      }] });
    }
    if (url.includes('/information/items')) {
      return json({ items: [], nextCursor: undefined });
    }
    if (url.includes('/information/runs') && init?.method === 'POST') {
      return json({ ok: true });
    }
    return json({}, 404);
  };

  try {
    const client = new HttpApiClient('http://test-server:12330', () => 'test-token', () => {});
    const settings = await client.getInformationSettings('space-test');
    assert.equal(settings.enabled, false);

    const savedSettings = await client.saveInformationSettings('space-test', { enabled: true, batchWindowSeconds: 20 });
    assert.equal(savedSettings.enabled, true);
    assert.equal(savedSettings.batchWindowSeconds, 20);

    const prefs = await client.getInformationPreferences('space-test');
    assert.equal(prefs.notes, '旧偏好');

    const savedPrefs = await client.saveInformationPreferences('space-test', { notes: '新偏好' });
    assert.equal(savedPrefs.notes, '新偏好');

    const ingested = await client.ingestInformationItems('space-test', [{
      source: 'sms',
      externalId: 'ext-1',
      content: '短信内容',
    }]);
    assert.equal(ingested.length, 1);
    assert.equal(ingested[0].id, 'new-1');

    const listed = await client.listInformationItems('space-test', { limit: 10, status: 'pending' });
    assert.deepEqual(listed.items, []);

    await client.triggerInformationRun('space-test');

    assert.equal(calls.length, 7);
    assert.ok(calls[0].url.endsWith('/api/spaces/space-test/information/settings'));
    assert.equal(calls[1].method, 'PUT');
    assert.ok(calls[4].url.endsWith('/api/spaces/space-test/information/items'));
    assert.equal(calls[4].method, 'POST');
    assert.ok(calls[5].url.includes('/api/spaces/space-test/information/items?limit=10&status=pending'));
    assert.ok(calls[6].url.endsWith('/api/spaces/space-test/information/runs'));
    assert.equal(calls[6].method, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
