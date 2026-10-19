#!/usr/bin/env node
// P1/P2 v569 — HDO/Waste/Tasks: never apply stale partial remote SELECT.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const moduleNames={hdo:'DomacnostHdo',waste:'DomacnostWaste',notes:'DomacnostNotes'};
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<18;i++)await Promise.resolve();};
const instantiate=type=>{
  const js=readFileSync(join(root,type+'.js'),'utf8');
  const ctx={window:{},console};vm.runInNewContext(js,ctx,{filename:type+'.js'});
  const state={
    cloud:{userId:'U',householdId:'A',provider:'supabase',lastSyncAt:'confirmed-original'},activeProfileId:'P1',
    household:{id:'A'},hdoCloud:{settingId:'local-setting'},hdoWindows:[{id:'wLocal',label:'Local',syncStatus:'pending_add'}],
    waste:[{id:'wLocal',type:'Local',date:'2026-10-17'}],
    homeTasks:[{id:'tLocal',title:'Local',syncStatus:'pending_add'}],tasksCloud:{loadedAt:'original'}
  };
  const queries=[],operations=[];
  const client={from(table){
    const deferred=gate(),filters=[];
    queries.push({table,deferred,filters});
    const query={select:()=>query,eq:(key,value)=>{filters.push([key,value]);return query;},order:()=>query,maybeSingle:()=>deferred.promise,
      then:(resolve,reject)=>deferred.promise.then(resolve,reject)};
    return query;
  }};
  const deps={
    getState:()=>state,getSupabaseClient:()=>client,showToast:x=>operations.push('toast:'+x),
    currentHouseholdId:()=>state.household.id,currentProfileId:()=>state.activeProfileId,
    touchState:()=>operations.push('touch'),saveState:()=>operations.push('save'),render:()=>operations.push('render'),
    uid:()=> 'local-unique',normalizeText:x=>String(x||''), TASK_CATEGORY_OPTIONS:[['domacnost','Domácnost']],
    TASK_PRIORITY_OPTIONS:[['normal','Normální']]
  };
  const factory=ctx.window[moduleNames[type]];
  const instance=type==='hdo'?factory.createHdo(deps):type==='waste'?factory.createWaste(deps):factory.createNotes(deps);
  const load=type==='hdo'?instance.cloudLoadHdoData:type==='waste'?instance.cloudLoadWaste:instance.cloudLoadTasks;
  const response=(index,data,error=null)=>queries[index].deferred.resolve({data,error});
  const snapshot=()=>JSON.stringify({hdoWindows:state.hdoWindows,hdoCloud:state.hdoCloud,waste:state.waste,homeTasks:state.homeTasks,tasksCloud:state.tasksCloud});
  return {state,queries,operations,load,response,snapshot};
};
function begin(e,expected){
 const job=e.load(false);
 assert.equal(e.queries.length,expected);
 return job;
}
function assertOriginal(e,before,label){assert.equal(e.snapshot(),before,label);assert.equal(e.state.cloud.lastSyncAt,'confirmed-original');assert.deepEqual(e.operations,[]);}
for(const change of ['household','user','profile','localHousehold','edit']){
  const e=instantiate('hdo'),job=begin(e,1),before=e.snapshot();
  if(change==='household')e.state.cloud.householdId='B';
  if(change==='user')e.state.cloud.userId='V';
  if(change==='profile')e.state.activeProfileId='P2';
  if(change==='localHousehold')e.state.household.id='B';
  if(change==='edit')e.state.hdoWindows[0].label='New local';
  const original=e.snapshot();e.response(0,{id:'server-setting'});await flush();
  if(change==='edit'){assert.equal(e.queries.length,2);e.response(1,[]);}
  assert.equal(await job,false);
  assertOriginal(e,original,'HDO '+change+' must not apply');
}
{
 const e=instantiate('hdo'),job=begin(e,1),before=e.snapshot();
 e.response(0,{id:'cloud-setting'});await flush();assert.equal(e.queries.length,2);
 assert.equal(e.snapshot(),before,'settings must not mutate prior to window read');
 e.response(1,null,{message:'offline'});assert.equal(await job,false);assertOriginal(e,before,'HDO partial');
}
{
 const e=instantiate('hdo'),job=begin(e,1);
 e.response(0,{id:'cloud-setting'});await flush();e.response(1,[]);
 assert.equal(await job,true);assert.equal(e.state.hdoCloud.settingId,'cloud-setting');
 assert.equal(e.state.hdoWindows[0].id,'wLocal','pending HDO survives');
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-original');
 assert(e.queries.every(q=>q.filters.some(([key,val])=>key==='household_id'&&val==='A')));
}
for(const type of ['waste','notes']){
 const loaderType=type==='notes'?'Tasks':'Waste';
 for(const change of ['household','user','profile','localHousehold','edit','invalid','error']){
  const e=instantiate(type),job=begin(e,1),before=e.snapshot();
  if(change==='household')e.state.cloud.householdId='B';
  if(change==='user')e.state.cloud.userId='V';
  if(change==='profile')e.state.activeProfileId='P2';
  if(change==='localHousehold')e.state.household.id='B';
  if(change==='edit'){
   if(type==='waste')e.state.waste[0].type='New local';
   else e.state.homeTasks[0].title='New local';
  }
  const preserved=e.snapshot();
  if(change==='invalid')e.response(0,null);
  else if(change==='error')e.response(0,[],{message:'offline'});
  else e.response(0,[]);
  assert.equal(await job,false,loaderType+' '+change);
  assertOriginal(e,preserved,loaderType+' '+change);
  assert(e.queries[0].filters.some(([key,val])=>key==='household_id'&&val==='A'));
 }
 const e=instantiate(type),job=begin(e,1);
 e.response(0,[]);assert.equal(await job,true,loaderType+' empty valid response');
 if(type==='waste')assert.equal(e.state.waste[0].type,'Local','local-only waste survives');
 else assert.equal(e.state.homeTasks[0].title,'Local','pending tasks survive');
 assert.equal(e.state.cloud.lastSyncAt,'confirmed-original');
}
console.log('PASS P1/P2 HDO/Waste/Tasks: atomic query, explicit failure, local edit, user/profile/local household switch and truthful timestamp');
