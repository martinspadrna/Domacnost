#!/usr/bin/env node
// P0 v586: executable identity-switch regressions on the real production
// diagnostic/recovery functions. Mocked cloud only: no user or database writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const cut=(start,end)=>{
  const i=app.indexOf(start),j=app.indexOf(end,i+start.length);
  assert(i>=0 && j>i,'Missing function: '+start);
  return app.slice(i,j);
};
const settings=cut('  async function diagnoseHouseholdUiPending()','  let garageCloudDiagnosticHouseholdId');
const subscriptions=cut('  async function diagnoseSubscriptionPending()','  async function recoverSingleMissingSubscriptionPayment()');
const recover=cut('  async function recoverSingleMissingSubscriptionPayment()','  function renderCloudRecoveryPanel()');
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const micro=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const state=()=>({
  cloud:{householdId:'home-a',userId:'user-a',householdUiPendingAt:'2026-10-20T10:00:00Z'},
  subscriptionsCloud:{pendingAt:'2026-10-20T10:00:00Z'},
  subscriptions:[],subscriptionPeople:[],subscriptionPayments:[]
});
const scoped=s=>({
  cloudReady:()=>true,
  cloudSyncWorkspaceScope:()=>({householdId:s.cloud.householdId,userId:s.cloud.userId}),
  cloudSyncWorkspaceMatches:scope=>s.cloud.householdId===scope.householdId&&s.cloud.userId===scope.userId
});
const build=(source,names,values,exportName)=>new Function(...names,source+'\nreturn '+exportName+';')(...values);
for(const [name,source,exportName] of [
  ['settings',settings,'diagnoseHouseholdUiPending'],
  ['subscriptions',subscriptions,'diagnoseSubscriptionPending']
]){
  // Identity changes during loading of dependencies must cancel before any
  // Supabase SELECT or mutation of the newly active user's local state.
  for(const changed of ['user','household']){
    const s=state(),gate=defer();let remoteReads=0,renders=0;
    const extras={
      state:s,showToast:()=>{},
      ensureHouseholdUiSyncDependencies:()=>gate.promise,
      getSupabaseClient:()=>{remoteReads++;return {};},
      requestBackgroundRender:()=>{renders++;}
    };
    const deps={...scoped(s),...extras};
    const fn=build(source,Object.keys(deps),Object.values(deps),exportName);
    const pending=fn();
    if(changed==='user')s.cloud.userId='user-b';
    else s.cloud.householdId='home-b';
    gate.resolve();await pending;
    assert.equal(remoteReads,0,name+' '+changed+' switch must cancel SELECT');
    assert.equal(renders,0,name+' '+changed+' stale report must not render');
  }
}

// Subscription diagnostic SELECT already started: switching auth within the
// *same household* must not merge payments nor clear an old pending marker.
for(const changed of ['user','household']){
  const s=state(),gate=defer();let merged=0,cleared=0,renders=0;
  const client={from(table){
    assert.equal(table,'households');
    const query={select(){return query;},eq(){return query;},maybeSingle(){return gate.promise;}};
    return query;
  }};
  const deps={...scoped(s),state:s,showToast:()=>{},
    ensureHouseholdUiSyncDependencies:async()=>{},
    getSupabaseClient:()=>client,
    mergeConfirmedRemoteSubscriptionPayments:()=>{merged++;return 0;},
    reconcileConfirmedSubscriptionPending:()=>{cleared++;return true;},
    requestBackgroundRender:()=>{renders++;}
  };
  const fn=build(subscriptions,Object.keys(deps),Object.values(deps),'diagnoseSubscriptionPending');
  const pending=fn();await micro();
  if(changed==='user')s.cloud.userId='user-b';
  else s.cloud.householdId='home-b';
  gate.resolve({data:{updated_at:'2026-10-21T10:00:00Z',dashboard_layout:{}},error:null});
  await pending;
  assert.equal(merged,0,'stale subscription payment must never enter new user state');
  assert.equal(cleared,0,'stale read must not clear subscription pending');
  assert.equal(renders,0,'stale read must not refresh new workspace');
}

// Manual missing-payment repair is a real CAS WRITE path. Verify no UPDATE
// after auth changes during remote baseline loading, and no ACK after changes
// while waiting for an already submitted CAS update.
for(const phase of ['baseline','write-receipt']){
  const s=state(),baseline=defer(),writeReceipt=defer();
  let updates=0,persisted=0,ack=0;
  const q={eq(){return q;},select(){return q;},maybeSingle(){return writeReceipt.promise;}};
  const client={from(table){
    assert.equal(table,'households');
    return {
      select(){return {eq(){return {maybeSingle(){return phase==='baseline'?baseline.promise:
        Promise.resolve({data:{updated_at:'2026-10-21T10:00:00Z',dashboard_layout:{subscriptionPayments:[]}},error:null});}};}};},
      update(){updates++;return q;}
    };
  }};
  const deps={...scoped(s),state:s,window:{confirm:()=>true},
    showToast:()=>{}, cloudHasBlockingConflict:()=>false,
    enqueueHouseholdUiSave:fn=>fn(),
    ensureHouseholdUiSyncDependencies:async()=>{},
    getSupabaseClient:()=>client,
    householdUiRemoteLayout:remote=>remote?.dashboard_layout||{},
    householdUiRemoteRevision:remote=>remote?.updated_at||'',
    subscriptionPaymentRecoveryCandidate:()=>({id:'pay-1',payment:{id:'pay-1'}}),
    canonicalSubscriptionSnapshot:()=>({items:[]}),
    structuredCloneSafe:v=>structuredClone(v),
    canonicalComparableJson:v=>v,
    APP_BUILD:586,
    householdUiSnapshotMatchesRemote:()=>true,
    reconcileConfirmedHouseholdUiPending:()=>{ack++;},
    reconcileConfirmedSubscriptionPending:()=>{ack++;},
    touchState:()=>{},persistStateSnapshot:()=>{persisted++;},
    requestBackgroundRender:()=>{}
  };
  const fn=build(recover,Object.keys(deps),Object.values(deps),'recoverSingleMissingSubscriptionPayment');
  const result=fn();await micro();
  if(phase==='baseline'){
    s.cloud.userId='user-b';
    baseline.resolve({data:{updated_at:'2026-10-21T10:00:00Z',dashboard_layout:{subscriptionPayments:[]}},error:null});
    assert.equal(await result,false);
    assert.equal(updates,0,'never write another user household after stale GET');
  } else {
    assert.equal(updates,1,'positive CAS path should attempt exactly one update');
    s.cloud.userId='user-b';
    writeReceipt.resolve({data:{updated_at:'2026-10-21T10:00:01Z',dashboard_layout:{subscriptionPayments:[{id:'pay-1'}]}},error:null});
    assert.equal(await result,false);
    assert.equal(ack,0,'never acknowledge a write into a switched user state');
    assert.equal(persisted,0);
  }
  assert.equal(s.subscriptionsCloud.pendingAt,'2026-10-20T10:00:00Z','pending must survive auth switch');
}
for(const [name,code,expected] of [
  ['settings',settings,2],['subscriptions',subscriptions,2],['recovery',recover,4]
]){
  const occurrences=(code.match(/cloudSyncWorkspaceMatches\(scope\)/g)||[]).length;
  assert(occurrences>=expected,name+' lacks identity guards');
}
console.log('PASS P0 v586: settings/subscriptions diagnostics, CAS recovery, stale auth no ACK or data loss');
