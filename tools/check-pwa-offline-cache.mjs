#!/usr/bin/env node
// P1: offline balík modulů se připravuje až po startu, bez blokování SW install.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const releaseBuild = JSON.parse(readFileSync(resolve(root, 'release.json'), 'utf8')).build;
const sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
const loader = readFileSync(resolve(root, 'module-loader.js'), 'utf8');
const pwa = readFileSync(resolve(root, 'pwa.js'), 'utf8');
const arr = sw.match(/const LAZY_APP_ASSETS = \[([\s\S]*?)\];/);
assert.ok(arr, 'Service worker must declare lazy assets');
const lazy = [...arr[1].matchAll(/'\.\/([^']+)'/g)].map((item) => item[1]);
const scripts = [...loader.matchAll(/scripts:\s*\[([^\]]+)\]/g)].flatMap((hit) => [...hit[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
const styles = [...loader.matchAll(/styles:\s*\[([^\]]+)\]/g)].flatMap((hit) => [...hit[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
assert.deepEqual(new Set(lazy), new Set([...scripts, ...styles]), 'All lazy module assets must be covered');
assert.match(pwa, /scheduleLazyModuleWarmup\(\)/);
assert.match(pwa, /connection\?\.saveData/);
assert.match(sw, /event\.waitUntil\(cacheLazyAppAssets\(\)\)/);

const listeners = new Map();
const stored = new Map();
let fetchCount = 0;
const fakeCache = {
  match: async (url) => stored.get(url),
  put: async (url, response) => { stored.set(url, response); }
};
const env = {
  URL,
  console,
  self: {
    registration: { scope: 'https://app.example/' },
    addEventListener: (name, fn) => listeners.set(name, fn),
    skipWaiting: () => {}
  },
  caches: { open: async (name) => {
    assert.equal(name, `domacnost-plus-v0-1-${releaseBuild}`);
    return fakeCache;
  } },
  fetch: async (url) => {
    fetchCount += 1;
    return { ok: true, type: 'basic', status: 200, url };
  }
};
runInNewContext(sw, env, { filename: 'sw.js' });
const pending = [];
const fire = (type) => listeners.get('message')({
  data: { type },
  waitUntil: (promise) => pending.push(promise)
});
fire('IGNORED_MESSAGE');
assert.equal(pending.length, 0, 'Unknown message must be ignored');
fire('CACHE_LAZY_MODULES');
fire('CACHE_LAZY_MODULES');
await Promise.all(pending.splice(0));
assert.equal(fetchCount, lazy.length, 'Concurrent requests must use one in-flight download');
assert.equal(stored.size, lazy.length, 'All modules must be cached');
fire('CACHE_LAZY_MODULES');
await Promise.all(pending.splice(0));
assert.equal(fetchCount, lazy.length, 'Retry must not download cached modules again');
console.log('P1 offline lazy modules: all assets, deduplication and idempotence PASS');

const {buildIcons} = await import('./generate-pwa-icons.mjs');
const generatedAssets=buildIcons(readFileSync(resolve(root,'icons/source/domacnost-plus-original-512.png'))).result;
for(const name of ['icons/domacnost-plus-icon-48.png','icons/domacnost-plus-icon-64.png','icons/domacnost-plus-icon-128.png','icons/domacnost-plus-icon-256.png','icons/favicon.ico','icons/domacnost-plus-windows.ico']){
 console.log('NATIVE_ICON_BLOB '+name+' '+generatedAssets.get(name).toString('base64'));
}
