#!/usr/bin/env node
// Finance: executable async INSERT/Undo/outbox race regression. No live DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const finance=readFileSync(join(root,'finance.js'),'utf8');
const app=readFileSync(join(root,'app.js'),'utf8');
const cut=(src,start,end)=>{
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert(a>=0&&b>a,'Missing code section: '+start);
 return src.slice(a,b);
};
const delay=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const history=[],queued=[];
const state={
  cloud:{householdId:'home-1',lastSyncAt:''},
  finance:[],financeAccounts:[],trash:[]
};
const activeUndoTrashIds=new Set(),pendingUndoTrashIds=new Set();
let snapshots=0,notif=0;
const link=new Function(
  'state','normalizeTrashEntries','persistStateSnapshot','activeUndoTrashIds','pendingUndoTrashIds','enqueueTrashCloudDeletes',
  cut(app,'  function linkFinanceLateInsertToTrash(collection, localId, householdId, receipt) {','  function enqueueTrashCloudDeletes(trashIds = []) {')+
  '\nreturn linkFinanceLateInsertToTrash;'
)(
 state,v=>v,()=>{snapshots++;},activeUndoTrashIds,pendingUndoTrashIds,ids=>{
  for(const id of ids){
    const entry=state.trash.find(x=>x.id===id);
    for(const item of entry?.records||[]) if(item.record.cloudId)
      queued.push({collection:item.collection,id:item.record.cloudId,revision:item.record.cloudUpdatedAt||''});
  }
 });
const inserts={finance_transactions:[],finance_accounts:[]};
const client={from(table){
 assert(table in inserts,'Unexpected table '+table);
 return {insert(payload){return {select(){return {single(){
  return new Promise(resolve=>inserts[table].push({payload,resolve}));
 }};}};}};
}};
const record=(id,title)=>({id,title,amount:123,type:'expense',syncStatus:'pending_add',householdId:'home-1'});
const transaction=new Function('getSupabaseClient','getState','refreshCloudSession',
 'ensureFinanceTransactionAccounts','cloudFinancePayload','financeTransactionAccountsBound',
 'showToast','linkFinanceLateInsertToTrash','markFinanceCloudPending','persistStateSnapshot',
 cut(finance,'    const financeTransactionInsertInFlight = new Map();','    async function cloudFinanceRow(')+
 '\nreturn {cloudAddFinance,financeTransactionInsertConfirmed};'
)(
 ()=>client,()=>state,async()=>({id:'user'}),
 async()=>true,(item,user)=>({household_id:state.cloud.householdId,title:item.title,amount:item.amount,created_by:user}),
 ()=>true,()=>{notif++;},link,reason=>history.push(reason),()=>{snapshots++;}
);
const account=new Function('getSupabaseClient','getState','refreshCloudSession',
 'cloudFinanceAccountPayload','showToast','linkFinanceLateInsertToTrash','markFinanceCloudPending','persistStateSnapshot',
 cut(finance,'    const financeAccountInsertInFlight = new Map();','    function financeCloudUpdateAcknowledged(')+
 '\nreturn {cloudAddFinanceAccount,financeAccountInsertConfirmed};'
)(
 ()=>client,()=>state,async()=>({id:'user'}),
 (item,user)=>({household_id:state.cloud.householdId,name:item.name,created_by:user}),
 ()=>{notif++;},link,reason=>history.push(reason),()=>{snapshots++;}
);

// Form autosync + manual sync on same item share exactly one INSERT.
{
 const item=record('a','Pohyb');
 state.finance=[item];
 const first=transaction.cloudAddFinance(item);
 const second=transaction.cloudAddFinance(item);
 await delay();
 assert.equal(inserts.finance_transactions.length,1,'double form/autosync caused duplicate transaction');
 inserts.finance_transactions.shift().resolve({data:{id:'remote-a',updated_at:'2026-10-16T08:00:00Z'},error:null});
 const results=await Promise.all([first,second]);
 assert.equal(results[0]?.id,'remote-a');assert.equal(results[1]?.id,'remote-a');
 assert.equal(item.cloudId,'remote-a');assert.equal(item.syncStatus,'');
 assert(transaction.financeTransactionInsertConfirmed(item,results[0]));
}

// Edited while INSERT is awaiting DB, newest immutable object retains pending_update.
{
 const old=record('b','Starý');
 state.finance=[old];
 const first=transaction.cloudAddFinance(old);
 await delay();
 const current={...old,title:'Nový'};
 state.finance=[current];
 inserts.finance_transactions.shift().resolve({data:{id:'remote-b',updated_at:'2026-10-16T08:01:00Z'},error:null});
 assert.equal(await first,null);
 assert.equal(current.cloudId,'remote-b');assert.equal(current.syncStatus,'pending_update');
 assert(history.includes('finance-transaction-changed-during-insert'));
 assert.equal(transaction.financeTransactionInsertConfirmed(old,{id:'remote-b'}),false);
}

// Deleted during INSERT; receipt must enter durable trash but not delete until Undo expires.
{
 const item=record('c','Smazaný');
 state.finance=[item];
 const promise=transaction.cloudAddFinance(item);
 await delay();
 state.finance=[];
 state.trash=[{id:'trash-c',records:[{collection:'finance',record:{id:'c',householdId:'home-1'}}]}];
 activeUndoTrashIds.add('trash-c');
 inserts.finance_transactions.shift().resolve({data:{id:'remote-c',updated_at:'2026-10-16T08:02:00Z'},error:null});
 assert.equal(await promise,null);
 assert.equal(item.cloudId,'remote-c');
 assert.equal(state.trash[0].records[0].record.cloudId,'remote-c');
 assert.equal(state.trash[0].records[0].record.cloudUpdatedAt,'2026-10-16T08:02:00Z');
 assert.equal(queued.length,0,'database DELETE must not happen before undo deadline');
 activeUndoTrashIds.delete('trash-c');
 assert(link('finance','c','home-1',{id:'remote-c',updated_at:'2026-10-16T08:02:00Z'}));
 assert.deepEqual(queued.pop(),{collection:'finance',id:'remote-c',revision:'2026-10-16T08:02:00Z'});
}

// Account creation finishing after deletion must be linked to account archival outbox.
{
 const item={id:'d',name:'Pokladna',householdId:'home-1',syncStatus:'pending_add'};
 state.financeAccounts=[item];
 const pending=account.cloudAddFinanceAccount(item);
 await delay();
 state.financeAccounts=[];
 state.trash=[{id:'trash-d',records:[{collection:'financeAccounts',record:{id:'d',householdId:'home-1'}}]}];
 inserts.finance_accounts.shift().resolve({data:{id:'remote-d'},error:null});
 assert.equal(await pending,null);
 assert.equal(item.cloudId,'remote-d');
 assert.equal(state.trash[0].records[0].record.cloudId,'remote-d');
 assert.deepEqual(queued.pop(),{collection:'financeAccounts',id:'remote-d',revision:''});
}

// Failed INSERT is not acknowledged, and a later retry is allowed.
{
 const item=record('e','Chyba sítě');state.finance=[item];
 const a=transaction.cloudAddFinance(item);await delay();
 inserts.finance_transactions.shift().resolve({data:null,error:{message:'offline'}});
 assert.equal(await a,null);assert.equal(item.cloudId,undefined);
 const b=transaction.cloudAddFinance(item);await delay();
 assert.equal(inserts.finance_transactions.length,1);
 inserts.finance_transactions.shift().resolve({data:{id:'remote-e',updated_at:'rev-e'},error:null});
 assert.equal((await b)?.id,'remote-e');
}
// Never append a remote ACK to a different household's trash.
assert.equal(link('finance','c','wrong-home',{id:'remote-x'}),false);
assert(snapshots>=3);
console.log('PASS finance concurrent insert, modified snapshot, late delete, Undo, archival and retry');
