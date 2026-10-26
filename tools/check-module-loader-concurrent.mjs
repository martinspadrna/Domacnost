#!/usr/bin/env node
// Lazy module loader: požadavky paralelně, vykonání classic scripts v pořadí.
// Není potřeba npm dependency ani připojení k internetu.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve(fileURLToPath(new URL('..', import.meta.url)), 'module-loader.js'), 'utf8');
const requests = [];
const events = [];
const document = {
  baseURI: 'https://example.test/',
  scripts: [], styleSheets: [],
  createElement(tag) {
    const handlers = new Map();
    return {
      tagName: tag.toUpperCase(), dataset: {}, async: true, src: '', href: '',
      addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
      removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
      emit(type) { for (const fn of [...(handlers.get(type) || [])]) fn(); },
      remove() { /* není potřeba u úspěšného scénáře */ }
    };
  },
  head: { appendChild(node) {
    requests.push(node);
    if (node.tagName === 'SCRIPT') document.scripts.push(node);
    if (node.tagName === 'LINK') document.styleSheets.push({ ownerNode: node });
  } }
};
const windowStub = {
  setTimeout, clearTimeout,
  dispatchEvent(event) { events.push(event); }
};
class CustomEventStub {
  constructor(type, options) { this.type = type; this.detail = options?.detail; }
}
runInNewContext(source, { document, window: windowStub, URL, CustomEvent: CustomEventStub, console }, { filename: 'module-loader.js' });
const pathname = (node) => new URL(node.src || node.href).pathname;
const app = requests.find((node) => pathname(node) === '/app.js');
assert.ok(app, 'bootstrap musí načítat app.js');
app.emit('load');
const loader = windowStub.DomacnostModuleLoader;
assert.ok(loader?.ensure && loader?.isReady && loader?.start);

// Současné vstupy do stejného modulu použijí jediný download / ready event.
const first = loader.ensure('shopping');
const second = loader.ensure('shopping');
const css = requests.find((node) => pathname(node) === '/shopping.css');
assert.ok(css, 'Nákupy potřebují CSS');
await new Promise(setImmediate);
const scripts = requests.filter((node) => node.tagName === 'SCRIPT' && pathname(node).startsWith('/shopping-'));
assert.deepEqual(scripts.map(pathname), ['/shopping-utils.js', '/shopping-render.js', '/shopping-actions.js'],
  'všechny 3 síťové requesty se musí spustit před dokončením prvního');
assert.ok(scripts.every((node) => node.async === false),
  'vykonání classic scripts musí zůstat v pořadí vložení');
assert.equal(loader.isReady('shopping'), false);
// CSS stále čeká na síti: JS requesty jsou spuštěné a kód se smí načíst,
// ale modul nesmí být hotový před CSS (žádný flash nestylovaného obsahu).
let resolved = false;
first.then(() => { resolved = true; });
windowStub.DomacnostShoppingUtils = {}; scripts[0].emit('load');
windowStub.DomacnostShoppingRender = {}; scripts[1].emit('load');
windowStub.DomacnostShoppingActions = {}; scripts[2].emit('load');
await new Promise(setImmediate);
assert.equal(resolved, false, 'modul nesmí být hotový před CSS');
assert.equal(loader.isReady('shopping'), true, 'JS ready nemůže obcházet čekání na CSS');
css.emit('load');
await Promise.all([first, second]);
assert.equal(loader.isReady('shopping'), true);
assert.equal(events.filter((event) => event.type === 'domacnost:module-code-ready' && event.detail?.moduleId === 'shopping').length, 1);
const before = requests.length;
await loader.ensure('shopping');
assert.equal(requests.length, before, 'připravený modul se znovu nestahuje');

// Single-file modul zůstává kompatibilní.
const tasks = loader.ensure('tasks');
await new Promise(setImmediate);
const notes = requests.find((node) => pathname(node) === '/notes.js');
assert.ok(notes, 'Úkoly musí načíst notes.js');
windowStub.DomacnostNotes = {};
notes.emit('load');
await tasks;
assert.equal(loader.isReady('tasks'), true);
console.log('OK: bootstrap, CSS+JS paralelně, dokončení čeká na CSS, async=false, deduplikace a Úkoly.');
