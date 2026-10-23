/**
 * 聊天展示纯逻辑的真实回归：专用空间、真实外部模型、currentTime、
 * SSE 聚合与权威历史全部走生产 HttpApiClient；不拦截响应、不使用替身。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { projectHistory } from '../src/chat/chat-state.ts';
import { describeTool } from '../src/chat/tool-display.ts';
import { safeMessageUrl } from '../src/chat/message-links.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for real model and live data');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');
const keepSpace = process.env.E2E_KEEP_SPACE === '1';
const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-chat-display-e2e-run.'));
const stamp = Date.now().toString(36);
const marker = `CHAT_DISPLAY_E2E_${stamp}`;
const spaceId = `chat-display-e2e-${stamp}`;
const runId = `chat-display-run-${stamp}`;
const messageId = `${runId}-message`;
const linkUrl = `https://example.com/?${marker}`;

let token;
let cleanupRequired = false;
let initialVersion;
let failure;
let history;
let baselineSpaces;
const checks = [];
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real authentication rejected'); });

console.log('OUTPUT', output);
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pass = (name, extra = {}) => {
  checks.push({ name, ...extra });
  console.log('PASS', name);
};
const phase = (name, extra = {}) => write('context.json', {
  phase: name,
  base,
  marker,
  spaceId,
  runId,
  keepSpace,
  ...extra,
});

async function deployment(label) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json'));
  assert.equal(health.ok, true);
  assert.equal(health.backend, 'pi');
  assert.equal(health.configured, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const [path, methods] of Object.entries({
    '/api/conversation': ['get'],
    '/api/conversation/run': ['post'],
    '/api/spaces': ['get'],
    '/api/spaces/{spaceId}': ['delete'],
    '/api/spaces/{spaceId}/instructions': ['get', 'put'],
  })) {
    for (const method of methods) assert.ok(schema.paths[path]?.[method], `${method} ${path}`);
  }
  write(`deployment-${label}.json`, { serviceVersion: health.serviceVersion });
  return health.serviceVersion;
}

function markdownLinks(content) {
  return [...content.matchAll(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
}

function assertMarkdown(content) {
  assert.ok(content.includes(marker), 'Unique marker must appear in the model reply');
  assert.match(content, /^##\s+\S+/m, 'Heading is required');
  assert.match(content, /(?:\*\*|__)[^*_\n]+(?:\*\*|__)/, 'Bold text is required');
  assert.match(content, /^\s*(?:[-*+]|\d+\.)\s+\S+/m, 'List item is required');
  assert.match(content, /^>\s+\S+/m, 'Blockquote is required');
  assert.match(
    content,
    /^\s*\|? *:?-{3,} *?:?(?:\| *:?-{3,} *?:?)+\|?\s*$/m,
    'Markdown table separator is required',
  );
  assert.match(content, /```(?:ts|typescript)\r?\n[\s\S]*?```/i, 'Fenced TypeScript code is required');
  const links = markdownLinks(content);
  assert.ok(links.length > 0, 'HTTP Markdown link is required');
  assert.ok(links.every((url) => safeMessageUrl(url) !== undefined), 'Every visible HTTP link must pass safeMessageUrl');
  assert.ok(links.some((url) => url === linkUrl), 'The dedicated HTTP link must be preserved');
}

async function runModel() {
  const before = await api.getConversation(spaceId);
  assert.equal(before.revision, 'empty');
  const eventTypes = [];
  const tools = [];
  const toolResults = [];
  const argsById = new Map();
  let streamedMarkdown = '';
  let runError;
  await api.runAgent({
    spaceId,
    runId,
    expectedRevision: before.revision,
    message: {
      id: messageId,
      content: [
        `Call the currentTime tool exactly once before answering.`,
        `Then reply with Markdown containing all of these elements: one level-2 heading, one bold phrase, one two-item list, one blockquote, one two-column table with a header row, one fenced TypeScript code block, and one Markdown link to ${linkUrl}.`,
        `Include the exact marker ${marker}.`,
        `Do not call any other tool, write files, or create memories, reminders, goals, monitors, or subagents.`,
      ].join(' '),
    },
  }, (event) => {
    eventTypes.push(event.type);
    if (event.type === 'TEXT_MESSAGE_CONTENT' && event.delta) streamedMarkdown += event.delta;
    if (event.type === 'TOOL_CALL_START') tools.push({ id: event.toolCallId, name: event.toolCallName });
    if (event.type === 'TOOL_CALL_ARGS') argsById.set(event.toolCallId, (argsById.get(event.toolCallId) ?? '') + (event.delta ?? ''));
    if (event.type === 'TOOL_CALL_RESULT') toolResults.push({ toolCallId: event.toolCallId, content: event.content });
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(300_000));

  assert.equal(runError, undefined, `Real model run failed: ${runError}`);
  assert.ok(eventTypes.includes('RUN_STARTED'));
  assert.ok(eventTypes.includes('RUN_FINISHED'));
  assert.equal(tools.filter((tool) => tool.name === 'currentTime').length, 1, 'Real model must call currentTime exactly once');
  assert.deepEqual(tools.map((tool) => tool.name), ['currentTime'], 'No other tool may be called');
  assert.equal(toolResults.length, 1);
  assertMarkdown(streamedMarkdown);

  const liveTool = tools[0];
  const liveArgs = argsById.get(liveTool.id) ?? '';
  const liveResult = toolResults[0].content;
  assert.equal(describeTool(liveTool.name, liveArgs).status, 'pending', 'A started tool without a result is pending');
  const liveDisplay = describeTool(liveTool.name, liveArgs, liveResult);
  assert.equal(liveDisplay.kind, 'time');
  assert.equal(liveDisplay.title, '当前时间');
  assert.equal(liveDisplay.status, 'finished');

  history = await api.getConversation(spaceId);
  const userIndex = history.messages.findIndex((message) => message.id === messageId);
  assert.ok(userIndex >= 0, 'Persisted history must contain the exact user request');
  const assistant = history.messages.slice(userIndex + 1).find((message) => message.role === 'assistant' && message.content);
  assert.ok(assistant?.content, 'Persisted history must contain the visible model reply');
  assert.equal(assistant.content, streamedMarkdown, 'SSE text and authoritative history must agree');
  assertMarkdown(assistant.content);

  const projected = projectHistory(history.messages);
  const historyAssistant = projected.find((message) => message.id === assistant.id);
  assert.ok(historyAssistant);
  assert.equal(historyAssistant.text, streamedMarkdown);
  const historyTools = historyAssistant.toolCalls.filter((tool) => tool.name === 'currentTime');
  assert.equal(historyTools.length, 1, 'Visible history must contain exactly one currentTime projection');
  const historyTool = historyTools[0];
  const historyDisplay = describeTool(historyTool.name, historyTool.args, historyTool.result);
  assert.equal(historyDisplay.kind, 'time');
  assert.equal(historyDisplay.status, 'finished');

  write('model-run.json', {
    runId,
    eventTypes,
    visibleTools: tools,
    visibleToolResults: toolResults,
    streamedMarkdown,
  });
  write('history.json', history);
  write('helper-results.json', { liveDisplay, historyDisplay });
  pass('real model runs currentTime and emits the requested visible Markdown', { toolCalls: tools.length });
  pass('safe helper consumes real SSE reply and authoritative history');
}

try {
  initialVersion = await deployment('start');
  pass('current docs/OpenAPI/health identity agrees', { serviceVersion: initialVersion });

  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'Real model backend is required');
  token = auth.token;

  baselineSpaces = (await api.listSpaces()).map((space) => space.id);
  assert.ok(!baselineSpaces.includes(spaceId), 'Dedicated chat-display space must start absent');
  cleanupRequired = true;
  await api.saveSpaceInstructions(
    spaceId,
    'Dedicated mobile chat display acceptance. Follow the explicit user request. Only use currentTime when requested; never write files or create other resources.',
  );
  phase('model-run');
  await runModel();

  phase('done', { assistantMessageId: history?.messages.find((message) => message.role === 'assistant')?.id });
  pass('real chat display regression completed');
} catch (error) {
  failure = error;
  phase('failed', { error: error.message });
  console.error('FAIL', error.stack);
} finally {
  try {
    if (cleanupRequired) {
      if (keepSpace) {
        write('keep-space.json', { spaceId, marker, runId });
        pass('dedicated space retained for native acceptance', { spaceId });
      } else if (token) {
        await api.deleteSpace(spaceId).catch((error) => {
          if (error?.status !== 404) throw error;
        });
        const remaining = (await api.listSpaces()).map((space) => space.id);
        assert.ok(!remaining.includes(spaceId), 'Cleanup must remove only the dedicated chat-display space');
        const missingBaseline = baselineSpaces?.filter((id) => !remaining.includes(id)) ?? [];
        assert.deepEqual(missingBaseline, [], 'Cleanup must not remove any pre-existing space');
        write('cleanup.json', {
          removedSpaceId: spaceId,
          baselineCount: baselineSpaces?.length ?? 0,
          baselineUntouched: true,
        });
        pass('cleanup removes the dedicated space through the API');
      } else {
        throw new Error('Cleanup is required but no authenticated session is available');
      }
    }
    if (initialVersion) {
      assert.deepEqual(await deployment('end'), initialVersion);
      pass('deployment identity unchanged throughout real acceptance');
    }
  } catch (error) {
    failure ??= error;
    console.error('FAIL cleanup/audit', error.message);
  }
  token = undefined;
  write('checks.json', checks);
  if (failure) process.exitCode = 1;
}
