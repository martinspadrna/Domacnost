#!/usr/bin/env node
// P0 v587: exercise the *real* Garage cloud ADD and CAS UPDATE functions.
// Network and local persistence are simulated: no Supabase writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const cut=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'Missing code '+start);return source.slice(a,b);};
const scopeSource=cut('  function cloudSyncWorkspaceScope()', '  function clearCloudAutosyncTimer()');
const vehicleSource=cut('  async function cloudAddVehicle(vehicle)', '  async function cloudDeleteVehicle(vehicle)');
const tick=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function harness() {
  const vehicle={id:'local-vehicle-1',name:'Auto',cloudId:'',syncStatus:''};
  const state={cloud:{householdId:'house-a',userId:'user-a'},vehicles:[vehicle]};
  const insert=[],read=[],update=[],notifications=[],snapshots=[];
  let schemaPending=0;
  let refresh=()=>Promise.resolve({id:'user-a'});
  const client={from(table){
    assert.equal(table,'vehicles');
    return {
      insert(payload){
        const gate=deferred();insert.push({payload,gate});
        return {select(){return {single(){return gate.promise;}};}};
      },
      select(){
        const gate=deferred(),filters=[];
        read.push({gate,filters});
        const query={eq(k,v){filters.push([k,v]);return query;},maybeSingle(){return gate.promise;}};
        return query;
      },
      update(payload){
        const gate=deferred(),filters=[];
        update.push({payload,gate,filters});
        const query={eq(k,v){filters.push([k,v]);return query;},select(){return query;},maybeSingle(){return gate.promise;}};
        return query;
      }
    };
  }};
  const fields=(v,user,opts={})=>{
    const payload={household_id:state.cloud.householdId,name:v.name,updated_by:user};
    if(opts.mode!=='update')payload.created_by=user;
    if(opts.includeExtendedFields!==false)payload.extended='yes';
    return payload;
  };
  const deps={
    state,cloudReady:()=>true,
    getSupabaseClient:()=>client,
    refreshCloudSession:()=>refresh(),
    cloudVehiclePayload:fields,
    markGarageRecordPending:item=>{item.syncStatus=item.cloudId?'pending_update':'pending_add';},
    isGarageVehicleExtendedSchemaError:e=>e?.code==='PGRST204',
    markGarageVehicleExtendedSchemaPending:()=>{schemaPending++;},
    showToast:message=>notifications.push(message),
    garageVehicleSafeUpdateDecision:()=> 'update',
    garageVehicleCloudDifference:()=>({type:'same'}),
    persistStateSnapshot:()=>snapshots.push(JSON.stringify(state.vehicles))
  };
  const api=new Function(...Object.keys(deps),
    scopeSource+vehicleSource+'\nreturn {cloudAddVehicle,cloudUpdateVehicle};')(...Object.values(deps));
  return {state,vehicle,insert,read,update,notifications,snapshots,api,
    setRefresh:fn=>{refresh=fn;},schemaPending:()=>schemaPending};
}
function switchIdentity(h,kind){
  if(kind==='user')h.state.cloud.userId='user-b';
  else h.state.cloud.householdId='house-b';
}

// POST cannot start if the identity changes during session refresh.
for(const kind of ['user','household']){
  const h=harness(),gate=deferred();
  h.setRefresh(()=>gate.promise);
  const task=h.api.cloudAddVehicle(h.vehicle);
  switchIdentity(h,kind);
  gate.resolve({id:'user-a'});
  assert.equal(await task,null);
  assert.equal(h.insert.length,0,'stale auth wrote INSERT');
  assert.equal(h.vehicle.cloudId,'');
  assert.equal(h.vehicle.syncStatus,'pending_add');
}
// Session refresh resolving as another member in same home must not POST.
{
  const h=harness();h.setRefresh(async()=>({id:'user-b'}));
  assert.equal(await h.api.cloudAddVehicle(h.vehicle),null);
  assert.equal(h.insert.length,0);
}
// Account switches *during* INSERT cannot attach the cloud receipt to the
// currently active workspace, even when household ID stays the same.
for(const kind of ['user','household']){
  const h=harness(),task=h.api.cloudAddVehicle(h.vehicle);
  await tick();assert.equal(h.insert.length,1);
  switchIdentity(h,kind);
  h.insert[0].gate.resolve({data:{id:'remote-id'},error:null});
  assert.equal(await task,null);
  assert.equal(h.vehicle.cloudId,'');
  assert.equal(h.vehicle.syncStatus,'pending_add');
  assert.equal(h.snapshots.length,0);
}
// A late schema-error response in a different account must not initiate a
// fallback INSERT nor set the new account's schema failure flag.
{
  const h=harness(),task=h.api.cloudAddVehicle(h.vehicle);
  await tick();
  h.state.cloud.userId='user-b';
  h.insert[0].gate.resolve({data:null,error:{code:'PGRST204'}});
  assert.equal(await task,null);
  assert.equal(h.insert.length,1);
  assert.equal(h.schemaPending(),0);
}
// The successful normal insert links cloud ID and clears pending *only*
// if the data still matches the originally submitted request.
{
  const h=harness(),task=h.api.cloudAddVehicle(h.vehicle);
  await tick();
  h.insert[0].gate.resolve({data:{id:'remote-a'},error:null});
  assert.equal((await task)?.id,'remote-a');
  assert.equal(h.vehicle.cloudId,'remote-a');
  assert.equal(h.vehicle.syncStatus,'');
  assert.equal(h.snapshots.length,1);
}
// User edits an auto while INSERT is running: cloud row is linked but latest
// local edits remain pending for a later CAS UPDATE.
{
  const h=harness(),task=h.api.cloudAddVehicle(h.vehicle);
  await tick();h.vehicle.name='Nový název';
  h.insert[0].gate.resolve({data:{id:'remote-b'},error:null});
  assert.equal((await task)?.id,'remote-b');
  assert.equal(h.vehicle.cloudId,'remote-b');
  assert.equal(h.vehicle.syncStatus,'pending_update');
}
// Normalize Garage into a new object while request is outstanding; don't only
// link the old object and risk duplicate insert on the current copy.
{
  const h=harness(),task=h.api.cloudAddVehicle(h.vehicle);
  await tick();
  const latest={...h.vehicle,name:'Přejmenované auto'};
  h.state.vehicles=[latest];
  h.insert[0].gate.resolve({data:{id:'remote-c'},error:null});
  assert.equal((await task)?.id,'remote-c');
  assert.equal(latest.cloudId,'remote-c');
  assert.equal(latest.syncStatus,'pending_update');
}
// Deleted local auto should never be revived by a late cloud receipt.
{
  const h=harness(),task=h.api.cloudAddVehicle(h.vehicle);
  await tick();h.state.vehicles=[];
  h.insert[0].gate.resolve({data:{id:'orphan-remote'},error:null});
  assert.equal(await task,null);
  assert.equal(h.vehicle.cloudId,'');
}
// UPDATE requires the same workspace after auth refresh and after remote GET.
for(const kind of ['user','household']){
  const h=harness();h.vehicle.cloudId='cloud-a';
  const refreshGate=deferred();h.setRefresh(()=>refreshGate.promise);
  const before=h.api.cloudUpdateVehicle(h.vehicle);
  switchIdentity(h,kind);refreshGate.resolve({id:'user-a'});
  assert.equal(await before,false);
  assert.equal(h.read.length,0);
  assert.equal(h.vehicle.syncStatus,'pending_update');
}
for(const kind of ['user','household']){
  const h=harness();h.vehicle.cloudId='cloud-b';
  const task=h.api.cloudUpdateVehicle(h.vehicle);
  await tick();assert.equal(h.read.length,1);
  switchIdentity(h,kind);
  h.read[0].gate.resolve({data:{id:'cloud-b',updated_at:'rev-1'},error:null});
  assert.equal(await task,false);
  assert.equal(h.update.length,0);
  assert.equal(h.vehicle.syncStatus,'pending_update');
}
// A CAS UPDATE can finish after logout; old receipt must never mark current
// workspace as synchronized. Normal positive path still confirms the update.
for(const changed of [false,true]){
  const h=harness();h.vehicle.cloudId='cloud-c';
  const task=h.api.cloudUpdateVehicle(h.vehicle);
  await tick();h.read[0].gate.resolve({data:{id:'cloud-c',updated_at:'rev-1'},error:null});
  await tick();assert.equal(h.update.length,1);
  if(changed)h.state.cloud.userId='user-b';
  h.update[0].gate.resolve({data:{id:'cloud-c',updated_at:'rev-2'},error:null});
  assert.equal(await task,!changed);
  assert.equal(h.vehicle.syncStatus,changed?'pending_update':'');
  assert(h.update[0].filters.some(([k,v])=>k==='updated_at'&&v==='rev-1'),'CAS revision not checked');
}
console.log('PASS P0 v587 Garage vehicle INSERT and CAS UPDATE identity, in-flight edit, normalized copy and stale ACK');
