#!/usr/bin/env node
// P0 v563: delayed subscription/refresh callbacks cannot mark a new home online.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const extract=(a,b)=>{
  const i=source.indexOf('  '+a),j=source.indexOf('  '+b,i+a.length);
  assert(i>=0 && j>i,'missing source '+a);
  return source.slice(i,j);
};
const build=(s,env,fn,pre='')=>new Function(...Object.keys(env),pre+s+'\nreturn '+fn+';')(...Object.values(env));
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

// Event handlers on old channels must not trigger B realtime refresh or B status.
{
  const state={cloud:{householdId:'A',userId:'u1',provider:'supabase',realtimeStatus:'idle'}};
  const events=[],writes=[],channels=[];
  const ctx={
    state,REALTIME_CLOUD_TABLES:['household_notes'],
    cloudReady:()=>Boolean(state.cloud?.householdId && state.cloud?.userId),
    getSupabaseClient:()=>({channel:()=>{
      const c={listeners:[],status:null,
        on(type,filter,cb){c.listeners.push({type,filter,cb});return c;},
        subscribe(cb){c.status=cb;return c;}
      };channels.push(c);return c;
    }}),
    disposeCloudRealtime:()=>{},
    scheduleCloudRealtimeRefresh:x=>events.push(x),
    saveState:()=>writes.push(state.cloud.realtimeStatus),
    document:{querySelector:()=>null},
    realtimeStatusLabel:()=>state.cloud.realtimeStatus
  };
  const setup=build(extract('function setupCloudRealtimeSubscriptions(', 'async function withMutedToasts('),ctx,
    'setupCloudRealtimeSubscriptions','let cloudRealtimeChannel=null; let cloudRealtimeHouseholdId="";');
  assert.equal(setup(true),true);
  const old=channels[0];old.status('SUBSCRIBED');
  assert.equal(state.cloud.realtimeStatus,'online');
  state.cloud.householdId='B';
  state.cloud.realtimeStatus='idle';
  assert.equal(setup(true),true);
  const second=channels[1];
  const beforeWrites=writes.length;
  old.status('CHANNEL_ERROR');
  old.listeners[0].cb({table:'household_notes'});
  old.listeners[1].cb({table:'households'});
  assert.equal(state.cloud.realtimeStatus,'connecting');
  assert.equal(writes.length,beforeWrites,'stale channel subscription callback must not write B status');
  assert.equal(events.length,0,'old home postgres_changes cannot schedule new home refresh');
  second.status('SUBSCRIBED');
  second.listeners[0].cb({table:'household_notes'});
  assert.equal(state.cloud.realtimeStatus,'online');
  assert.deepEqual(events,['household_notes'],'new channel still processes valid events');
  state.cloud.userId='u2';
  second.status('CHANNEL_ERROR');
  second.listeners[0].cb({table:'household_notes'});
  assert.equal(state.cloud.realtimeStatus,'online','old-account callback must not touch new user');
  assert.equal(events.length,1);
}

// Refresh result from A must not mark B online, not even on fallback/error.
for(const errorCase of [false,true]) {
  const state={cloud:{householdId:'A',userId:'u1',provider:'supabase',realtimeStatus:'idle'}};
  const gate=defer(),writes=[],loaded=[],scheduled=[];
  const env={
    state,console,
    cloudReady:()=>Boolean(state.cloud?.householdId && state.cloud?.userId),
    cloudSyncWorkspaceScope:()=>({householdId:state.cloud.householdId,userId:state.cloud.userId}),
    cloudSyncWorkspaceMatches:s=>s?.householdId===state.cloud.householdId && s?.userId===state.cloud.userId,
    withDeferredRender:cb=>cb(),withMutedToasts:cb=>cb(),
    runCloudRealtimeRefresh:()=>gate.promise,
    cloudLoadAllModules:()=>{loaded.push('fallback');return true;},
    describeRealtimeSources:()=> 'household_notes',
    touchState:()=>{},saveState:()=>writes.push(state.cloud.realtimeStatus),
    requestBackgroundRender:()=>{},
    armCloudRealtimeReloadTimer:delay=>scheduled.push(delay),
  };
  const tick=build(extract('async function runCloudRealtimeReloadTick(', 'function scheduleCloudRealtimeRefresh('),
    env,'runCloudRealtimeReloadTick',
    'let cloudRealtimeReloadTimer=null; let cloudRealtimeReloading=false; const cloudRealtimePendingSources=new Set(["household_notes"]);');
  const promise=tick();
  state.cloud.householdId='B';
  state.cloud.realtimeStatus='idle';
  if(errorCase)gate.reject(new Error('stale fail'));
  else gate.resolve(true);
  await promise;
  assert.equal(state.cloud.realtimeStatus,'idle');
  assert.deepEqual(writes,[]);
  assert.deepEqual(loaded,[]);
  assert.deepEqual(scheduled,[]);
}
console.log('PASS realtime: stale subscription events, channel callbacks, refresh completion, fallback and new-home isolation');
