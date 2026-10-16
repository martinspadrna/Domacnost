#!/usr/bin/env node
// Finance cloud trash/outbox P0 regression, pure checks (no live DB mutations).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const finance = readFileSync(join(root, 'finance.js'), 'utf8');
const app = readFileSync(join(root, 'app.js'), 'utf8');

const start = finance.indexOf('    function financeHiddenCloudIds(collection) {');
const end = finance.indexOf('    async function cloudLoadFinance(showMessage = true) {', start);
assert(start >= 0 && end > start, 'missing finance tombstone filter');
let state = {};
const factory = new Function('getState', finance.slice(start, end) + '\nreturn financeHiddenCloudIds;');
const hidden = factory(() => state);

state = {
  cloud: { householdId: 'home-a', outbox: [] },
  trash: [{
    expiresAt: '2099-10-16T12:00:00.000Z',
    records: [
      { collection: 'finance', record: { cloudId: 'tx-a', householdId: 'home-a' } },
      { collection: 'financeAccounts', record: { cloudId: 'account-a', householdId: 'home-a' } },
      { collection: 'finance', record: { cloudId: 'from-other-home', householdId: 'home-b' } }
    ]
  }, {
    expiresAt: '2020-01-01T12:00:00.000Z',
    records: [{ collection: 'finance', record: { cloudId: 'expired', householdId: 'home-a' } }]
  }]
};
assert.deepEqual([...hidden('finance')], ['tx-a']);
assert.deepEqual([...hidden('financeAccounts')], ['account-a']);
state.cloud.outbox = [{
  collection: 'finance', operation: 'delete', cloudId: 'tx-b'
}, {
  collection: 'financeAccounts', operation: 'delete', cloudId: 'account-b'
}];
assert.deepEqual([...hidden('finance')], ['tx-a', 'tx-b']);
assert.deepEqual([...hidden('financeAccounts')], ['account-a', 'account-b']);
state.cloud.householdId = '';
assert.equal(hidden('finance').size, 0, 'no household must not reveal tombstones');

const loadStart = finance.indexOf('    async function cloudLoadFinance(showMessage = true) {');
const loadEnd = finance.indexOf('    async function cloudDeleteFinance(item, options = {}) {', loadStart);
const loader = finance.slice(loadStart, loadEnd);
assert(loader.includes("financeHiddenCloudIds('finance')"));
assert(loader.includes("financeHiddenCloudIds('financeAccounts')"));
assert(loader.includes('!hiddenTransactionIds.has(String(item.id))'));
assert(loader.includes('!hiddenAccountIds.has(String(item.id))'));
assert(loader.includes('const stagedAccounts ='));
assert(loader.includes('getState().finance?.') === false);
assert(loader.includes('saveState({ skipTrashTracking: true })'),
  'remote load must not create local trash entries');

const begin = finance.indexOf('    // Smazání jde přes společný Koš');
const stop = finance.indexOf('    return {\n      // dashboard KPI', begin);
const deletes = finance.slice(begin, stop);
assert(deletes.includes("saveState({ immediate: true })"), 'deletion must persist trash before network');
assert(deletes.includes("showUndoToast('Záznam smazán'"));
assert(deletes.includes("showUndoToast('Účet smazán'"));
assert(!deletes.includes('cloudDeleteFinance(item)'));
assert(!deletes.includes('cloudDeleteFinanceAccount(account)'));
assert(!deletes.includes('await cloudAddFinance('), 'undo must not recreate remote before outbox state known');

const replayBegin = app.indexOf('  async function replayCloudOutbox() {');
const replayEnd = app.indexOf('\n  function normalizeModuleList', replayBegin);
const replay = app.slice(replayBegin, replayEnd);
assert(replay.includes("entry.collection === 'financeAccounts'"));
assert(replay.includes(".update({ is_archived: true })"));
assert(replay.includes(".eq('is_archived', false)"));
assert(replay.includes(".select('id').maybeSingle()"));
assert(replay.includes("existing.data?.is_archived === true"));
assert(replay.includes('FINANCE_ARCHIVE_UNCONFIRMED'));
assert(replay.includes("entry.collection === 'finance' && !entry.expectedRevision"));
assert(replay.includes("registerCloudRecordConflict({"));
assert(replay.includes("if (!data && ['shopping', 'finance', 'calendar'].includes(entry.collection))"));
const directDelete = finance.split('    async function cloudDeleteFinance(item, options = {}) {')[1]
  ?.split('    async function cloudDeleteFinanceAccount(')[0] || '';
assert(directDelete.includes('if (!expectedRevision) return false;'));
assert(directDelete.includes('return false;'));

console.log('PASS Finance trash visibility, no premature deletion, archive ack, CAS safety');
