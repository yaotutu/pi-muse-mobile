import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import {
  MAX_WORKSPACE_TEXT_BYTES,
  parseWorkspaceDelete,
  parseWorkspaceFileDetail,
  parseWorkspaceList,
  validateWorkspaceWritePath,
} from '../src/files/contracts.ts';
import { FilesStore, parentWorkspacePath } from '../src/files/files-store.ts';
import { safeDownloadFileName } from '../src/files/native-download-name.ts';
import { writeVerifiedDownloadTarget } from '../src/files/native-download-target.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const at = '2026-10-24T01:02:03.004Z';
const selector = { scope: 'space', spaceId: 'space-a' };
const entry = (overrides = {}) => ({
  name: 'a.txt', path: 'a.txt', kind: 'file', size: 9, updatedAt: at, ...overrides,
});
const list = (overrides = {}) => ({
  ...selector, path: '.', entries: [entry()], ...overrides,
});
const detail = (overrides = {}) => ({
  ...selector, name: 'a.txt', path: 'a.txt', kind: 'text', size: 9,
  updatedAt: at, mimeType: 'text/plain; charset=utf-8', content: '一二三', ...overrides,
});

test('workspace parsers validate ownership, ordering, content branches and base64 metadata', () => {
  assert.deepEqual(parseWorkspaceList(list()), list());
  assert.deepEqual(parseWorkspaceFileDetail(detail()), detail());
  const binary = detail({
    kind: 'binary', mimeType: 'application/octet-stream', size: 2, dataBase64: 'AQI=', content: undefined,
  });
  const parsedBinary = parseWorkspaceFileDetail(binary);
  assert.equal(Object.hasOwn(parsedBinary, 'content'), false);
  const expectedBinary = { ...binary };
  delete expectedBinary.content;
  assert.deepEqual(parsedBinary, expectedBinary);
  assert.deepEqual(parseWorkspaceDelete({ ...selector, path: 'a.txt', ok: true }), { ...selector, path: 'a.txt', ok: true });

  const invalidLists = [
    list({ spaceId: 'other' }),
    list({ path: 'other' }),
    list({ entries: [entry(), entry()] }),
    list({ entries: [{ ...entry(), path: 'wrong.txt' }] }),
    list({ entries: [{ ...entry(), kind: 'directory', size: 1 }] }),
    list({ entries: [entry({ name: 'b.txt', path: 'b.txt' }), entry()] }),
  ];
  for (const value of invalidLists) assert.throws(() => parseWorkspaceList(value, { ...selector, path: '.' }), ApiError);

  const invalidDetails = [
    detail({ spaceId: null, scope: 'shared' }),
    detail({ path: 'other.txt', name: 'other.txt' }),
    detail({ name: 'a', size: 3 }),
    detail({ content: '一' }),
    detail({ kind: 'binary', content: undefined, dataBase64: 'AQI=', size: 3 }),
    detail({ kind: 'binary', content: undefined, dataBase64: 'A Q=', size: 2 }),
    detail({ kind: 'binary', content: undefined, dataBase64: 'A===', size: 1 }),
  ];
  for (const value of invalidDetails) {
    assert.throws(() => parseWorkspaceFileDetail(value, { ...selector, path: 'a.txt' }), (error) => error.status === 502);
  }
});

test('write paths use a strict ASCII segment set and text byte boundary is exact', () => {
  assert.equal(validateWorkspaceWritePath('a/b-c_1.txt'), 'a/b-c_1.txt');
  for (const path of ['.', './a', 'a//b', 'a/../b', '/a', '\\a', 'a\\b', 'a b', '中文.txt', 'a?b']) {
    assert.throws(() => validateWorkspaceWritePath(path), (error) => error.status === 400, path);
  }
  assert.equal(new TextEncoder().encode('a'.repeat(MAX_WORKSPACE_TEXT_BYTES)).length, MAX_WORKSPACE_TEXT_BYTES);
});

test('directory up-navigation returns to root from one segment and removes only the leaf', () => {
  assert.equal(parentWorkspacePath('.'), '.');
  assert.equal(parentWorkspacePath('notes'), '.');
  assert.equal(parentWorkspacePath('a/notes'), 'a');
  assert.equal(parentWorkspacePath('a/b/notes.txt'), 'a/b');
});

test('HttpApiClient sends the fixed file endpoints, bearer auth and confirmed writes once', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const current = calls.length - 1;
    if (current === 0) return Response.json(list({ entries: [] }));
    if (current === 1) return Response.json(detail());
    if (current === 2 || current === 3) return Response.json(detail({ content: 'saved', size: 5 }));
    return Response.json({ ...selector, path: 'a.txt', ok: true });
  };
  try {
    const api = new HttpApiClient('https://files.example', () => 'token', () => {});
    assert.deepEqual((await api.listWorkspaceFiles(selector)).entries, []);
    assert.equal((await api.readWorkspaceFile({ ...selector, path: 'a.txt' })).content, '一二三');
    assert.equal((await api.createWorkspaceTextFile({ ...selector, path: 'a.txt' }, 'saved')).content, 'saved');
    assert.equal((await api.updateWorkspaceTextFile({ ...selector, path: 'a.txt' }, 'saved')).content, 'saved');
    assert.equal((await api.deleteWorkspaceFile({ ...selector, path: 'a.txt' })).ok, true);

    assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
      '/api/workspace/files', '/api/workspace/files/content', '/api/workspace/files/text', '/api/workspace/files/text', '/api/workspace/files',
    ]);
    assert.deepEqual(Object.fromEntries(new URL(calls[0].url).searchParams), { scope: 'space', spaceId: 'space-a', path: '.' });
    assert.deepEqual(Object.fromEntries(new URL(calls[4].url).searchParams), { scope: 'space', spaceId: 'space-a', path: 'a.txt' });
    for (const call of calls) assert.equal(call.init.headers.authorization, 'Bearer token');
    assert.deepEqual(JSON.parse(calls[2].init.body), {
      scope: 'space', spaceId: 'space-a', path: 'a.txt', content: 'saved', confirmed: true,
    });
    assert.equal(calls[3].init.method, 'PUT');
    assert.equal(calls[4].init.method, 'DELETE');
  } finally {
    globalThis.fetch = original;
  }
});

function storeFixture() {
  const calls = { list: [], read: [], create: [], update: [], delete: [] };
  const client = {
    listWorkspaceFiles(target, signal) {
      const item = deferred(); calls.list.push({ target, signal, ...item }); return item.promise;
    },
    readWorkspaceFile(target, signal) {
      const item = deferred(); calls.read.push({ target, signal, ...item }); return item.promise;
    },
    createWorkspaceTextFile(target, content, signal) {
      const item = deferred(); calls.create.push({ target, content, signal, ...item }); return item.promise;
    },
    updateWorkspaceTextFile(target, content, signal) {
      const item = deferred(); calls.update.push({ target, content, signal, ...item }); return item.promise;
    },
    deleteWorkspaceFile(target, signal) {
      const item = deferred(); calls.delete.push({ target, signal, ...item }); return item.promise;
    },
  };
  return { client, calls, store: new FilesStore(client) };
}

async function openStore(fixture, spaceId = 'space-a') {
  fixture.store.selectSpace(spaceId);
  fixture.store.setActive(true);
  fixture.store.open();
  await tick();
}

test('directory and space reads isolate late responses and preserve drafts across close/reopen', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  assert.equal(fixture.calls.list[0].target.spaceId, 'space-a');
  fixture.store.openDirectory('docs');
  assert.equal(fixture.calls.list[0].signal.aborted, true);
  fixture.calls.list[0].resolve(list({ path: '.', entries: [entry()] }));
  fixture.calls.list[1].resolve(list({ path: 'docs', entries: [entry({ name: 'nested.txt', path: 'docs/nested.txt' })] }));
  await tick();
  assert.deepEqual(fixture.store.getSnapshot().entries.map((item) => item.path), ['docs/nested.txt']);

  fixture.store.beginCreate();
  fixture.store.setDraftPath('draft.txt');
  fixture.store.setDraftContent('draft');
  assert.equal(fixture.store.selectSpace('space-b'), false);
  fixture.store.close();
  fixture.store.open();
  await tick();
  const snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.editor?.content, 'draft');
  assert.equal(fixture.calls.list[1].target.path, 'docs');
  assert.equal(fixture.calls.list[2].target.spaceId, 'space-a');
  fixture.calls.list[2].resolve(list({ path: 'docs', entries: [] }));
  await tick();
  fixture.store.cancelEditor();
  assert.equal(fixture.store.getSnapshot().editor, undefined);
  assert.equal(fixture.store.selectSpace('space-b'), true);
  fixture.store.dispose();
});

test('pending global space switch waits for the draft and never steals explicit shared selection', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list({ entries: [] }));
  await tick();
  fixture.store.beginCreate();
  fixture.store.setDraftPath('pending.txt');
  fixture.store.setDraftContent('pending draft');
  assert.equal(fixture.store.selectSpace('space-b'), false);
  assert.equal(fixture.store.getSnapshot().pendingSpaceId, 'space-b');

  assert.equal(fixture.store.selectShared(), false);
  assert.equal(fixture.store.getSnapshot().pendingSpaceId, undefined);
  fixture.store.cancelEditor();
  await tick();
  assert.equal(fixture.store.getSnapshot().scope, 'space');
  assert.equal(fixture.store.getSnapshot().selectedSpaceId, 'space-a');
  assert.equal(fixture.calls.list.length, 1);
  assert.equal(fixture.store.selectShared(), true);
  fixture.calls.list[1].resolve({ scope: 'shared', spaceId: null, path: '.', entries: [] });
  await tick();

  assert.equal(fixture.store.selectSpace('space-a'), true);
  fixture.calls.list[2].resolve(list({ entries: [] }));
  await tick();
  fixture.store.beginCreate();
  fixture.store.setDraftPath('switch-after-cancel.txt');
  fixture.store.setDraftContent('will cancel');
  assert.equal(fixture.store.selectSpace('space-b'), false);
  fixture.store.cancelEditor();
  await tick();
  const snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.scope, 'space');
  assert.equal(snapshot.selectedSpaceId, 'space-b');
  assert.equal(fixture.calls.list.at(-1).target.spaceId, 'space-b');
  fixture.store.dispose();
});

test('foreground reopen and refresh restore selected detail without replacing drafts', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list());
  await tick();
  const opened = fixture.store.openFile('a.txt');
  fixture.calls.read[0].resolve(detail());
  assert.equal(await opened, true);

  fixture.store.setActive(false);
  assert.equal(fixture.store.getSnapshot().detailStale, true);
  fixture.store.setActive(true);
  assert.equal(fixture.calls.list[1].target.path, '.');
  assert.equal(fixture.calls.read[1].target.path, 'a.txt');
  fixture.calls.list[1].resolve(list());
  fixture.calls.read[1].resolve(detail({ content: 'foreground restored' }));
  await tick();
  assert.equal(fixture.store.getSnapshot().detail.content, 'foreground restored');
  assert.equal(fixture.store.getSnapshot().detailStale, false);

  fixture.store.beginEdit();
  fixture.store.setDraftContent('draft survives reopen');
  fixture.store.close();
  fixture.store.open();
  assert.equal(fixture.calls.read.length, 2);
  fixture.calls.list[2].resolve(list());
  await tick();
  assert.equal(fixture.store.getSnapshot().editor.content, 'draft survives reopen');

  fixture.store.cancelEditor();
  const failed = fixture.store.refresh();
  fixture.calls.list[3].resolve(list({ entries: [entry({ name: 'b.txt', path: 'b.txt' })] }));
  fixture.calls.read[2].reject(new ApiError(500, 'offline'));
  assert.equal(await failed, false);
  const snapshot = fixture.store.getSnapshot();
  assert.deepEqual(snapshot.entries.map((item) => item.path), ['b.txt']);
  assert.equal(snapshot.detail.content, 'foreground restored');
  assert.equal(snapshot.detailStale, true);
  fixture.store.dispose();
});

test('a late detail response cannot cross a space switch', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list());
  await tick();
  const opened = fixture.store.openFile('a.txt');
  assert.equal(fixture.store.selectSpace('space-b'), true);
  fixture.calls.read[0].resolve(detail());
  fixture.calls.list[1].resolve(list({ spaceId: 'space-b', entries: [] }));
  assert.equal(await opened, false);
  await tick();
  const snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.scope, 'space');
  assert.equal(snapshot.selectedSpaceId, 'space-b');
  assert.equal(snapshot.selectedPath, undefined);
  assert.equal(snapshot.detail, undefined);
  fixture.store.dispose();
});

test('file read failures retain the last directory and known 404 clears stale detail', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list());
  await tick();
  const opened = fixture.store.openFile('a.txt');
  fixture.calls.read[0].resolve(detail());
  assert.equal(await opened, true);

  const failed = fixture.store.openFile('a.txt');
  fixture.calls.read[1].reject(new ApiError(500, 'offline'));
  assert.equal(await failed, false);
  let snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.detail.content, '一二三');
  assert.equal(snapshot.detailStale, true);

  const missing = fixture.store.openFile('a.txt');
  fixture.calls.read[2].reject(new ApiError(404, 'missing'));
  assert.equal(await missing, false);
  snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.detail, undefined);
  assert.equal(snapshot.missing, true);
  fixture.store.dispose();
});

test('text saves require full before/after confirmation and use the returned detail', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list());
  await tick();
  const opened = fixture.store.openFile('a.txt');
  fixture.calls.read[0].resolve(detail());
  await opened;
  fixture.store.beginEdit();
  fixture.store.setDraftContent('after');
  assert.equal(fixture.store.requestSave(), true);
  const preview = fixture.store.getSnapshot().savePreview;
  assert.deepEqual(
    { ...preview },
    { mode: 'update', ...selector, path: 'a.txt', before: '一二三', after: 'after' },
  );
  fixture.store.cancelSavePreview();
  assert.equal(await fixture.store.confirmSave(), false);
  assert.equal(fixture.calls.update.length, 0);

  fixture.store.requestSave();
  const saved = fixture.store.confirmSave();
  fixture.calls.update[0].resolve(detail({ content: 'after', size: 5 }));
  assert.equal(await saved, true);
  await tick();
  const snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.editor, undefined);
  assert.equal(snapshot.detail.content, 'after');
  assert.equal(snapshot.notice, '文本文件已保存');
  assert.equal(fixture.calls.update[0].content, 'after');
  fixture.store.dispose();
});

test('uncertain writes stay locked until full readback and an explicit user unlock', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list({ entries: [] }));
  await tick();
  fixture.store.beginCreate();
  fixture.store.setDraftPath('new.txt');
  fixture.store.setDraftContent('uncertain');
  fixture.store.requestSave();
  const first = fixture.store.confirmSave();
  fixture.calls.create[0].reject(new ApiError(408, 'timeout'));
  assert.equal(await first, false);
  let snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.uncertain, true);
  assert.equal(snapshot.reviewed, false);
  assert.equal(snapshot.editor.content, 'uncertain');
  fixture.store.requestSave();
  fixture.store.acknowledgeReviewed();
  assert.equal(fixture.calls.create.length, 1);

  const verified = fixture.store.verifyUncertainOperation();
  fixture.calls.read[0].resolve(detail({ path: 'new.txt', name: 'new.txt', content: 'uncertain' }));
  assert.equal(await verified, true);
  snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.reviewed, true);
  assert.equal(snapshot.verificationDetail.content, 'uncertain');
  assert.equal(snapshot.uncertainOperation.content, 'uncertain');
  fixture.store.acknowledgeReviewed();
  assert.equal(fixture.store.getSnapshot().uncertain, false);
  assert.equal(fixture.store.getSnapshot().editor.content, 'uncertain');
  fixture.store.dispose();
});

test('background interruption keeps the exact uncertain operation available for readback', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list({ entries: [] }));
  await tick();
  fixture.store.beginCreate();
  fixture.store.setDraftPath('background.txt');
  fixture.store.setDraftContent('background value');
  fixture.store.requestSave();
  const pending = fixture.store.confirmSave();
  fixture.store.setActive(false);
  assert.equal(fixture.calls.create[0].signal.aborted, true);
  fixture.calls.create[0].reject(new Error('cancelled locally'));
  await pending;
  assert.deepEqual(fixture.store.getSnapshot().uncertainOperation, {
    kind: 'create',
    ...selector,
    path: 'background.txt',
    content: 'background value',
  });
  fixture.store.setActive(true);
  const verified = fixture.store.verifyUncertainOperation();
  fixture.calls.read[0].resolve(detail({ path: 'background.txt', name: 'background.txt', content: 'background value' }));
  assert.equal(await verified, true);
  assert.equal(fixture.store.getSnapshot().reviewed, true);
  fixture.store.acknowledgeReviewed();
  assert.equal(fixture.store.getSnapshot().uncertain, false);
  fixture.store.dispose();
});

test('closing the page does not cancel an authorized write or lose its target', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list({ entries: [] }));
  await tick();
  fixture.store.beginCreate();
  fixture.store.setDraftPath('close-in-flight.txt');
  fixture.store.setDraftContent('saved after close');
  fixture.store.requestSave();
  const pending = fixture.store.confirmSave();
  fixture.store.close();
  assert.equal(fixture.calls.create[0].signal.aborted, false);
  fixture.calls.create[0].resolve(detail({ path: 'close-in-flight.txt', name: 'close-in-flight.txt', content: 'saved after close' }));
  assert.equal(await pending, true);
  const snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.uncertain, false);
  assert.equal(snapshot.detail.content, 'saved after close');
  fixture.store.dispose();
});

test('update 409 means the replacement may already be committed and stays uncertain', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list());
  await tick();
  const opened = fixture.store.openFile('a.txt');
  fixture.calls.read[0].resolve(detail());
  await opened;
  fixture.store.beginEdit();
  fixture.store.setDraftContent('possibly committed');
  fixture.store.requestSave();
  const pending = fixture.store.confirmSave();
  fixture.calls.update[0].reject(new ApiError(409, 'File was replaced, but its receipt could not be read'));
  assert.equal(await pending, false);
  const snapshot = fixture.store.getSnapshot();
  assert.equal(snapshot.uncertain, true);
  assert.equal(snapshot.uncertainOperation?.content, 'possibly committed');
  assert.equal(snapshot.editor.content, 'possibly committed');
  fixture.store.dispose();
});

test('delete requires an explicit current entry and cancel never sends the request', async () => {
  const fixture = storeFixture();
  await openStore(fixture);
  fixture.calls.list[0].resolve(list());
  await tick();
  assert.equal(fixture.store.requestDelete('../a.txt'), false);
  assert.equal(fixture.store.requestDelete('missing.txt'), false);
  fixture.store.requestDelete('a.txt');
  fixture.store.cancelDelete();
  assert.equal(await fixture.store.confirmDelete(), false);
  assert.equal(fixture.calls.delete.length, 0);

  fixture.store.requestDelete('a.txt');
  const removed = fixture.store.confirmDelete();
  fixture.calls.delete[0].resolve({ ...selector, path: 'a.txt', ok: true });
  assert.equal(await removed, true);
  await tick();
  assert.deepEqual(fixture.store.getSnapshot().entries, []);
  assert.equal(fixture.calls.delete.length, 1);
  fixture.store.dispose();
});

test('download names stay ASCII, unique-looking and cannot escape as dot paths', () => {
  assert.equal(safeDownloadFileName('notes.final.txt'), 'notes.final.txt');
  assert.equal(safeDownloadFileName('历史 笔记.txt'), '_____.txt');
  assert.equal(safeDownloadFileName('..'), '_');
  assert.equal(safeDownloadFileName(`${'a'.repeat(140)}.png`).length <= 120, true);
  assert.match(safeDownloadFileName(`${'a'.repeat(140)}.png`), /^[A-Za-z0-9._-]+$/);
});

test('SAF download checks provider display names and never writes renamed duplicates', () => {
  const fileName = 'fixture-binary.bin';
  const bytes = new Uint8Array([255, 0, 128, 1, 2]);
  const fixture = (nameSequences) => {
    const file = { uri: 'content://created-file', writes: [], deleted: 0, write(content) { this.writes.push(content); }, delete() { this.deleted++; } };
    let infoCall = 0;
    return {
      file,
      directory: {
        uri: 'content://selected-tree',
        info() { return { exists: true, files: nameSequences[Math.min(infoCall++, nameSequences.length - 1)] }; },
        createFile(createdName, mimeType) { this.created.push({ createdName, mimeType }); return file; },
        created: [],
      },
    };
  };

  const conflict = fixture([['other.txt', fileName]]);
  assert.deepEqual(writeVerifiedDownloadTarget(conflict.directory, fileName, 'application/octet-stream', bytes), {
    status: 'conflict', fileName, uri: 'content://selected-tree',
  });
  assert.deepEqual(conflict.directory.created, []);

  const saved = fixture([[], [fileName]]);
  assert.deepEqual(writeVerifiedDownloadTarget(saved.directory, fileName, 'application/octet-stream', bytes), {
    status: 'saved', fileName, uri: 'content://created-file',
  });
  assert.deepEqual(saved.directory.created, [{ createdName: fileName, mimeType: 'application/octet-stream' }]);
  assert.deepEqual(saved.file.writes, [bytes]);
  assert.equal(saved.file.deleted, 0);

  const renamed = fixture([[], ['fixture-binary (1).bin']]);
  const renamedResult = writeVerifiedDownloadTarget(renamed.directory, fileName, 'application/octet-stream', bytes);
  assert.equal(renamedResult.status, 'error');
  assert.deepEqual(renamed.file.writes, []);
  assert.equal(renamed.file.deleted, 1);

  const renamedToExistingName = fixture([['fixture-binary (1).bin'], ['fixture-binary (1).bin']]);
  assert.equal(
    writeVerifiedDownloadTarget(renamedToExistingName.directory, fileName, 'application/octet-stream', bytes).status,
    'error',
  );
  assert.deepEqual(renamedToExistingName.file.writes, []);
  assert.equal(renamedToExistingName.file.deleted, 1);

  const uninspectable = fixture([[undefined]]);
  assert.equal(writeVerifiedDownloadTarget(uninspectable.directory, fileName, 'application/octet-stream', bytes).status, 'error');
  assert.deepEqual(uninspectable.directory.created, []);

  const failedCreate = {
    uri: 'content://selected-tree',
    info: () => ({ exists: true, files: [] }),
    createFile() { throw new Error('provider rejected creation'); },
  };
  assert.equal(writeVerifiedDownloadTarget(failedCreate, fileName, 'application/octet-stream', bytes).status, 'error');
});

test('public non-visual integration surface is stable for the Sol UI task', () => {
  const store = readFileSync('src/files/files-store.ts', 'utf8');
  const provider = readFileSync('src/files/FilesProvider.tsx', 'utf8');
  const contracts = readFileSync('src/api/contracts.ts', 'utf8');
  assert.match(contracts, /interface ApiClient extends .*FilesClient/);
  for (const member of [
    'setActive(', 'open()', 'close()', 'selectSpace =', 'selectShared =', 'openDirectory =', 'goUp =',
    'refreshDirectory =', 'openFile =', 'refreshDetail =', 'beginCreate =', 'beginEdit =', 'setDraftPath =',
    'setDraftContent =', 'cancelEditor =', 'requestSave =', 'cancelSavePreview =', 'confirmSave =',
    'requestDelete =', 'cancelDelete =', 'confirmDelete =', 'verifyUncertainOperation =', 'acknowledgeReviewed =',
  ]) assert.ok(store.includes(member), member);
  assert.match(provider, /export function FilesProvider/);
  assert.match(provider, /export function useFiles/);
  assert.doesNotMatch(store, /setInterval|setTimeout/);
  assert.equal(existsSync('src/files/FilesPanel.tsx'), false);
});
