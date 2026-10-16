#!/usr/bin/env node
// P0 cloud / finance: late SELECT cannot overwrite a newer local edit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const financeSource = readFileSync(join(root, 'finance.js'), 'utf8');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');
function between(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'Missing source section '+start);
  return src.slice(a,b);
}
let state, renders, saves, requests, showToasts;
const household='h1';
const createClient=()=>{
  requests=[];
  return {from(table){
    assert(['finance_accounts','finance_transactions'].includes(table));
    let resolveRequest;
    const result=new Promise(resolve=>{resolveRequest=resolve;});
    const query={
      select(){return query;},eq(){return query;},order(){return query;},
      range(start,end){requests.push({table,start,end,resolve:resolveRequest});return result;}
    };
    return query;
  }};
};
const factory=new Function('getSupabaseClient','getState','showToast',
  'financeHiddenCloudIds','currentHouseholdId','currentProfileId','todayISO',
  'clearFinanceCloudPendingIfClean','touchState','saveState','render',
  between(financeSource,'    async function cloudFinanceFetchAll(',
    '    async function cloudDeleteFinance(item, options = {}) {')+
  '\nreturn cloudLoadFinance;');
let client=createClient();
const load=factory(()=>client,()=>state,m=>showToasts.push(m),
  collection=>new Set((state.trash||[]).flatMap(entry=>(entry.records||[])
    .filter(x=>x.collection===collection && x.record.cloudId)
    .map(x=>String(x.record.cloudId)))),
  ()=>household,()=> 'p',()=> '2026-10-16',()=>false,
  ()=>{},()=>{saves++;},()=>{renders++;});

const accountRow={
  id:'acct-cloud',name:'Účet v cloudu',account_type:'bank',
  owner_label:null,opening_balance:0,include_in_total:true,note:null,
  created_at:'2026-01-01T00:00:00Z'
};
const txRow={
  id:'tx-cloud',type:'expense',title:'Starý cloud',amount:120,
  transaction_date:'2026-10-16',payment_method:'card',note:'',
  created_at:'2026-10-16T08:00:00Z',updated_at:'2026-10-16T08:05:00Z',
  account_id:'acct-cloud',transfer_account_id:null
};
const tick=async()=>{for(let i=0;i<8;i++) await Promise.resolve();};
const reset=()=>{
  state={
    cloud:{householdId:household},
    financeAccounts:[],finance:[],financeCloud:{},trash:[]
  };
  client=createClient();renders=0;saves=0;showToasts=[];
};
reset();
let promise=load(false);
assert.equal(requests.length,1);
requests.shift().resolve({data:[accountRow],error:null,count:1});
await tick();
assert.equal(requests.length,1);
state.financeAccounts.push({
  id:'local-account', householdId:household,name:'Novější lokální účet',
  syncStatus:'pending_add'
});
requests.shift().resolve({data:[txRow],error:null,count:1});
assert.equal(await promise,false);
assert.equal(state.financeAccounts.length,1);
assert.equal(state.financeAccounts[0].name,'Novější lokální účet');
assert.equal(state.finance.length,0);
assert.equal(renders,0);
assert.equal(saves,0);

// A normal, unchanged read still commits cloud rows and preserves account linkage.
reset();
promise=load(false);
requests.shift().resolve({data:[accountRow],error:null,count:1});
await tick();
requests.shift().resolve({data:[txRow],error:null,count:1});
assert.equal(await promise,true);
assert.equal(state.financeAccounts[0].cloudId,'acct-cloud');
assert.equal(state.finance[0].cloudId,'tx-cloud');
assert.equal(state.finance[0].accountId,state.financeAccounts[0].id);
assert.equal(renders,1);

// Trash may change AFTER the first SELECT and before the transactions SELECT.
// Recheck tombstones immediately before committing staged remote data.
reset();
promise=load(false);
requests.shift().resolve({data:[accountRow],error:null,count:1});
await tick();
state.trash=[{records:[{collection:'finance',record:{
  id:'deleted-local',cloudId:'tx-cloud',householdId:household
}}]}];
requests.shift().resolve({data:[txRow],error:null,count:1});
assert.equal(await promise,true);
assert.equal(state.finance.length,0,'deleted cloud row should not resurrect');
assert.equal(state.financeAccounts.length,1);

// The recovery count is visible before a scheduled autosync or manual sync begins.
const cloudOverview=between(appSource,
  '  function getCloudSyncOverviewItems() {',
  '  function garageVehicleCloudDifference(');
assert(cloudOverview.includes('const recoverableFinanceDeletes = recoverableFinanceTrashDeleteIds();'));
assert(cloudOverview.includes('normalizeCloudOutbox(state.cloud?.outbox || []).length + recoverableFinanceDeletes.length'));
const pendingSync=between(appSource,
  '  async function cloudSyncLocalPendingData(showMessage = true) {',
  '  async function cloudWarmStartLoad(');
assert(pendingSync.includes('recoverFinanceTrashCloudDeletes();'));
assert(pendingSync.indexOf('recoverFinanceTrashCloudDeletes();') <
  pendingSync.indexOf('{ run: replayCloudOutbox }'),
  'manual sync must recover missing deletes before replay');
console.log('PASS finance delayed remote SELECT, late trash, manual recovery and pending visibility');
