#!/usr/bin/env node
// v0.1_559: Finance loader never replaces local state with partial pages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','finance.js'),'utf8');
function cut(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert(a>=0 && b>a,'Missing finance read section');
 return source.slice(a,b);
}
const factory=new Function('getSupabaseClient','getState','showToast',
 'financeHiddenCloudIds','currentHouseholdId','currentProfileId','todayISO',
 'clearFinanceCloudPendingIfClean','touchState','saveState','render',
 cut('    async function cloudFinanceFetchAll(', '    async function cloudDeleteFinance(item, options = {}) {')+
 '\nreturn cloudLoadFinance;');
const accountRows=[{id:'acct-1',name:'Účet',account_type:'bank',opening_balance:100,include_in_total:true}];
const txRows=Array.from({length:253},(_,i)=>({
 id:'tx-'+String(i).padStart(5,'0'),type:'expense',title:'Platba '+i,amount:i+1,
 transaction_date:'2026-10-16',created_at:'2026-10-16T10:00:00Z',
 updated_at:'2026-10-16T10:01:00Z',account_id:'acct-1'
}));
let state, calls, saves, messages, errorSecond=false, differentCount=false, missingSecond=false;
function reset(){
 state={cloud:{householdId:'home-1'},financeAccounts:[],finance:[],financeCloud:{},trash:[]};
 calls=[];saves=0;messages=[];errorSecond=false;differentCount=false;missingSecond=false;
}
const client={from(table){
 const query={select(){return query;},eq(){return query;},order(){return query;},
  range(start,end){
   calls.push({table,start,end});
   const rows=table==='finance_accounts'?accountRows:txRows;
   if(table==='finance_transactions' && start>0 && errorSecond)
     return Promise.resolve({data:null,error:{message:'Page 2 error'}});
   const data=(table==='finance_transactions' && start>0 && missingSecond)?[]:rows.slice(start,end+1);
   const count=(table==='finance_transactions' && start>0 && differentCount)?rows.length+1:rows.length;
   return Promise.resolve({data,error:null,count});
  }};
 return query;
}};
const load=factory(()=>client,()=>state,msg=>messages.push(msg),()=>new Set(),
 ()=> 'home-1',()=> 'p1',()=> '2026-10-16',()=>false,()=>{},()=>{saves++;},()=>{});
reset();
assert.equal(await load(false),true);
assert.equal(state.finance.length,253);
assert.equal(new Set(state.finance.map(x=>x.cloudId)).size,253);
assert.equal(state.finance[250].accountId,state.financeAccounts[0].id);
assert.deepEqual(calls.filter(x=>x.table==='finance_transactions').map(x=>[x.start,x.end]),[[0,249],[250,499]]);
assert.equal(saves,1);
// Network failure, count change, or unexpectedly empty page abort before any state swap.
for(const failure of ['network','count','empty']){
 reset();
 const original={id:'local',title:'Nesmí zmizet',syncStatus:'pending_add',householdId:'home-1'};
 state.finance=[original];
 if(failure==='network') errorSecond=true;
 if(failure==='count') differentCount=true;
 if(failure==='empty') missingSecond=true;
 assert.equal(await load(false),false,failure);
 assert.equal(state.finance[0],original,failure);
 assert.equal(state.finance.length,1,failure);
 assert.equal(saves,0,failure);
 assert(messages.length>0,failure);
}
console.log('PASS Finance 253-row paginated load, link continuity, count and second-page abort');
