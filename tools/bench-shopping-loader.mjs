#!/usr/bin/env node
// Izolovaný real-Chrome benchmark síťového waterfallu Nákupů.
// Porovnává přesný module-loader.js z v592 s aktuálním loaderem na totožných
// syntetických CSS/JS odpovědích s pevným zpožděním.
// Jde o cold-load kódu modulu (ensure), NE o měření celého UI ani reálné sítě.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const original = readFileSync(resolve(root, 'tools/fixtures/module-loader-592.js'), 'utf8');
const current = readFileSync(resolve(root, 'module-loader.js'), 'utf8');
const delay = { css: 260, js: 210 };
const rounds = 5;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function findBrowser() {
  const candidates = [process.env.CHROME_PATH, process.env.EDGE_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const path = spawnSync('which', [command], { encoding: 'utf8' });
    if (path.status === 0) candidates.push(path.stdout.trim());
  }
  return candidates.find((p) => p && existsSync(p)) || '';
}
const browserPath = findBrowser();
if (!browserPath) {
  if (process.env.BENCH_REQUIRED === '1' || process.env.CI === 'true') throw new Error('Chrome není dostupný pro povinný benchmark');
  console.log('SKIP: Chrome není dostupný pro volitelný benchmark');
  process.exit(0);
}

const scriptBodies = {
  'app.js': 'window.__benchApp = true;',
  'shopping-utils.js': 'window.__benchOrder=(window.__benchOrder||[]);window.__benchOrder.push("utils");window.DomacnostShoppingUtils={};',
  'shopping-render.js': 'if(!window.DomacnostShoppingUtils)throw Error("utils not ready");window.__benchOrder.push("render");window.DomacnostShoppingRender={};',
  'shopping-actions.js': 'if(!window.DomacnostShoppingRender)throw Error("render not ready");window.__benchOrder.push("actions");window.DomacnostShoppingActions={};'
};

const server = createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  const segments = path.split('/').filter(Boolean);
  const variant = segments[0];
  if (!['baseline', 'optimized'].includes(variant)) { res.writeHead(404);res.end();return; }
  const name = segments[1] || '';
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (!name) {
    const code = '(function(){var t=performance.now();window.__benchResult=null;window.DomacnostModuleLoader.ensure("shopping").then(function(){var resources=performance.getEntriesByType("resource");var css=resources.find(function(x){return /shopping[.]css/.test(x.name)});var js=resources.filter(function(x){return /shopping-(utils|render|actions)[.]js/.test(x.name)});window.__benchResult={ms:Math.round(performance.now()-t),ready:window.DomacnostModuleLoader.isReady("shopping"),cssLoaded:getComputedStyle(document.body).getPropertyValue("--shopping-bench-ready").trim()==="yes",order:(window.__benchOrder||[]).join(","),cssEnd:css?Math.round(css.responseEnd):0,firstJsStart:js.length?Math.round(Math.min.apply(null,js.map(function(x){return x.startTime}))):0,jsCount:js.length}}).catch(function(e){window.__benchResult={error:String(e)}})})();';
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/'+variant+'/module-loader.js"></script><script>'+code+'</script></body></html>';
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html' });res.end(html);return;
  }
  if (name === 'module-loader.js') {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript' });
    res.end(variant === 'baseline' ? original : current);
    return;
  }
  if (name === 'shopping.css') {
    setTimeout(() => { res.writeHead(200, { ...headers, 'Content-Type': 'text/css' });res.end('body{--shopping-bench-ready:yes}'); }, delay.css);
    return;
  }
  if (Object.hasOwn(scriptBodies, name)) {
    const respond = () => { res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript' });res.end(scriptBodies[name]); };
    if (name === 'app.js') respond();
    else setTimeout(respond, delay.js);
    return;
  }
  res.writeHead(404);res.end('Not found');
});

async function waitJson(url, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch {}
    await sleep(80);
  }
  throw new Error('CDP server se nespustil: '+url);
}
function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    if (msg.error) item.reject(new Error(msg.error.message));
    else item.resolve(msg.result);
  });
  return {
    open: new Promise((resolveReady, reject) => {
      socket.addEventListener('open', resolveReady, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP WebSocket chyba')), { once: true });
    }),
    send(method, params = {}) {
      return new Promise((resolveResult, reject) => {
        const n = ++id;
        pending.set(n, { resolve: resolveResult, reject });
        socket.send(JSON.stringify({ id: n, method, params }));
      });
    },
    close() { try { socket.close(); } catch {} }
  };
}
function median(items) {
  const sorted = [...items].sort((a,b) => a-b);
  return sorted[Math.floor(sorted.length / 2)];
}

await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
const baseUrl = 'http://127.0.0.1:'+server.address().port;
const profile = mkdtempSync(join(tmpdir(), 'domacnost-loader-bench-'));
const port = 9700 + Math.floor(Math.random() * 1000);
const browser = spawn(browserPath, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions',
  '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port='+port, '--user-data-dir='+profile, 'about:blank'
], { stdio: 'ignore' });
let control;
try {
  const version = await waitJson('http://127.0.0.1:'+port+'/json/version');
  control = connectCdp(version.webSocketDebuggerUrl);
  await control.open;
  async function trial(variant) {
    const target = await control.send('Target.createTarget', { url: 'about:blank' });
    let page;
    try {
      const items = await waitJson('http://127.0.0.1:'+port+'/json/list');
      const tab = items.find(x => x.id === target.targetId);
      assert.ok(tab?.webSocketDebuggerUrl, 'chybí CDP tab');
      page = connectCdp(tab.webSocketDebuggerUrl);
      await page.open;
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Network.enable');
      await page.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.send('Page.navigate', { url: baseUrl+'/'+variant+'/' });
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        try {
          const result = await page.send('Runtime.evaluate', { expression: 'window.__benchResult || null', returnByValue: true });
          if (result.result?.value) return result.result.value;
        } catch {}
        await sleep(30);
      }
      throw new Error('Timeout prvního otevření '+variant);
    } finally {
      page?.close();
      await control.send('Target.closeTarget', { targetId: target.targetId });
    }
  }

  const samples = { baseline: [], optimized: [] };
  const stages = { baseline: [], optimized: [] };
  for (let i=0; i<rounds; i++) {
    const order = i%2 ? ['optimized','baseline'] : ['baseline','optimized'];
    for (const variant of order) {
      const r = await trial(variant);
      assert.ok(!r.error, variant+' load failed: '+r.error);
      assert.ok(r.ready && r.cssLoaded, variant+' musí být připravený a stylovaný: '+JSON.stringify(r));
      assert.equal(r.order, 'utils,render,actions', variant+' musí zachovat pořadí scriptů');
      assert.equal(r.jsCount, 3, variant+' musí načíst všechny 3 soubory');
      assert.ok(r.cssEnd > 0 && r.firstJsStart > 0, 'chybějí resource timings');
      stages[variant].push(r);
      samples[variant].push(r.ms);
    }
  }
  const baseMs = median(samples.baseline), newMs = median(samples.optimized);
  const saved = baseMs - newMs;
  const percent = Math.round(saved/baseMs * 100);
  const before = stages.baseline.every(x => x.firstJsStart >= x.cssEnd - 20);
  const after = stages.optimized.every(x => x.firstJsStart < x.cssEnd - 30);
  const report = { measurement: 'Chrome module-loader ensure (mock assets, 260ms CSS / 210ms JS fixed latency, 5 cold trials each)', baselineMs:samples.baseline, optimizedMs:samples.optimized, baselineMedianMs:baseMs, optimizedMedianMs:newMs, savedMs:saved, savedPercent:percent, sequentialConfirmed:before, concurrentConfirmed:after };
  console.log('BENCH_RESULT '+JSON.stringify(report));
  assert.ok(before, 'v592 by měla načítat JS až po CSS');
  assert.ok(after, 'aktuální loader by měl stahovat JS během CSS');
  assert.ok(percent >= 20, 'očekávaný rozdíl nejméně 20 % při dané syntetické síti');
} finally {
  try { if (control) await control.send('Browser.close'); } catch {}
  control?.close();
  if (browser.exitCode === null) browser.kill('SIGTERM');
  await new Promise(resolveDone => server.close(resolveDone));
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
