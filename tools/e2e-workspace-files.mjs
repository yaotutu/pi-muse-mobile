/**
 * 工作区文件非视觉层真实回归：实际 HttpApiClient/FilesStore + 真外部模型。
 * 只使用专用空间和唯一 ASCII 文件；共享区只创建/清理本轮标记文件，不读取无关正文。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApprovalStore } from '../src/approvals/approval-store.ts';
import { RuntimeStore } from '../src/runtime/runtime-store.ts';
import { StreamAggregator, projectHistory } from '../src/chat/chat-state.ts';
import { FilesStore } from '../src/files/files-store.ts';
import { MAX_WORKSPACE_DIRECTORY_ENTRIES, MAX_WORKSPACE_TEXT_BYTES } from '../src/files/contracts.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for real file and model writes');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');

const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-workspace-files-e2e.'));
const stamp = Date.now().toString(36);
const marker = `WORKSPACE_FILES_E2E_${stamp}`;
const spaceId = `files-e2e-${stamp}`;
const otherSpaceId = `files-other-e2e-${stamp}`;
const bulkSpaceId = `files-bulk-e2e-${stamp}`;
const isolationPath = `isolation-${stamp}.txt`;
const manualPath = `manual-${stamp}.txt`;
const nestedPath = `notes/nested-${stamp}.txt`;
const modelPath = `model-created-${stamp}.txt`;
const cancelledPath = `cancelled-${stamp}.txt`;
const deletePath = `delete-${stamp}.txt`;
const boundaryPath = `boundary-${stamp}.txt`;
const sharedOwn = new Set();
const intendedSharedDeletes = new Set();
const spaces = new Set();
const checks = [];
const runs = [];
let token;
let failure;
let serviceVersion;
let baselineSpaceIds;

const api = new HttpApiClient(base, () => token, () => {
  throw new Error('Real authentication rejected');
});
const files = new FilesStore(api);
const approvals = new ApprovalStore(api);
const runtime = new RuntimeStore(api, {
  onEvent: (event) => approvals.receive(event),
  onConnection: (connection) => approvals.setConnection(connection),
});

const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pass = (name, extra = {}) => {
  checks.push({ name, ...extra });
  console.log('PASS', name);
};
const phase = (name, extra = {}) => write('context.json', { phase: name, base, marker, spaceId, otherSpaceId, bulkSpaceId, ...extra });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 300_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}

async function deployment(label) {
  const [docs, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(docs.includes('/openapi.json'));
  assert.equal(health.ok, true);
  assert.equal(health.backend, 'pi');
  assert.equal(health.configured, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const [path, methods] of Object.entries({
    '/api/workspace/files': ['get', 'delete'],
    '/api/workspace/files/content': ['get'],
    '/api/workspace/files/text': ['post', 'put'],
  })) {
    for (const method of methods) assert.ok(schema.paths[path]?.[method], `${method} ${path}`);
  }
  write(`deployment-${label}.json`, {
    serviceVersion: health.serviceVersion,
    filesApi: Object.fromEntries(Object.entries(schema.paths).filter(([path]) => path.startsWith('/api/workspace/files'))),
  });
  return health.serviceVersion;
}

async function rawFilesRequest(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => undefined);
  return { response, payload };
}

async function createSpace(id, instructions) {
  spaces.add(id);
  await api.saveSpaceInstructions(id, instructions);
  assert.ok((await api.listSpaces()).some((space) => space.id === id));
}

async function settledFiles(label) {
  await until(() => {
    const snapshot = files.getSnapshot();
    return snapshot.loaded && !snapshot.loading && !snapshot.stale;
  }, `${label}: FilesStore settled`);
  const snapshot = files.getSnapshot();
  assert.equal(snapshot.loading, false, label);
  assert.equal(snapshot.stale, false, label);
  assert.equal(snapshot.error, undefined, `${label}: ${snapshot.error}`);
  return snapshot;
}

async function createWithStore(spaceIdForFile, path, content) {
  files.beginCreate();
  files.setDraftPath(path);
  files.setDraftContent(content);
  assert.equal(files.requestSave(), true, 'save preview must be prepared');
  const preview = files.getSnapshot().savePreview;
  assert.ok(preview);
  assert.equal(preview.before, '');
  assert.equal(preview.after, content);
  assert.equal(await files.confirmSave(), true, `create ${path}`);
  return settledFiles(`create ${path} in ${spaceIdForFile}`);
}

async function updateWithStore(path, content) {
  const opened = await files.openFile(path);
  assert.equal(opened, true, `open ${path} before edit`);
  files.beginEdit();
  files.setDraftContent(content);
  files.requestSave();
  const preview = files.getSnapshot().savePreview;
  assert.ok(preview);
  assert.equal(preview.before !== content, true, 'update preview must show a full change');
  assert.equal(preview.after, content);
  assert.equal(await files.confirmSave(), true, `update ${path}`);
  return settledFiles(`update ${path}`);
}

function begin(content) {
  const history = api.getConversation(spaceId);
  const runId = `files-e2e-run-${stamp}-${runs.length + 1}`;
  const item = {
    runId,
    settled: false,
    events: [],
    controller: new AbortController(),
    history,
    aggregator: null,
  };
  item.promise = history.then(({ revision, messages }) => {
    item.aggregator = new StreamAggregator(projectHistory(messages));
    return api.runAgent({
      spaceId,
      runId,
      expectedRevision: revision,
      message: { id: `msg-${runId}`, content },
    }, (event) => {
      item.events.push(event.type);
      item.aggregator?.push(event);
      if (event.type === 'RUN_ERROR') item.error = event.code ?? event.message;
    }, item.controller.signal);
  }).catch((error) => {
    item.transportError = error.message;
  }).finally(() => {
    item.settled = true;
  });
  runs.push(item);
  return item;
}

async function finished(item) {
  await until(() => item.settled, 'model run stream ends');
  assert.equal(item.error, undefined, `model RUN_ERROR: ${item.error}`);
  assert.equal(item.transportError, undefined, `model transport error: ${item.transportError}`);
  assert.ok(item.events.includes('RUN_FINISHED'));
  return api.getConversation(spaceId);
}

async function pendingApproval(item, expected) {
  let approval;
  await until(() => {
    approval = Object.values(approvals.getSnapshot().records).find((record) =>
      record.spaceId === spaceId && record.runId === item.runId && record.status === 'pending');
    return !!approval || item.settled;
  }, 'real file write/edit approval');
  assert.ok(approval, `model ended without approval: ${item.error ?? item.transportError ?? ''}`);
  assert.equal(approval.preview.scope, 'space');
  assert.equal(approval.preview.ownerSpaceId, spaceId);
  assert.equal(approval.workspaceSpaceId, spaceId);
  assert.equal(approval.preview.path, expected.path);
  assert.equal(approval.preview.after, expected.after);
  assert.equal(approval.preview.before, expected.before);
  assert.equal(approval.preview.beforeExists, expected.beforeExists);
  return approval;
}

async function waitApprovalTerminal(id) {
  let record;
  await until(() => {
    record = approvals.getSnapshot().records[id];
    return !!record?.execution;
  }, 'approval execution receipt');
  return record;
}

async function createBulkFiles() {
  for (let number = 0; number <= MAX_WORKSPACE_DIRECTORY_ENTRIES; number++) {
    await api.createWorkspaceTextFile(
      { scope: 'space', spaceId: bulkSpaceId, path: `bulk/file-${String(number).padStart(4, '0')}.txt` },
      `${marker}:${number}`,
    );
  }
}

try {
  serviceVersion = await deployment('start');
  pass('current docs/OpenAPI/health expose the workspace-files contract', { serviceVersion });

  const unauthorized = await rawFilesRequest('/api/workspace/files?scope=shared&path=.');
  assert.equal(unauthorized.response.status, 401);
  pass('file endpoints require Bearer authentication');

  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'This acceptance must use the confirmed real external model service');
  token = auth.token;
  baselineSpaceIds = new Set((await api.listSpaces()).map((space) => space.id));
  for (const id of [spaceId, otherSpaceId, bulkSpaceId]) assert.ok(!baselineSpaceIds.has(id));
  const sharedBaseline = await api.listWorkspaceFiles({ scope: 'shared', spaceId: null });
  assert.equal(sharedBaseline.scope, 'shared');
  assert.equal(sharedBaseline.spaceId, null);
  assert.ok(!sharedBaseline.entries.some((entry) => entry.name.includes(stamp)));
  pass('real baseline has no dedicated spaces or shared marker files');

  const instructions = [
    'Dedicated mobile workspace-file acceptance space.',
    'Follow only explicit test requests.',
    `Only use read/write/edit on the exact PRIVATE filenames containing ${stamp}.`,
    'Never touch shared files, other spaces, memories, profile, goals, monitors, schedules or subagents.',
    'For write/edit, wait for human approval and do not retry after denial or version failure.',
  ].join('\n');
  await createSpace(spaceId, instructions);
  await createSpace(otherSpaceId, `Dedicated isolation space ${marker}. Never run models or touch other data.`);
  await createSpace(bulkSpaceId, `Dedicated bulk-list space ${marker}. Never run models or touch other data.`);

  files.selectSpace(spaceId);
  files.setActive(true);
  files.open();
  let snapshot = await settledFiles('initial private root');
  assert.deepEqual(snapshot.entries, []);
  pass('actual HttpApiClient/FilesStore reads a dedicated private root');

  const nestedContent = `NESTED_${marker}`;
  await api.createWorkspaceTextFile({ scope: 'space', spaceId, path: nestedPath }, nestedContent);
  await files.refreshDirectory();
  await settledFiles('refresh after nested create');
  assert.equal(files.openDirectory('notes'), true);
  await settledFiles('nested directory');
  assert.deepEqual(files.getSnapshot().entries.map((entry) => entry.path), [nestedPath]);
  assert.equal(await files.openFile(nestedPath), true);
  assert.equal(files.getSnapshot().detail?.content, nestedContent);

  // 复现系统目录选择器让应用进入 inactive 再返回后的非 UI 生命周期。
  files.setActive(false);
  assert.equal(files.getSnapshot().detailStale, true);
  files.setActive(true);
  await until(() => {
    const snapshot = files.getSnapshot();
    return snapshot.detailStale === false && snapshot.detailLoading === false && snapshot.detail?.content === nestedContent;
  }, 'foreground detail restoration');
  files.close();
  files.open();
  await until(() => {
    const snapshot = files.getSnapshot();
    return snapshot.detailStale === false && snapshot.detailLoading === false && snapshot.detail?.content === nestedContent;
  }, 'reopen detail restoration');
  pass('foreground restoration and close/reopen read the selected detail again');

  assert.equal(files.goUp(), true);
  snapshot = await settledFiles('root after goUp');
  assert.ok(snapshot.entries.some((entry) => entry.path === 'notes' && entry.kind === 'directory'));
  pass('real directory navigation reads nested content and returns to root');

  files.beginCreate();
  files.setDraftPath(`pending-${stamp}.txt`);
  files.setDraftContent(`PENDING_${marker}`);
  assert.equal(files.selectSpace(otherSpaceId), false);
  assert.equal(files.getSnapshot().pendingSpaceId, otherSpaceId);
  assert.equal(files.selectShared(), false);
  assert.equal(files.getSnapshot().pendingSpaceId, undefined);
  files.cancelEditor();
  await settledFiles('draft cancel keeps current space');
  assert.equal(files.getSnapshot().selectedSpaceId, spaceId);
  pass('blocked space switch keeps its draft ownership and explicit shared intent cancels pending switch');

  const initialManual = `MANUAL_V1_${marker}`;
  await createWithStore(spaceId, manualPath, initialManual);
  const manualDetail = await api.readWorkspaceFile({ scope: 'space', spaceId, path: manualPath });
  assert.equal(manualDetail.content, initialManual);
  assert.equal(manualDetail.kind, 'text');
  assert.equal(manualDetail.spaceId, spaceId);
  pass('confirmed create returns and reads the exact full text');

  const updatedManual = `MANUAL_V2_${marker}`;
  await updateWithStore(manualPath, updatedManual);
  assert.equal((await api.readWorkspaceFile({ scope: 'space', spaceId, path: manualPath })).content, updatedManual);
  pass('confirmed update requires full before/after and last successful save wins');

  files.beginCreate();
  files.setDraftPath(cancelledPath);
  files.setDraftContent(`CANCELLED_${marker}`);
  files.requestSave();
  files.cancelSavePreview();
  files.cancelEditor();
  await assert.rejects(api.readWorkspaceFile({ scope: 'space', spaceId, path: cancelledPath }), (error) => error.status === 404);
  pass('cancelling preview/editor leaves no file');

  await api.createWorkspaceTextFile({ scope: 'space', spaceId, path: deletePath }, `DELETE_${marker}`);
  await files.refreshDirectory();
  await settledFiles('refresh before delete');
  assert.equal(files.requestDelete(deletePath), true);
  files.cancelDelete();
  assert.equal(await files.confirmDelete(), false);
  assert.equal((await api.readWorkspaceFile({ scope: 'space', spaceId, path: deletePath })).content, `DELETE_${marker}`);
  files.requestDelete(deletePath);
  assert.equal(await files.confirmDelete(), true);
  await settledFiles('refresh after delete');
  await assert.rejects(api.readWorkspaceFile({ scope: 'space', spaceId, path: deletePath }), (error) => error.status === 404);
  pass('delete needs a current explicit target; cancel sends nothing and confirm removes it');

  const beforeMissing = files.getSnapshot().entries.length;
  await files.openFile(`missing-${stamp}.txt`).catch(() => false);
  assert.equal(files.getSnapshot().entries.length, beforeMissing);
  assert.equal(files.getSnapshot().missing, true);
  pass('missing detail does not erase the last observed directory list');

  const privateIsolation = `PRIVATE_${marker}`;
  await api.createWorkspaceTextFile({ scope: 'space', spaceId, path: isolationPath }, privateIsolation);
  const otherIsolation = `OTHER_${marker}`;
  await api.createWorkspaceTextFile({ scope: 'space', spaceId: otherSpaceId, path: isolationPath }, otherIsolation);
  const sharedIsolation = `SHARED_${marker}`;
  sharedOwn.add(isolationPath);
  await api.createWorkspaceTextFile({ scope: 'shared', spaceId: null, path: isolationPath }, sharedIsolation);
  const [privateRead, otherRead, sharedRead] = await Promise.all([
    api.readWorkspaceFile({ scope: 'space', spaceId, path: isolationPath }),
    api.readWorkspaceFile({ scope: 'space', spaceId: otherSpaceId, path: isolationPath }),
    api.readWorkspaceFile({ scope: 'shared', spaceId: null, path: isolationPath }),
  ]);
  assert.equal(privateRead.spaceId, spaceId);
  assert.equal(otherRead.spaceId, otherSpaceId);
  assert.equal(sharedRead.spaceId, null);
  assert.deepEqual([privateRead.content, otherRead.content, sharedRead.content], [privateIsolation, otherIsolation, sharedIsolation]);
  pass('same path stays isolated across private spaces and shared');

  assert.equal(files.selectShared(), true);
  await settledFiles('shared root');
  const sharedCreate = `SHARED_UPDATE_${marker}`;
  await updateWithStore(isolationPath, sharedCreate);
  assert.equal((await api.readWorkspaceFile({ scope: 'shared', spaceId: null, path: isolationPath })).content, sharedCreate);
  pass('FilesStore consumes shared responses with spaceId=null');

  const missingSpace = `files-missing-${stamp}`;
  await assert.rejects(
    api.listWorkspaceFiles({ scope: 'space', spaceId: missingSpace, path: '.' }),
    (error) => error.status === 404,
  );
  for (const path of ['%2e%2e/x', 'a%5Cb', '%2Fabsolute', 'a%2F%2E%2E']) {
    const result = await rawFilesRequest(`/api/workspace/files?scope=space&spaceId=${encodeURIComponent(spaceId)}&path=${path}`);
    assert.equal(result.response.status, 400, path);
  }
  pass('missing spaces and unsafe server paths fail without implicit creation');

  const boundaryContent = 'B'.repeat(MAX_WORKSPACE_TEXT_BYTES);
  await api.createWorkspaceTextFile({ scope: 'space', spaceId: bulkSpaceId, path: boundaryPath }, boundaryContent);
  assert.equal((await api.readWorkspaceFile({ scope: 'space', spaceId: bulkSpaceId, path: boundaryPath })).size, MAX_WORKSPACE_TEXT_BYTES);
  const oversized = await rawFilesRequest('/api/workspace/files/text', {
    method: 'POST',
    body: JSON.stringify({
      scope: 'space', spaceId: bulkSpaceId, path: `oversized-${stamp}.txt`,
      content: `${boundaryContent}B`, confirmed: true,
    }),
  });
  assert.equal(oversized.response.status, 413);
  pass('exact 100000 UTF-8 bytes pass and 100001 bytes return 413');

  await createBulkFiles();
  await assert.rejects(
    api.listWorkspaceFiles({ scope: 'space', spaceId: bulkSpaceId, path: 'bulk' }),
    (error) => error.status === 413,
  );
  pass('1001-entry directory returns 413 instead of truncating');

  approvals.setActive(true);
  runtime.setActive(true);
  await until(() => runtime.getSnapshot().connection === 'live' && approvals.getSnapshot().synchronized, 'shared approval SSE ready', 20_000);

  const readRun = begin(`Use read exactly once to read the PRIVATE relative file ${manualPath}. Report its exact content and no other text. Do not write or use any other tool.`);
  const readHistory = await finished(readRun);
  assert.ok(projectHistory(readHistory.messages).some((message) => message.role === 'assistant' && message.text.includes(updatedManual)));
  const readStatus = await api.getAgentStatus(spaceId, readRun.runId);
  assert.equal(readStatus.status.status, 'succeeded');
  write('model-read.json', {
    runId: readRun.runId,
    eventTypes: readRun.events,
    status: readStatus.status,
    visibleReply: projectHistory(readHistory.messages).filter((message) => message.role === 'assistant').at(-1),
  });
  pass('real external model reads and reports the exact private file marker');

  const modelContent = `MODEL_WRITE_${marker}`;
  const writeRun = begin(`Use write exactly once to create the PRIVATE relative file ${modelPath}. The exact content is ${JSON.stringify(modelContent)} without extra quotation marks or punctuation. Wait for approval, then report the result.`);
  const writeApproval = await pendingApproval(writeRun, { path: modelPath, after: modelContent, before: '', beforeExists: false });
  write('model-write-preview.json', writeApproval);
  assert.equal(await approvals.decide(writeApproval.id, 'approve'), true);
  await finished(writeRun);
  const writeReceipt = await waitApprovalTerminal(writeApproval.id);
  assert.equal(writeReceipt.execution?.status, 'succeeded');
  assert.equal((await api.readWorkspaceFile({ scope: 'space', spaceId, path: modelPath })).content, modelContent);
  pass('real model write shows a complete pending preview and commits only after original approval API');

  const staleBefore = updatedManual;
  const staleAfter = `MODEL_STALE_${marker}`;
  const editRun = begin(`Use edit exactly once on the PRIVATE relative file ${manualPath}. Replace the exact text ${JSON.stringify(staleBefore)} with ${JSON.stringify(staleAfter)}. Wait for approval; if commit fails after approval, report that briefly and do not retry.`);
  const editApproval = await pendingApproval(editRun, { path: manualPath, after: staleAfter, before: staleBefore, beforeExists: true });
  write('model-edit-preview.json', editApproval);
  const manualFinal = `MANUAL_AFTER_MODEL_${marker}`;
  await api.updateWorkspaceTextFile({ scope: 'space', spaceId, path: manualPath }, manualFinal);
  assert.equal(await approvals.decide(editApproval.id, 'approve'), true);
  await finished(editRun);
  const editReceipt = await waitApprovalTerminal(editApproval.id);
  assert.equal(editReceipt.execution?.status, 'failed');
  assert.match(editReceipt.execution?.result ?? '', /changed/i);
  assert.equal((await api.readWorkspaceFile({ scope: 'space', spaceId, path: manualPath })).content, manualFinal);
  write('stale-approval.json', { approval: editReceipt, finalContent: manualFinal });
  pass('old model approval fails after manual last-successful save and cannot overwrite new value');

  assert.deepEqual(await deployment('end'), serviceVersion);
  pass('deployment identity remained unchanged');
} catch (error) {
  failure = error;
  phase('failed', { error: error.message });
  console.error('FAIL', error.stack ?? error);
} finally {
  for (const item of runs) {
    if (!item.settled) {
      await api.stopRun(spaceId, item.runId).catch(() => {});
      item.controller.abort();
      await item.promise;
    }
  }
  runtime.dispose();
  approvals.dispose();
  files.dispose();
  try {
    for (const path of sharedOwn) {
      intendedSharedDeletes.add(path);
      try {
        await api.deleteWorkspaceFile({ scope: 'shared', spaceId: null, path });
      } catch (error) {
        if (error.status !== 404) {
          write(`cleanup-shared-${path}.json`, { path, status: error.status, message: error.message });
          throw error;
        }
      }
    }
    if (token) {
      const sharedAfter = (await api.listWorkspaceFiles({ scope: 'shared', spaceId: null })).entries;
      assert.equal(sharedAfter.some((entry) => entry.name.includes(stamp)), false, 'dedicated shared files must be cleaned');
    }
    for (const id of spaces) {
      try {
        await api.deleteSpace(id);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    if (token && baselineSpaceIds) {
      const after = (await api.listSpaces()).map((space) => space.id);
      assert.equal(after.some((id) => id === spaceId || id === otherSpaceId || id === bulkSpaceId), false);
      for (const id of baselineSpaceIds) assert.ok(after.includes(id), `original space retained: ${id}`);
    }
    pass('cleanup removed only dedicated spaces/files and retained original spaces');
  } catch (error) {
    failure ??= error;
    console.error('FAIL cleanup:', error);
  }
  token = undefined;
  write('results.json', {
    passed: !failure,
    base,
    marker,
    spaceId,
    otherSpaceId,
    bulkSpaceId,
    checks,
    runs: runs.map(({ runId, events, error, transportError }) => ({ runId, events, error, transportError })),
    error: failure?.message,
    completedAt: new Date().toISOString(),
    unverified: failure
      ? ['Remaining scenarios after the failed assertion; inspect checks and error']
      : [
        'native directory picker and physical file write (requires later Android UI/native acceptance)',
        'image/binary full download and >8MiB rejection (manual HTTP contract has no binary upload fixture)',
        'legacy non-ASCII read-only names (cannot be created through the confirmed write contract)',
      ],
  });
  console.log('Evidence:', output);
}

if (failure) process.exitCode = 1;
