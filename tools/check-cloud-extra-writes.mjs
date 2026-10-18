#!/usr/bin/env node
// P0 v564: multi-path extra cloud writes must require real acknowledgements,
// preserve newer local edits, and never apply a previous household's receipt.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const between=(a,b)=>{const i=app.indexOf('  '+a),j=app.indexOf('  '+b,i+a.length);
  assert(i>=0&&j>i,'missing '+a);return app.slice(i,j);};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<18;i++) await Promise.resolve();};
const testEnv=()=>{
  const item={id:'local-a',cloudId:'',text:'First',status:'active',syncStatus:'pending'};
  const state={notes:[item],coupons:[],warranties:[],
    cloud:{provider:'supabase',householdId:'A',userId:'user1',lastSyncAt:'initial'}};
  const requests=[],persisted=[],alerts=[],retries=[];
  let clientAvailable=true;
  let refresh=async()=>({id:'user1'});
  const config={table:'household_notes',
    payload:(x,userId)=>({household_id:state.cloud.householdId,text:x.text,
      status:x.status,created_by:x.cloudId?undefined:userId,updated_by:userId})};
  const cloudClient={
    from(table){
      const r={table,filters:{},method:'',payload:null};requests.push(r);
      const gate=deferred();r.gate=gate;
      const q={
        insert(data){r.method='insert';r.payload=data;return q;},
        update(data){r.method='update';r.payload=data;return q;},
        delete(){r.method='delete';return q;},
        eq(key,v){r.filters[key]=v;return q;},
        select(){return q;},
        single(){return gate.promise;},
        maybeSingle(){return gate.promise;}
      };
      return q;
    }
  };
  const scope=()=>({householdId:state.cloud.householdId,userId:state.cloud.userId});
  const matched=s=>Boolean(s&&state.cloud.userId===s.userId&&state.cloud.householdId===s.householdId);
  const env={
    state,console,
    extraCloudConfig:key=>key==='notes'?config:null,
    cloudReady:()=>Boolean(state.cloud.userId&&state.cloud.householdId),
    cloudSyncWorkspaceScope:scope,cloudSyncWorkspaceMatches:matched,
    getSupabaseClient:()=>clientAvailable?cloudClient:null,
    refreshCloudSession:(...a)=>refresh(...a),
    showToast:x=>alerts.push(x),
    persistStateSnapshot:()=>persisted.push(state.cloud.householdId),
    scheduleCloudAutosync:(...x)=>retries.push(x),
  };
  const source=between('const extraCloudWritesInFlight = new Map();','function mergeCloudExtraCollectionPreservingPending(');
  const f=new Function(...Object.keys(env),source+
    '\nreturn { cloudAddExtraItem, cloudUpdateExtraItem, cloudDeleteExtraItem, extraCloudItemCurrent };');
  const api=f(...Object.values(env));
  return {state,item,requests,persisted,alerts,retries,api,
    noClient:()=>{clientAvailable=false;},
    refreshThrough:f=>{refresh=f;}};
};

// Normal INSERT receipt binds remote ID; lastSyncAt only complete-sync can update.
{
  const e=testEnv(),job=e.api.cloudAddExtraItem('notes',e.item);
  await flush();
  assert.equal(e.requests.length,1);
  assert.equal(e.requests[0].payload.household_id,'A');
  e.requests[0].gate.resolve({data:{id:'remote-a'},error:null});
  assert.equal((await job)?.id,'remote-a');
  assert.equal(e.item.cloudId,'remote-a');
  assert.equal(e.item.syncStatus,'');
  assert.equal(e.state.cloud.lastSyncAt,'initial');
}
// Lost/empty server ACK must remain pending; never mark as synced.
{
  const e=testEnv();e.item.cloudId='remote-a';
  const job=e.api.cloudUpdateExtraItem('notes',e.item);
  await flush();
  assert.equal(e.requests[0].method,'update');
  assert.equal(e.requests[0].filters.household_id,'A');
  assert.equal(e.requests[0].filters.id,'remote-a');
  e.requests[0].gate.resolve({data:null,error:null});
  assert.equal(await job,false);
  assert.equal(e.item.syncStatus,'pending');
  assert.equal(e.state.cloud.lastSyncAt,'initial');
}
// Concurrent update attempt does NOT dispatch a second HTTP request.
{
  const e=testEnv();e.item.cloudId='remote-a';
  const first=e.api.cloudUpdateExtraItem('notes',e.item);
  await flush();
  e.item.text='Changed before ACK';
  const second=await e.api.cloudUpdateExtraItem('notes',e.item);
  assert.equal(second,false);
  assert.equal(e.requests.length,1);
  e.requests[0].gate.resolve({data:{id:'remote-a'},error:null});
  assert.equal(await first,false,'stale ACK must not clean pending state');
  assert.equal(e.item.syncStatus,'pending');
  assert.equal(e.item.text,'Changed before ACK');
  assert(e.retries.some(([name])=>name==='extra-changed-during-update'));
}
// INSERT response comes after local edit: attach ID, keep newer text pending.
{
  const e=testEnv(),job=e.api.cloudAddExtraItem('notes',e.item);
  await flush();
  e.item.text='Newer local text';
  e.requests[0].gate.resolve({data:{id:'remote-a'},error:null});
  assert.equal(await job,null);
  assert.equal(e.item.cloudId,'remote-a');
  assert.equal(e.item.text,'Newer local text');
  assert.equal(e.item.syncStatus,'pending');
  assert(e.retries.some(([name])=>name==='extra-changed-during-insert'));
}
// A→B while session refreshes: must never send the changed workspace payload.
{
  const e=testEnv(),session=deferred();e.refreshThrough(()=>session.promise);
  const job=e.api.cloudAddExtraItem('notes',e.item);
  e.state.cloud={provider:'supabase',householdId:'B',userId:'user2',lastSyncAt:'B'};
  e.state.notes=[{id:'B',text:'B',syncStatus:'pending'}];
  session.resolve({id:'user1'});
  assert.equal(await job,null);
  assert.equal(e.requests.length,0);
  assert.equal(e.persisted.length,0);
  assert.equal(e.state.cloud.lastSyncAt,'B');
}
// A→B with outstanding remote response must not apply ACK to B or persist.
{
  const e=testEnv(),job=e.api.cloudAddExtraItem('notes',e.item);await flush();
  e.state.cloud={provider:'supabase',householdId:'B',userId:'user2',lastSyncAt:'B'};
  e.state.notes=[{id:'B',text:'B',syncStatus:'pending'}];
  e.requests[0].gate.resolve({data:{id:'remote-a'},error:null});
  assert.equal(await job,null);
  assert.equal(e.item.cloudId,'');
  assert.equal(e.persisted.length,0);
}
// Remote error must not clear pending, offline/no client must not claim success.
{
  const e=testEnv();e.item.cloudId='remote-a';
  const job=e.api.cloudUpdateExtraItem('notes',e.item);await flush();
  e.requests[0].gate.resolve({data:null,error:{message:'network outage'}});
  assert.equal(await job,false);
  assert.equal(e.item.syncStatus,'pending');
  assert.equal(e.alerts.includes('network outage'),true);
  e.noClient();
  assert.equal(await e.api.cloudUpdateExtraItem('notes',e.item),false);
  assert.equal(await e.api.cloudDeleteExtraItem('notes',e.item),false);
}
// Confirm DELETE only if a row was explicitly affected.
{
  const e=testEnv();e.item.cloudId='remote-a';
  const noAck=e.api.cloudDeleteExtraItem('notes',e.item);
  e.requests[0].gate.resolve({data:null,error:null});
  assert.equal(await noAck,false);
  const ack=e.api.cloudDeleteExtraItem('notes',e.item);
  e.requests[1].gate.resolve({data:{id:'remote-a'},error:null});
  assert.equal(await ack,true);
  assert.equal(e.state.cloud.lastSyncAt,'initial');
}
// After deletion of local item during INSERT, never bring it back to UI.
{
  const e=testEnv(),job=e.api.cloudAddExtraItem('notes',e.item);await flush();
  e.state.notes=[];
  e.requests[0].gate.resolve({data:{id:'remote-a'},error:null});
  assert.equal(await job,null);
  assert.equal(e.state.notes.length,0);
}

// Batch sync isolates A→B and does not save B with A's completion.
{
  const e=testEnv(),gate=deferred();let count=0;
  const syncEnv={
    state:e.state,console,CLOUD_EXTRA_COLLECTIONS:{notes:{},coupons:{},warranties:{}},
    cloudReady:()=>true,
    cloudSyncWorkspaceScope:()=>({householdId:e.state.cloud.householdId,userId:e.state.cloud.userId}),
    cloudSyncWorkspaceMatches:s=>s.householdId===e.state.cloud.householdId&&s.userId===e.state.cloud.userId,
    cloudExtraItemNeedsSync:x=>Boolean(!x.cloudId||x.syncStatus),
    extraCloudItemCurrent:(c,x,s)=>e.state[c].includes(x)&&s.householdId===e.state.cloud.householdId&&s.userId===e.state.cloud.userId,
    cloudAddExtraItem:()=>{count++;return gate.promise;},
    cloudUpdateExtraItem:async()=>false,
    touchState:()=>{},saveState:()=>e.persisted.push(e.state.cloud.householdId),
    requestBackgroundRender:()=>{},render:()=>{},showToast:()=>{}
  };
  const code=between('async function cloudSyncLocalExtraCollections(', 'function cloudExtraItemNeedsSync(');
  const f=new Function(...Object.keys(syncEnv),code+'\nreturn cloudSyncLocalExtraCollections;')(...Object.values(syncEnv));
  const job=f(false);
  assert.equal(count,1);
  e.state.cloud={provider:'supabase',householdId:'B',userId:'user2'};
  e.state.notes=[{id:'different'}];
  gate.resolve({id:'remote-A'});
  assert.equal(await job,0);
  assert.deepEqual(e.persisted,[]);
  assert.equal(count,1);
}

// Complete loader must not count the intentionally disabled user-app-settings table.
{
  const loader=between('async function cloudLoadAllModules(', 'function cloudSyncCompletionState(');
  assert(!/^\s*cloudLoadUserVisualSettings\s*,/m.test(loader));
  const status=between('async function runCloudRealtimeRefresh(', 'function armCloudRealtimeReloadTimer(');
  assert(status.includes('loaded.loaded === loaded.total'));
}

console.log('PASS P0 extra writes: zero-row ACK, concurrent updates, changed payload, tenant switch, offline, delete and batch sync');
