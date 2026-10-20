#!/usr/bin/env node
// P0 Finance: focused async account-INSERT race regression tests without DB writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'finance.js'), 'utf8');
const start = source.indexOf('    const FINANCE_INSERT_UUID =');
const end = source.indexOf('    function financeCloudUpdateAcknowledged(', start);
assert(start >= 0 && end > start, 'Finance account INSERT guard was not found');
const codeUnderTest = source.slice(start, end);

function harness(record) {
  const state = { cloud: { householdId: 'house-a', userId: 'user-a', lastSyncAt: '' }, household: { id: 'house-a' }, activeProfileId: 'p1', financeAccounts: [record] };
  const requests = [];
  const pendingReasons = [];
  const toasts = [];
  let snapshots = 0;
  const client = {
    from(table) {
      assert.equal(table, 'finance_accounts');
      return {
        select() { const q={ eq(){return q;}, maybeSingle(){return Promise.resolve({data:null,error:null});} }; return q; },
        insert(payload) {
          return {
            select(cols) {
              assert.equal(cols, 'id,updated_at');
              return {
                single() {
                  return new Promise(resolve => requests.push({ payload, resolve }));
                }
              };
            }
          };
        }
      };
    }
  };
  // Only the actual production functions under test are evaluated.
  const factory = new Function(
    'getSupabaseClient', 'getState', 'refreshCloudSession',
    'currentProfileId', 'currentHouseholdId', 'cloudFinanceAccountPayload', 'markFinanceCloudPending',
    'persistStateSnapshot', 'showToast',
    codeUnderTest + '\nreturn {cloudAddFinanceAccount, financeAccountInsertConfirmed};'
  );
  const api = factory(
    () => client,
    () => state,
    async () => ({ id: 'user-a' }),
    () => state.activeProfileId, () => state.household.id,
    (account, userId) => ({
      household_id: state.cloud.householdId,
      name: account.name,
      opening_balance: Number(account.openingBalance || 0),
      created_by: userId
    }),
    reason => pendingReasons.push(reason),
    () => { snapshots += 1; },
    message => toasts.push(message)
  );
  return {
    state, requests, pendingReasons, toasts, api,
    snapshots: () => snapshots
  };
}

async function flushRequests() {
  // Continue through the async refreshCloudSession microtask.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function respond(request, id = request.payload.id) {
  request.resolve({ data: { id, updated_at: 'rev-insert' }, error: null });
}

// Two concurrent callers share one INSERT and both see the confirmed ID.
{
  const record = { id: 'a', name: 'Účet', syncStatus: 'pending_add' };
  const h = harness(record);
  const first = h.api.cloudAddFinanceAccount(record);
  const second = h.api.cloudAddFinanceAccount(record);
  await flushRequests();
  assert.equal(h.requests.length, 1, 'two calls created duplicate INSERT');
  const savedId = h.requests[0].payload.id;
  assert.match(savedId, /^[0-9a-f-]{36}$/i);
  respond(h.requests[0]);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a?.id, savedId);
  assert.equal(b?.id, savedId);
  assert.equal(record.cloudId, savedId);
  assert.equal(record.cloudUpdatedAt, 'rev-insert');
  assert.equal(record.cloudInsertId, savedId);
  assert.equal(record.syncStatus, '');
  assert(h.api.financeAccountInsertConfirmed(record, b));
  assert.equal(h.snapshots(), 2);
}

// A local edit during an in-flight INSERT must retain its unsent changes,
// and the next attempt must be an UPDATE of the confirmed cloud ID.
{
  const record = { id: 'b', name: 'Původní', syncStatus: 'pending_add' };
  const h = harness(record);
  const request = h.api.cloudAddFinanceAccount(record);
  await flushRequests();
  const savedId = h.requests[0].payload.id;
  record.name = 'Upravený';
  respond(h.requests[0]);
  assert.equal(await request, null);
  assert.equal(record.cloudId, savedId);
  assert.equal(record.syncStatus, 'pending_update');
  assert.deepEqual(h.pendingReasons, ['finance-account-changed-during-insert']);
  assert.equal(h.snapshots(), 2);
}

// Immutable form replacement of the same local ID must not produce a second INSERT.
{
  const original = { id: 'c', name: 'Původní', syncStatus: 'pending_add' };
  const h = harness(original);
  const first = h.api.cloudAddFinanceAccount(original);
  await flushRequests();
  const savedId = h.requests[0].payload.id;
  const replacement = { ...original, name: 'Novější' };
  h.state.financeAccounts[0] = replacement;
  const second = h.api.cloudAddFinanceAccount(replacement);
  await flushRequests();
  assert.equal(h.requests.length, 1);
  respond(h.requests[0]);
  await Promise.all([first, second]);
  assert.equal(replacement.cloudId, savedId);
  assert.equal(replacement.cloudInsertId, savedId);
  assert.equal(replacement.syncStatus, 'pending_update');
  assert.equal(h.api.financeAccountInsertConfirmed(original, { id: savedId }), false);
}

// A failed DB write never yields a success marker, and retry is possible.
{
  const record = { id: 'd', name: 'Účet', syncStatus: 'pending_add' };
  const h = harness(record);
  const first = h.api.cloudAddFinanceAccount(record);
  await flushRequests();
  h.requests[0].resolve({ data: null, error: { message: 'offline' } });
  assert.equal(await first, null);
  assert.equal(record.cloudId, undefined);
  assert.equal(record.syncStatus, 'pending_add');
  const second = h.api.cloudAddFinanceAccount(record);
  await flushRequests();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].payload.id,h.requests[0].payload.id,'retry must use original UUID');
  respond(h.requests[1]);
  assert.equal((await second)?.id,h.requests[0].payload.id);
}

// Switching household mid-request must not acknowledge a different household's row.
{
  const record = { id: 'e', name: 'Účet', syncStatus: 'pending_add' };
  const h = harness(record);
  const first = h.api.cloudAddFinanceAccount(record);
  await flushRequests();
  h.state.cloud.householdId = 'house-b';
  h.state.financeAccounts = [];
  respond(h.requests[0]);
  assert.equal(await first, null);
  assert.equal(record.cloudId, undefined);
  assert.equal(h.snapshots(), 1);
}


// A late successful INSERT must not ACK data into a different logged-in user,
// even when both accounts share the same cloud household.
for (const changed of ['user', 'profile', 'localHousehold']) {
  const record = { id: 'user-switch-'+changed, name: 'Shared account', syncStatus: 'pending_add' };
  const h = harness(record);
  const job = h.api.cloudAddFinanceAccount(record);
  await flushRequests();
  assert.equal(h.requests.length, 1);
  if (changed === 'user') h.state.cloud.userId = 'user-b';
  else if (changed === 'profile') h.state.activeProfileId = 'p2';
  else h.state.household.id = 'house-b';
  respond(h.requests[0]);
  assert.equal(await job, null, 'stale account '+changed+' ACK');
  assert.equal(record.cloudId, undefined, 'stale account receipt must not be linked');
  assert.equal(record.syncStatus, 'pending_add');
  assert.equal(h.snapshots(), 1);
  assert.deepEqual(h.toasts, []);
}
console.log('PASS Finance account INSERT single-flight, user/profile/workspace and pending race checks');
