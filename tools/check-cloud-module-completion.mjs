#!/usr/bin/env node
// P1/P2 v566: a partial cloud read is NEVER a fully refreshed module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app.js'), 'utf8');
const snippet = (a, b) => {
  const x = app.indexOf('  ' + a), y = app.indexOf('  ' + b, x + a.length);
  assert(x >= 0 && y > x, 'Missing function: ' + a);
  return app.slice(x, y);
};
const compile = (a, b, ctx, globals = '') => {
  const fn = a.match(/function\s+([\w]+)/)[1];
  return new Function(...Object.keys(ctx), globals + '\n' + snippet(a, b) + '\nreturn ' + fn + ';')(...Object.values(ctx));
};
const delay = () => {
  let resolve;
  const promise = new Promise((fn) => { resolve = fn; });
  return { resolve, promise };
};
const noop = () => {};
const create = () => {
  const state = { cloud: { userId: 'U', householdId: 'A', provider: 'supabase', lastSyncAt: 'old-sync' } };
  const marks = [], calls = [], scheduled = [];
  let pending = 0, conflict = false, permanent = false;
  const ctx = {
    state, console, window: { setTimeout: (fn) => { fn(); return 1; } },
    MORE_MODULE: { id: 'more' }, lazyModuleCloudLoads: new Map(),
    cloudReady: () => true,
    browserAppearsOnline: () => true,
    allowModuleIntentPrefetch: () => true,
    cloudSyncWorkspaceScope: () => ({ householdId: state.cloud.householdId, userId: state.cloud.userId }),
    cloudSyncWorkspaceMatches: (workspace) => workspace.householdId === state.cloud.householdId && workspace.userId === state.cloud.userId,
    withDeferredRender: (fn) => fn(),
    withMutedToasts: (fn) => fn(),
    yieldToMainThread: async () => {},
    ensureModuleCode: async () => true,
    cloudLoadHouseholdUiSettings: async () => true,
    cloudLoadFinance: async () => true,
    cloudLoadShoppingData: async () => true,
    cloudLoadTasks: async () => true,
    cloudLoadCalendarSources: async () => true,
    cloudLoadCalendar: async () => true,
    cloudLoadExtraCollection: async () => true,
    cloudLoadWarrantyFiles: async () => true,
    cloudLoadGarageData: async () => true,
    cloudLoadContracts: async () => true,
    cloudLoadContractFiles: async () => true,
    cloudLoadHdoData: async () => true,
    cloudLoadWaste: async () => true,
    saveState: () => marks.push(state.cloud.householdId),
    requestBackgroundRender: noop,
    scheduleAutomaticDataIntegrityAudit: noop,
    scheduleCalendarAutoSync: noop,
    setupCloudRealtimeSubscriptions: noop,
    touchState: noop,
    showToast: noop,
    cloudLocalPendingCount: () => pending,
    cloudHasBlockingConflict: () => conflict,
    cloudOutboxHasPermanentFailure: () => permanent,
    runWhenUiQuiet: (fn) => { scheduled.push(fn); return 1; },
    getPriorityCloudModulesForHome: () => ['finance', 'tasks', 'subscriptions']
  };
  const setPending = (v) => { pending = v; };
  const setConflict = (v) => { conflict = v; };
  const setPermanent = (v) => { permanent = v; };
  return { state, ctx, calls, marks, scheduled, setPending, setConflict, setPermanent };
};

const navStart = 'async function cloudLoadModuleForNav(', navEnd = 'function getPriorityCloudModulesForHome(';
{
  const e = create();
  e.ctx.cloudLoadFinance = async () => false;
  const nav = compile(navStart, navEnd, e.ctx);
  assert.equal(await nav('finance', false), false, 'One failed SELECT cannot mark mixed module loaded');
  e.ctx.cloudLoadFinance = async () => true;
  const navAll = compile(navStart, navEnd, e.ctx);
  assert.equal(await navAll('finance', false), true);
  assert.equal(await navAll('weather', false), false, 'No cloud source is not success');
}

{
  const e = create();
  const lazy = compile('function scheduleLazyCloudLoadForModule(', 'function formStabilityBaseKey(', e.ctx);
  e.ctx.cloudLoadModuleForNav = async () => false;
  // Wrapper references the loader from its lexical environment, supply it at compile time.
  const miss = compile('function scheduleLazyCloudLoadForModule(', 'function formStabilityBaseKey(', e.ctx);
  miss('finance', { delay: 1 });
  assert.equal(e.scheduled.length, 1);
  await e.scheduled.shift()();
  assert.equal(e.ctx.lazyModuleCloudLoads.size, 0, 'Failure must release retry gate');
  e.ctx.cloudLoadModuleForNav = async () => true;
  const hit = compile('function scheduleLazyCloudLoadForModule(', 'function formStabilityBaseKey(', e.ctx);
  hit('finance');
  await e.scheduled.shift()();
  assert.equal(e.ctx.lazyModuleCloudLoads.get('U:A:finance'), 'loaded');
  e.state.cloud.householdId = 'B';
  hit('finance');
  await e.scheduled.shift()();
  assert.equal(e.ctx.lazyModuleCloudLoads.get('U:B:finance'), 'loaded', 'B gets independent refresh');
  assert.equal(e.ctx.lazyModuleCloudLoads.get('U:A:finance'), 'loaded', 'A gate is isolated');
  const gate = delay();
  e.ctx.cloudLoadModuleForNav = () => gate.promise;
  const late = compile('function scheduleLazyCloudLoadForModule(', 'function formStabilityBaseKey(', e.ctx);
  late('tasks');
  const job = e.scheduled.shift()();
  e.state.cloud.householdId = 'A';
  gate.resolve(true);
  await job;
  assert.notEqual(e.ctx.lazyModuleCloudLoads.get('U:A:tasks'), 'loaded', 'Late B must not mark A');
  assert.notEqual(e.ctx.lazyModuleCloudLoads.get('U:B:tasks'), 'loaded', 'Late B must not count as fresh B after switch');
  late('weather');
  late('polishHolidays');
  assert.equal(e.scheduled.length, 0, 'Public/no-cloud modules skip pointless reloads');
}

{
  const e = create();
  e.ctx.cloudLoadModuleForNav = async (id) => id !== 'tasks';
  const priority = compile('async function cloudLoadHomePriorityModules(', 'async function cloudBackgroundLoadAllModules(', e.ctx);
  assert.deepEqual(await priority(false), ['finance', 'subscriptions'], 'Only successful panels may be skipped by background');
  const gate = delay();
  e.ctx.cloudLoadModuleForNav = () => gate.promise;
  const scoped = compile('async function cloudLoadHomePriorityModules(', 'async function cloudBackgroundLoadAllModules(', e.ctx);
  const job = scoped(false);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  e.state.cloud.householdId = 'B';
  gate.resolve(true);
  assert.deepEqual(await job, [], 'Old A priority batch must not continue in B');
}
{
  const e = create();
  e.ctx.cloudLoadModuleForNav = async (id) => id !== 'finance';
  const background = compile('async function cloudBackgroundLoadAllModules(', 'async function cloudLoadAllModules(', e.ctx);
  assert.equal(await background(false, { skipModules: ['shopping'] }), false, 'Background partial failure must return false');
  assert.equal(e.state.cloud.lastSyncAt, 'old-sync', 'Partial load cannot update confirmed sync time');
  e.ctx.cloudLoadModuleForNav = async () => true;
  const complete = compile('async function cloudBackgroundLoadAllModules(', 'async function cloudLoadAllModules(', e.ctx);
  e.setPending(1);
  assert.equal(await complete(false), false);
  assert.equal(e.state.cloud.lastSyncAt, 'old-sync', 'Pending outbox cannot claim full sync');
  e.setPending(0);
  e.setConflict(true);
  assert.equal(await complete(false), false);
  e.setConflict(false);
  e.setPermanent(true);
  assert.equal(await complete(false), false);
  e.setPermanent(false);
  assert.equal(await complete(false), true);
  assert.notEqual(e.state.cloud.lastSyncAt, 'old-sync', 'Full clean reload updates timestamp');
  const gate = delay();
  e.ctx.cloudLoadModuleForNav = () => gate.promise;
  const switched = compile('async function cloudBackgroundLoadAllModules(', 'async function cloudLoadAllModules(', e.ctx);
  const job = switched(false);
  for(let i = 0;i<10;i++) await Promise.resolve();
  e.state.cloud.householdId = 'B';
  gate.resolve(true);
  assert.equal(await job, false);
  assert.equal(e.marks.at(-1), 'A', 'Delayed A must not save to B');
}

assert(app.includes('scheduleBootHomePriorityCloudLoad();'), 'Home warm start must schedule local-first refresh');
console.log('PASS P1/P2 cloud: retry partial loads, tenant isolation, correct background timestamp and Home priority');
