#!/usr/bin/env node
// P0 Cloud: verify success/failure reporting after actual sync and module load.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const app=readFileSync(join(root,'app.js'),'utf8');
const between=(start,end)=>{
 const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
 assert(a>=0&&b>a,'Missing source: '+start);
 return app.slice(a,b);
};
const completion=between('  function cloudSyncCompletionState(loadResult) {',
  '  async function runUnifiedCloudSync(showMessage = true) {');
const unified=between('  async function runUnifiedCloudSync(showMessage = true) {',
  '  function setAppTheme(value) {');

let pending=0, blocked=false, permanent=false, loaded=15, loadTotal=15;
const alerts=[], retries=[];
const state={cloud:{householdId:'h1',userId:'user1',provider:'supabase',
  lastSyncAt:'2026-10-14T12:00:00.000Z'}};
const env={
  state,
  cloudReady:()=>true,
  clearCloudAutosyncTimer:()=>{},
  render:()=>{},
  ensureModuleCode:async()=>{},
  cloudLoadHouseholds:async()=>true,
  cloudSyncLocalPendingData:async()=>true,
  cloudLoadAllModules:async()=>({loaded,total:loadTotal}),
  setupCloudRealtimeSubscriptions:()=>{},
  cloudLocalPendingCount:()=>pending,
  cloudHasBlockingConflict:()=>blocked,
  cloudOutboxHasPermanentFailure:()=>permanent,
  touchState:()=>{},saveState:()=>{},
  showToast:v=>alerts.push(v),
  scheduleCloudAutosync:(...args)=>retries.push(args),
  persistModuleTabsSoon:()=>{},
  console
};
const names=Object.keys(env);
const runFactory=new Function(...names,
  'let cloudAutosyncFailureCount = 0; let activeModule = "home"; let moduleTabs = {};\n'+
   completion+unified+'\nreturn runUnifiedCloudSync;');
const run=runFactory(...names.map(k=>env[k]));

const a=await run(true);
assert.equal(a,true);
assert.equal(state.cloud.autosyncStatus,'done');
assert.equal(alerts.at(-1),'Všechno je synchronizované');
const successAt=state.cloud.lastSyncAt;
assert(successAt!=='2026-10-14T12:00:00.000Z');

pending=3;
assert.equal(await run(true),false);
assert.equal(state.cloud.autosyncStatus,'pending');
assert.equal(state.cloud.lastSyncAt,successAt,'unsent changes must not update last successful sync');
assert.equal(state.cloud.lastAutosyncError,'Ještě zbývá synchronizovat 3 změn');
assert(retries.some(x=>x[0]==='unified-incomplete'));

pending=0;loaded=13;
assert.equal(await run(true),false);
assert.equal(state.cloud.autosyncStatus,'blocked');
assert.equal(state.cloud.lastSyncAt,successAt);
assert.equal(alerts.at(-1),'Některé cloudové moduly se nepovedlo načíst');

loaded=15;blocked=true;
assert.equal(await run(true),false);
assert.equal(state.cloud.autosyncStatus,'blocked');
assert.equal(state.cloud.lastSyncAt,successAt);

blocked=false;permanent=true;
assert.equal(await run(true),false);
assert.equal(state.cloud.autosyncStatus,'blocked');
assert.equal(state.cloud.lastSyncAt,successAt);

assert(completion.includes('const incompleteLoad = !loadResult'));
assert(unified.includes('return !failed;'));
const pendingSource=between('  async function cloudSyncLocalPendingData(showMessage = true) {',
  '  async function cloudWarmStartLoad(');
assert(pendingSource.includes('if (!remaining && !blocked) state.cloud.lastSyncAt ='));
assert(!pendingSource.includes("showToast('Lokální záznamy byly zkontrolované a cloud je načtený')"));
const loadSource=between('  async function cloudLoadAllModules(showMessage = true, options = {}) {',
  '  function cloudSyncCompletionState(loadResult) {');
assert(loadSource.includes('if (result !== false) ok += 1;'));
assert(loadSource.includes('return { loaded: ok, total: loaders.length };'));
assert(loadSource.includes('if (ok === loaders.length && !cloudLocalPendingCount() && !cloudHasBlockingConflict())'));

console.log('PASS cloud truthful status: confirmed, pending, conflict, partial load and retry');
