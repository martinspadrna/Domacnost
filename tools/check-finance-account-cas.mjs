#!/usr/bin/env node
// P0 v583: proven Finance account CAS against actual Supabase table revision.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'finance.js'), 'utf8');
const start = source.indexOf('    async function cloudFinanceAccountRow(');
const end = source.indexOf('    function cloudFinancePayload(item, userId)', start);
assert(start >= 0 && end > start, 'Account CAS updater not found');
const updaterSource = source.slice(start, end);
const defer = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { resolve, promise }; };
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const remote = (rev = 'remote-new') => ({
  id: 'account-cloud', household_id: 'h1', name: 'Server changed',
  account_type: 'cash', opening_balance: 99, include_in_total: true,
  updated_at: rev
});

function harness(rev = '') {
  const account = { id: 'local-account', cloudId: 'account-cloud',
    cloudUpdatedAt: rev, name: 'Local change', openingBalance: 40, syncStatus: 'pending_update' };
  const state = { cloud: { householdId: 'h1', userId: 'u1' }, household: { id: 'h1' },
    activeProfileId: 'p1', financeAccounts: [account] };
  const reads = [], writes = [], conflicts = [], toasts = [];
  const client = { from(table) {
    assert.equal(table, 'finance_accounts');
    return {
      select(columns) {
        assert(columns.includes('updated_at'));
        const gate = defer(), filters = [], query = {
          eq(key, value) { filters.push([key, value]); return query; },
          maybeSingle() { return gate.promise; }
        };
        reads.push({ gate, filters });
        return query;
      },
      update(payload) {
        const gate = defer(), filters = [], query = {
          eq(key, value) { filters.push([key, value]); return query; },
          select(columns) { assert.equal(columns, 'id,updated_at'); return query; },
          maybeSingle() { return gate.promise; }
        };
        writes.push({ payload, gate, filters });
        return query;
      }
    };
  } };
  const deps = {
    getState: () => state, getSupabaseClient: () => client,
    currentProfileId: () => state.activeProfileId,
    currentHouseholdId: () => state.household.id,
    refreshCloudSession: async () => ({ id: 'u1' }),
    cloudFinanceAccountPayload: (item, uid) => ({
      household_id: state.cloud.householdId, name: item.name,
      opening_balance: item.openingBalance, created_by: uid
    }),
    financeCloudUpdateAcknowledged: (row, id) => row?.id === id,
    registerCloudRecordConflict: conflict => conflicts.push(conflict),
    showToast: message => toasts.push(message)
  };
  const api = new Function(...Object.keys(deps), updaterSource +
    '\nreturn { cloudUpdateFinanceAccount, cloudFinanceAccountRow };')(...Object.values(deps));
  return { account, state, reads, writes, conflicts, toasts, ...api };
}
const hasFilter = (request, key, value) => request.filters.some(([name, entry]) => name === key && entry === value);

// Unknown base: read-only conflict, never silently adopt newest remote revision.
{
  const e = harness(), job = e.cloudUpdateFinanceAccount(e.account);
  await flush();
  assert.equal(e.writes.length, 0);
  assert.equal(e.reads.length, 1);
  assert(hasFilter(e.reads[0], 'household_id', 'h1'));
  e.reads[0].gate.resolve({ data: remote(), error: null });
  assert.equal(await job, 'conflict');
  assert.equal(e.account.syncStatus, 'conflict');
  assert.equal(e.account.cloudUpdatedAt, '');
  assert.equal(e.conflicts[0].table, 'finance_accounts');
  assert.equal(e.writes.length, 0);
}
// Strict CAS success: match exact saved base revision and retain server revision.
{
  const e = harness('base-rev'), job = e.cloudUpdateFinanceAccount(e.account);
  await flush();
  assert.equal(e.writes.length, 1);
  assert(hasFilter(e.writes[0], 'updated_at', 'base-rev'));
  assert(hasFilter(e.writes[0], 'household_id', 'h1'));
  e.writes[0].gate.resolve({ data: { id: 'account-cloud', updated_at: 'written-rev' }, error: null });
  assert.equal(await job, true);
  assert.equal(e.account.cloudUpdatedAt, 'written-rev');
  assert.equal(e.conflicts.length, 0);
}
// CAS miss: no overwrite; fetch newest revision and register actionable conflict.
{
  const e = harness('stale-rev'), job = e.cloudUpdateFinanceAccount(e.account);
  await flush(); e.writes[0].gate.resolve({ data: null, error: null });
  await flush(); assert.equal(e.reads.length, 1);
  e.reads[0].gate.resolve({ data: remote(), error: null });
  assert.equal(await job, 'conflict');
  assert.equal(e.account.syncStatus, 'conflict');
  assert.equal(e.account.cloudUpdatedAt, 'stale-rev');
  assert.equal(e.conflicts[0].expectedRevision, 'stale-rev');
}
// No server access or RLS-hidden row: never fabricate a conflict/ACK.
{
  const e = harness(), job = e.cloudUpdateFinanceAccount(e.account);
  await flush(); e.reads[0].gate.resolve({ data: null, error: null });
  assert.equal(await job, false);
  assert.equal(e.account.syncStatus, 'pending_update');
}
// Scope switch during remote conflict read: never apply a stale result.
for (const which of ['user', 'profile', 'household', 'edit', 'replacement']) {
  const e = harness(), job = e.cloudUpdateFinanceAccount(e.account);
  await flush();
  if (which === 'user') e.state.cloud.userId = 'u2';
  if (which === 'profile') e.state.activeProfileId = 'p2';
  if (which === 'household') e.state.household.id = 'h2';
  if (which === 'edit') e.account.name = 'New local text';
  if (which === 'replacement') e.state.financeAccounts = [{ ...e.account }];
  e.reads[0].gate.resolve({ data: remote(), error: null });
  assert.equal(await job, false, which);
  assert.equal(e.conflicts.length, 0, which);
  assert.equal(e.account.syncStatus, 'pending_update', which);
}
// An edit during an acknowledged write retains pending but advances the CAS base.
{
  const e = harness('base-rev'), job = e.cloudUpdateFinanceAccount(e.account);
  await flush(); e.account.name = 'Newer local edit';
  e.writes[0].gate.resolve({ data: { id: 'account-cloud', updated_at: 'new-base' }, error: null });
  assert.equal(await job, false);
  assert.equal(e.account.cloudUpdatedAt, 'new-base');
  assert.equal(e.account.syncStatus, 'pending_update');
}
console.log('PASS Finance account CAS v583: revision, conflict, scope, zero-row, late edits');
