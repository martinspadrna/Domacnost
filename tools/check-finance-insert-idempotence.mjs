#!/usr/bin/env node
// P0 Finance v584: retry of one logical INSERT must never create a second
// row even if server committed the first one before the reply was lost.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const finance = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'finance.js'), 'utf8');
const cut = (start,end) => {
  const a=finance.indexOf(start), b=finance.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'missing source: '+start);
  return finance.slice(a,b);
};
const source = cut('    const FINANCE_INSERT_UUID =','    // Per-instance single-flight;')+
  cut('    const financeAccountInsertInFlight = new Map();','    function financeCloudUpdateAcknowledged(')+
  cut('    const financeTransactionInsertInFlight = new Map();','    async function cloudFinanceRow(');
const tick = async()=>{for(let n=0;n<35;n++)await Promise.resolve();};
function harness(mode='ok') {
  let responseMode=mode;
  const state={cloud:{householdId:'house-one',userId:'member-1'},
    household:{id:'house-one'},activeProfileId:'profile-one',financeAccounts:[],finance:[]};
  const tables={finance_accounts:new Map(),finance_transactions:new Map()};
  const inserts=[],reads=[],pending=[],toasts=[],snapshots=[];
  const client={from(table) {
    assert(tables[table],table);
    return {
      insert(payload) {
        return {select(columns) {
          assert(columns.includes('id'));
          return {async single() {
            inserts.push({table,payload:structuredClone(payload)});
            const exists=tables[table].get(payload.id);
            if(exists) return {data:null,error:{code:'23505',message:'duplicate key'}};
            if(responseMode==='offline') return {data:null,error:{message:'network unreachable'}};
            const row={...payload,updated_at:'revision-1'};
            if(responseMode==='changed') row.note='DIFFERENT REMOTE';
            tables[table].set(payload.id,row);
            if(responseMode==='lost'||responseMode==='changed') return {data:null,error:{message:'response lost'}};
            return {data:{id:payload.id,updated_at:'revision-1'},error:null};
          }};
        }};
      },
      select(cols) {
        const eqs=[],query={eq(k,v){eqs.push([k,v]);return query;},
          async maybeSingle() {
            reads.push({table,cols,eqs:[...eqs]});
            const id=eqs.find(([k])=>k==='id')?.[1];
            const household=eqs.find(([k])=>k==='household_id')?.[1];
            const row=tables[table].get(id);
            return {data:row && row.household_id===household?structuredClone(row):null,error:null};
          }};
        return query;
      }
    };
  }};
  const deps={
    getSupabaseClient:()=>client,getState:()=>state,
    refreshCloudSession:async()=>({id:'member-1'}),
    currentProfileId:()=>state.activeProfileId,
    currentHouseholdId:()=>state.household.id,
    cloudFinanceAccountPayload:(entry,user)=>({household_id:state.cloud.householdId,
      name:entry.name,opening_balance:entry.openingBalance||0,note:entry.note||null,
      created_by:user,updated_by:user}),
    cloudFinancePayload:(entry,user)=>({household_id:state.cloud.householdId,
      title:entry.title,amount:entry.amount,note:entry.note||null,created_by:user,updated_by:user}),
    ensureFinanceTransactionAccounts:async()=>true,
    financeTransactionAccountsBound:()=>true,
    markFinanceCloudPending:reason=>pending.push(reason),
    persistStateSnapshot:()=>snapshots.push(structuredClone({
      accounts:state.financeAccounts,finance:state.finance})),
    showToast:message=>toasts.push(message),
    linkFinanceLateInsertToTrash:()=>false
  };
  const api=new Function(...Object.keys(deps),source+'\nreturn {cloudAddFinance,cloudAddFinanceAccount};')(...Object.values(deps));
  return {state,setMode(value){responseMode=value;},tables,inserts,reads,pending,toasts,snapshots,...api};
}
const newAccount=(id='local')=>({id,name:'Cash',openingBalance:2,syncStatus:'pending_add'});
const newTx=(id='tx')=>({id,title:'Buy',amount:7,type:'expense',syncStatus:'pending_add'});
async function runCase(kind,mode) {
  const e=harness(mode),account=kind==='account',rec=account?newAccount():newTx();
  (account?e.state.financeAccounts:e.state.finance).push(rec);
  const result=await (account?e.cloudAddFinanceAccount(rec):e.cloudAddFinance(rec));
  return {e,rec,result,table:account?'finance_accounts':'finance_transactions'};
}
for (const kind of ['account','transaction']) {
  {
    const {e,rec,result,table}=await runCase(kind,'lost');
    assert.equal(e.inserts.length,1);
    assert.equal(e.tables[table].size,1);
    assert.match(rec.cloudInsertId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(result?.id,rec.cloudInsertId,'lost server ACK must be recovered from exact remote row');
    assert.equal(rec.cloudId,rec.cloudInsertId);
    assert.equal(rec.syncStatus,'');
    assert.equal(e.reads.length,1,'ambiguous write must verify remote data');
    assert(e.snapshots.length>=2,'stable UUID must be persisted before network and final ACK');
  }
  {
    const e=harness('offline'),rec=kind==='account'?newAccount():newTx();
    (kind==='account'?e.state.financeAccounts:e.state.finance).push(rec);
    const write=kind==='account'?e.cloudAddFinanceAccount:e.cloudAddFinance;
    assert.equal(await write(rec),null);
    const sameId=rec.cloudInsertId;
    assert.match(sameId,/^[0-9a-f-]{36}$/i);
    assert.equal(e.tables[kind==='account'?'finance_accounts':'finance_transactions'].size,0);
    assert.equal(e.snapshots[0][kind==='account'?'accounts':'finance'][0].cloudInsertId,sameId,
      'UUID must survive the saved snapshot before any remote ACK');
    // Simulate app restart: replace the active object with its persisted copy.
    const restored=structuredClone(e.snapshots[0][kind==='account'?'accounts':'finance'][0]);
    if(kind==='account') e.state.financeAccounts=[restored]; else e.state.finance=[restored];
    e.setMode('ok');
    const receipt=await write(restored);
    assert.equal(receipt?.id,sameId);
    assert.equal(restored.cloudId,sameId);
    assert.equal(restored.cloudInsertId,sameId,'restart retry must not generate a new UUID');
    assert.equal(e.inserts.length,2);
    assert.equal(e.tables[kind==='account'?'finance_accounts':'finance_transactions'].size,1);
  }
  {
    const {e,rec,result,table}=await runCase(kind,'changed');
    assert.equal(result,null,'remote different payload cannot be acknowledged');
    assert.equal(rec.cloudId,undefined);
    assert.equal(rec.syncStatus,'pending_add');
    assert.equal(e.tables[table].size,1,'server already committed first request');
    assert.equal(await (kind==='account'?e.cloudAddFinanceAccount(rec):e.cloudAddFinance(rec)),null);
    assert.equal(e.tables[table].size,1,'PK blocks duplicate on retry');
    assert.equal(e.inserts[0].payload.id,e.inserts[1].payload.id);
  }
}
// Two independent records that happen to have the same title never share an ID.
{
  const e=harness(),a=newTx('a'),b=newTx('b');e.state.finance=[a,b];
  await Promise.all([e.cloudAddFinance(a),e.cloudAddFinance(b)]);
  assert.notEqual(a.cloudInsertId,b.cloudInsertId);
  assert.equal(e.tables.finance_transactions.size,2);
}
// A UUID belonging to a different household is NOT an ACK for this household.
{
  const e=harness('lost'),tx=newTx();e.state.finance=[tx];
  const uuid='6d1aabb0-f8e4-443c-a15f-989d91736a11';
  tx.cloudInsertId=uuid;
  e.tables.finance_transactions.set(uuid,{household_id:'another-home',id:uuid,title:tx.title,amount:tx.amount,
    created_by:'member-1',updated_by:'member-1',note:null,updated_at:'rev'});
  assert.equal(await e.cloudAddFinance(tx),null);
  assert.equal(tx.cloudId,undefined);
  assert.equal(tx.syncStatus,'pending_add');
}
console.log('PASS P0 v584 stable UUID: ambiguous ACK recovery, mismatch, retry, tenant guard, distinct records');
