#!/usr/bin/env node
// P0 Finance v578: batch must stop when active user/profile/local household changes
// during awaited sync, without touching unrelated state or sending more rows.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const text=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','finance.js'),'utf8');
const begin=text.indexOf('    function financeSyncBatchScope() {');
const end=text.indexOf('    // Smazání jde přes společný Koš',begin);
assert(begin>=0&&end>begin,'Missing production scoped Finance sync code');
const slice=text.slice(begin,end);
const defer=()=>{let resolve;const promise=new Promise(fn=>resolve=fn);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function harness(){
 const accounts=[
  {id:'a1',cloudId:'ca1',syncStatus:'pending_update'},
  {id:'a2',cloudId:'ca2',syncStatus:'pending_update'}
 ];
 const finance=[
  {id:'f1',cloudId:'cf1',syncStatus:'pending_update'},
  {id:'f2',cloudId:'cf2',syncStatus:'pending_update'}
 ];
 const state={cloud:{userId:'u1',householdId:'h1'},activeProfileId:'p1',household:{id:'h1'},financeAccounts:accounts,finance};
 const gates=[],calls=[],log=[];
 const updater=(kind)=>(item)=>{
  const gate=defer();calls.push({kind,id:item.id});gates.push(gate);return gate.promise;
 };
 const deps={
  getState:()=>state,currentProfileId:()=>state.activeProfileId,currentHouseholdId:()=>state.household.id,
  cloudUpdateFinanceAccount:updater('account'),cloudAddFinanceAccount:updater('newaccount'),
  cloudUpdateFinance:updater('finance'),cloudAddFinance:updater('newfinance'),
  financeAccountInsertConfirmed:()=>false,financeTransactionInsertConfirmed:()=>false,
  clearFinanceCloudPendingIfClean:()=>false,markFinanceCloudPending:v=>log.push('pending:'+v),
  persistStateSnapshot:()=>log.push('persist'),requestRender:()=>log.push('requestRender'),
  saveState:()=>log.push('save'),touchState:()=>log.push('touch'),render:()=>log.push('render'),
  showToast:()=>log.push('toast'),yieldToMainThread:async()=>{}
 };
 const api=new Function(...Object.keys(deps),slice+
  '\nreturn {cloudSyncFinanceAccountById,cloudSyncLocalFinanceAccounts,cloudSyncFinanceById,cloudSyncLocalFinance,cloudSyncAllFinance};')(...Object.values(deps));
 return {api,state,calls,gates,log,accounts,finance};
}
function changeScope(e,kind){
 if(kind==='user') e.state.cloud.userId='u2';
 else if(kind==='profile') e.state.activeProfileId='p2';
 else if(kind==='localHousehold') e.state.household.id='h2';
 else e.state.cloud.householdId='h2';
}
for(const fnName of ['cloudSyncLocalFinanceAccounts','cloudSyncLocalFinance','cloudSyncFinanceAccountById','cloudSyncFinanceById']){
 for(const switchType of ['user','profile','localHousehold','cloudHousehold']){
  const e=harness();
  const arg=fnName.endsWith('ById')?(fnName.includes('Account')?'a1':'f1'):undefined;
  const job=e.api[fnName](arg);
  await flush();
  assert.equal(e.calls.length,1,fnName+' first request');
  changeScope(e,switchType);
  e.gates[0].resolve(true);
  await job;
  assert.equal(e.calls.length,1,fnName+' must not enqueue next request after '+switchType);
  assert.equal(e.log.length,0,fnName+' must not persist/toast into new scope '+switchType);
  assert.equal(e.accounts[0].syncStatus,'pending_update');
  assert.equal(e.finance[0].syncStatus,'pending_update');
 }
}
for(const collection of ['cloudSyncLocalFinanceAccounts','cloudSyncLocalFinance']){
 const e=harness(),job=e.api[collection]();
 await flush();e.gates[0].resolve(true);await flush();
 assert.equal(e.calls.length,2,'unchanged scope must proceed to second row');
 e.gates[1].resolve(true);
 assert.equal(await job,2);
 assert(e.log.includes('save'),'completed batch persisted');
 assert(e.log.includes('toast'),'completed batch reported status');
 const list=collection.includes('Accounts')?e.accounts:e.finance;
 assert(list.every(x=>x.syncStatus===''));
}
{
 const e=harness(),job=e.api.cloudSyncAllFinance();
 await flush();
 e.gates[0].resolve(true);await flush();
 assert.equal(e.calls.length,2);
 e.gates[1].resolve(true);await flush();
 assert.equal(e.calls.length,3,'all-finance runs movements only after accounts finish');
 e.gates[2].resolve(true);await flush();
 assert.equal(e.calls.length,4);
 e.gates[3].resolve(true);
 assert.equal(await job,4);
}
{
 const e=harness(),job=e.api.cloudSyncAllFinance();
 await flush();e.gates[0].resolve(true);await flush();
 changeScope(e,'profile');
 e.gates[1].resolve(true);
 assert.equal(await job,1,'count only confirmed old-scope accounts before profile switch');
 assert.equal(e.calls.length,2,'scope switch must abort before finance movements');
 assert(!e.log.includes('save'),'no saving stale sync into switched workspace');
}
console.log('PASS Finance batches v578: account/movement/single-id/full sync scoped across awaited writes and no stale ACK');
