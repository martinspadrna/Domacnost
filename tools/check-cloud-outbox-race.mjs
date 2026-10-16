#!/usr/bin/env node
// P0 v561: pozdní odpověď DELETE nesmí upravit outbox jiné domácnosti;
// ani ztratit DELETE přidaný během čekání na HTTP odpověď.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app.js'), 'utf8');
const begin = source.indexOf('  async function replayCloudOutbox() {');
const end = source.indexOf('  function normalizeModuleList(', begin);
assert(begin >= 0 && end > begin, 'Missing cloud outbox function');
const functionSource = source.slice(begin, end).trim();
const mk = (id, collection = 'financeAccounts') => ({
  id, collection, table: collection === 'financeAccounts' ? 'finance_accounts' : 'finance_transactions',
  cloudId: id + '-remote', operation: 'delete', expectedRevision: '',
  attempts: 0, lastError: '', createdAt: '2026-10-16T12:00:00.000Z'
});
let state, pending, persisted, confirmed, conflicts, scope;
function setup() {
  state = { cloud: { provider: 'supabase', userId: 'user1', householdId: 'home1', outbox: [mk('a')] } };
  pending = []; persisted = []; confirmed = []; conflicts = [];
  const ctx = {
    state,
    console,
    normalizeText: (v) => String(v || '').trim(),
    normalizeCloudOutbox: (a) => a.map((x) => ({ ...x })),
    cloudReady: () => Boolean(ctx.state.cloud?.userId && ctx.state.cloud?.householdId),
    browserAppearsOnline: () => true,
    cleanupProviderManagedCalendarSyncArtifacts: () => {},
    getSupabaseClient: () => ({
      from(table) {
        const details = { table, filters: {}, operation: '' };
        const q = {
          update() { details.operation = 'update'; return q; },
          delete() { details.operation = 'delete'; return q; },
          select() { details.operation ||= 'select'; return q; },
          eq(name, value) { details.filters[name] = value; return q; },
          maybeSingle() { return new Promise((resolve) => pending.push({ ...details, resolve })); }
        };
        return q;
      }
    }),
    calendarSyncRecordIsProviderManaged: () => false,
    cloudRecordConflicts: () => [],
    registerCloudRecordConflict: (value) => conflicts.push(value),
    confirmFinanceTrashCloudDelete: (entry) => confirmed.push({ id: entry.id, householdId: ctx.state.cloud.householdId }),
    persistStateSnapshot: () => persisted.push(ctx.state.cloud.householdId),
    yieldToMainThread: () => Promise.resolve(),
    cloudErrorIsTransient: () => true,
    cloudErrorFriendlyMessage: () => 'offline'
  };
  scope = ctx;
  const context = vm.createContext(ctx);
  return vm.runInContext('(' + functionSource + ')', context);
}
const tick = async () => { for (let i=0; i<12; i++) await Promise.resolve(); };

// Změna domácnosti v průběhu archivace: výsledek patří jen první domácnosti.
let replay = setup(), job = replay();
assert.equal(pending.length, 1);
assert.equal(pending[0].filters.household_id, 'home1');
const newHome = { cloud: { provider: 'supabase', userId: 'user2', householdId: 'home2', outbox: [mk('b')] } };
scope.state = newHome;
pending.shift().resolve({ data: { id: 'a-remote' }, error: null });
assert.equal(await job, false);
assert.equal(newHome.cloud.outbox.length, 1);
assert.equal(newHome.cloud.outbox[0].id, 'b');
assert.equal(persisted.length, 0);
assert.equal(confirmed.length, 0);

// Nová DELETE během pending požadavku se nesmí ztratit při potvrzení první.
replay = setup(); job = replay();
scope.state.cloud.outbox.push(mk('b'));
pending.shift().resolve({ data: { id: 'a-remote' }, error: null });
await tick();
assert.equal(confirmed.length, 1);
assert.equal(confirmed[0].id, 'a');
assert.equal(scope.state.cloud.outbox.length, 1);
assert.equal(scope.state.cloud.outbox[0].id, 'b');
assert.equal(pending.length, 1);
assert.equal(pending[0].filters.household_id, 'home1');
pending.shift().resolve({ data: { id: 'b-remote' }, error: null });
assert.equal(await job, true);
assert.equal(scope.state.cloud.outbox.length, 0);
assert.deepEqual(confirmed.map(x => x.id), ['a','b']);

// Síťový neúspěch prvního DELETE musí zachovat nový záznam ve frontě.
replay = setup(); job = replay();
scope.state.cloud.outbox.push(mk('b'));
pending.shift().resolve({ data: null, error: { message: 'timeout', status: 503 } });
assert.equal(await job, false);
assert.equal(scope.state.cloud.outbox.length, 2);
assert.equal(scope.state.cloud.outbox[0].attempts, 1);
assert.equal(scope.state.cloud.outbox[1].id, 'b');
assert.equal(confirmed.length, 0);

// Read-before-delete finanční transakce musí být scoped i při změně domácnosti.
replay = setup();
scope.state.cloud.outbox = [mk('c', 'finance')];
job = replay();
assert.equal(pending[0].filters.household_id, 'home1');
scope.state = { cloud: { provider: 'supabase', userId: 'user2', householdId: 'home2', outbox: [mk('z')] } };
pending.shift().resolve({ data: { id: 'c-remote', updated_at: 'revision' }, error: null });
assert.equal(await job, false);
assert.equal(conflicts.length, 0);
assert.equal(scope.state.cloud.outbox[0].id, 'z');
console.log('PASS outbox household switching, late ack isolation, concurrent enqueue and failure preservation');
