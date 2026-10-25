#!/usr/bin/env node
// P0 Garage v590 — source-level executable CAS update tests. No live DB writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app.js'), 'utf8');
const cut = (a,b) => {
  const i = app.indexOf(a), j = app.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'Source anchor missing: '+a);
  return app.slice(i,j);
};
const source = cut('  function cloudSyncWorkspaceScope()', '  function clearCloudAutosyncTimer()') +
  cut('  const garageLogUpdateInFlight =', '  async function cloudDeleteGarageRecord(collection, item)');
const tick = async () => { for(let i=0;i<35;i++) await Promise.resolve(); };
function later() { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; }
const baseRemote = collection => collection === 'fuel'
  ? {id:'cloud-log',household_id:'house-a',vehicle_id:'car-cloud',date:'2026-10-24',odometer:12345,liters:44,total_price:1700,price_per_liter:38.64,note:'Původní',updated_at:'rev-one'}
  : {id:'cloud-log',household_id:'house-a',vehicle_id:'car-cloud',date:'2026-10-24',odometer:12345,type:'tires',title:'Pneumatiky',total_price:7000,note:'Původní',updated_at:'rev-one'};
const localRecord = collection => collection === 'fuel'
  ? {id:'local-log', cloudId:'cloud-log',cloudUpdatedAt:'rev-one',date:'2026-10-24',vehicleId:'car-local',odometer:'12345',liters:44,price:1800,note:'Nová poznámka',syncStatus:'pending_update'}
  : {id:'local-log', cloudId:'cloud-log',cloudUpdatedAt:'rev-one',date:'2026-10-24',vehicleId:'car-local',odometer:'12345',title:'Pneumatiky',price:7500,note:'Nová poznámka',syncStatus:'pending_update'};
function setup(collection, options={}) {
  const item=localRecord(collection);
  const remote=baseRemote(collection);
  if(options.missingBaseline) item.cloudUpdatedAt='';
  if(options.remoteRevision) remote.updated_at=options.remoteRevision;
  const state={cloud:{userId:'user-a',householdId:'house-a'},fuel:[],services:[]};
  state[collection]=[item];
  const selects=[],updates=[],notifications=[],persists=[],conflicts=[];
  let nextRevision='rev-two',getGate=null,updateGate=null,mode=options.mode||'success';
  const client={from(table){
    assert.equal(table,collection==='fuel'?'fuel_logs':'service_logs');
    return {
      select(){
        const filters=[];
        const query={eq(k,v){filters.push([k,v]);return query;},
          async maybeSingle(){
            selects.push(filters);
            if(getGate) await getGate;
            const matched=filters.every(([k,v])=>remote[k]===v);
            return {data:matched?structuredClone(remote):null,error:null};
          }};
        return query;
      },
      update(payload){
        const filters=[];
        const query={eq(k,v){filters.push([k,v]);return query;},select(){return query;},
          async maybeSingle(){
            updates.push({payload:structuredClone(payload),filters:[...filters]});
            if(updateGate) await updateGate;
            if(mode==='error')return{data:null,error:{message:'network error'}};
            if(!filters.every(([k,v])=>remote[k]===v))return{data:null,error:null};
            Object.assign(remote,payload,{updated_at:nextRevision});
            if(mode==='lost')return{data:null,error:{message:'response lost'}};
            return {data:structuredClone(remote),error:null};
          }};
        return query;
      }
    };
  }};
  const deps={
    state, cloudReady:()=>true, getSupabaseClient:()=>client,
    refreshCloudSession:async()=>({id:'user-a'}), todayISO:()=> '2026-10-24',
    markGarageRecordPending:r=>{r.syncStatus=r.cloudId?'pending_update':'pending_add';},
    serviceTypeToCloud:()=> 'tires',
    canonicalComparableJson:v=>v,
    persistStateSnapshot:()=>persists.push(structuredClone(state[collection])),
    registerCloudRecordConflict:entry=>{conflicts.push(structuredClone(entry));return entry;},
    showToast:msg=>notifications.push(msg)
  };
  const api=new Function(...Object.keys(deps), source+'\nreturn {cloudUpdateFuelLog,cloudUpdateServiceLog,resolveGarageLogRecordConflict};')(...Object.values(deps));
  return {state,item,remote,selects,updates,notifications,persists,conflicts,
    update: opts=>collection==='fuel'?api.cloudUpdateFuelLog(item,opts):api.cloudUpdateServiceLog(item,opts),
    resolve:(conflict,strategy)=>api.resolveGarageLogRecordConflict(conflict,strategy),
    setGetGate:g=>{getGate=g;}, setUpdateGate:g=>{updateGate=g;},
    setMode:x=>{mode=x;}, setRevision:x=>{nextRevision=x;}
  };
}
for(const collection of ['fuel','services']){
  {
    const h=setup(collection);
    assert.equal(await h.update(),true,'standard CAS should succeed');
    assert.equal(h.updates.length,1);
    assert(h.updates[0].filters.some(([k,v])=>k==='updated_at'&&v==='rev-one'));
    assert.equal(h.item.cloudUpdatedAt,'rev-two');
    assert.equal(h.item.syncStatus,'');
  }
  {
    const h=setup(collection,{remoteRevision:'rev-other'});
    assert.equal(await h.update(),false);
    assert.equal(h.updates.length,0,'remote revision mismatch must not WRITE');
    assert.equal(h.item.syncStatus,'conflict');
    assert.equal(h.conflicts.length,1);
    assert.equal(h.conflicts[0].collection,collection);
    assert.equal(h.conflicts[0].remoteRevision,'rev-other');
  }
  {
    const h=setup(collection,{missingBaseline:true});
    assert.equal(await h.update(),false);
    assert.equal(h.updates.length,0,'no known baseline cannot force write');
    assert.equal(h.item.syncStatus,'conflict');
  }
  {
    const h=setup(collection,{mode:'lost'});
    assert.equal(await h.update(),true,'lost UPDATE ACK can be recovered via exact read');
    assert.equal(h.updates.length,1);
    assert.equal(h.selects.length,2);
    assert.equal(h.item.cloudUpdatedAt,'rev-two');
    assert.equal(h.item.syncStatus,'');
  }
  {
    const h=setup(collection,{mode:'error'});
    assert.equal(await h.update(),false);
    assert.equal(h.item.syncStatus,'pending_update');
    assert.equal(h.conflicts.length,0);
  }
  {
    const h=setup(collection);
    const gate=later(); h.setUpdateGate(gate.promise);
    const task=h.update(); await tick();
    h.remote.updated_at='rev-from-phone';
    gate.resolve();
    assert.equal(await task,false,'CAS zero-row should not ack');
    assert.equal(h.item.syncStatus,'conflict');
    assert.equal(h.conflicts[0].remoteRevision,'rev-from-phone');
  }
  {
    const h=setup(collection);
    const gate=later(); h.setUpdateGate(gate.promise);
    const task=h.update(); await tick();
    h.item.note='Ještě další editace';
    gate.resolve();
    assert.equal(await task,true);
    assert.equal(h.item.syncStatus,'pending_update','later edits remain pending');
    assert.equal(h.item.cloudUpdatedAt,'rev-two');
  }
  {
    const h=setup(collection);
    const gate=later();h.setGetGate(gate.promise);
    const task=h.update();await tick();
    h.state.cloud.userId='different-user';gate.resolve();
    assert.equal(await task,false);
    assert.equal(h.updates.length,0);
    assert.equal(h.item.syncStatus,'pending_update');
  }
  {
    const h=setup(collection,{remoteRevision:'rev-from-phone'});
    assert.equal(await h.update(),false);
    const conflict=h.conflicts[0];
    const ok=await h.resolve(conflict,'local');
    assert.equal(ok,true,'explicit local choice CAS against observed remote revision');
    assert.equal(h.updates.length,1);
    assert(h.updates[0].filters.some(([k,v])=>k==='updated_at'&&v==='rev-from-phone'));
  }
  {
    const h=setup(collection,{remoteRevision:'rev-from-phone'});
    assert.equal(await h.update(),false);
    assert.equal(await h.resolve(h.conflicts[0],'cloud'),true);
    assert.equal(h.updates.length,0,'explicit cloud choice does not write remote');
    assert.equal(h.item.syncStatus,'');
    assert.equal(h.item.cloudUpdatedAt,'rev-from-phone');
    assert.equal(h.item.note,'Původní');
  }
}
console.log('PASS Garage fuel/service CAS, missing baseline, conflict choices, lost ACK, edit/auth races');
