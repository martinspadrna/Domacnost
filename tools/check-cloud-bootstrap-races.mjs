#!/usr/bin/env node
// P1/P2 v567 — historical async SELECT must not overwrite another workspace.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const part=(a,b)=>{
  const start=source.indexOf('  '+a),end=source.indexOf('  '+b,start+a.length);
  assert(start>=0&&end>start,'missing '+a);return source.slice(start,end);
};
const compile=(a,b,ctx,prelude='')=>new Function(...Object.keys(ctx),prelude+'\n'+part(a,b)+'\nreturn '+a.match(/function\s+(\w+)/)[1]+';')(...Object.values(ctx));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const base=()=>({
 state:{cloud:{provider:'supabase',userId:'U',householdId:'A',lastSyncAt:'confirmed-old'},
        household:{id:'A',name:'A'},profiles:[{id:'pA',name:'A'}],activeProfileId:'pA'},
 calls:[],writes:[],toasts:[]
});
const scope=e=>({
 cloudSyncWorkspaceScope:()=>({householdId:e.state.cloud.householdId,userId:e.state.cloud.userId}),
 cloudSyncWorkspaceMatches:x=>Boolean(x?.userId===e.state.cloud.userId&&x?.householdId===e.state.cloud.householdId)
});
function query(e,collection='households'){
 const d=gate();
 const steps=[];
 const builder={
  select:()=>builder,eq:(key,value)=>{steps.push([key,value]);return builder;},
  order:()=>builder,
  single:()=>d.promise,
  then:(ok,bad)=>d.promise.then(ok,bad)
 };
 e.calls.push({collection,steps});
 return {promise:d,steps,client:{from:()=>builder}};
}
const householdRow=(id='A')=>({id,name:id,dashboard_layout:{},weather_location:{},updated_at:'2026-10-18'});
const profileRow=(id='profA')=>({id,name:id,user_id:'U',avatar_emoji:'🙂',color:'blue',is_default:true,created_at:'2026-10-18'});
const ctxFor=e=>({
 state:e.state,console,
 ...scope(e),
 cloudReady:()=>true,
 touchState:()=>e.writes.push('touch'),
 saveState:()=>e.writes.push('save'),
 persistStateSnapshot:()=>e.writes.push('persist'),
 requestBackgroundRender:()=>e.writes.push('render'),
 render:()=>e.writes.push('render'),
 showToast:message=>e.toasts.push(message),
 householdUiHasPendingChanges:()=>false,
 ensureHouseholdUiSyncDependencies:async()=>true,
 shouldApplyRemoteHouseholdUi:()=>true,
 mergeConfirmedRemoteSubscriptionPayments:()=>e.writes.push('mergePayments'),
 applyCloudHouseholdUiSettings:()=>e.writes.push('applyLayout'),
 resetTrashTrackingBaseline:()=>{},
 applyActiveProfileUiSettings:()=>e.writes.push('applyProfileUi'),
 dedupeProfiles:v=>v,
 normalizeText:v=>String(v||''),
 resetCloudModuleCachesForUserSwitch:()=>e.writes.push('resetCaches'),
 pickBestCloudHousehold:items=>items[0],
 withDeferredRender:fn=>fn(),
 refreshCloudSession:async()=>({id:'U'}),
 cloudLoadUserVisualSettings:async()=>true,
 yieldToMainThread:async()=>{},
 maybeRestoreHouseholdFromMeta:()=>false,
 bootstrapCloudHousehold:async()=>false,
 scheduleBootCloudMaintenance:()=>e.writes.push('scheduleMaintenance'),
 scheduleBootHomePriorityCloudLoad:()=>e.writes.push('scheduleHome'),
 saveState:()=>e.writes.push('save'),
 console
});
const defs={
 households:['async function cloudLoadHouseholds(', 'function applyCloudHouseholdUiSettings('],
 layout:['async function cloudLoadHouseholdUiSettings(', 'async function resolveHouseholdUiConflict('],
 profiles:['async function cloudLoadProfilesForCurrentHousehold(', 'async function cloudLogout('],
 warm:['async function cloudWarmStartLoad(', 'async function cloudLoadModuleForNav(']
};
// Late household list after tenant switch must be no-op, including no sync timestamp.
{
 const e=base(),q=query(e),ctx={...ctxFor(e),getSupabaseClient:()=>q.client};
 const fn=compile(...defs.households,ctx);
 const job=fn(false);
 await flush();
 e.state.cloud.householdId='B';
 q.promise.resolve({data:[{household_id:'A',role:'owner',status:'active',households:{name:'A'}}],error:null});
 assert.deepEqual(await job,[]);
 assert.equal(e.state.cloud.householdId,'B');
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-old');
 assert.deepEqual(e.writes,[]);
 assert(q.steps.some(([k,v])=>k==='user_id'&&v==='U'));
}
// Missing data without error is a failed SELECT, not a command to clear the workspace.
{
 const e=base(),q=query(e),ctx={...ctxFor(e),getSupabaseClient:()=>q.client};
 const fn=compile(...defs.households,ctx);
 const job=fn();
 q.promise.resolve({data:null,error:null});
 assert.deepEqual(await job,[]);
 assert.equal(e.state.cloud.householdId,'A');
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-old');
}
// Household member query must not apply stale layout after a deferred dependency.
{
 const e=base(),q=query(e),dep=gate();
 const ctx={...ctxFor(e),getSupabaseClient:()=>q.client,
  ensureHouseholdUiSyncDependencies:()=>dep.promise};
 const fn=compile(...defs.households,ctx);
 const job=fn(false);
 q.promise.resolve({data:[{household_id:'A',households:{name:'A'}}],error:null});
 await flush();
 e.state.cloud.householdId='B';
 dep.resolve(true);
 assert.deepEqual(await job,[]);
 assert.equal(e.writes.includes('applyLayout'),false);
}
// Layout query binds original tenant and never applies a stale reply to B.
{
 const e=base(),q=query(e),ctx={...ctxFor(e),getSupabaseClient:()=>q.client};
 const fn=compile(...defs.layout,ctx);
 const job=fn(false);
 e.state.cloud.householdId='B';
 q.promise.resolve({data:householdRow('A'),error:null});
 assert.equal(await job,false);
 assert(q.steps.some(([k,v])=>k==='id'&&v==='A'));
 assert.equal(e.writes.includes('applyLayout'),false);
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-old');
}
// Even with the same household, an extra async dependency may finish after switching.
{
 const e=base(),q=query(e),dep=gate();
 const ctx={...ctxFor(e),getSupabaseClient:()=>q.client,
  ensureHouseholdUiSyncDependencies:()=>dep.promise};
 const fn=compile(...defs.layout,ctx);
 const job=fn();
 q.promise.resolve({data:householdRow('A'),error:null});
 await flush();
 e.state.cloud.householdId='B';
 dep.resolve(true);
 assert.equal(await job,false);
 assert.equal(e.writes.includes('applyLayout'),false);
}
// Matching layout can still refresh data, without pretending full sync.
{
 const e=base(),q=query(e),ctx={...ctxFor(e),getSupabaseClient:()=>q.client};
 const fn=compile(...defs.layout,ctx);
 const job=fn(false,{renderAfter:false});
 q.promise.resolve({data:householdRow('A'),error:null});
 assert.equal(await job,true);
 assert.equal(e.writes.includes('applyLayout'),true);
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-old');
}
// Profile response cannot be applied across tenants OR over an in-flight local edit.
for(const switchKind of ['household','user','localEdit','activeProfile']){
 const e=base(),q=query(e),ctx={...ctxFor(e),getSupabaseClient:()=>q.client};
 const fn=compile(...defs.profiles,ctx);
 const job=fn();
 if(switchKind==='household')e.state.cloud.householdId='B';
 if(switchKind==='user')e.state.cloud.userId='V';
 if(switchKind==='localEdit')e.state.profiles[0].name='My edit';
 if(switchKind==='activeProfile')e.state.activeProfileId='newLocalSelection';
 q.promise.resolve({data:[profileRow()],error:null});
 assert.equal(await job,false,switchKind);
 assert.equal(e.state.profiles[0].id,'pA');
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-old');
 assert.equal(e.writes.includes('applyProfileUi'),false);
 assert(q.steps.some(([k,v])=>k==='household_id'&&v==='A'));
}
// Clean profile read remains operational.
{
 const e=base(),q=query(e),ctx={...ctxFor(e),getSupabaseClient:()=>q.client};
 const fn=compile(...defs.profiles,ctx);
 const job=fn();
 q.promise.resolve({data:[profileRow()],error:null});
 assert.equal(await job,true);
 assert.equal(e.state.profiles[0].id,'profA');
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-old');
}
// Warm start must not schedule A loaders or persist A after a delayed B switch.
{
 const e=base(),d=gate(),ctx={
  ...ctxFor(e),
  refreshCloudSession:async()=>({id:'U'}),
  cloudLoadHouseholds:async()=>[{id:'A',name:'A'}],
  cloudLoadHouseholdUiSettings:()=>d.promise,
  cloudLoadProfilesForCurrentHousehold:async()=>{e.writes.push('loadProfiles');return true;}
 };
 const fn=compile(...defs.warm,ctx,
  "let cloudWarmStartDone=false;let bootCloudResumeChecked=false;let onboardingMode='choice';");
 const job=fn(false);
 await flush();
 e.state.cloud.householdId='B';
 d.resolve(true);
 assert.equal(await job,false);
 assert.equal(e.writes.includes('loadProfiles'),false);
 assert.equal(e.writes.includes('scheduleHome'),false);
 assert.equal(e.writes.includes('save'),false);
}
console.log('PASS P1/P2 bootstrap: household list/layout/profiles scope, in-flight local edit and truthful partial timestamp');
