#!/usr/bin/env node
// P0 Finance: durable recovery of pending cloud deletes after restart/Undo crash.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)),'..');
const app=readFileSync(join(root,'app.js'),'utf8');
const fromTo=(src,start,end)=>{
 const i=src.indexOf(start),j=src.indexOf(end,i+start.length);
 assert(i>=0&&j>i,'Missing source range: '+start);
 return src.slice(i,j);
};
const now=Date.now();
const old=new Date(now-12_000).toISOString();
const fresh=new Date(now-1_000).toISOString();
const expired=new Date(now-30_000).toISOString();
const mk=(id,collection,cloudId,householdId='h1',date=old,extra={})=>({
 id:'trash-'+id,deletedAt:date,records:[{
 collection,record:{id,cloudId,householdId,cloudUpdatedAt:'rev-'+id,...extra}
 }]
});
let seq=0, persisted=0, scheduled=0, rendered=0;
const state={
 cloud:{householdId:'h1',userId:'u1',provider:'supabase',outbox:[]},
 finance:[],financeAccounts:[],
 trash:[
  mk('tx-pending','finance','remote-tx'),
  mk('account-pending','financeAccounts','remote-account'),
  mk('too-new','finance','remote-new','h1',fresh),
  mk('other-household','finance','remote-other','h2'),
  mk('undo','finance','remote-undo'),
  mk('pending-undo','finance','remote-pending-undo'),
  mk('already-deleted','finance','remote-acked','h1',old,{cloudDeleteConfirmedAt:expired}),
  mk('still-live','finance','remote-live'),
  mk('already-in-outbox','finance','remote-queued')
 ]
};
state.finance=[{id:'still-live',cloudId:'remote-live'}];
state.cloud.outbox=[{
 id:'existing-queue',collection:'finance',table:'finance_transactions',
 operation:'delete',cloudId:'remote-queued',expectedRevision:'rev-queued',createdAt:old
}];
const activeUndo=new Set(['trash-undo']);
const pendingUndo=new Set(['trash-pending-undo']);
const tables={finance:'finance_transactions',financeAccounts:'finance_accounts'};
const moduleFactory=new Function(
 'state','CLOUD_DELETE_TABLES','cloudRecordConflicts','uid','normalizeText',
 'normalizeCloudOutbox','trashRecordTitle','persistStateSnapshot','cloudLocalPendingCount',
 'requestBackgroundRender','scheduleCloudAutosync','activeUndoTrashIds',
 'pendingUndoTrashIds','cloudReady',
 fromTo(app,'  function enqueueTrashCloudDeletes(trashIds = [], options = {}) {',
   '  function cloudErrorIsTransient(error) {')+
 '\nreturn {enqueueTrashCloudDeletes,recoverFinanceTrashCloudDeletes,confirmFinanceTrashCloudDelete};'
);
const funcs=moduleFactory(
 state,tables,()=>[],()=>String(++seq),x=>String(x||''),
 entries=>{
  const map=new Map();
  for(const e of entries){const k=e.table+':'+e.cloudId;if(!map.has(k))map.set(k,e);}
  return [...map.values()];
 },(_,r)=>r.id||'Záznam',()=>{persisted++;},()=>0,()=>{rendered++;},()=>{scheduled++;},
 activeUndo,pendingUndo,()=>true
);
const first=funcs.recoverFinanceTrashCloudDeletes();
assert.equal(first,2,'only mature unacknowledged finance removals should recover');
assert.equal(state.cloud.outbox.length,3);
assert.deepEqual(new Set(state.cloud.outbox.map(x=>x.cloudId)),new Set(['remote-queued','remote-tx','remote-account']));
assert.equal(state.cloud.outbox.find(x=>x.cloudId==='remote-tx').expectedRevision,'rev-tx-pending');
assert.equal(scheduled,0,'restart recovery should not recursively schedule itself');
assert(persisted>0);
assert.equal(funcs.recoverFinanceTrashCloudDeletes(),0,'outbox already contains recovered work');
activeUndo.clear();pendingUndo.clear();
assert.equal(funcs.recoverFinanceTrashCloudDeletes(),2,'expired Undo/pending Undo is recoverable after restart');
assert.equal(state.cloud.outbox.length,5);
assert.equal(funcs.confirmFinanceTrashCloudDelete({collection:'finance',cloudId:'remote-tx'}),true);
assert.equal(state.trash[0].records[0].record.cloudDeleteConfirmedAt?.length>0,true);
assert.equal(funcs.confirmFinanceTrashCloudDelete({collection:'finance',cloudId:'remote-tx'}),false);
state.cloud.outbox=state.cloud.outbox.filter(x=>x.cloudId!=='remote-tx');
assert.equal(funcs.recoverFinanceTrashCloudDeletes(),0,'ACK must survive removal of outbox item');
assert(!state.cloud.outbox.some(x=>x.cloudId==='remote-tx'));

// Preserve late-insert cloud ID/confirmation when older household snapshot arrives.
const mergeFn=new Function('localTrash','remoteTrash',fromTo(app,
 '  function mergeFinanceTrashReceipts(localTrash = [], remoteTrash = []) {',
 '  function resetTrashTrackingBaseline() {')+
 '\nreturn mergeFinanceTrashReceipts(localTrash,remoteTrash);');
const remote=[mk('tx-pending','finance','','h1',old)];
const preserved=mergeFn(state.trash,remote);
assert.equal(preserved[0].records[0].record.cloudId,'remote-tx');
assert(preserved[0].records[0].record.cloudDeleteConfirmedAt);
const noLeak=mergeFn(state.trash,[mk('tx-pending','finance','unexpected-id')]);
assert.equal(noLeak[0].records[0].record.cloudId,'unexpected-id','different cloud identities must not be combined');
assert(app.includes("recoverFinanceTrashCloudDeletes();\n    recoverGarageTrashCloudDeletes();\n    const pending = cloudLocalPendingCount();"));
assert(app.includes("recoverFinanceTrashCloudDeletes();\n    recoverGarageTrashCloudDeletes();\n    const before = cloudLocalPendingCount();"));
assert(app.includes("if (!finishEntry(entry)) return false;\n      confirmFinanceTrashCloudDelete(entry);"), 'ACK may only be stored after current outbox entry and household are verified');
assert(app.includes("delete restored.cloudDeleteConfirmedAt;"),'restoring must reset delete receipt');
console.log('PASS Finance restart tombstone recovery, Undo safety, tenant isolation, ack and snapshot merge');
