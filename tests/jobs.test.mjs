import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JobStore } from '../src/jobs/job-store.ts';
import { jobEditor, jobUpdates, availableJobActions, localJobTime } from '../src/jobs/presentation.ts';
import { parseJob, parseJobs, parseJobDetail, parseJobRemoval, parseServerTimeZone } from '../src/api/job-contracts.ts';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';

const fixture = (patch = {}) => ({ id: 'job-1', kind: 'job', title: 'Reminder', prompt: 'Only reply hello', daily: true, at: '09:00', enabled: true, status: 'scheduled', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', nextRunAt: '2026-10-22T01:00:00.000Z', error: null, originSpaceId: 'space-1', ...patch });
const event = { id: 'ev-1', taskId: 'job-1', date: '2026-10-20T00:00:00Z', kind: 'status', title: 'Created', detail: '' };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup(overrides = {}) {
  let job = fixture(); const calls = [];
  const client = {
    listJobs: async (query) => { calls.push(['list', query]); return job ? [job] : []; },
    getJob: async (id) => { calls.push(['get', id]); if (!job) throw new ApiError(404, 'gone'); return { job, events: [event] }; },
    getServerTimeZone: async () => 'Asia/Shanghai',
    updateJob: async (id, patch) => { calls.push(['patch', id, patch]); job = { ...job, ...patch }; return job; },
    controlJob: async (id, action) => { calls.push(['control', id, action]); job = { ...job, status: action === 'pause' ? 'paused' : 'scheduled', enabled: action !== 'pause' }; return job; },
    deleteJob: async (id) => { calls.push(['delete', id]); job = undefined; return { ok: true, id }; }, ...overrides,
  };
  const store = new JobStore(client);
  return { store, calls, setJob: (value) => { job = value; }, client };
}
async function opened(options) { const context = setup(options); context.store.setActive(true); context.store.open(); await settle(); context.store.select('job-1'); await settle(); return context; }

test('Jobs strict contract rejects wrong kinds, missing fields, null optionals and foreign event/identity', () => {
  assert.deepEqual(parseJob(fixture()), fixture());
  for (const patch of [{ id: '' }, { kind: 'task' }, { daily: 'true' }, { enabled: 1 }, { status: 'completed' }, { error: undefined }, { nextRunAt: null }, { originSpaceId: 12 }]) assert.throws(() => parseJob(fixture(patch)), (error) => error.status === 502);
  for (const field of ['id', 'title', 'prompt', 'at', 'createdAt', 'updatedAt']) { const job = fixture(); delete job[field]; assert.throws(() => parseJob(job)); }
  assert.throws(() => parseJob(fixture(), 'another'));
  assert.throws(() => parseJobs({ jobs: [fixture(), fixture()] }));
  assert.throws(() => parseJobs({ tasks: [] }));
  assert.deepEqual(parseJobDetail({ job: fixture(), events: [event] }, 'job-1').events, [event]);
  for (const data of [{ task: fixture(), events: [] }, { job: fixture(), events: [{ ...event, taskId: 'foreign' }] }, { job: fixture(), events: [{ ...event, kind: 'unknown' }] }, { job: fixture(), events: [event, event] }]) assert.throws(() => parseJobDetail(data, 'job-1'));
  assert.deepEqual(parseJobRemoval({ ok: true, id: 'job-1' }, 'job-1'), { ok: true, id: 'job-1' });
  for (const data of [{ ok: false, id: 'job-1' }, { ok: true, id: 'foreign' }]) assert.throws(() => parseJobRemoval(data, 'job-1'));
  for (const timeZone of [undefined, '', 'not-a-timezone', 8]) assert.throws(() => parseServerTimeZone({ ok: true, timeZone }));
});

test('Daily HH:mm is unchanged and naive ISO is never emitted; unchanged timestamp precision is retained', () => {
  const editor = jobEditor(fixture());
  assert.deepEqual(jobUpdates({ ...editor, time: '10:30' }), { daily: true, at: '10:30' });
  for (const time of ['9:00', '24:00', '12:60', '09:00Z', ' 09:00']) assert.throws(() => jobUpdates({ ...editor, time }));
  for (const prompt of ['', '   ', 'a'.repeat(2001)]) assert.throws(() => jobUpdates({ ...editor, prompt }));
  assert.throws(() => jobUpdates(editor));
  const once = jobEditor(fixture({ daily: false, at: '2026-10-22T09:00:32.123+08:00' }));
  assert.deepEqual(jobUpdates({ ...once, prompt: 'Changed' }), { prompt: 'Changed' });
  assert.throws(() => jobUpdates({ ...once, date: '2027-02-30' }));
  assert.throws(() => jobUpdates({ ...once, date: '2026-01-01' }));
  const updates = jobUpdates({ ...once, date: '2099-10-22', time: '10:00' });
  assert.match(updates.at, /^2099-10-22T10:00:00[+-]\d{2}:\d{2}$/);
  assert.equal(updates.daily, false);
  assert.equal(localJobTime('not-a-date'), '服务端时间格式异常');
  assert.equal(localJobTime('2026-10-22T09:00:00'), '服务端时间格式异常');
  assert.equal(jobEditor(fixture({ daily: false, at: '2026-10-22T09:00:00' })).date, '');
});

test('Local one-time offset uses chosen date, not UTC/device-current-day offset; DST gap rejected', () => {
  const script = `import {jobEditor,jobUpdates} from './src/jobs/presentation.ts';const e=jobEditor(${JSON.stringify(fixture())});for(const date of ['2027-07-01','2027-01-01'])console.log(JSON.stringify(jobUpdates({...e,daily:false,date,time:'09:00'},0)));try{jobUpdates({...e,daily:false,date:'2027-03-14',time:'02:30'},0)}catch{console.log('gap-rejected')}`;
  const output = execFileSync(process.execPath, ['--import', './tests/register-source.mjs', '--input-type=module', '-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.match(output, /2027-07-01T09:00:00-04:00/); assert.match(output, /2027-01-01T09:00:00-05:00/); assert.match(output, /gap-rejected/);
});

test('Health is truly anonymous; encoded ID and Jobs query use only documented fields', async () => {
  const original = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, init) => { requests.push([url, init]); return new Response(JSON.stringify(url.endsWith('/api/health') ? { ok: true, timeZone: 'Asia/Shanghai' } : { jobs: [] })); };
  try {
    const client = new HttpApiClient('https://api.example', () => 'secret', () => {});
    assert.equal(await client.getServerTimeZone(), 'Asia/Shanghai'); assert.equal(requests[0][1].headers.authorization, undefined);
    await client.listJobs({ spaceId: 'sp/one', threadId: 'forbidden', sort: 'createdAt', order: 'desc' });
    assert.equal(requests[1][0], 'https://api.example/api/jobs?spaceId=sp%2Fone&sort=createdAt&order=desc');
  } finally { globalThis.fetch = original; }
});

test('JobStore actual reads, serial confirmed controls, cancelled confirmations and successful edit/delete readback', async () => {
  const { store, calls } = await opened(); assert.equal(store.canWrite(), true); assert.equal(store.getSnapshot().timeZone, 'Asia/Shanghai');
  store.requestAction('pause'); store.cancelAction(); assert.equal(await store.confirmAction(), false); assert.equal(calls.filter(([kind]) => kind === 'control').length, 0);
  store.requestAction('pause'); assert.equal(await store.confirmAction(), true); await settle(); assert.equal(store.getSnapshot().detail.job.status, 'paused');
  store.requestAction('resume'); assert.equal(await store.confirmAction(), true); await settle();
  store.edit(); store.setEditor({ prompt: 'Changed prompt' }); assert.equal(await store.save(), true); await settle();
  assert.equal(store.getSnapshot().detail.job.prompt, 'Changed prompt'); assert.equal(store.getSnapshot().editor, undefined);
  store.requestAction('delete'); assert.equal(await store.confirmAction(), true); await settle(); assert.deepEqual(store.getSnapshot().jobs, []); assert.equal(store.getSnapshot().selectedId, undefined); store.dispose();
});

test('Invalid forms never issue PATCH; source is not silently rewritten and unchanged seconds are not truncated', async () => {
  const { store, calls } = await opened(); store.edit(); store.setEditor({ prompt: '  ' }); assert.equal(await store.save(), false); assert.equal(calls.some(([kind]) => kind === 'patch'), false);
  store.setEditor({ prompt: 'New' }); await store.save(); await settle(); assert.deepEqual(calls.find(([kind]) => kind === 'patch')[2], { prompt: 'New' }); store.dispose();
});

test('Refresh/foreground expire destructive confirmations, preserve draft and detect external edits', async () => {
  const { store, setJob } = await opened(); store.requestAction('delete'); await store.refresh(); assert.equal(await store.confirmAction(), false);
  store.edit(); store.setEditor({ prompt: 'Unsent' }); store.close(); store.open(); await settle(); assert.equal(store.getSnapshot().editor.prompt, 'Unsent');
  store.setActive(false); setJob(fixture({ prompt: 'External', updatedAt: '2026-10-21T00:00:00Z' })); store.setActive(true); await settle(); assert.equal(store.getSnapshot().editor.prompt, 'Unsent'); assert.equal(await store.save(), false); assert.match(store.getSnapshot().error, /其他地方更新/); store.dispose();
});

for (const error of [new ApiError(0, 'offline'), new ApiError(408, 'timeout'), new ApiError(502, 'invalid'), new Error('transport')]) {
  test(`Uncertain write (${error.message}) locks replay, preserves draft; explicit fresh review required`, async () => {
    const { store, calls } = await opened({ updateJob: async () => { calls.push(['patch']); throw error; } });
    store.edit(); store.setEditor({ prompt: 'Unsent' }); assert.equal(await store.save(), false); assert.equal(store.getSnapshot().uncertain, true); assert.equal(store.getSnapshot().editor.prompt, 'Unsent');
    store.acknowledgeReviewed(); assert.equal(store.getSnapshot().uncertain, true); assert.equal(await store.save(), false);
    await store.refresh(); assert.equal(store.getSnapshot().reviewed, true); assert.equal(store.getSnapshot().uncertain, true);
    store.acknowledgeReviewed(); assert.equal(store.getSnapshot().uncertain, false); assert.equal(calls.filter(([kind]) => kind === 'patch').length, 1); store.dispose();
  });
}

test('Late reads and writes cannot publish after background, selection or disposal; no automatic replay', async () => {
  const pending = deferred(); const { store } = await opened({ updateJob: () => pending.promise }); store.edit(); store.setEditor({ prompt: 'Sent' }); const saving = store.save();
  assert.equal(store.getSnapshot().writing, true); store.setActive(false); assert.equal(store.getSnapshot().uncertain, true); pending.resolve(fixture({ prompt: 'Late' })); assert.equal(await saving, false); assert.equal(store.getSnapshot().editor.prompt, 'Sent');
  store.setActive(true); await settle(); assert.equal(store.getSnapshot().uncertain, true); store.dispose(); assert.equal(store.getSnapshot().loaded, false);
  const reading = deferred(); const other = setup({ listJobs: () => reading.promise }); other.store.setActive(true); other.store.open(); other.store.close(); reading.resolve([fixture()]); await settle(); assert.equal(other.store.getSnapshot().loaded, false); other.store.dispose();
});

test('Failed refresh cannot unlock uncertain write; definitive errors preserve draft without uncertain replay', async () => {
  let offline = false;
  const context = await opened({ listJobs: async () => { if (offline) throw new ApiError(0, 'offline'); return [fixture()]; }, updateJob: async () => { throw new ApiError(408, 'timeout'); } });
  context.store.edit(); context.store.setEditor({ prompt: 'New' }); await context.store.save(); offline = true; await context.store.refresh(); context.store.acknowledgeReviewed(); assert.equal(context.store.getSnapshot().uncertain, true); context.store.dispose();
  const other = await opened({ updateJob: async () => { throw new ApiError(409, 'conflict'); } }); other.store.edit(); other.store.setEditor({ prompt: 'New' }); await other.store.save(); assert.equal(other.store.getSnapshot().uncertain, false); assert.equal(other.store.getSnapshot().stale, true); assert.equal(other.store.getSnapshot().editor.prompt, 'New'); other.store.dispose();
});

test('Missing task never becomes an editable phantom; unknown server timezone does not hide real list', async () => {
  const { store, setJob } = await opened({ getServerTimeZone: async () => { throw new ApiError(0, 'offline'); } }); assert.equal(store.getSnapshot().jobs.length, 1); assert.equal(store.getSnapshot().timeZone, undefined);
  store.edit(); store.setEditor({ time: '10:00' }); assert.equal(await store.save(), false); assert.match(store.getSnapshot().error, /服务端时区/);
  setJob(undefined); await store.refresh(); assert.equal(store.getSnapshot().missing, true); assert.equal(store.getSnapshot().detail, undefined); assert.equal(store.canWrite(), false); assert.equal(await store.save(), false); store.cancelEdit(); store.select(); await settle(); assert.deepEqual(store.getSnapshot().jobs, []); store.dispose();
});

test('Retry only offered for failed jobs; notification invalidates without opening a second SSE/polling loop', async () => {
  assert.deepEqual(availableJobActions(fixture({ status: 'running' })), []);
  assert.deepEqual(availableJobActions(fixture({ status: 'queued' })), []);
  assert.ok(availableJobActions(fixture({ status: 'failed', enabled: false })).includes('retry'));
  const { store, calls, setJob } = await opened(); store.requestAction('retry'); assert.equal(await store.confirmAction(), false);
  setJob(fixture({ status: 'failed', enabled: false })); store.receive({ event: 'agent_status_updated', data: { source: 'job' } }); await settle();
  store.requestAction('retry'); assert.equal(await store.confirmAction(), true); await settle(); assert.equal(calls.filter(([kind, , action]) => kind === 'control' && action === 'retry').length, 1); store.dispose();
});

test('Writes are serialized; closing page does not falsely cancel authorized remote write; re-opening reads truth', async () => {
  const pending = deferred(); let writes = 0;
  const { store } = await opened({ controlJob: async () => { writes++; return pending.promise; } });
  store.requestAction('pause'); const first = store.confirmAction(); assert.equal(await store.confirmAction(), false); store.requestAction('delete'); assert.equal(writes, 1);
  store.close(); pending.resolve(fixture({ status: 'paused', enabled: false })); assert.equal(await first, true); assert.equal(store.getSnapshot().uncertain, false);
  store.open(); await settle(); assert.equal(store.getSnapshot().stale, false); assert.equal(writes, 1); store.dispose();
});

test('A stale scoped request cannot replace a newer filter; background expires a pending confirmation', async () => {
  const pending = deferred(); let count = 0;
  const { store } = setup({ listJobs: async () => ++count === 1 ? pending.promise : [] });
  store.setActive(true); store.open(); store.setQuery({ spaceId: 'new-space', sort: 'updatedAt', order: 'desc' }); await settle();
  pending.resolve([fixture()]); await settle(); assert.deepEqual(store.getSnapshot().jobs, []); assert.equal(store.getSnapshot().query.spaceId, 'new-space'); store.dispose();
  const other = await opened(); other.store.requestAction('delete'); other.store.setActive(false); other.store.setActive(true); await settle(); assert.equal(await other.store.confirmAction(), false); other.store.dispose();
});

test('Every Job mutation/detail validates response ID and never replays a malformed write', async () => {
  const original = globalThis.fetch;
  try {
    for (const method of ['get', 'pause', 'patch', 'delete']) {
      let calls = 0;
      globalThis.fetch = async (url) => {
        calls++; assert.match(url, /\/api\/jobs\/job%2Fone(?:\/control)?$/);
        const job = fixture({ id: 'foreign' });
        return new Response(JSON.stringify(method === 'get' ? { job, events: [] } : method === 'delete' ? { ok: true, id: 'foreign' } : job));
      };
      const client = new HttpApiClient('https://api.example', () => 'secret', () => {});
      const request = method === 'get' ? client.getJob('job/one') : method === 'pause' ? client.controlJob('job/one', 'pause') : method === 'patch' ? client.updateJob('job/one', { prompt: 'New' }) : client.deleteJob('job/one');
      await assert.rejects(request, (error) => error instanceof ApiError && error.status === 502); assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test('Anonymous health401 does not invalidate the authenticated service connection', async () => {
  const original = globalThis.fetch; let invalidated = false;
  globalThis.fetch = async (_url, options) => { assert.equal(options.headers.authorization, undefined); return new Response(JSON.stringify({ error: 'No public health' }), { status: 401 }); };
  try {
    const client = new HttpApiClient('https://api.example', () => 'kept-token', () => { invalidated = true; });
    await assert.rejects(client.getServerTimeZone(), (error) => error.status === 401); assert.equal(invalidated, false);
  } finally { globalThis.fetch = original; }
});

test('Running/queued jobs cannot be edited, retried, cancelled or deleted by stale UI callbacks', async () => {
  for (const status of ['running', 'queued']) {
    const { store, calls } = await opened({ getJob: async () => ({ job: fixture({ status }), events: [] }) });
    store.edit(); assert.equal(store.getSnapshot().editor, undefined);
    for (const action of ['pause', 'resume', 'cancel', 'retry', 'delete']) { store.requestAction(action); assert.equal(store.getSnapshot().confirmation, undefined); assert.equal(await store.confirmAction(), false); }
    assert.equal(calls.some(([kind]) => ['control', 'patch', 'delete'].includes(kind)), false); store.dispose();
  }
});

test('Editing only text of a completed one-time job preserves past absolute time, offset and source', async () => {
  const original = fixture({ daily: false, at: '2020-01-01T09:00:32.123+08:00', status: 'succeeded', enabled: false });
  const writes = [];
  const { store } = await opened({ getJob: async () => ({ job: original, events: [] }), updateJob: async (id, patch) => { writes.push([id, patch]); return { ...original, ...patch }; } });
  store.edit(); store.setEditor({ prompt: 'Corrected text' }); assert.equal(await store.save(), true);
  assert.deepEqual(writes, [['job-1', { prompt: 'Corrected text' }]]); store.dispose();
});

test('Native driver never sends Back for stale Gboard visibility or another focused app', () => {
  const script = `import ast,re
source=ast.parse(open('tools/e2e-jobs-native.py').read())
fn=next(node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='dismiss_keyboard')
cases=[('mCurrentFocus=Window{host.exp.exponent}\\nmImeShowing=false\\nmIsInputViewShown=true',False),('mCurrentFocus=Window{host.exp.exponent}\\nmImeShowing=true',True),('mCurrentFocus=Window{another.app}\\nmImeShowing=true',False),('mCurrentFocus=Window{host.exp.exponent}\\nmIsInputViewShown=true',False)]
for state,expected in cases:
 calls=[]
 def sh(*args):
  calls.append(args)
  return state.encode()
 env={'sh':sh,'re':re,'time':type('Clock',(),{'sleep':staticmethod(lambda _:None)})}
 exec(compile(ast.Module(body=[fn],type_ignores=[]),'driver','exec'),env)
 env['dismiss_keyboard']()
 assert (('shell','input','keyevent','KEYCODE_BACK') in calls)==expected
print('4 native keyboard safety cases passed')`;
  assert.match(execFileSync('python3', ['-c', script], { encoding: 'utf8' }), /4 native keyboard safety cases passed/);
});

test('Native driver scrolls clipped buttons into view and only dismisses its own visible selection popup', () => {
  const script = `import ast,re,xml.etree.ElementTree as ET
source=ast.parse(open('tools/e2e-jobs-native.py').read())
names={'bounds','visible','tappable','selection_popup_visible','swipe'}
env={'re':re,'width':1080,'height':2400}
exec(compile(ast.Module(body=[node for node in source.body if isinstance(node,ast.FunctionDef) and node.name in names],type_ignores=[]),'driver','exec'),env)
clipped=ET.fromstring('<node bounds="[612,2124][833,2153]" enabled="true"><node text="Cancel" bounds="[648,2153][796,2153]"/></node>')
full=ET.fromstring('<node bounds="[612,1800][833,1916]" enabled="true"><node text="Cancel" bounds="[648,1829][796,1887]"/></node>')
assert not env['tappable'](clipped)
assert env['tappable'](full)
calls=[]
env.update({'tree':ET.fromstring('<hierarchy><node class="android.widget.ScrollView" bounds="[0,315][1080,2153]"/></hierarchy>'),'density':420/160,'dismiss_selection':lambda:None,'sh':lambda *args:calls.append(args),'time':type('Clock',(),{'sleep':staticmethod(lambda _:None)})})
env['swipe']()
assert calls[-1][3]=='94' and 78<int(calls[-1][3])<105
state='mCurrentFocus=Window{host.exp.exponent/Activity}\\n  Window #7 Window{PopupWindow:abc}:\\npackage=host.exp.exponent appop=NONE\\nty=APPLICATION_ABOVE_SUB_PANEL\\nSurface: shown=true\\nisVisible=true'
assert env['selection_popup_visible'](state)
for changed in [state.replace('isVisible=true','isVisible=false'),state.replace('shown=true','shown=false'),state.replace('package=host.exp.exponent ','package=another.app '),state.replace('host.exp.exponent/Activity','another.app/Activity'),state.replace('APPLICATION_ABOVE_SUB_PANEL','APPLICATION_SUB_PANEL')]:
 assert not env['selection_popup_visible'](changed)
print('native clipped target and guarded selection cases passed')`;
  assert.match(execFileSync('python3', ['-c', script], { encoding: 'utf8' }), /native clipped target and guarded selection cases passed/);
});
