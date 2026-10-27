/** 附件契约、HTTP DTO 投影、空间草稿归属与未确认重试的确定性回归；不代表真实模型验收。 */

import './helpers/register-conversation-tests.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const {
  MAX_TOTAL_ATTACHMENT_BYTES,
  bytesToBase64,
  createAttachmentDrafts,
  createAttachmentDraftsFromBytes,
  isCanonicalBase64,
  pickedMimeType,
  validateOutgoingMessage,
} = await import('../src/attachments/validation.ts');
const { HttpApiClient } = await import('../src/api/http-client.ts');
const { parseConversationSnapshot, parseMessagesSnapshotEvent } = await import('../src/api/contracts.ts');
const { ApiError } = await import('../src/api/errors.ts');
const { SpaceStore } = await import('../src/spaces/space-store.ts');
const { createMockApi } = await import('./helpers/conversation-test-harness.ts');
const { renderConversationHook } = await import('./helpers/hook-runner.ts');
const { projectHistory } = await import('../src/chat/chat-state.ts');

const base64 = (value) => Buffer.from(value).toString('base64');
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBase64 = pngHeader.toString('base64');
const textBase64 = base64('文本附件内容');

const makeDrafts = (inputs) => {
  const result = createAttachmentDrafts(inputs);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.attachments;
};

const imageInput = {
  id: 'image-1', name: 'probe.png', mimeType: 'image/png', dataBase64: pngBase64,
};
const textInput = {
  id: 'text-1', name: 'notes.txt', mimeType: 'text/plain', dataBase64: textBase64,
};

test('附件校验保留原始 Base64、识别图片/文本并执行字节上限', () => {
  assert.equal(bytesToBase64(pngHeader), pngBase64);
  const drafts = makeDrafts([imageInput, textInput]);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].kind, 'image');
  assert.equal(drafts[0].size, pngHeader.length);
  assert.equal(drafts[0].image?.dataBase64, pngBase64);
  assert.equal(drafts[1].kind, 'text');
  assert.equal(drafts[1].size, Buffer.byteLength('文本附件内容'));
  assert.equal('image' in drafts[1], false);

  const invalidCases = [
    [[{ ...imageInput, mimeType: 'image/jpeg' }], /图片 MIME/],
    [[{ ...imageInput, dataBase64: `x${pngBase64}` }], /Base64/],
    [[{ ...imageInput, dataBase64: base64('%PDF-1.4') }], /图片 MIME/],
    [[{ id: 'pdf', name: 'a.pdf', mimeType: 'application/pdf', dataBase64: base64('%PDF-1.4') }], /仅支持/],
    [[{ ...textInput, dataBase64: base64(Buffer.from([0xff, 0xfe])) }], /UTF-8/],
    [[{ ...textInput, dataBase64: base64(Buffer.from([0])) }], /NUL/],
    [[{ ...textInput, dataBase64: '' }], /Base64/],
    [Array.from({ length: 5 }, (_, index) => ({ ...textInput, id: `text-${index}` })), /最多/],
    [[
      { ...textInput, id: 'text-a', dataBase64: base64('a'.repeat(50_000)) },
      { ...textInput, id: 'text-b', name: 'b.txt', dataBase64: base64('b'.repeat(50_001)) },
    ], /文本附件合计/],
    [[{
      ...imageInput,
      dataBase64: Buffer.concat([pngHeader, Buffer.alloc(8 * 1024 * 1024 + 1)]).toString('base64'),
    }], /附件总大小|图片/],
  ];
  for (const [inputs, pattern] of invalidCases) {
    const result = createAttachmentDrafts(inputs);
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
  }

  assert.equal(validateOutgoingMessage('', []).ok, false);
  const onlyTextAttachment = validateOutgoingMessage('', [textInput]);
  assert.equal(onlyTextAttachment.ok, true);
  assert.equal(onlyTextAttachment.attachments.length, 1);
});

test('Base64 分块、canonical 检查、严格 UTF-8 与系统 MIME 投影回归', () => {
  // 回归记录：早期 32768 字节分块不是 3 的倍数，曾把连续组拆成独立 padding；
  // 单个大正则也曾在 Hermes/Node 上栈溢出。这里只比较结果，不打印大字符串。
  const candidateUrls = [
    new URL('../../audit-archives/integration-audit/attachments/vision-probe.png', import.meta.url),
    new URL('../../integration-audit/attachments/vision-probe.png', import.meta.url),
  ];
  const pngUrl = candidateUrls.find((url) => existsSync(url)) ?? new URL('../assets/favicon.png', import.meta.url);
  const realPng = readFileSync(pngUrl);
  assert.equal(bytesToBase64(realPng), realPng.toString('base64'));
  for (const size of [32_767, 32_768, 32_769, 60_000, 100_001]) {
    const bytes = Buffer.alloc(size, (index) => (index * 31 + size) & 0xff);
    assert.equal(bytesToBase64(bytes), bytes.toString('base64'), `size=${size}`);
  }
  const random = Buffer.alloc(MAX_TOTAL_ATTACHMENT_BYTES);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < random.length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    random[i] = (seed >>> 16) & 0xff;
  }
  assert.equal(bytesToBase64(random), random.toString('base64'));

  assert.equal(isCanonicalBase64('AB=='), false, '非 canonical padding 必须拒绝');
  assert.equal(isCanonicalBase64('AQ=='), true);
  assert.equal(isCanonicalBase64('wK8='), true, 'Base64 本身 canonical；UTF-8 错误由字节校验拒绝');
  assert.equal(createAttachmentDrafts([{ ...textInput, dataBase64: 'wK8=' }]).error, '文本附件 notes.txt 不是有效 UTF-8');
  for (const bytes of [
    Buffer.from([0xc2, 0xaf]),
    Buffer.from([0xe4, 0xb8, 0xad]),
    Buffer.from([0xf0, 0x9f, 0x98, 0x80]),
  ]) {
    const result = createAttachmentDraftsFromBytes([{ ...textInput, data: bytes }]);
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
  }
  for (const bytes of [
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xc1, 0xbf]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xf4, 0x90, 0x80, 0x80]),
    Buffer.from([0xe4, 0xb8]),
  ]) {
    const result = createAttachmentDraftsFromBytes([{ ...textInput, data: bytes }]);
    assert.equal(result.ok, false);
    assert.match(result.error, /UTF-8/);
  }

  assert.equal(pickedMimeType('code.ts', 'video/mp2t'), 'application/octet-stream');
  assert.equal(pickedMimeType('code.py', 'text/x-python'), 'application/octet-stream');
  assert.equal(pickedMimeType('photo.JPG', 'IMAGE/JPG'), 'image/jpeg');
  assert.equal(pickedMimeType('notes.txt', undefined), 'text/plain');
  assert.equal(pickedMimeType('unknown.bin', undefined, 'image/png'), 'image/png');
});

test('HttpApiClient 只上传四字段 DTO，并严格解析历史与流快照附件', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  // SSE 响应同时验证 MESSAGES_SNAPSHOT 附件解析与上传 DTO 的字段白名单。
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const snapshot = {
      type: 'MESSAGES_SNAPSHOT',
      messages: [{
        id: 'message-1', role: 'user', content: '',
        attachments: [{
          id: 'image-1', name: 'probe.png', kind: 'image', mimeType: 'image/png',
          size: pngHeader.length, sha256: 'a'.repeat(64),
          image: { mimeType: 'image/png', dataBase64: pngBase64 },
        }],
      }],
    };
    return new Response(`data: ${JSON.stringify(snapshot)}\n\ndata: {"type":"RUN_FINISHED"}\n\n`);
  };
  try {
    const client = new HttpApiClient('https://api.example', () => 'token', () => {});
    const events = [];
    await client.runAgent({
      spaceId: 'space-1',
      runId: 'run-1',
      expectedRevision: 'rev-1',
      message: { id: 'message-1', content: '', attachments: [makeDrafts([imageInput])[0]] },
    }, (event) => events.push(event));
    assert.deepEqual(requestBody.message.attachments, [{
      id: 'image-1', name: 'probe.png', mimeType: 'image/png', dataBase64: pngBase64,
    }]);
    assert.equal('attachments' in requestBody.message, true);
    assert.equal(requestBody.message.attachments[0].kind, undefined);
    assert.equal(requestBody.message.attachments[0].size, undefined);
    assert.equal(requestBody.message.attachments[0].image, undefined);
    assert.equal(events[0].messages[0].attachments[0].image.dataBase64, pngBase64);
    assert.equal(projectHistory(events[0].messages)[0].attachments[0].kind, 'image');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const parsed = parseConversationSnapshot({
    revision: 'rev-1',
    messages: [{
      id: 'message-1', role: 'user', content: '', attachments: [{
        id: 'text-1', name: 'notes.txt', kind: 'text', mimeType: 'text/plain',
        size: 18, sha256: '0'.repeat(64),
      }],
    }],
  });
  assert.equal(parsed.messages[0].attachments[0].image, undefined);
  assert.throws(() => parseMessagesSnapshotEvent({
    type: 'MESSAGES_SNAPSHOT',
    messages: [{
      id: 'bad', role: 'user', attachments: [{
        id: 'bad', name: 'bad.png', kind: 'image', mimeType: 'image/png', size: 1,
        sha256: 'x'.repeat(64), image: { mimeType: 'image/png', dataBase64: `data:image/png;base64,${pngBase64}` },
      }],
    }],
  }), /会话历史格式不正确/);
});

test('HttpApiClient 文本消息不携带 attachments 字段且本地坏附件不发 HTTP', async () => {
  const originalFetch = globalThis.fetch;
  let called = 0;
  let textBody;
  globalThis.fetch = async (_url, init) => {
    called += 1;
    textBody = JSON.parse(init.body);
    return new Response('data: {"type":"RUN_FINISHED"}\n\n');
  };
  try {
    const client = new HttpApiClient('https://api.example', () => undefined, () => {});
    await client.runAgent({
      spaceId: 'space-1', runId: 'run-1', expectedRevision: 'rev-1',
      message: { id: 'message-1', content: 'hello' },
    }, () => {});
    assert.equal('attachments' in textBody.message, false);
    assert.equal(called, 1);
    await assert.rejects(client.runAgent({
      spaceId: 'space-1', runId: 'run-2', expectedRevision: 'rev-1',
      message: { id: 'message-2', content: 'hello', attachments: [{ ...imageInput, dataBase64: '!!!' }] },
    }, () => {}), (error) => error instanceof ApiError && error.status === 400);
    assert.equal(called, 1, '坏附件必须在 HTTP 前拒绝');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SpaceStore 按空间与 epoch 管理附件草稿、失败载荷和生命周期', () => {
  const store = new SpaceStore({});
  const epoch = store.get('space-1').epoch;
  const drafts = makeDrafts([imageInput, textInput]);

  // 系统选择器返回时常伴随连接短暂 disabled；不能因此丢掉已读到的结果。
  store.setEnabled(false);
  assert.equal(store.appendDraftAttachments('space-1', epoch, drafts).ok, true);
  assert.deepEqual(store.get('space-1').draftAttachments, drafts);
  assert.equal(store.appendDraftAttachments('space-1', epoch, drafts).ok, false, '重复 ID 被拒绝');
  assert.equal(store.get('space-1').draftAttachments.length, 2);
  store.setEnabled(true);

  assert.equal(store.removeDraftAttachment('space-1', epoch, 'text-1'), true);
  assert.equal(store.get('space-1').draftAttachments.length, 1);
  assert.equal(store.clearDraftAttachments('space-1', epoch), true);
  assert.deepEqual(store.get('space-1').draftAttachments, []);

  // 回归：两次系统选择各自 60KB 均合法，但追加后文本合计超限时必须保留第一次草稿。
  const firstLargeText = createAttachmentDraftsFromBytes([{
    id: 'large-text-1', name: 'first.txt', mimeType: 'text/plain', data: Buffer.alloc(60_000, 0x61),
  }]).attachments[0];
  const secondLargeText = createAttachmentDraftsFromBytes([{
    id: 'large-text-2', name: 'second.txt', mimeType: 'text/plain', data: Buffer.alloc(60_000, 0x62),
  }]).attachments[0];
  assert.equal(store.appendDraftAttachments('space-1', epoch, [firstLargeText]).ok, true);
  const overflow = store.appendDraftAttachments('space-1', epoch, [secondLargeText]);
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /文本附件合计/);
  assert.deepEqual(store.get('space-1').draftAttachments, [firstLargeText]);
  assert.equal(store.clearDraftAttachments('space-1', epoch), true);

  store.setPendingSubmission('space-1', epoch, {
    messageId: 'message-1', runId: 'run-1', text: '', epoch, status: 'failed',
    error: '失败', attachments: drafts,
  });
  assert.equal(store.restorePendingSubmissionToDraft('space-1'), true);
  assert.deepEqual(store.get('space-1').draftAttachments, drafts);
  assert.equal(store.get('space-1').pendingSubmission, null);

  store.bindSession('space-1', 'session-1');
  store.setDraftAttachments('space-1', store.get('space-1').epoch, drafts);
  store.setPendingSubmission('space-1', store.get('space-1').epoch, {
    messageId: 'message-2', runId: 'run-2', text: 'x', epoch: store.get('space-1').epoch,
    status: 'unconfirmed', attachments: drafts,
  });
  const oldEpoch = store.get('space-1').epoch;
  store.bindSession('space-1', 'session-2');
  assert.equal(store.get('space-1').epoch, oldEpoch + 1);
  assert.deepEqual(store.get('space-1').draftAttachments, []);
  assert.equal(store.get('space-1').pendingSubmission, null);
  assert.equal(store.appendDraftAttachments('space-1', oldEpoch, drafts).ok, false, '旧 epoch 迟到结果不得写入新会话');
});

test('useConversation 支持纯附件发送、服务端历史附件替换乐观视图', async () => {
  let persisted = false;
  let submitted;
  const api = createMockApi({
    getConversation: async () => persisted
      ? {
          revision: 'rev-2',
          messages: [{
            id: submitted?.message.id, role: 'user', content: '', attachments: [{
              id: 'image-1', name: 'probe.png', kind: 'image', mimeType: 'image/png',
              size: pngHeader.length, sha256: 'a'.repeat(64),
              image: { mimeType: 'image/png', dataBase64: pngBase64 },
            }],
          }],
        }
      : { revision: 'rev-1', messages: [] },
    runAgent: async (input, onEvent) => {
      submitted = input;
      persisted = true;
      onEvent({ type: 'RUN_FINISHED' });
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    const drafts = makeDrafts([imageInput]);
    let accepted = false;
    await hook.result.current.send('', () => { accepted = true; }, drafts);
    assert.equal(accepted, true);
    assert.equal(submitted.message.content, '');
    assert.equal(submitted.message.attachments[0].dataBase64, pngBase64);
    assert.equal(store.get('space-1').pendingSubmission, null);
    const user = hook.result.current.views.find((view) => view.id === submitted.message.id);
    assert.ok(user);
    assert.equal(user.attachments[0].image.dataBase64, pngBase64);
  } finally {
    hook.unmount();
  }
});

test('failed 附件消息显式 retry 复用原 message/run 与原始附件', async () => {
  let persisted = false;
  const calls = [];
  const api = createMockApi({
    getConversation: async () => persisted
      ? {
          revision: 'rev-2',
          messages: [
            { id: calls.at(-1)?.message.id, role: 'user', content: '', attachments: [{ id: 'text-1', name: 'notes.txt', kind: 'text', mimeType: 'text/plain', size: 18, sha256: '0'.repeat(64) }] },
            { id: 'assistant-1', role: 'assistant', content: 'ok' },
          ],
        }
      : { revision: 'rev-1', messages: [] },
    runAgent: async (input, onEvent) => {
      calls.push(input);
      if (calls.length === 1) throw new ApiError(400, '服务端拒绝附件');
      persisted = true;
      onEvent({ type: 'RUN_FINISHED' });
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    const drafts = makeDrafts([textInput]);
    await hook.result.current.send('', () => {}, drafts);
    assert.equal(calls.length, 1);
    assert.equal(store.get('space-1').pendingSubmission.status, 'failed');
    assert.equal(store.get('space-1').pendingSubmission.attachments[0].dataBase64, textBase64);

    assert.equal(await hook.result.current.retry(), true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].runId, calls[0].runId);
    assert.equal(calls[1].message.id, calls[0].message.id);
    assert.equal(calls[1].message.attachments[0].dataBase64, calls[0].message.attachments[0].dataBase64);
    assert.equal(store.get('space-1').pendingSubmission, null);
    assert.equal(hook.result.current.views.filter((view) => view.id === calls[0].message.id).length, 1);
  } finally {
    hook.unmount();
  }
});

test('REQUEST_TOO_LARGE 映射为明确的 pre-run 未发送失败', async () => {
  const api = createMockApi({
    getConversation: async () => ({ revision: 'rev-1', messages: [] }),
    runAgent: async () => { throw new ApiError(413, '请求体过大', 'REQUEST_TOO_LARGE'); },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    await hook.result.current.send('过大消息', () => {});
    const pending = store.get('space-1').pendingSubmission;
    assert.equal(pending.status, 'failed');
    assert.equal(pending.error, '请求体过大');
    assert.equal(hook.result.current.historyFailed, false);
  } finally {
    hook.unmount();
  }
});
