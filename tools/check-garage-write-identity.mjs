#!/usr/bin/env node
// P0 Garage: test actual async vehicle INSERT/UPDATE functions with deferred
// Supabase responses; no live database or user data is touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const cut=(start,end)=>{
  const from=src.indexOf(start),to=src.indexOf(end,from+start.length);
  assert(from>=0&&to>from,'missing app section: '+start);
  return src.slice(from,to);
};
const code=cut('  function garageVehicleWriteScope()','  function cloudVehiclePayload(')
  +cut('  async function cloudAddVehicle(vehicle)','  async function cloudDeleteVehicle(vehicle)');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function make(options={}) {
  const state={cloud:{householdId:'house-a',userId:'user-a'},household:{id:'house-a'},activeProfileId:'profile-a',vehicles:[]};
  const readRequests=[],insertRequests=[],updateRequests=[],snapshots=[],notices=[];
  const client={from(table){
    assert.equal(table,'vehicles');
    return {
      insert(payload) {
        const req={payload,gate:gate()};
        insertRequests.push(req);
        return {select(columns){assert(columns.includes('id'));return {single(){return req.gate.promise;}};}};
      },
      select(columns){
        const req={columns,where:[],gate:gate()};
        readRequests.push(req);
        const q={eq(k,v){req.where.push([k,v]);return q;},maybeSingle(){return req.gate.promise;}};
        return q;
      },
      update(payload){
        const req={payload,where:[],gate:gate()};
        updateRequests.push(req);
        const q={eq(k,v){req.where.push([k,v]);return q;},select(){return q;},maybeSingle(){return req.gate.promise;}};
        return q;
      }
    };
  }};
  let sessionGate=null;
  const deps={
    state,console,
    getSupabaseClient:()=>client,
    refreshCloudSession:()=>sessionGate?.promise||Promise.resolve({id:'user-a'}),
    cloudSyncWorkspaceScope:()=>({householdId:state.cloud.householdId,userId:state.cloud.userId}),
    cloudSyncWorkspaceMatches:s=>state.cloud.householdId===s.householdId&&state.cloud.userId===s.userId,
    currentProfileId:()=>state.activeProfileId,
    currentHouseholdId:()=>state.household.id,
    cloudVehiclePayload:(car,user,opt={})=>({
      household_id:state.cloud.householdId,name:car.name,note:car.note||null,
      updated_by:user,...(opt.mode==='update'?{}:{created_by:user}),
      ...(opt.includeExtendedFields===false?{}:{technical_specs:{type:car.type||'wagon'}})
    }),
    markGarageRecordPending:car=>{car.syncStatus=car.cloudId?'pending_update':'pending_add';},
    persistStateSnapshot:()=>snapshots.push(structuredClone(state.vehicles)),
    isGarageVehicleExtendedSchemaError:error=>error?.code==='PGRST204',
    markGarageVehicleExtendedSchemaPending:()=>notices.push('schema'),
    garageVehicleSafeUpdateDecision:()=>options.decision||'update',
    garageVehicleCloudDifference:()=>({type:'same'}),
    canonicalComparableJson:x=>x,
    showToast:message=>notices.push(message)
  };
  const api=new Function(...Object.keys(deps),code+'\nreturn {cloudAddVehicle,cloudUpdateVehicle};')(...Object.values(deps));
  return {state,readRequests,insertRequests,updateRequests,snapshots,notices,api,
    holdSession(){sessionGate=gate();return sessionGate;}};
}
const car=(id='car')=>({id,name:'Fabia',note:'local',syncStatus:'pending_add'});
const assertPending=(c)=>{assert.equal(c.cloudId,undefined);assert.equal(c.syncStatus,'pending_add');};
for (const kind of ['user','household','profile','localHousehold']) {
  const h=make(),c=car(kind);h.state.vehicles=[c];
  const task=h.api.cloudAddVehicle(c);
  await tick();
  assert.equal(h.insertRequests.length,1);
  if(kind==='user')h.state.cloud.userId='user-b';
  if(kind==='household')h.state.cloud.householdId='house-b';
  if(kind==='profile')h.state.activeProfileId='profile-b';
  if(kind==='localHousehold')h.state.household.id='house-b';
  h.insertRequests[0].gate.resolve({data:{id:h.insertRequests[0].payload.id,updated_at:'rev'},error:null});
  assert.equal(await task,null,'stale '+kind+' insert ACK');
  assertPending(c);
}
for (const kind of ['user','household','profile','localHousehold']) {
  const h=make({decision:'update'}),c={...car(kind),cloudId:'remote-car',syncStatus:'pending_update'};
  h.state.vehicles=[c];const task=h.api.cloudUpdateVehicle(c);await tick();
  assert.equal(h.readRequests.length,1);
  if(kind==='user')h.state.cloud.userId='user-b';
  if(kind==='household')h.state.cloud.householdId='house-b';
  if(kind==='profile')h.state.activeProfileId='profile-b';
  if(kind==='localHousehold')h.state.household.id='house-b';
  h.readRequests[0].gate.resolve({data:{id:'remote-car',updated_at:'rev'},error:null});
  assert.equal(await task,false,'stale '+kind+' read');
  assert.equal(h.updateRequests.length,0,'stale read must not cause UPDATE');
  assert.equal(c.syncStatus,'pending_update');
}
{
  const h=make({decision:'update'}),c={...car(),cloudId:'remote-car',syncStatus:'pending_update'};
  h.state.vehicles=[c];const task=h.api.cloudUpdateVehicle(c);await tick();
  h.readRequests[0].gate.resolve({data:{id:'remote-car',updated_at:'rev-base'},error:null});
  await tick();assert.equal(h.updateRequests.length,1);
  assert(h.updateRequests[0].where.some(([key,value])=>key==='updated_at'&&value==='rev-base'));
  h.state.cloud.userId='user-b';
  h.updateRequests[0].gate.resolve({data:{id:'remote-car',updated_at:'rev-new'},error:null});
  assert.equal(await task,false,'late CAS ACK may not clear pending');
  assert.equal(c.syncStatus,'pending_update');
}
{
  const h=make({decision:'update'}),c={...car(),cloudId:'remote-car',syncStatus:'pending_update'};
  h.state.vehicles=[c];const task=h.api.cloudUpdateVehicle(c);await tick();
  h.readRequests[0].gate.resolve({data:{id:'remote-car',updated_at:'rev-base'},error:null});
  await tick();h.updateRequests[0].gate.resolve({data:null,error:null});
  assert.equal(await task,false,'zero-row CAS must not be ACK');
  assert.equal(c.syncStatus,'pending_update');
}
{
  const h=make(),c=car();h.state.vehicles=[c];
  const task=h.api.cloudAddVehicle(c);await tick();
  assert.equal(h.insertRequests.length,1);
  assert.match(h.insertRequests[0].payload.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(h.snapshots[0][0].cloudInsertId,h.insertRequests[0].payload.id,
    'stable UUID must be persisted before INSERT');
  // First request committed remotely but the response was lost.
  h.insertRequests[0].gate.resolve({data:null,error:{message:'connection lost'}});
  await tick();assert.equal(h.readRequests.length,1);
  const payload=h.insertRequests[0].payload;
  h.readRequests[0].gate.resolve({data:{...payload,updated_at:'rev'},error:null});
  const result=await task;
  assert.equal(result.id,payload.id);
  assert.equal(c.cloudId,payload.id);
  assert.equal(c.syncStatus,'');
  assert.equal(h.snapshots.length,2,'ACK must be persisted');
}
{
  const h=make(),c=car();h.state.vehicles=[c];
  const first=h.api.cloudAddVehicle(c),second=h.api.cloudAddVehicle(c);await tick();
  assert.equal(h.insertRequests.length,1,'single-flight in one instance');
  const payload=h.insertRequests[0].payload;
  h.insertRequests[0].gate.resolve({data:{id:payload.id,updated_at:'rev'},error:null});
  assert.equal((await first)?.id,payload.id);assert.equal((await second)?.id,payload.id);
}
{
  const h=make(),c=car();h.state.vehicles=[c];
  const first=h.api.cloudAddVehicle(c);await tick();
  const id=h.insertRequests[0].payload.id;
  h.insertRequests[0].gate.resolve({data:null,error:{message:'offline'}});
  await tick();h.readRequests[0].gate.resolve({data:null,error:null});
  assert.equal(await first,null);assertPending(c);
  const second=h.api.cloudAddVehicle(c);await tick();
  assert.equal(h.insertRequests.length,2);assert.equal(h.insertRequests[1].payload.id,id);
  h.insertRequests[1].gate.resolve({data:{id,updated_at:'rev'},error:null});
  assert.equal((await second)?.id,id);
}
{
  const h=make(),c=car();h.state.vehicles=[c];
  const task=h.api.cloudAddVehicle(c);await tick();
  const payload=h.insertRequests[0].payload;
  h.insertRequests[0].gate.resolve({data:null,error:{message:'lost'}});
  await tick();
  h.readRequests[0].gate.resolve({data:{...payload,note:'DIFFERENT',updated_at:'rev'},error:null});
  assert.equal(await task,null,'different remote content must remain pending');
  assertPending(c);
}
{
  const h=make(),c=car();h.state.vehicles=[c];
  const task=h.api.cloudAddVehicle(c);await tick();
  const payload=h.insertRequests[0].payload;
  c.note='edited during insert';
  h.insertRequests[0].gate.resolve({data:{id:payload.id,updated_at:'rev'},error:null});
  assert.equal(await task,null,'new local change must remain pending');
  assert.equal(c.cloudId,payload.id);
  assert.equal(c.syncStatus,'pending_update');
}
{
  const h=make(),c=car();h.state.vehicles=[c];
  const task=h.api.cloudAddVehicle(c);await tick();
  const firstId=h.insertRequests[0].payload.id;
  h.insertRequests[0].gate.resolve({data:null,error:{code:'PGRST204',message:'missing extended column'}});
  await tick();
  assert.equal(h.insertRequests.length,2,'schema fallback expected');
  assert.equal(h.insertRequests[1].payload.id,firstId,'fallback must reuse UUID');
  assert(!('technical_specs' in h.insertRequests[1].payload));
  h.insertRequests[1].gate.resolve({data:{id:firstId,updated_at:'rev'},error:null});
  assert.equal((await task)?.id,firstId,'schema fallback confirms ID for dependent logs');
  assert.equal(c.cloudId,firstId);
  assert.equal(c.syncStatus,'pending_update');
}
console.log('PASS P0 v587 Garage: UUID retry/recovery, CAS, profile/user/household identity, schema fallback, pending');
