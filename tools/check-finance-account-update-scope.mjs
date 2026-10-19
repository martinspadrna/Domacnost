#!/usr/bin/env node
// P0 Finance v577: delayed finance_accounts UPDATE must never confirm a
// response in another account, profile, household or replaced local record.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(join(root,'finance.js'),'utf8');
const first=source.indexOf('    async function cloudUpdateFinanceAccount(account) {');
const last=source.indexOf('    function cloudFinancePayload(item, userId)', first);
assert(first>=0 && last>first);
const slice=source.slice(first,last);
const defer=()=>{let resolve;const promise=new Promise(fn=>resolve=fn);return {resolve,promise};};
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function harness() {
 const row={id:'local-account',cloudId:'cloud-account',name:'Local edited',openingBalance:100,syncStatus:'pending_update'};
 const state={cloud:{householdId:'h1',userId:'u1'},household:{id:'h1'},activeProfileId:'p1',financeAccounts:[row]};
 const requests=[],toasts=[],session=defer();
 const client={from(table){
  assert.equal(table,'finance_accounts');
  return {update(payload){
   const gate=defer(),filters=[],q={eq(k,v){filters.push([k,v]);return q;},select(){return q;},maybeSingle(){return gate.promise;}};
   requests.push({payload,gate,filters});return q;
  }};
 }};
 const deps={
  getSupabaseClient:()=>client,getState:()=>state,
  currentProfileId:()=>state.activeProfileId,currentHouseholdId:()=>state.household.id,
  refreshCloudSession:()=>session.promise,
  cloudFinanceAccountPayload:(account,userId)=>({household_id:state.cloud.householdId,name:account.name,opening_balance:account.openingBalance,created_by:userId}),
  financeCloudUpdateAcknowledged:(receipt,id)=>Boolean(receipt?.id===id),showToast:value=>toasts.push(value)
 };
 const api=new Function(...Object.keys(deps),slice+'\nreturn cloudUpdateFinanceAccount;')(...Object.values(deps));
 return {row,state,requests,toasts,session,api};
}
{
 const e=harness(),job=e.api(e.row);
 e.session.resolve({id:'u1'});await flush();
 assert.equal(e.requests.length,1);
 assert(e.requests[0].filters.some(([k,v])=>k==='household_id'&&v==='h1'));
 e.requests[0].gate.resolve({data:{id:'cloud-account'},error:null});
 assert.equal(await job,true);
}
for(const scenario of ['user','profile','localHousehold','replacement','edit','cloudId']) {
 const e=harness(),job=e.api(e.row);
 e.session.resolve({id:'u1'});await flush();
 assert.equal(e.requests.length,1);
 if(scenario==='user')e.state.cloud.userId='u2';
 if(scenario==='profile')e.state.activeProfileId='p2';
 if(scenario==='localHousehold')e.state.household.id='h2';
 if(scenario==='replacement')e.state.financeAccounts=[{...e.row}];
 if(scenario==='edit')e.row.name='Edited while in flight';
 if(scenario==='cloudId')e.row.cloudId='other-cloud';
 e.requests[0].gate.resolve({data:{id:'cloud-account'},error:null});
 assert.equal(await job,false,scenario+' must not ACK stale account');
 assert.equal(e.row.syncStatus,'pending_update');
 assert.equal(e.toasts.length,0,'do not toast old scope');
}
for(const scenario of ['user','profile','localHousehold','replacement']) {
 const e=harness(),job=e.api(e.row);
 if(scenario==='user')e.state.cloud.userId='u2';
 if(scenario==='profile')e.state.activeProfileId='p2';
 if(scenario==='localHousehold')e.state.household.id='h2';
 if(scenario==='replacement')e.state.financeAccounts=[{...e.row}];
 e.session.resolve({id:'u1'});await flush();
 assert.equal(await job,false,scenario+' must not send stale UPDATE');
 assert.equal(e.requests.length,0);
}
{
 const e=harness(),job=e.api(e.row);
 e.session.resolve({id:'u1'});await flush();
 e.requests[0].gate.resolve({data:null,error:null});
 assert.equal(await job,false,'0 matching rows are not a successful account update');
 assert.equal(e.row.syncStatus,'pending_update');
}
console.log('PASS Finance account UPDATE: late user/profile/workspace ACK, replaced row, edit, no remote match');
