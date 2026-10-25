#!/usr/bin/env node
// P0 Garage v591: exercise production durable tombstones + the real
// replayCloudOutbox path with a simulated remote DB; never touch live data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const app=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const cut=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'Missing source anchor '+a);return app.slice(i,j);};
const source =
  cut('  function normalizeCloudOutbox(value)', '  function normalizeCloudRecordConflicts(value)')+
  cut('  function enqueueTrashCloudDeletes(trashIds', '  // Pozdní potvrzení DELETE/archivace')+
  cut('  const GARAGE_DELETE_COLLECTIONS =', '  function cloudErrorIsTransient(error)')+
  cut('  const garageLogUpdateInFlight =', '  async function cloudDeleteGarageRecord(collection, item)')+
  cut('  async function replayCloudOutbox()', '  function normalizeModuleList(value)');
const stamp='2026-10-24T10:00:00.000Z';
const newRecord=(col, id)=>{
  const common={id,householdId:'household-home1',cloudInsertId:'79ba5afd-18d1-4ca4-a0c2-0ce992ab66a3',date:'2026-10-24',odometer:'12345',note:'Původní'};
  if(col==='vehicles')return {...common,name:'Auto',plate:'ABC'};
  if(col==='fuel')return {...common,vehicleId:'local-vehicle',liters:44,price:1700,source:'manual'};
  return {...common,vehicleId:'local-vehicle',title:'Pneumatiky',price:7000,source:'manual'};
};
const remoteFor=(col,rec)=>{
 const common={id:rec.cloudInsertId,household_id:'home1',created_at:stamp,updated_at:stamp, date:rec.date,odometer:Number(rec.odometer),note:rec.note,source:'manual'};
 if(col==='vehicles')return {...common,name:'Auto',plate_number:'ABC'};
 if(col==='fuel')return {...common,vehicle_id:'vehicle-remote',liters:44,total_price:1700,price_per_liter:38.64};
 return {...common,vehicle_id:'vehicle-remote',type:'tires',title:'Pneumatiky',total_price:7000};
};
function harness(collection='fuel'){
 let seq=0,mode='normal', gate=null,afterRead=()=>{};
 const record=newRecord(collection,'local-'+collection);
 const state={household:{id:'household-home1'},cloud:{provider:'supabase',userId:'user1',householdId:'home1',outbox:[]},
  trash:[{id:'trash-a',deletedAt:new Date(Date.now()-18000).toISOString(),
    records:[{collection,record}]}],vehicles:[],fuel:[],services:[]};
 const table={vehicles:'vehicles',fuel:'fuel_logs',services:'service_logs'}[collection];
 const rows=new Map(),operations=[],snapshots=[];
 const client={from(actual){
   assert.equal(actual,table,'cross-table DELETE must never occur');
   return {
     select(){return makeQuery('read')},
     delete(){return makeQuery('delete')}
   };
   function makeQuery(operation){
     const filters=[];
     const q={eq(k,v){filters.push([k,v]);return q;},select(){return q;},
       async maybeSingle(){
         operations.push({operation,filters:[...filters],house:state.cloud.householdId});
         if(gate && operation==='read') await gate;
         const row=rows.get(record.cloudInsertId);
         const found=row && filters.every(([k,v])=>row[k]===v);
         if(operation==='read'){
           afterRead();
           return {data:found?structuredClone(row):null,error:null};
         }
         if(mode==='race'&&found){row.updated_at='2026-10-24T11:00:00.000Z';return {data:null,error:null};}
         if(found)rows.delete(record.cloudInsertId);
         if(mode==='lost'&&found)return {data:null,error:{message:'connection reset',status:503}};
         return {data:found?{id:record.cloudInsertId}:null,error:null};
       }};
     return q;
   }
 }};
 const ctx={
   state,activeUndoTrashIds:new Set(),pendingUndoTrashIds:new Set(),
   CLOUD_DELETE_TABLES:{vehicles:'vehicles',fuel:'fuel_logs',services:'service_logs'},
   currentHouseholdId:()=>state.household.id,
   normalizeText:v=>String(v??'').trim(),structuredCloneSafe:structuredClone,
   normalizeTrashEntries:rows=>rows,
   uid:()=>String(++seq),trashRecordTitle:(col,rec)=>rec.title||rec.name||col, cloudReady:()=>Boolean(state.cloud.userId&&state.cloud.householdId),
   cloudSyncWorkspaceMatches:scope=>scope.householdId===state.cloud.householdId && scope.userId===state.cloud.userId,
   cloudLocalPendingCount:()=>state.cloud.outbox.length,requestBackgroundRender:()=>{},
   persistStateSnapshot:()=>snapshots.push(structuredClone(state)),
   scheduleCloudAutosync:()=>{},
   browserAppearsOnline:()=>true,cleanupProviderManagedCalendarSyncArtifacts:()=>{},
   getSupabaseClient:()=>client, showToast:()=>{},
   garageVehicleCloudDifference:(local,remote)=>({type:local.name===remote?.name && local.plate===remote?.plate_number && local.note===remote?.note?'same':'different'}),
   garageLogUpdatePayload:(col,rec,user)=>col==='fuel'
     ? {date:rec.date,odometer:Number(rec.odometer),note:rec.note,liters:Number(rec.liters),total_price:Number(rec.price),price_per_liter:38.64,updated_by:user}
     : {date:rec.date,odometer:Number(rec.odometer),note:rec.note,type:'tires',title:rec.title,total_price:Number(rec.price),updated_by:user},
   garageLogUpdatePayloadMatches:(payload,remote)=>Object.entries(payload).every(([k,v])=>k==='updated_by'||remote?.[k]===v),
   cloudRecordConflicts:()=>[],calendarSyncRecordIsProviderManaged:()=>false,
   confirmFinanceTrashCloudDelete:()=>false,
   yieldToMainThread:async()=>{},cloudErrorIsTransient:error=>!error?.code || error?.code==='503',
   cloudErrorFriendlyMessage:error=>error?.message||'cloud failure',
   registerCloudRecordConflict:()=>{},
   serviceTypeToCloud:()=> 'tires',todayISO:()=> '2026-10-24',
   refreshCloudSession:async()=>({id:'user1'}),
   markGarageRecordPending:()=>{},
   canonicalComparableJson:v=>v,
   garageVehicleInsertInFlight:new Map()
 };
 const api=new vm.Script(source+'\n({recoverableGarageTrashDeleteIds,recoverGarageTrashCloudDeletes,garageDeletedCloudIds,linkGarageLateInsertToTrash,replayCloudOutbox,normalizeCloudOutbox})').runInNewContext(ctx);
 return {ctx,api,state,record,rows,operations,snapshots,seed:()=>rows.set(record.cloudInsertId,remoteFor(collection,record)),
  setMode:v=>{mode=v;},setGate:v=>{gate=v;},afterRead:f=>{afterRead=f;}};
}
for(const collection of ['vehicles','fuel','services']){
  // Restart with only a persisted Trash snapshot: one outbox tombstone.
  let h=harness(collection);
  assert.deepEqual(Array.from(h.api.recoverableGarageTrashDeleteIds()),['trash-a']);
  assert.equal(h.api.recoverGarageTrashCloudDeletes(),1);
  assert.equal(h.state.cloud.outbox.length,1);
  assert.equal(h.state.cloud.outbox[0].cloudId,h.record.cloudInsertId);
  assert.equal(h.state.cloud.outbox[0].garageInsertUnconfirmed,true);
  assert.equal(h.api.recoverGarageTrashCloudDeletes(),0,'never enqueue duplicate');
  assert.equal(h.snapshots.length,1,'tombstone must be durable');
  assert(h.api.garageDeletedCloudIds(collection).has(h.record.cloudInsertId),'remote reimport must be blocked');

  // A read with no row cannot acknowledge an in-flight/lost-ACK INSERT.
  assert.equal(await h.api.replayCloudOutbox(),false);
  assert.equal(h.state.cloud.outbox.length,1);
  assert.equal(h.state.cloud.outbox[0].attempts,1);
  assert(h.state.cloud.outbox[0].nextRetryAt,'must retry, not forget');

  h.seed();
  assert.equal(await h.api.replayCloudOutbox(),true,'late INSERT recovered and deleted');
  assert.equal(h.rows.size,0);
  assert.equal(h.state.cloud.outbox.length,0);
  assert(h.state.trash[0].records[0].record.cloudDeleteConfirmedAt,'persist confirmation with Trash');
  assert.equal(h.api.recoverGarageTrashCloudDeletes(),0,'completed delete never requeued');
  assert(h.operations.find(x=>x.operation==='delete').filters.some(([k,v])=>k==='updated_at'&&v===stamp),'CAS required');

  // Content mismatch is a permanent block, never a destructive guessing delete.
  h=harness(collection);h.seed();h.rows.get(h.record.cloudInsertId).note='Změna z telefonu';
  h.api.recoverGarageTrashCloudDeletes();
  assert.equal(await h.api.replayCloudOutbox(),false);
  assert.equal(h.rows.size,1);
  assert.equal(h.state.cloud.autosyncStatus,'blocked');
  assert.equal(h.operations.filter(x=>x.operation==='delete').length,0);

  // Concurrent remote edit between read and CAS must not be deleted.
  h=harness(collection);h.seed();h.api.recoverGarageTrashCloudDeletes();h.setMode('race');
  assert.equal(await h.api.replayCloudOutbox(),false);
  assert.equal(h.rows.size,1);
  assert.equal(h.state.cloud.autosyncStatus,'blocked');

  // A DELETE can commit but lose its ACK. Verify absence and finish.
  h=harness(collection);h.seed();h.api.recoverGarageTrashCloudDeletes();h.setMode('lost');
  assert.equal(await h.api.replayCloudOutbox(),true);
  assert.equal(h.rows.size,0);
  assert.equal(h.state.cloud.outbox.length,0);

  // Switching account/household mid-read must preserve old queued request.
  h=harness(collection);h.seed();h.api.recoverGarageTrashCloudDeletes();
  let resolve;const gate=new Promise(r=>{resolve=r;});h.setGate(gate);
  const task=h.api.replayCloudOutbox();
  for(let i=0;i<12;i++)await Promise.resolve();
  h.state.cloud.userId='another-user';resolve();
  assert.equal(await task,false);
  assert.equal(h.rows.size,1);
  assert.equal(h.state.cloud.outbox.length,1);

  // Undo active and restored record must not be enqueued from Trash.
  h=harness(collection);
  h.ctx.activeUndoTrashIds.add('trash-a');
  assert.equal(h.api.recoverGarageTrashCloudDeletes(),0);
  h.ctx.activeUndoTrashIds.clear();
  h.state[collection].push({...h.record});
  assert.equal(h.api.recoverGarageTrashCloudDeletes(),0);

  // Trash restore before replay or during remote SELECT cancels its DELETE.
  h=harness(collection);h.seed();h.api.recoverGarageTrashCloudDeletes();
  h.state[collection].push({...h.record,cloudId:''});
  assert.equal(await h.api.replayCloudOutbox(),true);
  assert.equal(h.operations.filter(x=>x.operation==='delete').length,0);
  assert.equal(h.rows.size,1);
  assert.equal(h.state.cloud.outbox.length,0);
  h=harness(collection);h.seed();h.api.recoverGarageTrashCloudDeletes();
  let unblock;const readGate=new Promise(resolve=>{unblock=resolve;});
  h.setGate(readGate);
  const restoring=h.api.replayCloudOutbox();
  for(let i=0;i<12;i++)await Promise.resolve();
  h.state[collection].push({...h.record,cloudId:''});
  unblock();
  assert.equal(await restoring,true);
  assert.equal(h.rows.size,1);
  assert.equal(h.operations.filter(x=>x.operation==='delete').length,0);

  // Late ACK while Undo is active links only the durable Trash, not a delete.
  h=harness(collection);
  h.ctx.activeUndoTrashIds.add('trash-a');
  assert.equal(h.api.linkGarageLateInsertToTrash(collection,h.record.id,{householdId:'home1',userId:'user1'},{id:h.record.cloudInsertId,updated_at:stamp}),true);
  assert.equal(h.state.cloud.outbox.length,0);
  assert.equal(h.state.trash[0].records[0].record.cloudId,h.record.cloudInsertId);
  h.ctx.activeUndoTrashIds.clear();
  assert.equal(h.api.recoverGarageTrashCloudDeletes(),1);
}
console.log('PASS P0 Garage durable deletion: lost INSERT/DELETE ACK, reload, CAS, Undo, tenant and mismatch');
