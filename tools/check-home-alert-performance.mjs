#!/usr/bin/env node
// Runtime regresní test výkonu upozornění Home: každé auto číst právě jednou.
// Kontroluje, že se nezmění výstup ani pořadí upozornění.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const src = readFileSync(resolve(fileURLToPath(new URL('..', import.meta.url)), 'app.js'),'utf8');
const func = src.match(/  function getVehicleAlerts\(\) \{[\s\S]*?\n  \}/);
assert.ok(func, 'getVehicleAlerts v app.js existuje');
const state = { vehicles: [{ id:'one',name:'Auto 1' },{ id:'two',name:'Auto 2' },{ id:'not-owned',name:'Cizí auto' }] };
const reads = [];
const ctx = {
  state, isVehicleOwned: v => v.id !== 'not-owned',
  vehicleInsuranceUntilEffective: () => '',
  daysUntil: () => null, formatDate: String,
  garageRowsForVehicle: id => { reads.push(id);return { fuelRows:[{ id:id+'-fuel' }],serviceRows:[{ id:id+'-service' }] }; },
  getVehicleCurrentOdometer: (vehicle,fuel,service) => { assert.equal(fuel[0]?.id,vehicle.id+'-fuel'); assert.equal(service[0]?.id,vehicle.id+'-service');return 10000; },
  getVehicleServicePlan: () => [{ label:'Kontrola',id:'plan' }],
  computeServicePlanStatus: () => ({ tone:'warn',detail:'brzy' })
};
const getAlerts = runInNewContext('('+func[0].trim()+')',ctx);
const result = getAlerts();
assert.deepEqual(reads,['one','two'],'Garáž se musí načítat pouze 1x za vlastní vozidlo');
assert.equal(result.length,2);
assert.deepEqual(Array.from(result,x=>x.title),['Kontrola: Auto 1','Kontrola: Auto 2']);
console.log('OK: Home upozornění: jediný výběr Garáže na auto, servisní pořadí zachováno.');
