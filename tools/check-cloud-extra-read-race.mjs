#!/usr/bin/env node
// P0 v563: Extra SELECT cannot overwrite another household or a newer local edit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const s = readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const code = (start,end) => {
  const a=s.indexOf('  '+start),b=s.indexOf('  '+end,a+start.length);
  assert(a>=0 && b>a, 'missing '+start);
  return s.slice(a,b);
};
const compile = (source,env,returned,pre='') => new Function(...Object.keys(env),
  pre + '\n' + source + '\nreturn ' + returned + ';')(...Object.values(env));
const pending = () => { let resolve; const promise=new Promise(r=>resolve=r); return {resolve,promise}; };
const row = (id,text) => ({ id, text, status:'active', created_at:'2026-10-16T12:00:00.000Z' });
const deferredContext=() => {
  const state={cloud:{provider:'supabase',householdId:'A',userId:'person1',lastSyncAt:'confirmed-original'},
    household:{id:'A'},activeProfileId:'profile-A',
    notes:[{id:'local-1',cloudId:'id-1',text:'Old',syncStatus:''}],
    coupons:[],warranties:[],householdExtrasCloud:{loadedAt:''}};
  const queries=[],saves=[],toasts=[];
  const configs={
    notes:{table:'household_notes',select:'id,text,status,created_at',order:{column:'created_at',ascending:false},
      map:(x)=>({id:state.notes.find(z=>z.cloudId===x.id)?.id || 'note-cloud-'+x.id,cloudId:x.id,text:x.text,status:x.status})},
    coupons:{table:'household_coupons',select:'id,code',
      map:(x)=>({id:'coupon-cloud-'+x.id,cloudId:x.id,code:x.code})},
    warranties:{table:'household_warranties',select:'id,name',
      map:(x)=>({id:'warranty-cloud-'+x.id,cloudId:x.id,name:x.name})}
  };
  const queryFor=table=>{
    const gate=pending(),meta={table,household:''};queries.push({gate,meta});
    const q={
      select(){return q;},
      eq(field,val){if(field==='household_id')meta.household=val;return q;},
      order(){return q;},
      then(onOk,onErr){return gate.promise.then(onOk,onErr);}
    };
    return q;
  };
  const scope=()=>({householdId:state.cloud.householdId,userId:state.cloud.userId});
  const matching=x=>Boolean(x?.householdId===state.cloud.householdId && x?.userId===state.cloud.userId);
  const env={
    state,console,
    extraCloudConfig:(key)=>configs[key]||null,
    CLOUD_EXTRA_COLLECTIONS:configs,
    cloudReady:()=>matching(scope()),
    getSupabaseClient:()=>({from:queryFor}),
    cloudSyncWorkspaceScope:scope,cloudSyncWorkspaceMatches:matching,
    currentProfileId:()=>state.activeProfileId,currentHouseholdId:()=>state.household.id,
    touchState:()=>{},saveState:()=>saves.push(state.cloud.householdId),render:()=>{},
    showToast:x=>toasts.push(x),
    mergeCloudExtraCollectionPreservingPending:null
  };
  env.mergeCloudExtraCollectionPreservingPending=compile(code('function mergeCloudExtraCollectionPreservingPending(', 'async function cloudLoadExtraCollection('),env,'mergeCloudExtraCollectionPreservingPending');
  const loader=compile(code('async function cloudLoadExtraCollection(', 'async function cloudLoadExtraCollections('),env,'cloudLoadExtraCollection');
  env.cloudLoadExtraCollection=loader;
  const batch=compile(code('async function cloudLoadExtraCollections(', 'async function cloudSyncLocalExtraCollections('),env,'cloudLoadExtraCollections');
  return {state,queries,saves,toasts,loader,batch,env};
};

// Happy path cloud refresh still works.
{
  const e=deferredContext(),job=e.loader('notes');
  assert.equal(e.queries[0].meta.household,'A');
  e.queries[0].gate.resolve({data:[row('id-1','New')],error:null});
  assert.equal(await job,true);
  assert.equal(e.state.notes[0].text,'New');
  assert.equal(e.state.cloud.lastSyncAt,'confirmed-original','partial read is not successful complete sync');
}
// Pending local edit is source of truth even if remote differs.
{
  const e=deferredContext();
  e.state.notes[0].syncStatus='pending';
  e.state.notes[0].text='Important local';
  const job=e.loader('notes');
  e.queries[0].gate.resolve({data:[row('id-1','Older server'),row('id-2','Server only')],error:null});
  assert.equal(await job,true);
  assert.equal(e.state.notes.find(x=>x.cloudId==='id-1').text,'Important local');
  assert.equal(e.state.notes.find(x=>x.cloudId==='id-2').text,'Server only');
}
// Local change occurring AFTER start of request must abort stale refresh.
{
  const e=deferredContext(),job=e.loader('notes');
  e.state.notes[0].text='Edited while loading';
  e.state.notes[0].syncStatus='pending';
  e.queries[0].gate.resolve({data:[row('id-1','Older server')],error:null});
  assert.equal(await job,false);
  assert.equal(e.state.notes[0].text,'Edited while loading');
  assert.equal(e.saves.length,0);
}
// Household and account switches cannot apply old response or a read failure into B.
for(const switchedUser of [false,true]) {
  const e=deferredContext(),job=e.loader('notes',true);
  if(switchedUser)e.state.cloud.userId='person2';
  else e.state.cloud.householdId='B';
  e.state.notes=[{id:'local-b',text:'B data',syncStatus:'pending'}];
  e.queries[0].gate.resolve({data:[row('id-old','Other household')],error:null});
  assert.equal(await job,false);
  assert.equal(e.state.notes[0].text,'B data');
  assert.equal(e.saves.length,0);
  assert.equal(e.toasts.length,0);
}
// The same cloud household with a different active profile/local household is not a valid read context.
for (const switched of ['profile','localHousehold']) {
  const e=deferredContext(),job=e.loader('notes',true);
  if(switched==='profile') e.state.activeProfileId='profile-B';
  else e.state.household.id='B';
  const original=JSON.stringify(e.state.notes);
  e.queries[0].gate.resolve({data:[row('id-1','Wrong profile')],error:null});
  assert.equal(await job,false,switched+' must not commit');
  assert.equal(JSON.stringify(e.state.notes),original);
  assert.equal(e.saves.length,0);
  assert.equal(e.toasts.length,0);
}
// DB partial/invalid response must not silently wipe the collection.
{
  const e=deferredContext(),job=e.loader('notes');
  e.queries[0].gate.resolve({data:null,error:null});
  assert.equal(await job,false);
  assert.equal(e.state.notes[0].text,'Old');
}
// Multiple extras: after switched workspace do not query other collections or persist old batch.
{
  const e=deferredContext(),job=e.batch();
  assert.equal(e.queries.length,1);
  e.state.cloud.householdId='B';
  e.queries[0].gate.resolve({data:[row('id-1','Remote A')],error:null});
  assert.equal(await job,false);
  assert.equal(e.queries.length,1);
  assert.equal(e.saves.length,0);
}
// If the active profile changes during a batch, do not fetch subsequent collections.
{
  const e=deferredContext(),job=e.batch();
  assert.equal(e.queries.length,1);
  e.state.activeProfileId='profile-B';
  e.queries[0].gate.resolve({data:[row('id-1','Wrong profile')],error:null});
  assert.equal(await job,false);
  assert.equal(e.queries.length,1);
  assert.equal(e.saves.length,0);
}
// Batch partial fetch must truthfully report unsuccessful (vs the previous unconditional true).
{
  const e=deferredContext(),job=e.batch();
  e.queries[0].gate.resolve({data:null,error:{message:'down'}});
  for(let i=0;i<20;i++) await Promise.resolve();
  assert.equal(e.queries.length,2);
  e.queries[1].gate.resolve({data:[],error:null});
  for(let i=0;i<20;i++) await Promise.resolve();
  assert.equal(e.queries.length,3);
  e.queries[2].gate.resolve({data:[],error:null});
  assert.equal(await job,false);
}

console.log('PASS extras read: pending merge, stale in-flight edit, household/profile switch, partial batch and truthful timestamp');
