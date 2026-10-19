#!/usr/bin/env node
// v570 — execute the actual lazy modules against deliberately delayed cloud SELECTs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const tick=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function setup(kind) {
  const code=readFileSync(join(root,kind+'.js'),'utf8'),ctx={window:{},console};
  vm.runInNewContext(code,ctx,{filename:kind+'.js'});
  const state={cloud:{userId:'U',householdId:'A',provider:'supabase',lastSyncAt:'old-confirmed',recordConflicts:[]},
    household:{id:'A'},activeProfileId:'P1',calendar:[],calendarCloud:{sources:[]},contracts:[],contractFiles:[]};
  const req=[],actions=[];let active='';
  const client={from(table){const deferred=gate(),where=[];
    req.push({table,deferred,where});
    const q={select:()=>q,eq:(k,v)=>{where.push([k,v]);return q;},neq:()=>q,order:()=>q,
      then:(yes,no)=>deferred.promise.then(yes,no)};return q;
  }};
  const deps={getState:()=>state,getSupabaseClient:()=>client,refreshCloudSession:async()=>({id:'U'}),
    currentHouseholdId:()=>state.household.id,currentProfileId:()=>state.activeProfileId,
    getActiveContractId:()=>active,setActiveContractId:v=>{active=v;actions.push('select');},
    getCalendarViewMonth:()=> '2026-10',uid:()=> 'generated-local',
    touchState:()=>actions.push('touch'),saveState:()=>actions.push('save'),
    render:()=>actions.push('render'),showToast:()=>actions.push('toast')};
  const factory=kind==='calendar'?ctx.window.DomacnostCalendar.createCalendar:ctx.window.DomacnostContracts.createContracts;
  const mod=factory(deps);
  const snapshot=()=>JSON.stringify({calendar:state.calendar,calendarCloud:state.calendarCloud,contracts:state.contracts,files:state.contractFiles,active});
  return {kind,state,req,actions,mod,snapshot,respond:(i,data,error=null)=>req[i].deferred.resolve({data,error})};
}
async function count(e,n){await tick();assert.equal(e.req.length,n,e.kind+' query count');}
const remote={
  source:[{id:'source-1',household_id:'A',name:'Family',provider:'manual',created_at:'2026-10-18'}],
  contract:[{id:'contract-1',title:'Internet',reminder_days:30,created_at:'2026-10-18'}],
  file:[{id:'file-1',household_id:'A',contract_id:'contract-1',storage_path:'A/file.pdf',file_name:'Contract.pdf',mime_type:'application/pdf',file_size:1000,created_at:'2026-10-18'}]
};
for(const kind of ['calendar','contracts']){
  const name=kind==='calendar'?'cloudLoadCalendar':'cloudLoadContracts';
  for(const scenario of ['error','missing','household','user','profile','localHousehold','localEdit']){
    const e=setup(kind),job=e.mod[name](false);
    await count(e,1);e.respond(0,kind==='calendar'?remote.source:remote.contract);
    await count(e,2);
    if(scenario==='household')e.state.cloud.householdId='B';
    if(scenario==='user')e.state.cloud.userId='V';
    if(scenario==='profile')e.state.activeProfileId='P2';
    if(scenario==='localHousehold')e.state.household.id='B';
    if(scenario==='localEdit'){
      if(kind==='calendar')e.state.calendar.push({id:'mine',title:'Changed in flight'});
      else e.state.contracts.push({id:'mine',name:'Changed in flight'});
    }
    const expected=e.snapshot();
    e.respond(1,scenario==='missing'?null:[],scenario==='error'?{message:'network error'}:null);
    assert.equal(await job,false,kind+' '+scenario);
    assert.equal(e.snapshot(),expected,kind+' '+scenario+' must preserve state');
    assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
    assert.deepEqual(e.actions,[]);
    assert(e.req.every(q=>q.where.some(([key,value])=>key==='household_id'&&value==='A')));
  }
}
// Full-load happy paths, including metadata referencing newly loaded contracts.
{
 const e=setup('calendar'),job=e.mod.cloudLoadCalendar(false);
 await count(e,1);e.respond(0,remote.source);await count(e,2);
 assert.equal(e.state.calendarCloud.sources.length,0,'stage must not mutate before events');
 e.respond(1,[]);assert.equal(await job,true);assert.equal(e.state.calendarCloud.sources.length,1);
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
}
{
 const e=setup('contracts'),job=e.mod.cloudLoadContracts(false);
 await count(e,1);e.respond(0,remote.contract);await count(e,2);
 assert.equal(e.state.contracts.length,0,'stage must not mutate before files');
 e.respond(1,remote.file);assert.equal(await job,true);
 assert.equal(e.state.contracts.length,1);assert.equal(e.state.contractFiles.length,1);
 assert.equal(e.state.contractFiles[0].contractId,e.state.contracts[0].id);
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
}
// Local source inserted while event SELECT is pending must not be lost.
{
 const e=setup('calendar'),job=e.mod.cloudLoadCalendar(false);
 await count(e,1);e.respond(0,remote.source);await count(e,2);
 e.state.calendarCloud.sources.push({id:'mine',name:'Local',cloudId:''});
 e.respond(1,[]);assert.equal(await job,false);
 assert.equal(e.state.calendarCloud.sources[0].name,'Local');
}
// Standalone readers still return their historical success shapes.
{
 const e=setup('calendar'),job=e.mod.cloudLoadCalendarSources(false);
 await count(e,1);e.respond(0,remote.source);
 assert.equal((await job).length,1);assert.equal(e.state.calendarCloud.sources.length,1);
}
{
 const e=setup('contracts'),job=e.mod.cloudLoadContractFiles(false);
 await count(e,1);e.respond(0,[]);
 assert.equal(await job,true);assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
}
console.log('PASS P1/P2 calendar and contract attachments: atomic, delayed, tenant/profile, local edit, mapping and sync status');
