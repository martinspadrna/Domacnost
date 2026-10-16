#!/usr/bin/env node
// P0 Finance v558: úprava cloudově navázané domácnosti i bez právě dostupného userId.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root=join(dirname(fileURLToPath(import.meta.url)), '..');
const financeSource=readFileSync(join(root,'finance.js'),'utf8');
const win={};
runInNewContext(financeSource,{window:win,console,Date,setTimeout});
assert.equal(typeof win.DomacnostFinance.createFinance,'function');
const remoteAccount={id:'account-remote',name:'Původní cloud',account_type:'bank',opening_balance:50,include_in_total:true};
const remoteMove={id:'move-remote',type:'expense',title:'Původní cloud',amount:10,transaction_date:'2026-10-16',account_id:'account-remote',updated_at:'2026-10-16T05:00:00Z'};
function client(){
  return {from(table){
    let orders=0;
    const q={select(){return q;},eq(){return q;},order(){
      orders++;
      if(table==='finance_accounts'||orders===2) return Promise.resolve({data:table==='finance_accounts'?[remoteAccount]:[remoteMove],error:null});
      return q;
    }};
    return q;
  }};
}
let serial=0;
function harness(cloud) {
  const state={
    cloud:{provider:'supabase',householdId:'home1',lastSyncAt:'2026-10-15T05:00:00Z',...cloud},
    financeAccounts:[],finance:[],financeCloud:{},trash:[]
  };
  const snapshots=[];
  const api=win.DomacnostFinance.createFinance({
    getState:()=>state, cloudReady:()=>Boolean(state.cloud.userId),
    getSupabaseClient:()=>client(), uid:()=>String(++serial),
    todayISO:()=> '2026-10-16',currentHouseholdId:()=> 'home1',currentProfileId:()=> 'p1',
    normalizeText:v=>String(v??'').trim(),decimalValue:v=>Number(v)||0,
    saveState:()=>snapshots.push(JSON.parse(JSON.stringify({finance:state.finance,accounts:state.financeAccounts,cloud:state.financeCloud}))),
    touchState:()=>{},render:()=>{},requestRender:()=>{},persistStateSnapshot:()=>{},
    showToast:()=>{},setFinanceEditId:()=>{},setFinanceAccountEditId:()=>{},setFinanceCopyId:()=>{},
    parseDateValue:v=>new Date(v),clearFinanceCloudPendingIfClean:()=>false,
    yieldToMainThread:()=>Promise.resolve()
  });
  return {state,api,snapshots};
}
const form={reset(){}};
let {state,api,snapshots}=harness({userId:''});
await api.addFinanceAccountFromForm({name:'Lokální účet'},form);
assert.equal(state.financeAccounts[0].syncStatus,'pending_add');
assert(state.financeCloud.pendingAt);
assert.equal(snapshots.at(-1).accounts[0].syncStatus,'pending_add','pending must persist before save');
state.financeAccounts=[{id:'acct',cloudId:'account-remote',name:'Starý účet',accountType:'bank',householdId:'home1'}];
await api.updateFinanceAccountFromForm('acct',{name:'Novější účet'},form);
assert.equal(state.financeAccounts[0].syncStatus,'pending_update');
assert.equal(snapshots.at(-1).accounts[0].name,'Novější účet');

state.finance=[{id:'tx',cloudId:'move-remote',cloudUpdatedAt:'2026-10-16T05:00:00Z',title:'Starý pohyb',amount:10,type:'expense',date:'2026-10-16',accountId:'acct',householdId:'home1'}];
await api.updateFinanceFromForm('tx',{title:'Novější pohyb',amount:'22',date:'2026-10-16',type:'expense',accountId:'acct'},form);
assert.equal(state.finance[0].syncStatus,'pending_update');
assert.equal(snapshots.at(-1).finance[0].title,'Novější pohyb');
assert.equal(await api.cloudLoadFinance(false),true);
assert.equal(state.financeAccounts[0].name,'Novější účet','remote may not overwrite unsent account');
assert.equal(state.finance[0].title,'Novější pohyb','remote may not overwrite unsent movement');

await api.addFinanceFromForm({title:'Nový pohyb',type:'expense',amount:'30',date:'2026-10-16'},form);
assert.equal(state.finance.at(-1).syncStatus,'pending_add');
assert.equal(snapshots.at(-1).finance.at(-1).syncStatus,'pending_add');

await api.copyFinanceToMonths('tx',{firstMonth:'2026-11',count:2,day:12},form);
assert.equal(state.finance.filter(x=>!x.cloudId&&x.syncStatus==='pending_add').length,3);
assert(state.finance.filter(x=>!x.cloudId).every(x=>!x.cloudUpdatedAt),'copy must not inherit remote revision');

({state,api}=harness({provider:'local',householdId:'',userId:''}));
await api.addFinanceAccountFromForm({name:'Jen v zařízení'},form);
assert.equal(state.financeAccounts[0].syncStatus,undefined,'local-only workspace should not get cloud pending');
assert.equal(state.financeCloud.pendingAt,undefined);
assert(!financeSource.includes('getState().cloud.lastSyncAt = new Date().toISOString();'),
  'per-record cloud actions must not claim full cloud synchronization');
console.log('PASS finance disconnected account/movement/copy pending persistence, safe cloud reload, local-only and truthful sync time');
