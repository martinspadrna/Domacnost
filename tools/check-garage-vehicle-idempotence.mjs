#!/usr/bin/env node
// P0 Garage v588: same logical car keeps one UUID across retry/restart/lost ACK.
// Exercises the production cloudAddVehicle, never touches live Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const cut=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'Missing Garage source '+a);return app.slice(i,j);};
const source=cut('  function cloudSyncWorkspaceScope()', '  function clearCloudAutosyncTimer()')+
  cut('  const GARAGE_VEHICLE_INSERT_UUID =', '  async function cloudUpdateVehicle(vehicle)');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function harness(mode='success'){
  let responseMode=mode;
  const state={cloud:{householdId:'home-one',userId:'user-one'},vehicles:[]};
  const rows=new Map(),inserted=[],selected=[],snapshots=[],toasts=[],schema=[];
  const client={from(table){
    assert.equal(table,'vehicles');
    return {
      insert(payload){return{select(){return{async single(){
        inserted.push(structuredClone(payload));
        if(responseMode==='schema' && inserted.length===1)return {data:null,error:{code:'PGRST204',message:'missing columns'}};
        if(rows.has(payload.id))return {data:null,error:{code:'23505',message:'duplicate key'}};
        if(responseMode==='offline')return{data:null,error:{message:'offline'}};
        const row={...payload,updated_at:'2026-10-23T10:00:00.000Z'};
        if(responseMode==='mismatch')row.name='UNRELATED';
        rows.set(payload.id,row);
        if(['lost','mismatch'].includes(responseMode))return{data:null,error:{message:'connection closed'}};
        return{data:{id:payload.id},error:null};
      }};}};
      },
      select(){const filters=[],query={eq(k,v){filters.push([k,v]);return query;},
        async maybeSingle(){
          selected.push([...filters]);
          const id=filters.find(([k])=>k==='id')?.[1];
          const house=filters.find(([k])=>k==='household_id')?.[1];
          const row=rows.get(id);
          return {data:row?.household_id===house?structuredClone(row):null,error:null};
        }};
        return query;
      }
    };
  }};
  const cloudVehiclePayload=(item,user,options={})=>{
    const payload={household_id:state.cloud.householdId,profile_id:null,
      name:item.name,created_by:user,updated_by:user,
      plate_number:item.plate||null,current_odometer:item.odometer||null,
      technical_specs:{vin:item.vin||''}};
    if(options.includeExtendedFields===false)delete payload.technical_specs;
    return payload;
  };
  const deps={
    state,cloudReady:()=>true,getSupabaseClient:()=>client,
    refreshCloudSession:async()=>({id:'user-one'}),
    cloudVehiclePayload,
    linkGarageLateInsertToTrash: () => false,
    markGarageRecordPending:item=>{item.syncStatus=item.cloudId?'pending_update':'pending_add';},
    isGarageVehicleExtendedSchemaError:e=>e?.code==='PGRST204',
    markGarageVehicleExtendedSchemaPending:()=>schema.push(true),
    showToast:msg=>toasts.push(msg),
    persistStateSnapshot:()=>snapshots.push(structuredClone(state.vehicles)),
    canonicalComparableJson(value){if(Array.isArray(value))return value.map(deps.canonicalComparableJson);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,deps.canonicalComparableJson(v)]));
      return value;}
  };
  const api=new Function(...Object.keys(deps),source+'\nreturn {cloudAddVehicle};')(...Object.values(deps));
  return {state,rows,inserted,selected,snapshots,toasts,schema,api,setMode(value){responseMode=value;}};
}
const vehicle=()=>({id:'local-auto',name:'Fabia',plate:'ABC1234',odometer:110,syncStatus:'pending_add'});
for(const mode of ['success','lost','schema']){
  const h=harness(mode),car=vehicle();h.state.vehicles=[car];
  const result=await h.api.cloudAddVehicle(car);
  assert.equal(h.inserted.length,mode==='schema'?2:1);
  assert.match(h.inserted[0].id,uuid);
  assert.equal(car.cloudInsertId,h.inserted[0].id,'persisted ID must match payload');
  assert.equal(result?.id,car.cloudInsertId,mode+' insert must be confirmed');
  assert.equal(car.cloudId,car.cloudInsertId);
  assert.equal(h.rows.size,1,'no duplicate rows');
  assert.equal(car.syncStatus,mode==='schema'?'pending_update':'');
  assert(h.snapshots[0][0].cloudInsertId===car.cloudInsertId,'UUID saved before INSERT');
  if(mode==='lost')assert.equal(h.selected.length,1,'recover only via exact read');
}
{
  const h=harness('offline'),car=vehicle();h.state.vehicles=[car];
  assert.equal(await h.api.cloudAddVehicle(car),null);
  const id=car.cloudInsertId;
  assert.match(id,uuid);
  assert.equal(h.rows.size,0);
  // Restart from the durable snapshot, using a new immutable local object.
  const restored=structuredClone(h.snapshots[0][0]);h.state.vehicles=[restored];
  h.setMode('success');
  assert.equal((await h.api.cloudAddVehicle(restored))?.id,id);
  assert.equal(h.inserted.length,2);
  assert.equal(h.inserted[0].id,h.inserted[1].id);
  assert.equal(h.rows.size,1);
}
for(const mode of ['mismatch','other-home']){
  const h=harness(mode==='other-home'?'lost':mode),car=vehicle();
  h.state.vehicles=[car];
  if(mode==='other-home'){
    const id='7901a222-0234-4130-a6c7-4c4619b9dabc';
    car.cloudInsertId=id;
    h.rows.set(id,{id,household_id:'different-home',name:car.name});
  }
  const receipt=await h.api.cloudAddVehicle(car);
  assert.equal(receipt,null,mode+' cannot be ACK');
  assert(!car.cloudId,'remote mismatch must not bind ID');
  assert.equal(car.syncStatus,'pending_add');
  if(mode==='mismatch'){
    await h.api.cloudAddVehicle(car);
    assert.equal(h.inserted[0].id,h.inserted[1].id);
    assert.equal(h.rows.size,1,'UUID primary key prevents another insert');
  }
}
{
  // Two simultaneous autosync/manual sync calls cannot start two POSTs.
  const h=harness(),car=vehicle();h.state.vehicles=[car];
  const [first,second]=await Promise.all([h.api.cloudAddVehicle(car),h.api.cloudAddVehicle(car)]);
  assert.equal(first?.id,second?.id);assert.equal(h.inserted.length,1);
}
{
  const h=harness('success'),car=vehicle();h.state.vehicles=[car];
  // A locally deleted item is not revived. The old object retains the remote
  // receipt so Undo-expiry cleanup can still target exactly that UUID.
  const original=h.api.cloudAddVehicle(car);
  await Promise.resolve(); // wait for session refresh and POST to begin
  assert.equal(h.inserted.length,1,'delete must happen during an actual POST');
  h.state.vehicles=[];
  assert.equal(await original,null);
  assert.equal(h.state.vehicles.length,0);
  assert.match(car.cloudId,uuid,'deleted object retains ACK for delayed Undo cleanup');
  assert.equal(car.cloudId,car.cloudInsertId);
}
{
  const h=harness('success'),car=vehicle();h.state.vehicles=[car];
  const original=h.api.cloudAddVehicle(car);
  h.state.cloud.userId='other-user';
  assert.equal(await original,null);
  assert(!car.cloudId,'auth switch prevents stale local ACK');
  assert.equal(h.state.vehicles[0].cloudInsertId||'', '');
}
assert(app.includes("linkGarageLateInsertToTrash('vehicles', vehicle.id, scope"), 'late ACK must link deleted car to Trash');
assert(app.includes('garageInsertUnconfirmed:'), 'deleted car must use durable Garage outbox');
console.log('PASS P0 v588 Garage UUID: durable restart, lost ACK, schema fallback, mismatch, scope, concurrent insert and Undo');
