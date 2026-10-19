#!/usr/bin/env node
// v572: a partial cloud write / manual replay may never claim a full clean sync.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const fragment=(a,b)=>{const start=app.indexOf('  '+a),end=app.indexOf('  '+b,start+a.length);
  assert(start>=0&&end>start,'Missing '+a);return app.slice(start,end);};
function compile(a,b,ctx){const fn=a.match(/function\s+(\w+)/)[1];return new Function(...Object.keys(ctx),
  fragment(a,b)+'\nreturn '+fn+';')(...Object.values(ctx));}
const e=()=>{
 let pending=0, blocked=false, permanent=false, result={loaded:12,total:13}, loadCalls=0;
 const state={cloud:{userId:'U',householdId:'A',lastSyncAt:'previous-clean',provider:'supabase'}};
 const alerts=[],saveCalls=[];
 const ctx={
   state, console, cloudReady:()=>true, cloudSyncWorkspaceScope:()=>({userId:state.cloud.userId,householdId:state.cloud.householdId}),
   cloudSyncWorkspaceMatches:x=>x.userId===state.cloud.userId&&x.householdId===state.cloud.householdId,
   withDeferredRender:fn=>fn(),withMutedToasts:fn=>fn(),
   recoverFinanceTrashCloudDeletes:()=>{},moduleCodeReady:()=>false,yieldToMainThread:async()=>{},
   replayCloudOutbox:async()=>true,cloudSyncLocalProfiles:async()=>true,
   cloudSyncLocalShoppingItems:async()=>true,cloudSyncLocalContracts:async()=>true,cloudSyncLocalContractFiles:async()=>true,
   cloudSyncLocalWarrantyFiles:async()=>true,cloudSyncLocalGarage:async()=>true,
   cloudSyncLocalHdo:async()=>true,cloudSyncLocalWaste:async()=>true,cloudSyncLocalTasks:async()=>true,
   cloudSyncLocalCalendarSources:async()=>true,cloudSyncLocalCalendar:async()=>true,
   cloudSyncLocalFinanceAccounts:async()=>true,cloudSyncLocalFinance:async()=>true,
   householdUiHasPendingChanges:()=>false,cloudExtraPendingCount:()=>0,
   cloudSaveHouseholdUiSettings:async()=>true,cloudSyncLocalExtraCollections:async()=>true,
   cloudHasBlockingConflict:()=>blocked,cloudOutboxHasPermanentFailure:()=>permanent,
   cloudLocalPendingCount:()=>pending,cloudSyncCompletionState:r=>({complete:Boolean(r)&&r.loaded===r.total&&!pending&&!blocked&&!permanent}),
   setupCloudRealtimeSubscriptions:()=>{},touchState:()=>{},saveState:()=>saveCalls.push(state.cloud.lastSyncAt),
   requestBackgroundRender:()=>{},showToast:msg=>alerts.push(msg),
   cloudLoadAllModules:async()=>{loadCalls++;return result;}
 };
 return {state,ctx,alerts,saveCalls,setPending:v=>pending=v,setBlocked:v=>blocked=v,setResult:v=>result=v,
   getCalls:()=>loadCalls};
};
const pendingFn=['async function cloudSyncLocalPendingData(', 'async function cloudWarmStartLoad('];
{
 const c=e(),run=compile(...pendingFn,c.ctx);
 assert.equal(await run(true),false,'partial remote reload is not complete');
 assert.equal(c.state.cloud.lastSyncAt,'previous-clean');
 assert.match(c.alerts.at(-1),/některé cloudové moduly/);
 c.setPending(1);c.setResult({loaded:13,total:13});
 assert.equal(await run(true),false,'pending local writes block manual complete');
 assert.equal(c.state.cloud.lastSyncAt,'previous-clean');
 c.setPending(0);c.setResult({loaded:13,total:13});
 assert.equal(await run(true),true,'manual complete requires full remote reload');
 assert.equal(c.state.cloud.lastSyncAt,'previous-clean','aggregate owns timestamp; pending helper never invents it');
 assert.equal(c.getCalls(),3);
}
{
 const c=e(),run=compile(...pendingFn,c.ctx);
 assert.equal(await run(false),true,'pending-only replay can succeed without full reload');
 assert.equal(c.getCalls(),0,'autosync replay must not load all modules');
 assert.equal(c.state.cloud.lastSyncAt,'previous-clean','pending replay does not attest full sync');
}
{
 const c=e(),scope=c.ctx;
 let store=[],saved=0,rendered=0;
 const run=compile('async function cloudSwitchHousehold(', 'async function cloudLoadInvitations(', {
   state:c.state,
   window:{confirm:()=>true},saveHouseholdWorkspace:()=>saved++,
   restoreHouseholdWorkspace:(householdId,name)=>{
     c.state.household={name};c.state.cloud.lastSyncAt='B-previous-clean';
   },activeModule:'home',touchState:()=>{},saveState:()=>{},render:()=>rendered++,
   cloudLoadAllModules:async()=>false,showToast:msg=>store.push(msg)
 });
 assert.equal(await run('B','Shared'),undefined);
 assert.equal(c.state.cloud.householdId,'B');
 assert.equal(c.state.cloud.lastSyncAt,'B-previous-clean','switch must preserve B previous verified timestamp');
 assert.equal(saved,1);
}
{
 const ctx={
   state:{cloud:{householdId:'A',lastSyncAt:'older-confirmed'},subscriptionsCloud:{},readingsCloud:{},loyaltyCardsCloud:{},financeCloud:{},poolCloud:{}},
   householdUiOldestPendingAt:()=> '2026-10-15T10:00:00Z',householdUiRemoteRevision:()=> '2026-10-15T10:01:00Z',
   householdUiSnapshotMatchesRemote:()=>true,clearHouseholdUiPendingState:()=>{},
   settleRecoveredCloudSyncState:()=>true
 };
 const run=compile('function reconcileConfirmedHouseholdUiPending(', 'function reconcileConfirmedSubscriptionPending(',ctx);
 assert.equal(run({}),true);
 assert.equal(ctx.state.cloud.lastSyncAt,'older-confirmed','single household UI snapshot is not a full refresh');
}
const bulk=fragment('async function cloudBackgroundLoadAllModules(', 'async function cloudLoadAllModules(');
const all=fragment('async function cloudLoadAllModules(', 'function cloudSyncCompletionState(');
assert(bulk.includes('if (clean) state.cloud.lastSyncAt ='));
assert(all.includes('if (ok === loaders.length && !cloudLocalPendingCount()'));
const switchBody=fragment('async function cloudSwitchHousehold(', 'async function cloudLoadInvitations(');
const acceptBody=fragment('async function cloudAcceptInvitation(', 'async function bootstrapCloudHousehold(');
assert(!switchBody.includes('lastSyncAt = new Date().toISOString()'));
assert(!acceptBody.includes('lastSyncAt = new Date().toISOString()'));
const uiSave=fragment('async function performCloudSaveHouseholdUiSettings(', 'async function cloudSwitchHousehold(');
assert(!uiSave.includes('lastSyncAt: syncedAt'));
assert(app.includes("Poslední úplná synchronizace:"));
assert(app.includes("'zatím nepotvrzena'"));
console.log('PASS v572 global sync truth: pending-only vs aggregate, partial reads, workspace timestamps and UI reconciliation');
