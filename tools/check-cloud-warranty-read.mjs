#!/usr/bin/env node
// P1/P2 v571 — warranty file SELECT isolation and redundant cloud-load map regression.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const app=readFileSync(join(root,'app.js'),'utf8');
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function environment() {
  const state={
    cloud:{userId:'U',householdId:'A',provider:'supabase',lastSyncAt:'old-confirmed'},
    household:{id:'A'},
    warranties:[{id:'war-1',name:'TV',cloudId:'w1'}],
    warrantyFiles:[{id:'local-file',warrantyId:'war-1',fileName:'draft.pdf'}]
  };
  const operations=[],requests=[];
  const client={from(table){
    const delayed=defer(),filters=[];
    requests.push({table,delayed,filters});
    const q={select:()=>q,eq:(field,value)=>{filters.push([field,value]);return q;},
      order:()=>q,then:(onOk,onError)=>delayed.promise.then(onOk,onError)};
    return q;
  }};
  const context={console,window:{sessionStorage:{getItem:()=>null,setItem:()=>{}}}};
  vm.runInNewContext(readFileSync(join(root,'warranty.js'),'utf8'),context,{filename:'warranty.js'});
  const deps={
    getState:()=>state,getSupabaseClient:()=>client,refreshCloudSession:async()=>({id:'U'}),
    currentHouseholdId:()=>state.cloud.householdId,currentProfileId:()=>null,
    touchState:()=>operations.push('touch'),saveState:()=>operations.push('save'),
    render:()=>operations.push('render'),showToast:()=>operations.push('toast')
  };
  const warranty=context.window.DomacnostWarranty.createWarranty(deps);
  const snapshot=()=>JSON.stringify({warranties:state.warranties,files:state.warrantyFiles});
  return {state,operations,requests,warranty,snapshot};
}
const row={id:'file-1',household_id:'A',warranty_key:'war-1',storage_path:'A/warr/file.pdf',
  file_name:'receipt.pdf',mime_type:'application/pdf',file_size:100,source:'upload',created_at:'2026-10-18'};
for(const scenario of ['household','user','warrantyEdit','fileEdit','null','network']){
 const e=environment(),job=e.warranty.cloudLoadWarrantyFiles(false);
 await flush();assert.equal(e.requests.length,1);
 assert.equal(e.requests[0].table,'household_warranty_files');
 assert(e.requests[0].filters.some(([k,v])=>k==='household_id'&&v==='A'));
 if(scenario==='household')e.state.cloud.householdId='B';
 if(scenario==='user')e.state.cloud.userId='OtherUser';
 if(scenario==='warrantyEdit')e.state.warranties[0].name='Edited in flight';
 if(scenario==='fileEdit')e.state.warrantyFiles.push({id:'new-local',fileName:'later.pdf'});
 const before=e.snapshot();
 e.requests[0].delayed.resolve({
   data:scenario==='null'?null:[row],
   error:scenario==='network'?{message:'offline'}:null
 });
 assert.equal(await job,false,scenario);
 assert.equal(e.snapshot(),before,scenario+' should not overwrite local edits or old tenant');
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
 assert.deepEqual(e.operations,[],'No UI save on stale/failed query');
}
{
 const e=environment(),job=e.warranty.cloudLoadWarrantyFiles(false);
 await flush();e.requests[0].delayed.resolve({data:[],error:null});
 assert.equal(await job,true);
 assert.equal(e.state.warrantyFiles.length,1,'valid empty cloud keeps local-only file');
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
}
{
 const e=environment(),job=e.warranty.cloudLoadWarrantyFiles(false);
 await flush();e.requests[0].delayed.resolve({data:[row],error:null});
 assert.equal(await job,true);
 assert.equal(e.state.warrantyFiles.length,2,'cloud and local-only files coexist');
 assert.equal(e.state.warrantyFiles.find(x=>x.cloudId==='file-1').warrantyId,'war-1');
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
}
// Atomic calendar/contract loaders are already composite since v570.
// Explicitly prevent reinstating two redundant SELECTs in navigation or full sync.
const nav=app.slice(app.indexOf('  async function cloudLoadModuleForNav('),app.indexOf('  function getPriorityCloudModulesForHome('));
const full=app.slice(app.indexOf('  async function cloudLoadAllModules('),app.indexOf('  function cloudSyncCompletionState('));
assert(nav.includes('calendar: [cloudLoadCalendar]'));
assert(nav.includes('contracts: [cloudLoadContracts]'));
assert(full.includes('        cloudLoadCalendar,'));
assert(full.includes('        cloudLoadContracts,'));
assert(!full.includes('        cloudLoadCalendarSources,'));
assert(!full.includes('        cloudLoadContractFiles,'));
assert(full.includes('return { loaded: ok, total: loaders.length };'));
console.log('PASS warranty file remote isolation, partial errors, local changes, composite cloud module dedupe');
