#!/usr/bin/env node
// P1/P2 v568: reading household shopping / garage atomically, no stale writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const fn=(start,end,ctx)=>{
  const from=source.indexOf('  '+start),to=source.indexOf('  '+end,from+start.length);
  assert(from>=0&&to>from,'Missing '+start);
  return new Function(...Object.keys(ctx),source.slice(from,to)+'\nreturn '+start.match(/function\s+(\w+)/)[1]+';')(...Object.values(ctx));
};
const defer=()=>{let resolve;let promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
const create=()=>{
  const state={
    cloud:{userId:'U',householdId:'A',provider:'supabase',lastSyncAt:'old-confirmed'},
    household:{id:'A'},activeProfileId:'profile-A',
    shoppingLists:[{id:'local-list',name:'Local'}],shopping:[{id:'local-item',name:'Bread',syncStatus:'pending'}],
    shoppingCloud:{units:[],categories:[],catalog:[],activeListId:'',loadedAt:'old'},
    activeShoppingListId:'local-list',vehicles:[{id:'local-car',name:'Local',syncStatus:'pending'}],
    fuel:[],services:[]
  };
  const queries=[],actions=[];
  const client={from(table){
    const gate=defer(),where=[];
    queries.push({table,gate,where});
    const builder={
      select(){return builder;},order(){return builder;},or(){return builder;},
      eq(key,value){where.push([key,value]);return builder;},in(key,value){where.push([key,value]);return builder;},
      then(ok,err){return gate.promise.then(ok,err);}
    };
    return builder;
  }};
  const ctx={
    state,console,getSupabaseClient:()=>client,refreshCloudSession:async()=>({id:'U'}),
    cloudSyncWorkspaceScope:()=>({householdId:state.cloud.householdId,userId:state.cloud.userId}),
    cloudSyncWorkspaceMatches:x=>x.householdId===state.cloud.householdId&&x.userId===state.cloud.userId,
    currentHouseholdId:()=>state.household.id,currentProfileId:()=>state.activeProfileId,
    normalizeKey:x=>String(x||'').toLowerCase(),normalizeShoppingListRecord:x=>x,
    normalizeShoppingLists:(lists)=>lists,markShoppingCatalogDirty:()=>actions.push('catalog'),
    mergeShoppingCloudItemsPreservingPending:cloud=>[...state.shopping.filter(x=>x.syncStatus==='pending'),...cloud],
    markShoppingRuntimeDirty:()=>actions.push('runtime'),dedupeShoppingData:()=>{},
    findShoppingCatalogItem:()=>null,cloudRecordConflicts:()=>[],uid:()=>('id-'+actions.length),
    mergeGarageCloudItemsPreservingPending:(local,cloud)=>[...local.filter(x=>x.syncStatus==='pending'),...cloud],
    garageDeletedCloudIds:()=>new Set(),
    keepExistingGarageValue:(next,old)=>next??old,
    keepExistingGarageObject:(next,old)=>next??old,
    vehicleOwnershipStatus:()=> 'owned',fuelTypeFromCloud:x=>x,
    normalizeVehicleIconColor:x=>x||'blue',normalizeVehicleIconShape:x=>x||'car',
    vehicleIconColorFromSettings:()=> 'blue',vehicleIconShapeFromSettings:()=> 'car',
    refreshVehicleIconColorSettings:()=>actions.push('icons'),
    refreshVehicleIconShapeSettings:()=>actions.push('shapes'),
    applyVehicleTechnicalFields:()=>{},normalizeGarageRuntimeState:()=>{},
    touchState:()=>actions.push('touch'),saveState:()=>actions.push('save'),
    render:()=>actions.push('render'),showToast:()=>actions.push('toast'),
    garageVehicleId:null
  };
  return {state,ctx,queries,actions};
};
const fShopping=(e)=>fn('async function cloudLoadShoppingData(', 'async function cloudAddShoppingList(',e.ctx);
const fGarage=(e)=>fn('async function cloudLoadGarageData(', 'async function cloudSyncGarageSubset(',e.ctx);
const resolveShoppingBasic=async(e,lists=[])=>{
  await flush();assert.equal(e.queries.length,4,'four shopping header queries');
  const results=[[],[],[],lists];
  for(let i=0;i<4;i++)e.queries[i].gate.resolve({data:results[i],error:null});
  await flush();
};
const resolveGarage=async(e,sets=[[],[],[]])=>{
  await flush();assert.equal(e.queries.length,3,'garage triple query');
  e.queries.forEach((q,i)=>q.gate.resolve({data:sets[i],error:null}));
};
const snap=e=>JSON.stringify({shopping:e.state.shopping,shoppingLists:e.state.shoppingLists,shoppingCloud:e.state.shoppingCloud,vehicles:e.state.vehicles,fuel:e.state.fuel,services:e.state.services});
for(const changed of ['household','user','profile','localHousehold','localEdit']){
  const e=create(),start=snap(e),job=fShopping(e)();
  await flush();
  if(changed==='household')e.state.cloud.householdId='B';
  else if(changed==='user')e.state.cloud.userId='V';
  else if(changed==='profile')e.state.activeProfileId='profile-B';
  else if(changed==='localHousehold')e.state.household.id='B';
  else e.state.shopping[0].name='My later edit';
  await resolveShoppingBasic(e,[]);
  assert.equal(await job,false,'shopping '+changed);
  assert.equal(snap(e),changed==='localEdit'?snap(e):start,'shopping original workspace not modified');
  assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
  assert.equal(e.actions.length,0);
}
{
 const e=create(),job=fShopping(e)(false);
 await resolveShoppingBasic(e,[{id:'list-cloud',name:'Cloud',created_at:'2026-10-18'}]);
 assert.equal(e.queries.length,5,'items query must happen before mutating list state');
 const start=snap(e);
 e.queries[4].gate.resolve({data:null,error:{message:'offline'}});
 assert.equal(await job,false);
 assert.equal(snap(e),start,'failed items read must keep both original lists and items');
 assert.equal(e.actions.length,0);
}
{
 const e=create(),job=fShopping(e)(false);
 await resolveShoppingBasic(e,[{id:'list-cloud',name:'Cloud'}]);
 const start=snap(e);
 e.state.shopping[0].name='Changed while items fetch';
 e.queries[4].gate.resolve({data:[],error:null});
 assert.equal(await job,false);
 assert.notEqual(snap(e),start);
 assert.equal(e.state.shoppingLists[0].name,'Local');
 assert.equal(e.actions.length,0);
}
{
 const e=create(),job=fShopping(e)(false);
 await resolveShoppingBasic(e,[]);
 assert.equal(await job,true,'empty cloud list is successful complete read');
 assert.equal(e.state.shopping[0].name,'Bread','pending item survives');
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
}
for(const changed of ['household','user','profile','localHousehold','localEdit','partial']){
 const e=create(),job=fGarage(e)(false);
 await flush();
 if(changed==='household')e.state.cloud.householdId='B';
 else if(changed==='user')e.state.cloud.userId='V';
 else if(changed==='profile')e.state.activeProfileId='profile-B';
 else if(changed==='localHousehold')e.state.household.id='B';
 else if(changed==='localEdit')e.state.vehicles[0].name='My garage edit';
 const original=snap(e);
 await resolveGarage(e,changed==='partial'?[null,[],[]]:[[],[],[]]);
 assert.equal(await job,false,'garage '+changed);
 assert.equal(snap(e),original);
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
 assert.equal(e.actions.length,0);
 assert(e.queries.some(q=>q.where.some(([k,v])=>k==='household_id'&&v==='A')));
}
{
 const e=create(),job=fGarage(e)(false);
 await resolveGarage(e);
 assert.equal(await job,true);
 assert.equal(e.state.vehicles[0].name,'Local','unsent car survives');
 assert.equal(e.state.cloud.lastSyncAt,'old-confirmed');
}
const bulk=source.slice(source.indexOf('  async function cloudLoadAllModules('),source.indexOf('  function cloudSyncCompletionState('));
assert(bulk.includes('result !== false && result !== null'),'explicit null cannot count as a loaded component');
assert(bulk.includes('!cloudOutboxHasPermanentFailure()'),'permanent failure prevents successful sync timestamp');
console.log('PASS shopping/garage: atomic read, tenant + profile + local household, pending, partial and truthful timestamp');
