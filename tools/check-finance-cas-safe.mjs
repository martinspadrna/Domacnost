#!/usr/bin/env node
// P0 Finance v576 — execute the production CAS updater with deferred server replies.
// A local transaction without a known base revision cannot adopt the newest
// remote revision and overwrite an edit made on another device.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'finance.js'), 'utf8');
const start = source.indexOf('    async function cloudUpdateFinance(item, options = {}) {');
const end = source.indexOf('    // Koš a cloud outbox jsou zdrojem pravdy pro smazání.', start);
assert(start >= 0 && end > start, 'Missing production Finance CAS updater');
const codeUnderTest = source.slice(start, end);
const defer = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const remote = (id = 'tx-cloud', rev = '2026-10-19T08:00:00Z') =>
  ({ id, title: 'Latest remote', updated_at: rev, amount: 20 });

function harness(revision = '') {
  const item = {
    id: 'tx-local', cloudId: 'tx-cloud', cloudUpdatedAt: revision,
    title: 'Local change', amount: 30, type: 'expense',
    syncStatus: 'pending_update'
  };
  const state = {
    cloud: { householdId: 'h1', userId: 'u1', provider: 'supabase' },
    household: { id: 'h1' }, activeProfileId: 'p1', finance: [item]
  };
  const reads = [], updates = [], conflicts = [], toasts = [];
  const client = {
    from(table) {
      assert.equal(table, 'finance_transactions');
      return {
        update(payload) {
          const gate = defer(), where = [], request = { payload, gate, where };
          updates.push(request);
          const query = {
            eq(key, value) { where.push([key, value]); return query; },
            select() { return query; },
            maybeSingle() { return gate.promise; }
          };
          return query;
        }
      };
    }
  };
  const deps = {
    getState: () => state, getSupabaseClient: () => client,
    currentProfileId: () => state.activeProfileId,
    currentHouseholdId: () => state.household.id,
    refreshCloudSession: async () => ({ id: 'u1' }),
    ensureFinanceTransactionAccounts: async () => true,
    cloudFinancePayload: (record, userId) => ({
      household_id: state.cloud.householdId, title: record.title,
      amount: record.amount, created_by: userId
    }),
    financeTransactionAccountsBound: () => true,
    cloudFinanceRow: async () => {
      const gate = defer();
      reads.push(gate);
      return gate.promise;
    },
    registerCloudRecordConflict: entry => conflicts.push(entry),
    financeCloudUpdateAcknowledged: (value, id) => Boolean(value?.id === id),
    showToast: message => toasts.push(message)
  };
  const update = new Function(...Object.keys(deps),
    codeUnderTest + '\nreturn cloudUpdateFinance;')(...Object.values(deps));
  return { item, state, reads, updates, conflicts, toasts, update };
}

{
  const e = harness(), job = e.update(e.item);
  await flush();
  assert.equal(e.reads.length, 1, 'missing base revision must trigger read');
  assert.equal(e.updates.length, 0, 'missing base must not write');
  e.reads[0].resolve(remote());
  assert.equal(await job, 'conflict');
  assert.equal(e.item.syncStatus, 'conflict');
  assert.equal(e.item.cloudUpdatedAt, '');
  assert.equal(e.conflicts[0].expectedRevision, '');
  assert.equal(e.conflicts[0].remoteRevision, '2026-10-19T08:00:00Z');
  assert.equal(e.updates.length, 0, 'fresh remote revision was wrongly adopted as CAS baseline');
}
{
  const e = harness(), job = e.update(e.item);
  await flush();
  e.reads[0].resolve(null);
  assert.equal(await job, false, 'missing remote row cannot acknowledge write');
  assert.equal(e.item.syncStatus, 'pending_update');
  assert.equal(e.updates.length, 0);
}
{
  const e = harness(), job = e.update(e.item, { skipConflict: true });
  await flush(); e.reads[0].resolve(remote());
  assert.equal(await job, false);
  assert.equal(e.conflicts.length, 0, 'explicit skipConflict must not create a conflict');
  assert.equal(e.updates.length, 0);
}
for (const scenario of ['user', 'profile', 'localHousehold', 'edit', 'replaced']) {
  const e = harness(), job = e.update(e.item);
  await flush();
  if (scenario === 'user') e.state.cloud.userId = 'u2';
  else if (scenario === 'profile') e.state.activeProfileId = 'p2';
  else if (scenario === 'localHousehold') e.state.household.id = 'h2';
  else if (scenario === 'edit') e.item.title = 'Edited during SELECT';
  else e.state.finance = [{ ...e.item }];
  e.reads[0].resolve(remote());
  assert.equal(await job, false, scenario + ' must not register stale conflict');
  assert.equal(e.conflicts.length, 0, scenario);
  assert.equal(e.updates.length, 0, scenario);
  assert.equal(e.item.syncStatus, 'pending_update', scenario);
}
{
  const e = harness('rev-known'), job = e.update(e.item);
  await flush();
  assert.equal(e.reads.length, 0);
  assert.equal(e.updates.length, 1);
  assert(e.updates[0].where.some(([k,v]) => k === 'updated_at' && v === 'rev-known'),
    'UPDATE must use locally confirmed CAS revision');
  assert(e.updates[0].where.some(([k,v]) => k === 'household_id' && v === 'h1'));
  e.updates[0].gate.resolve({ data: { id: 'tx-cloud', updated_at: 'rev-new' }, error: null });
  assert.equal(await job, true);
  assert.equal(e.item.cloudUpdatedAt, 'rev-new');
  assert.equal(e.item.syncStatus, '');
}
{
  const e = harness(), job = e.update(e.item, { expectedRevision: 'chosen-remote-revision' });
  await flush();
  assert.equal(e.reads.length, 0, 'explicit revision from conflict-resolution can update');
  assert.equal(e.updates.length, 1);
  assert(e.updates[0].where.some(([k,v]) => k === 'updated_at' && v === 'chosen-remote-revision'));
  e.updates[0].gate.resolve({ data: { id: 'tx-cloud', updated_at: 'rev-chosen' }, error: null });
  assert.equal(await job, true);
  assert.equal(e.item.cloudUpdatedAt, 'rev-chosen');
}
{
  const e = harness('rev-old'), job = e.update(e.item);
  await flush();
  e.updates[0].gate.resolve({ data: null, error: null });
  await flush();
  assert.equal(e.reads.length, 1, 'CAS miss should fetch remote for conflict UI');
  e.reads[0].resolve(remote());
  assert.equal(await job, 'conflict');
  assert.equal(e.item.syncStatus, 'conflict');
  assert.equal(e.conflicts[0].expectedRevision, 'rev-old');
}
{
  const e = harness('rev-old'), job = e.update(e.item);
  await flush();
  e.updates[0].gate.resolve({ data: null, error: null });
  await flush();
  e.state.cloud.userId = 'u2';
  e.reads[0].resolve(remote());
  assert.equal(await job, false);
  assert.equal(e.conflicts.length, 0, 'stale CAS miss cannot register conflict for another user');
  assert.equal(e.item.syncStatus, 'pending_update');
}
{
  const e = harness('rev-old'), job = e.update(e.item);
  await flush();
  e.state.activeProfileId = 'p2';
  e.updates[0].gate.resolve({ data: { id: 'tx-cloud', updated_at: 'rev-new' }, error: null });
  assert.equal(await job, false, 'late UPDATE receipt must not ACK into different profile');
  assert.equal(e.item.cloudUpdatedAt, 'rev-old');
  assert.equal(e.item.syncStatus, 'pending_update');
}
console.log('PASS Finance CAS v576: no remote revision adoption, confirmed update, safe conflict and async scope');
