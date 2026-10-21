#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','app.js'),'utf8');
const section=(start,end)=>{const i=app.indexOf(start),j=app.indexOf(end,i+start.length);assert(i>=0&&j>i);return app.slice(i,j);};
const save=section('  async function performCloudSaveHouseholdUiSettings(','  async function cloudLoadHouseholdUiSettings(');
assert(save.includes('const saveScope = cloudSyncWorkspaceScope();'));
assert.match(save,/await ensureHouseholdUiSyncDependencies\(\);\s*if \(!cloudSyncWorkspaceMatches\(saveScope\)\) return false;/);
assert.match(save,/\.maybeSingle\(\);\s*if \(!cloudSyncWorkspaceMatches\(saveScope\)\) return false;\s*if \(baselineError\)/);
assert.match(save,/await query\.select\('updated_at, dashboard_layout'\)\.maybeSingle\(\);\s*if \(!cloudSyncWorkspaceMatches\(saveScope\)\) return false;/);
assert.match(save,/if \(!cloudSyncWorkspaceMatches\(saveScope\)\) return false;\s*if \(remoteError\)/);
assert.equal((save.match(/\.eq\('id', saveScope\.householdId\)/g)||[]).length,3);
const garage=section('  async function diagnoseGaragePending()','  let subscriptionCloudDiagnosticReport');
assert(garage.includes('const scope = cloudSyncWorkspaceScope();'));
assert.equal((garage.match(/if \(!cloudSyncWorkspaceMatches\(scope\)\) return;/g)||[]).length,2);
assert(!garage.includes('state.cloud?.householdId !== householdId'));
console.log('PASS P0 household settings async session guards, remote CAS and garage diagnostic identity');
