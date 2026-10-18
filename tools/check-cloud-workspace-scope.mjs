#!/usr/bin/env node
// P0 v562: opožděný sync ani cloud read původní domácnosti nesmí pokračovat v nové.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const slice=(a,b)=>{
  const from=src.indexOf('  '+a), to=src.indexOf('  '+b,from+a.length);
  assert(from>=0 && to>from,'Missing function '+a);
  return src.slice(from,to);
};
const compile=(a,b,env,prelude='')=>{
  const parts=Object.keys(env);
  return new Function(...parts,prelude+'\n'+slice(a,b)+'\nreturn '+a.match(/function\s+([A-Za-z0-9_]+)/)[1]+';')(...parts.map(x=>env[x]));
};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const home=(id,user='user1')=>({householdId:id,userId:user,provider:'supabase',outbox:[],autosyncStatus:'idle',lastSyncAt:'original'});
const make=()=>{
  const state={cloud:home('a')};
  const calls=[],saved=[],timers=[];
  const stub=()=>{};
  const ctx={
    state,
    console,
    window:{setTimeout:()=>0},
    cloudReady:()=>Boolean(state.cloud?.householdId && state.cloud?.userId),
    cloudSyncWorkspaceScope:()=>({householdId:state.cloud.householdId,userId:state.cloud.userId}),
    cloudSyncWorkspaceMatches:(x)=>Boolean(x?.householdId===state.cloud.householdId && x?.userId===state.cloud.userId && ctx.cloudReady()),
    withDeferredRender:(f)=>f(),
    withMutedToasts:(f)=>f(),
    yieldToMainThread:async()=>{},
    cloudLocalPendingCount:()=>1,
    cloudHasBlockingConflict:()=>false,
    cloudOutboxHasPermanentFailure:()=>false,
    clearCloudAutosyncTimer:stub,
    setupCloudRealtimeSubscriptions:()=>calls.push('realtime'),
    persistStateSnapshot:()=>saved.push(state.cloud.householdId),
    saveState:()=>saved.push(state.cloud.householdId),
    touchState:stub,
    render:stub,
    requestBackgroundRender:stub,
    scheduleCloudAutosync:(...args)=>timers.push(args),
    showToast:stub,
    console,
    ensureModuleCode:async()=>{},
    moduleCodeReady:()=>true,
    cleanupProviderManagedCalendarSyncArtifacts:stub,
    healStaleHouseholdUiConflict:stub,
    browserAppearsOnline:()=>true,
    recoverFinanceTrashCloudDeletes:stub,
    ensurePendingCloudModuleCode:async()=>{},
    runWhenMainThreadFree:stub,
    householdUiHasPendingChanges:()=>false,
    cloudExtraPendingCount:()=>0,
    cloudSaveHouseholdUiSettings:async()=>true,
    cloudLoadAllModules:async()=>({loaded:1,total:1}),
    cloudLoadHouseholds:async()=>[],
    cloudSyncCompletionState:()=>({complete:true,pending:0,blocked:false,incompleteLoad:false}),
    persistModuleTabsSoon:stub,
    registerCloudRecordConflict:stub,
    scheduleAutomaticDataIntegrityAudit:stub,
    scheduleCalendarAutoSync:stub,
    cloudLoadModuleForNav:async()=>true,
    // All function references in the pending-sync dispatch table.
    replayCloudOutbox:async()=>true,
    cloudSyncLocalProfiles:async()=>true,
    cloudSyncLocalShoppingItems:async()=>true,
    cloudSyncLocalContracts:async()=>true,
    cloudSyncLocalContractFiles:async()=>true,
    cloudSyncLocalWarrantyFiles:async()=>true,
    cloudSyncLocalGarage:async()=>true,
    cloudSyncLocalHdo:async()=>true,
    cloudSyncLocalWaste:async()=>true,
    cloudSyncLocalTasks:async()=>true,
    cloudSyncLocalCalendarSources:async()=>true,
    cloudSyncLocalCalendar:async()=>true,
    cloudSyncLocalFinanceAccounts:async()=>true,
    cloudSyncLocalFinance:async()=>true,
    // Bulk/load dependencies.
    cloudLoadUserVisualSettings:async()=>true,
    cloudLoadHouseholdUiSettings:async()=>true,
    cloudLoadProfilesForCurrentHousehold:async()=>true,
    cloudLoadShoppingData:async()=>true,
    cloudLoadGarageData:async()=>true,
    cloudLoadHdoData:async()=>true,
    cloudLoadWaste:async()=>true,
    cloudLoadTasks:async()=>true,
    cloudLoadCalendarSources:async()=>true,
    cloudLoadCalendar:async()=>true,
    cloudLoadContractFiles:async()=>true,
    cloudLoadExtraCollections:async()=>true,
    cloudLoadWarrantyFiles:async()=>true,
    cloudLoadFinance:async()=>true,
    cloudLoadContracts:async()=>true,
    cloudLoadExtraCollection:async()=>true,
    cloudLoadShoppingData:async()=>true
  };
  return {state,calls,saved,timers,ctx};
};

// Manual pending sync: stop dispatch after a pending network response when household changes.
{
  const e=make(),gate=deferred();
  e.ctx.replayCloudOutbox=()=>{e.calls.push('delete');return gate.promise;};
  e.ctx.cloudSyncLocalProfiles=()=>{e.calls.push('profiles');};
  const fn=compile('async function cloudSyncLocalPendingData(', 'async function cloudWarmStartLoad(',e.ctx);
  const job=fn(false);
  await flush();
  assert.deepEqual(e.calls,['delete']);
  e.state.cloud=home('b','user2');
  gate.resolve(true);
  assert.equal(await job,false);
  assert.deepEqual(e.calls,['delete'],'no second syncer in switched workspace');
  assert.equal(e.state.cloud.lastSyncAt,'original');
  assert.equal(e.saved.includes('b'),false);
}

// Autosync must not mark new household as done; overlapping calls must be gated.
{
  const e=make(),gate=deferred();
  e.ctx.ensurePendingCloudModuleCode=()=>{e.calls.push('warm');return gate.promise;};
  e.ctx.cloudSyncLocalPendingData=async()=>{e.calls.push('send');};
  const fn=compile('async function runCloudAutosyncNow(', 'function setCloudAutosyncEnabled(',e.ctx,
    'let cloudAutosyncRunning=false; let cloudAutosyncFailureCount=0; let cloudAutosyncLastAttempt=0;');
  const job=fn(false);
  await flush();
  assert.deepEqual(e.calls,['warm']);
  assert.equal(await fn(false),false,'second concurrent autosync must be ignored');
  e.state.cloud=home('b','user2');
  gate.resolve();
  assert.equal(await job,false);
  assert.deepEqual(e.calls,['warm']);
  assert.equal(e.state.cloud.autosyncStatus,'idle');
  assert.equal(e.state.cloud.lastSyncAt,'original');
  assert.equal(e.saved.includes('b'),false);
  assert.equal(e.timers.some(([source])=>source==='workspace-changed'),true,'B pending must get its own sync');
}

// Unified/manual sync returns without stale success or loading modules of a new home.
{
  const e=make(),gate=deferred();
  e.ctx.ensureModuleCode=()=>gate.promise;
  e.ctx.cloudLoadHouseholds=async()=>{e.calls.push('households');};
  const fn=compile('async function runUnifiedCloudSync(', 'function setAppTheme(',e.ctx,
    'let cloudAutosyncFailureCount=0; let activeModule="home"; let moduleTabs={};');
  const job=fn(false);
  await flush();
  e.state.cloud=home('b','user2');
  gate.resolve();
  assert.equal(await job,false);
  assert.deepEqual(e.calls,[]);
  assert.equal(e.state.cloud.autosyncStatus,'idle');
  assert.equal(e.saved.includes('b'),false);
}

// Bulk cloud loader must stop at the first delayed loader response.
{
  const e=make(),gate=deferred();
  // V564 se už záměrný no-op user_app_settings nepočítá jako loader.
  e.ctx.cloudLoadHouseholdUiSettings=()=>{e.calls.push('household');return gate.promise;};
  const fn=compile('async function cloudLoadAllModules(', 'function cloudSyncCompletionState(',e.ctx);
  const job=fn(false);
  await flush();
  assert.deepEqual(e.calls,['household']);
  e.state.cloud=home('b','user2');
  gate.resolve(true);
  assert.equal(await job,false);
  assert.deepEqual(e.calls,['household']);
  assert.equal(e.saved.includes('b'),false);
}

// Targeted module loader may contain multiple queries. Never start the next one after a switch.
{
  const e=make(),gate=deferred();
  e.ctx.cloudLoadHouseholdUiSettings=()=>{e.calls.push('layout');return gate.promise;};
  e.ctx.cloudLoadFinance=async()=>{e.calls.push('finance');return true;};
  const fn=compile('async function cloudLoadModuleForNav(', 'function getPriorityCloudModulesForHome(',e.ctx);
  const job=fn('finance',false,{renderAfter:false});
  await flush();
  assert.deepEqual(e.calls,['layout']);
  e.state.cloud=home('b','user2');
  gate.resolve(true);
  assert.equal(await job,false);
  assert.deepEqual(e.calls,['layout']);
  assert.equal(e.saved.includes('b'),false);
}

// Background batch must not continue into next module after tenant changes.
{
  const e=make(),gate=deferred();
  e.ctx.cloudLoadModuleForNav=()=>{e.calls.push('shopping');return gate.promise;};
  const fn=compile('async function cloudBackgroundLoadAllModules(', 'async function cloudLoadAllModules(',e.ctx);
  const job=fn(false);
  await flush();
  assert.deepEqual(e.calls,['shopping']);
  e.state.cloud=home('b','user2');
  gate.resolve(true);
  assert.equal(await job,false);
  assert.deepEqual(e.calls,['shopping']);
  assert.equal(e.state.cloud.lastSyncAt,'original');
  assert.equal(e.saved.includes('b'),false);
}

console.log('PASS P0 tenant isolation: pending, automatic/manual sync, bulk, targeted and background loads');
