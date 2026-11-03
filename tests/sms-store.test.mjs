import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SmsStore, SMS_REFRESH_INTERVAL_MS} from '../src/information/sms-store.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(overrides={}) {
 const remote={settings:{enabled:true,batchWindowSeconds:15},notes:'saved',items:[{id:'one',status:'pending'}]};let reads=0;
 const client={getSmsSettings:async()=>{reads++;return {...remote.settings};},getSmsPreferences:async()=>({notes:remote.notes,feedbackExamples:[]}),listSmsItems:async()=>({items:remote.items.map(i=>({...i}))}),saveSmsSettings:async s=>(remote.settings=s),saveSmsPreferences:async p=>({notes:remote.notes=p.notes,feedbackExamples:[]}),ingestSmsItems:async()=>[],triggerSmsRun:async()=>{},...overrides};
 const store=new SmsStore(client,15);return {store,remote,client,reads:()=>reads};
}
test('短信仅在设置页前台定期回读，静默分析状态更新；离开、后台或销毁停止',async()=>{
 const f=fixture();try {
 assert.equal(SMS_REFRESH_INTERVAL_MS,5000);f.store.setForeground(true);await tick();const initial=f.reads();await new Promise(r=>setTimeout(r,35));assert.equal(f.reads(),initial);
 f.store.setVisible(true);f.remote.items[0].status='processed';await new Promise(r=>setTimeout(r,40));assert.equal(f.store.getSnapshot().items[0].status,'processed');
 f.store.setVisible(false);const hidden=f.reads();await new Promise(r=>setTimeout(r,35));assert.equal(f.reads(),hidden);
 f.store.setVisible(true);f.store.setForeground(false);const paused=f.reads();await new Promise(r=>setTimeout(r,35));assert.equal(f.reads(),paused);
 f.store.setForeground(true);await tick();assert.ok(f.reads()>paused);
 }finally{f.store.dispose();}
 const ended=f.reads();await new Promise(r=>setTimeout(r,35));assert.equal(f.reads(),ended);
});
test('回读保留脏草稿，干净偏好接受远端更新；读取失败保留旧记录与开关',async()=>{
 const f=fixture();try {
 await f.store.reload();f.store.setDraftNotes('unsaved');f.remote.notes='remote';f.remote.items[0].status='processed';await f.store.reload();assert.equal(f.store.getSnapshot().draftNotes,'unsaved');assert.equal(f.store.getSnapshot().preferences.notes,'remote');
 f.store.setDraftNotes('remote');f.remote.notes='new';await f.store.reload();assert.equal(f.store.getSnapshot().draftNotes,'new');
 f.client.listSmsItems=async()=>{throw Error('offline');};await f.store.reload();assert.equal(f.store.getSnapshot().items[0].status,'processed');assert.equal(f.store.getSnapshot().settings.enabled,true);assert.match(f.store.getSnapshot().error,/保留上次记录/);
 }finally{f.store.dispose();}
});
test('保存前废弃旧 GET，晚到读取不能回滚开关；保存中继续修改的草稿保留',async()=>{
 const old=deferred();const saving=deferred();const f=fixture();try {
 await f.store.reload();let readingOld=true;f.client.getSmsSettings=()=>readingOld?(readingOld=false,old.promise):Promise.resolve({enabled:false,batchWindowSeconds:15});const reading=f.store.reload();f.client.saveSmsSettings=async()=>({enabled:false,batchWindowSeconds:15});const write=f.store.toggleEnabled(false);await tick();old.resolve({enabled:true,batchWindowSeconds:15});await Promise.all([reading,write]);assert.equal(f.store.getSnapshot().settings.enabled,false);
 f.client.getSmsSettings=async()=>({enabled:false,batchWindowSeconds:15});f.client.saveSmsPreferences=()=>saving.promise;f.store.setDraftNotes('sent');const save=f.store.saveNotes();f.store.setDraftNotes('new draft');saving.resolve({notes:'sent',feedbackExamples:[]});await save;assert.equal(f.store.getSnapshot().draftNotes,'new draft');
 }finally{f.store.dispose();}
});
test('写入结果未明时自动回读不解锁、不重发，显式刷新核对仍保留草稿',async()=>{
 let calls=0;const f=fixture({saveSmsPreferences:async()=>{calls++;throw Error('lost response');}});try {
 await f.store.reload();f.store.setDraftNotes('unsent');await f.store.saveNotes();assert.equal(f.store.getSnapshot().needsReadback,true);const before=f.reads();await f.store.reload(true);await f.store.saveNotes();assert.equal(f.reads(),before);assert.equal(calls,1);
 await f.store.reload();assert.equal(f.store.getSnapshot().needsReadback,false);assert.equal(f.store.getSnapshot().draftNotes,'unsent');
 }finally{f.store.dispose();}
});
test('原生并发短信不丢失，条目去重并有界；分析成功与读取失败分离，不自动重跑',async()=>{
 let runs=0;const first=deferred();const second=deferred();let n=0;
 const f=fixture({ingestSmsItems:()=>++n===1?first.promise:second.promise,triggerSmsRun:async()=>{runs++;}});try {
 await f.store.reload();const a=f.store.ingestSms('a',undefined,'one');const b=f.store.ingestSms('b',undefined,'two');first.resolve([{id:'a',status:'pending'}]);await a;assert.equal(f.store.getSnapshot().ingesting,true);assert.equal(f.store.getSnapshot().items[0].id,'a');
 f.remote.items=[{id:'b',status:'pending'},{id:'a',status:'pending'},...Array.from({length:10},(_,i)=>({id:`old-${i}`,status:'processed'}))];
 f.client.listSmsItems=async()=>({items:f.remote.items.slice(0,10)});second.resolve([{id:'b',status:'pending'},{id:'a',status:'pending'}]);await b;assert.equal(f.store.getSnapshot().ingesting,false);assert.equal(f.store.getSnapshot().items.length,10);assert.equal(new Set(f.store.getSnapshot().items.map(i=>i.id)).size,10);assert.deepEqual(f.store.getSnapshot().items.slice(0,2).map(i=>i.id),['b','a']);
 f.client.listSmsItems=async()=>{throw Error('offline');};await f.store.triggerRun();assert.equal(runs,1);assert.equal(f.store.getSnapshot().needsReadback,false);assert.match(f.store.getSnapshot().notice,/分析已完成/);assert.match(f.store.getSnapshot().error,/同步失败/);
 }finally{f.store.dispose();}
});
test('页面只控制刷新生命周期，权限与监听在连接所有者，状态文案为中文',()=>{
 const read=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');const ui=read('information/SmsSettingsCard.tsx');assert.match(ui,/setVisible\(true\); return \(\) => setVisible\(false\)/);assert.match(ui,/processing: '分析中'/);assert.match(ui,/failed: '分析失败'/);
 const hook=read('information/useSmsInformation.ts');assert.match(hook,/AppState.addEventListener/);assert.match(hook,/store.setForeground\(next === 'active'\)/);assert.match(hook,/hasSmsPermission !== true/);assert.doesNotMatch(ui,/setInterval|addSmsListener|requestSmsPermission/);
});
