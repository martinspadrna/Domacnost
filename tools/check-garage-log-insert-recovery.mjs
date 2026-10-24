#!/usr/bin/env node
// P0 v589: real Garage fuel/service INSERTs recover from a lost ACK and
// legacy source_hash duplicate only after an exact read-only row comparison.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app.js'), 'utf8');
const cut = (a, b) => {
  const start = app.indexOf(a), end = app.indexOf(b, start + a.length);
  assert(start >= 0 && end > start, 'Missing Garage code anchor: ' + a);
  return app.slice(start, end);
};
const source =
  cut('  function cloudSyncWorkspaceScope()', '  function clearCloudAutosyncTimer()') +
  cut('  const GARAGE_VEHICLE_INSERT_UUID =', '  async function garageVehicleInsertedRow(') +
  cut('  const garageLogInsertInFlight =', '  async function cloudUpdateFuelLog(item)');
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const makeItem = collection => collection === 'fuel'
  ? { id: 'fuel-local', vehicleId: 'car-local', date: '2026-10-24', odometer: '150001', liters: 42, price: 1645, note: 'Plná nádrž', syncStatus: 'pending_add' }
  : { id: 'service-local', vehicleId: 'car-local', date: '2026-10-24', odometer: '150001', title: 'Nové pneumatiky', price: 8200, note: 'Zimní sada', syncStatus: 'pending_add' };
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical)
    : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]))
  : value;
function createHarness(collection, behavior = 'normal') {
  let mode = behavior;
  const table = collection === 'fuel' ? 'fuel_logs' : 'service_logs';
  const item = makeItem(collection);
  const state = { cloud: { householdId: 'house-a', userId: 'user-a' }, vehicles: [{ id:'car-local', cloudId:'car-cloud' }], fuel: [], services: [] };
  state[collection] = [item];
  const rows = new Map(), attempts = [], selects = [], snapshots = [], toasts = [];
  let gate = null;
  const client = { from(actual) {
    assert.equal(actual, table);
    return {
      insert(payload) { return { select() { return { async single() {
        attempts.push(structuredClone(payload));
        if (gate) await gate;
        if (mode === 'offline') return {data:null,error:{message:'offline'}};
        const existing = [...rows.values()].find(x => x.household_id === payload.household_id &&
          x.vehicle_id === payload.vehicle_id && x.source_hash === payload.source_hash);
        if (existing) return {data:null,error:{code:'23505',message:'duplicate key value'}};
        const inserted = { ...payload, updated_at:'2026-10-24T10:00:00Z' };
        rows.set(inserted.id, inserted);
        if (mode === 'lost' || mode === 'change') return {data:null,error:{message:'connection closed'}};
        return {data:{id:inserted.id},error:null};
      } }; } }; },
      select() {
        const filters = [];
        const q = { eq(key, value) { filters.push([key,value]); return q; },
          async maybeSingle() {
            selects.push([...filters]);
            return {data:[...rows.values()].find(row => filters.every(([k,v]) => row[k]===v))||null,error:null};
          }};
        return q;
      }
    };
  }};
  const deps = {
    state, cloudReady: () => true, getSupabaseClient: () => client,
    refreshCloudSession: async () => ({ id:'user-a' }),
    ensureCloudVehicle: async () => 'car-cloud',
    markGarageRecordPending: r => {r.syncStatus=r.cloudId?'pending_update':'pending_add';},
    garageSourceHash: (kind,rec) => [kind,'car-cloud',rec.date,rec.odometer,
      kind==='fuel'?rec.liters:rec.title].join('|'),
    serviceTypeToCloud: () => 'tires', todayISO: () => '2026-10-24',
    canonicalComparableJson: canonical,
    persistStateSnapshot: () => snapshots.push(structuredClone(state[collection])),
    showToast: msg => toasts.push(msg)
  };
  const api = new Function(...Object.keys(deps),source+'\nreturn {cloudAddFuelLog,cloudAddServiceLog};')(...Object.values(deps));
  const add = x => collection === 'fuel' ? api.cloudAddFuelLog(x) : api.cloudAddServiceLog(x);
  return { item,state,rows,attempts,selects,snapshots,toasts,add,setMode: x=>{mode=x;},setGate: x=>{gate=x;} };
}
for(const collection of ['fuel','services']) {
  // A successful first INSERT saves a durable UUID and clears only its own pending.
  {
    const h=createHarness(collection);
    const receipt=await h.add(h.item);
    assert.equal(h.attempts.length,1);
    assert.match(h.attempts[0].id,uuid);
    assert.equal(h.snapshots[0][0].cloudInsertId,h.attempts[0].id);
    assert.equal(h.item.cloudId,receipt.id);
    assert.equal(h.item.syncStatus,'');
  }
  // Server committed INSERT but its network ACK was lost.
  {
    const h=createHarness(collection,'lost');
    const receipt=await h.add(h.item);
    assert.equal(receipt?.id,h.attempts[0].id);
    assert.equal(h.rows.size,1);
    assert.equal(h.item.syncStatus,'');
    assert.equal(h.selects.length,1);
  }
  // v588 or earlier: old client already committed with server-generated ID,
  // then kept pending after receiving 23505 on a retry.
  {
    const h=createHarness(collection);
    const seed = createHarness(collection);
    await seed.add(seed.item);
    const previous = { ...seed.attempts[0], id:'00000000-0000-4000-8000-000000000099' };
    h.rows.set(previous.id,previous);
    const receipt=await h.add(h.item);
    assert.equal(receipt?.id,previous.id);
    assert.equal(h.item.cloudId,previous.id);
    assert.equal(h.item.syncStatus,'');
    assert.equal(h.rows.size,1);
    assert(h.selects.some(q=>q.some(([key])=>key==='source_hash')));
  }
  // Identical source hash with a differing amount must NEVER be ACKed.
  {
    const h=createHarness(collection);
    const seed=createHarness(collection);
    await seed.add(seed.item);
    const previous={...seed.attempts[0],id:'00000000-0000-4000-8000-000000000098',total_price:1};
    h.rows.set(previous.id,previous);
    assert.equal(await h.add(h.item),null);
    assert.equal(h.item.syncStatus,'pending_add');
    assert(!h.item.cloudId);
    assert.equal(h.rows.size,1);
  }
  // Offline retry keeps one durable UUID, not one UUID per attempt.
  {
    const h=createHarness(collection,'offline');
    assert.equal(await h.add(h.item),null);
    const firstId=h.attempts[0].id;
    h.setMode('normal');
    const receipt=await h.add(h.item);
    assert.equal(receipt?.id,firstId);
    assert.equal(h.attempts[1].id,firstId);
    assert.equal(h.rows.size,1);
  }
  // An ACK arriving after the user changes account must not mutate a record.
  {
    const h=createHarness(collection,'change');
    let proceed;
    h.setGate(new Promise(resolve=>{proceed=resolve;}));
    const task=h.add(h.item);
    for(let k=0;k<30;k++)await Promise.resolve();
    h.state.cloud.userId='user-b';
    proceed();
    assert.equal(await task,null);
    assert(!h.item.cloudId);
    assert.equal(h.item.syncStatus,'pending_add');
  }
  // If the record changes while POST is in flight, an ACK links the ID but
  // must not claim the newly edited content is synced.
  {
    const h=createHarness(collection,'change');
    let proceed;
    h.setGate(new Promise(resolve=>{proceed=resolve;}));
    const task=h.add(h.item);
    for(let k=0;k<30;k++)await Promise.resolve();
    h.item.note='Novější úprava během odesílání';
    proceed();
    assert((await task)?.id);
    assert.equal(h.item.syncStatus,'pending_update');
  }
}
console.log('PASS: Garage fuel/service duplicate, lost ACK, mismatch, offline, scope and edit race');
