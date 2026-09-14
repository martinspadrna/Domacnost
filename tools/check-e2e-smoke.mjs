#!/usr/bin/env node
// Domácnost+ real-browser E2E smoke.
// Dependency-free: spustí lokální statický server, najde systémový Chrome/Edge,
// připojí se přes Chrome DevTools Protocol a ověří základní boot + nové moduly.

import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const required = process.env.E2E_REQUIRED === '1' || process.env.CI === 'true';
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 25000);
const appSource = readFileSync(join(projectRoot, 'app.js'), 'utf8');
const buildMatch = appSource.match(/const APP_BUILD = (\d+);/);
const expectedBuild = buildMatch ? buildMatch[1] : '0';
const notes = [];
const errors = [];

function ok(message) {
  notes.push(message);
}

function fail(message) {
  errors.push(message);
}

function shouldSkip(message) {
  if (required) {
    fail(message);
    return false;
  }
  console.log(`E2E smoke přeskočen: ${message}`);
  process.exit(0);
}

function commandPath(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function browserCandidates() {
  const envCandidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    process.env.BROWSER_PATH
  ].filter(Boolean);
  const pathCandidates = process.platform === 'win32'
    ? [
        join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe')
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
          '/usr/bin/microsoft-edge',
          '/usr/bin/microsoft-edge-stable'
        ];
  const commandCandidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'msedge']
    .map(commandPath)
    .filter(Boolean);
  return [...envCandidates, ...pathCandidates, ...commandCandidates];
}

function findBrowser() {
  return browserCandidates().find((candidate) => existsSync(candidate)) || '';
}

function stopBrowserProcessTree(browserProcess) {
  if (!browserProcess || browserProcess.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try { browserProcess.kill('SIGTERM'); } catch {}
}

function mimeType(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  }[extname(filePath)] || 'application/octet-stream';
}

function supabaseStubScript() {
  return `<script defer>
    window.supabase = {
      createClient: function () {
        const chain = {
          select: function () { return chain; },
          insert: function () { return chain; },
          update: function () { return chain; },
          delete: function () { return chain; },
          eq: function () { return chain; },
          in: function () { return chain; },
          order: function () { return chain; },
          limit: function () { return chain; },
          single: function () { return Promise.resolve({ data: null, error: null }); },
          maybeSingle: function () { return Promise.resolve({ data: null, error: null }); },
          then: function (resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
        };
        return {
          auth: {
            getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
            onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
            signInWithPassword: function () { return Promise.resolve({ data: {}, error: null }); },
            signUp: function () { return Promise.resolve({ data: {}, error: null }); },
            signOut: function () { return Promise.resolve({ error: null }); },
            resetPasswordForEmail: function () { return Promise.resolve({ error: null }); },
            updateUser: function () { return Promise.resolve({ data: {}, error: null }); }
          },
          from: function () { return chain; },
          channel: function () { return { on: function () { return this; }, subscribe: function () { return this; }, unsubscribe: function () {} }; },
          removeChannel: function () { return Promise.resolve('ok'); },
          storage: { from: function () { return { upload: function () { return Promise.resolve({ data: {}, error: null }); }, download: function () { return Promise.resolve({ data: null, error: null }); }, remove: function () { return Promise.resolve({ data: [], error: null }); }, getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
        };
      }
    };
  </script>`;
}

function startStaticServer() {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname || '/');
      if (pathname === '/') pathname = '/index.html';
      const safePath = normalize(pathname).replace(/^[/\\]+/, '');
      const filePath = resolve(projectRoot, safePath);
      if (!filePath.startsWith(projectRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (safePath === 'index.html') {
        const html = readFileSync(filePath, 'utf8')
          .replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"\s+defer><\/script>/, supabaseStubScript());
        res.writeHead(200, { 'Content-Type': mimeType(filePath), 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      const data = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mimeType(filePath), 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolveServer({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function waitForJson(url, timeout = timeoutMs) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw lastError || new Error(`Timeout waiting for ${url}`);
}

function connectCdp(wsUrl) {
  if (typeof WebSocket !== 'function') {
    shouldSkip('Node runtime nemá global WebSocket pro CDP.');
  }
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveResult, rejectResult } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectResult(new Error(message.error.message || JSON.stringify(message.error)));
    else resolveResult(message.result);
  });
  const openPromise = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket connection failed')), { once: true });
  });
  return {
    socket,
    open: openPromise,
    send(method, params = {}) {
      const nextId = ++id;
      const promise = new Promise((resolveResult, rejectResult) => {
        pending.set(nextId, { resolveResult, rejectResult });
      });
      socket.send(JSON.stringify({ id: nextId, method, params }));
      return promise;
    },
    close() {
      try { socket.close(); } catch {}
    }
  };
}

async function waitForExpression(page, expression, timeout = 3000, interval = 50) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression
    });
    if (result.result?.value) return result.result.value;
    await new Promise((resolveWait) => setTimeout(resolveWait, interval));
  }
  return null;
}

async function dispatchPhysicalClick(page, selector) {
  const rectResult = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      element.scrollIntoView?.({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })()`
  });
  const rect = rectResult.result?.value;
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || rect.width <= 0 || rect.height <= 0) return null;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 });
  return rect;
}

async function measurePhysicalNavClick(page, navId, timeout = 2600) {
  const selector = `.nav-shell .nav-item[data-nav="${String(navId).replace(/"/g, '\\"')}"]`;
  const started = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `performance.now()`
  });
  const startMs = Number(started.result?.value || 0);
  const rect = await dispatchPhysicalClick(page, selector);
  if (!rect) return { navId, found: false, latencyMs: 0 };
  const active = await waitForExpression(page, `(() => {
    const item = document.querySelector(${JSON.stringify(selector)});
    const app = document.querySelector('#app');
    return Boolean(item?.classList?.contains('active') && app?.dataset?.bootOk === '1');
  })()`, timeout, 45);
  const finished = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `performance.now()`
  });
  return {
    navId,
    found: true,
    active: Boolean(active),
    latencyMs: Math.round(Number(finished.result?.value || startMs) - startMs),
    rect
  };
}

function smokeSeedScript() {
  const advancePaymentDate = new Date();
  advancePaymentDate.setMonth(advancePaymentDate.getMonth() - 2, 1);
  const advancePaymentMonth = `${advancePaymentDate.getFullYear()}-${String(advancePaymentDate.getMonth() + 1).padStart(2, '0')}`;
  const readingPreviousDate = new Date();
  readingPreviousDate.setMonth(readingPreviousDate.getMonth() - 2, 1);
  const readingLatestDate = new Date();
  readingLatestDate.setMonth(readingLatestDate.getMonth() - 1, 1);
  const seed = {
    meta: { schemaVersion: 85, appBuild: Number(expectedBuild), mode: 'e2e-smoke', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    household: { id: 'household-e2e-smoke', name: 'Smoke domácnost', isConfigured: true, createdAt: new Date().toISOString() },
    profiles: [{ id: 'profile-e2e-smoke', name: 'Smoke', role: 'admin', createdAt: new Date().toISOString() }],
    activeProfileId: 'profile-e2e-smoke',
    enabledModules: ['weather', 'calendar', 'shopping', 'hdo', 'waste', 'readings', 'pool', 'tasks', 'warranties', 'polishHolidays', 'garage', 'contracts', 'finance', 'subscriptions', 'vape'],
    shoppingLists: [{
      id: 'shopping-list-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      name: 'Smoke nákup',
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    activeShoppingListId: 'shopping-list-e2e-smoke',
    shopping: [{
      id: 'shopping-item-open-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      listId: 'shopping-list-e2e-smoke',
      name: 'Mléko',
      category: 'Potraviny',
      kind: 'Potraviny',
      quantity: 1,
      unit: 'ks',
      done: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, {
      id: 'shopping-item-done-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      listId: 'shopping-list-e2e-smoke',
      name: 'Rohlíky',
      category: 'Pečivo',
      kind: 'Pečivo',
      quantity: 6,
      unit: 'ks',
      done: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    calendarCloud: {
      sources: [{
        id: 'calendar-source-e2e-smoke',
        cloudId: 'calendar-source-e2e-smoke',
        householdId: 'household-e2e-smoke',
        name: 'Smoke kalendar',
        provider: 'manual',
        isEnabled: true,
        syncEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    },
    calendar: [{
      id: 'calendar-event-e2e-smoke',
      cloudId: '',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      sourceId: 'calendar-source-e2e-smoke',
      title: 'Smoke udalost',
      // Událost musí zůstat v aktuálně otevřeném měsíci i při pozdějším běhu CI.
      date: new Date().toISOString().slice(0, 10),
      time: '09:30',
      endTime: '10:15',
      type: 'event',
      location: 'Doma',
      note: 'E2E smoke',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    hdoWindows: [{
      id: 'hdo-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      label: 'Smoke nízký tarif',
      start: '02:00',
      end: '03:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    waste: [{
      id: 'waste-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      type: 'Směsný',
      date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      note: 'E2E smoke',
      repeat: 'none',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    homeTasks: [{
      id: 'task-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      title: 'Smoke úkol',
      due: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      note: 'E2E undo',
      category: 'domacnost',
      priority: 'normal',
      done: false,
      createdAt: new Date().toISOString()
    }],
    vehicles: [{
      id: 'vehicle-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      name: 'Smoke auto',
      brand: 'Test',
      model: 'Modal',
      year: '2024',
      plate: 'SMK 351',
      fuelType: 'benzín',
      odometer: 45000,
      technicalInspectionUntil: '2027-01-01',
      insuranceUntil: '2026-12-31',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    fuel: [{
      id: 'fuel-e2e-smoke',
      vehicleId: 'vehicle-e2e-smoke',
      date: '2026-06-30',
      odometer: 44800,
      liters: 42,
      pricePerLiter: 38.9,
      price: 1633.8,
      note: 'E2E smoke',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    services: [{
      id: 'service-e2e-smoke',
      vehicleId: 'vehicle-e2e-smoke',
      date: '2026-06-20',
      odometer: 44000,
      title: 'Smoke servis',
      price: 2500,
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    readingGroups: [{
      id: 'reading-group-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      name: 'Smoke dům',
      prices: { electricityT1: 6.2, electricityT2: '', gas: '', water: '' },
      deposits: { electricity: 1800, gas: '', water: '' },
      billing: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    readingMeters: [{
      id: 'reading-meter-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      groupId: 'reading-group-e2e-smoke',
      type: 'electricity',
      name: 'Smoke elektroměr',
      unit: 'kWh',
      serial: 'SMOKE-EL-1',
      location: 'Dům',
      pricePerUnit: 6.2,
      monthlyDeposit: 1800,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    readings: [{
      id: 'reading-entry-previous-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      meterId: 'reading-meter-e2e-smoke',
      date: readingPreviousDate.toISOString().slice(0, 10),
      value: 12000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, {
      id: 'reading-entry-latest-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      meterId: 'reading-meter-e2e-smoke',
      date: readingLatestDate.toISOString().slice(0, 10),
      value: 12150,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    warranties: [{
      id: 'warranty-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      name: 'Smoke konvice',
      store: 'Test obchod',
      price: 899,
      purchaseDate: new Date().toISOString().slice(0, 10),
      warrantyYears: 2,
      warrantyUntil: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      status: 'active',
      note: 'E2E undo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    warrantyFiles: [{
      id: 'warranty-file-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      warrantyId: 'warranty-e2e-smoke',
      fileName: 'uctenka-smoke.pdf',
      fileType: 'application/pdf',
      size: 321,
      source: 'upload',
      createdAt: new Date().toISOString()
    }],
    settings: {
      bottomNavIds: ['home', 'finance', 'pool', 'contracts', 'calendar'],
      homeHeroItems: ['pool', 'finance', 'calendar', 'garage'],
      dashboardWidgets: [],
      vehicleServicePlans: {
        'vehicle-e2e-smoke': [{
          id: 'service-plan-e2e-smoke',
          type: 'oil',
          label: 'Olej',
          intervalKm: 15000,
          intervalMonths: 12,
          lastKm: 44000,
          lastDate: '2026-06-20',
          note: 'E2E smoke'
        }]
      }
    },
    vape: {
      startDate: '2026-01-01',
      cigaretteCostPerDay: 150,
      resaleTotal: 0,
      calcBooster: {},
      calcReady: {},
      calcShakeVape: {},
      items: [{
        id: 'vape-item-e2e-smoke-booster',
        category: 'booster',
        name: 'Smoke booster',
        price: 409,
        sizeMl: 50,
        qty: 2,
        rating: 8,
        note: 'E2E smoke'
      }, {
        id: 'vape-item-e2e-smoke-aroma',
        category: 'aroma',
        name: 'Smoke aroma',
        price: 139,
        sizeMl: 10,
        qty: 1,
        rating: 9,
        note: ''
      }]
    },
    contracts: [{
      id: 'contract-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      name: 'Smoke pojistka',
      type: 'home_insurance',
      provider: 'Test',
      number: 'SMOKE-1',
      validFrom: '2026-01-01',
      // +30 dní od běhu testu, ať smlouva vždy spadne do 45denního okna
      // pro urgentContracts a objeví se v Home widgetu Nadcházející.
      validTo: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      amount: 1200,
      frequency: 'monthly',
      note: 'E2E smoke',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    contractFiles: [{
      id: 'contract-file-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      contractId: 'contract-e2e-smoke',
      fileName: 'smlouva-smoke.pdf',
      fileType: 'application/pdf',
      size: 456,
      source: 'upload',
      createdAt: new Date().toISOString()
    }],
    finance: [{
      id: 'finance-entry-e2e-smoke',
      householdId: 'household-e2e-smoke',
      profileId: 'profile-e2e-smoke',
      type: 'expense',
      title: 'Smoke výdaj k obnovení',
      amount: 450,
      date: new Date().toISOString().slice(0, 10),
      paymentMethod: 'card',
      category: 'groceries',
      note: 'E2E undo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    financeLoans: [{
      id: 'loan-e2e-smoke',
      name: 'Smoke půjčka',
      lender: 'Test',
      loanType: 'consumer',
      principal: 120000,
      currentBalance: 90000,
      interestRate: 7.9,
      monthlyPayment: 3100,
      remainingMonths: 36,
      earlyRepaymentFee: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    subscriptionPeople: [{
      id: 'subscription-person-e2e-smoke',
      name: 'Petr',
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, {
      id: 'subscription-person-advance-e2e-smoke',
      name: 'Aleš',
      note: 'Zaplaceno dopředu',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    subscriptions: [{
      id: 'subscription-e2e-smoke',
      serviceKey: 'netflix',
      name: 'Netflix',
      price: 319,
      billingDay: 1,
      maxMembers: 5,
      enabled: true,
      shares: [
        { personId: 'subscription-person-e2e-smoke', amount: 100 },
        { personId: 'subscription-person-advance-e2e-smoke', amount: 300 }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    subscriptionPayments: [{
      id: 'subscription-payment-advance-e2e-smoke',
      subscriptionId: 'subscription-e2e-smoke',
      personId: 'subscription-person-advance-e2e-smoke',
      month: advancePaymentMonth,
      amount: 3600,
      paidAt: new Date().toISOString().slice(0, 10),
      note: 'Platba dopředu',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    pool: {
      shape: 'rect',
      length: 6,
      width: 3,
      depth: 1.2,
      ph: 7.6,
      waterTempC: 24.5,
      targetPh: 7.2,
      dosePer10m3Per01: 100,
      measurements: [
        { id: 'pool-measure-1', date: '2026-06-28', ph: 7.3, waterTempC: 22.2, note: 'start' },
        { id: 'pool-measure-2', date: '2026-06-30', ph: 7.5, waterTempC: 23.8, note: '' },
        { id: 'pool-measure-3', date: '2026-07-02', ph: 7.6, waterTempC: 24.5, note: 'smoke' }
      ],
      updatedAt: new Date().toISOString()
    },
    cloud: {
      provider: 'supabase',
      status: 'signed-in',
      userId: 'user-e2e-smoke',
      email: 'smoke@example.test',
      householdId: 'household-e2e-smoke',
      lastSyncAt: '',
      autoSyncEnabled: true
    }
  };
  const auth = {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-e2e-smoke', email: 'smoke@example.test' }
  };
  return `
    try {
      const noopRegistration = {
        waiting: null,
        installing: null,
        addEventListener: function () {},
        update: function () { return Promise.resolve(); }
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          controller: null,
          ready: Promise.resolve(noopRegistration),
          register: function () { return Promise.resolve(noopRegistration); },
          addEventListener: function () {},
          getRegistration: function () { return Promise.resolve(noopRegistration); }
        }
      });
    } catch {}
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('domacnostPlus.v0.1_86', ${JSON.stringify(JSON.stringify(seed))});
    localStorage.setItem('domacnost-plus-auth', ${JSON.stringify(JSON.stringify(auth))});
    localStorage.setItem('domacnostPlus.moduleTabs', JSON.stringify({ finance: 'loans' }));
  `;
}

async function run() {
  const browserPath = findBrowser();
  if (!browserPath) shouldSkip('nenalezený Chrome/Chromium/Edge binary.');
  ok(`browser: ${browserPath}`);

  const { server, url } = await startStaticServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'domacnost-e2e-'));
  const debugPort = 9300 + Math.floor(Math.random() * 400);
  const browserProcess = spawn(browserPath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let browserCdp = null;
  let page = null;
  try {
    browserProcess.stderr.setEncoding('utf8');
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    browserCdp = connectCdp(version.webSocketDebuggerUrl);
    await browserCdp.open;
    const target = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const tabInfo = targets.find((item) => item.id === target.targetId) || targets.find((item) => item.type === 'page');
    if (!tabInfo?.webSocketDebuggerUrl) throw new Error('Nepovedlo se získat CDP URL pro stránku.');
    page = connectCdp(tabInfo.webSocketDebuggerUrl);
    await page.open;
    const runtimeErrors = [];
    page.socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params?.exceptionDetails || {};
          const description = details.exception?.description || details.exception?.value || details.text || 'Runtime exception';
          runtimeErrors.push(`${description}${details.url ? ` @ ${details.url}:${details.lineNumber || 0}` : ''}`);
        }
      } catch {}
    });
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: smokeSeedScript() });
    await page.send('Page.navigate', { url });
    const bootWaitStart = Date.now();
    while (Date.now() - bootWaitStart < timeoutMs) {
      const bootState = await page.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `Boolean(window.__DOMACNOST_APP_STARTED__ || document.querySelector('#app[data-boot-ok="1"], .home-dash, .app-boot-error'))`
      });
      if (bootState.result?.value) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }

    const initial = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const text = document.body?.innerText || '';
        const homeMain = document.querySelector('.home-redesign-shell.home-app-shell main');
        const homeMainStyle = homeMain ? getComputedStyle(homeMain) : null;
        const navShell = document.querySelector('.nav-shell');
        const navRect = navShell?.getBoundingClientRect?.();
        const navStyle = navShell ? getComputedStyle(navShell) : null;
        return {
          title: document.title,
          appStarted: Boolean(window.__DOMACNOST_APP_STARTED__),
          e2eNavHook: typeof window.__DOMACNOST_E2E_NAV__,
          lazyLoader: Boolean(window.DomacnostModuleLoader),
          deferredModulesAtBoot: {
            shopping: !window.DomacnostShoppingUtils && !window.DomacnostShoppingRender && !window.DomacnostShoppingActions,
            tasks: !window.DomacnostNotes,
            contracts: !window.DomacnostContracts,
            subscriptions: !window.DomacnostSubscriptions,
            warranties: !window.DomacnostWarranty,
            hdo: !window.DomacnostHdo,
            waste: !window.DomacnostWaste,
            finance: !window.DomacnostFinance,
            pool: !window.DomacnostPool,
            readings: !window.DomacnostReadings,
            garage: !window.DomacnostGarage,
            calendar: !window.DomacnostCalendar,
            vape: !window.DomacnostVape
          },
          appRoot: Boolean(document.querySelector('#app')),
          moduleLoadStatus: Boolean(document.querySelector('#module-load-status')),
          moduleLoadStatusHidden: !document.querySelector('#module-load-status')?.classList.contains('is-visible'),
          versionOk: document.title.includes('v.0.1_${expectedBuild}') || text.includes('v.0.1_${expectedBuild}'),
          bootError: Boolean(document.querySelector('.module-error-card, .app-boot-error')),
          homeDash: Boolean(document.querySelector('.home-dash')),
          homeDashTop: Boolean(document.querySelector('.home-dash-top')),
          homeOldHero: Boolean(document.querySelector('.home-minimal-hero, .dashboard-empty-home, .home-daily-hero, .home-dashboard-redesign')),
          homeMainScrollable: Boolean(homeMainStyle && /auto|scroll/.test(homeMainStyle.overflowY)),
          homeMainScrollRange: homeMain ? Math.max(0, homeMain.scrollHeight - homeMain.clientHeight) : 0,
          homeMainAnimationName: homeMainStyle?.animationName || '',
          homeGreeting: Boolean(document.querySelector('.home-dash-greeting')),
          homeTitle: Boolean(document.querySelector('.home-dash-title')),
          homeToday: Boolean(document.querySelector('.home-today-grid .home-today-card')),
          homeFinance: Boolean(document.querySelector('.home-finance-widget')),
          homeAttention: Boolean(document.querySelector('.home-timeline-list .home-timeline-row')),
          homeModules: Boolean(document.querySelector('.home-quick-actions .home-quick-action')),
          bottomNavCount: document.querySelectorAll('.nav-shell .nav-item').length,
          bottomNavGap: navRect ? Math.round(window.innerHeight - navRect.bottom) : null,
          bottomNavCssBottom: navStyle?.bottom || '',
          navPool: Boolean(document.querySelector('[data-nav="pool"]')),
          navFinance: Boolean(document.querySelector('[data-nav="finance"]')),
          navContracts: Boolean(document.querySelector('[data-nav="contracts"]')),
          textSample: text.slice(0, 600)
        };
      })()`
    });
    const initialValue = initial.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG initial:', JSON.stringify(initialValue, null, 2));
      if (runtimeErrors.length) console.log('DEBUG runtime errors:', JSON.stringify(runtimeErrors, null, 2));
    }
    runtimeErrors.forEach((line) => fail(`Runtime chyba v prohlížeči: ${line}`));
    let bootOk = true;
    if (!initialValue.appStarted) { fail('App nenastavila __DOMACNOST_APP_STARTED__.'); bootOk = false; }
    if (!initialValue.lazyLoader) { fail('Chybí loader odložených modulů.'); bootOk = false; }
    if (!Object.values(initialValue.deferredModulesAtBoot || {}).every(Boolean)) { fail('Některý odložený modul znovu blokuje první vykreslení.'); bootOk = false; }
    if (!initialValue.appRoot) { fail('Chybí #app root.'); bootOk = false; }
    if (!initialValue.moduleLoadStatus || !initialValue.moduleLoadStatusHidden) { fail('Stav načítání modulů při klidném bootu chybí nebo zůstává viditelný.'); bootOk = false; }
    if (!initialValue.versionOk) { fail(`Na stránce/title není v0.1_${expectedBuild}.`); bootOk = false; }
    if (initialValue.bootError) { fail('Po bootu je vidět module/app error card.'); bootOk = false; }
    if (!initialValue.homeDash) { fail('Home nepoužívá nový home-dash widget layout.'); bootOk = false; }
    if (!initialValue.homeDashTop) { fail('Home nemá hlavičku home-dash-top (pozdrav + název domácnosti).'); bootOk = false; }
    if (initialValue.homeOldHero) { fail('Home znovu vykresluje starý hero/cockpit layout.'); bootOk = false; }
    if (!initialValue.homeMainScrollable) { fail('Nový Home main není scrollovatelný.'); bootOk = false; }
    if (!(initialValue.homeMainScrollRange > 0)) { fail(`Domů nemá skutečný prostor pro svislý posun (${initialValue.homeMainScrollRange}px).`); bootOk = false; }
    if (initialValue.homeMainAnimationName && initialValue.homeMainAnimationName !== 'none') { fail(`Home main při bootu pořád animuje (${initialValue.homeMainAnimationName}).`); bootOk = false; }
    if (!initialValue.homeGreeting) { fail('Home nemá pozdrav (home-dash-greeting).'); bootOk = false; }
    if (!initialValue.homeTitle) { fail('Home nemá název domácnosti v nadpisu (home-dash-title).'); bootOk = false; }
    if (!initialValue.homeToday) { fail('Home neobsahuje dnešní přehled (home-today-grid).'); bootOk = false; }
    if (!initialValue.homeFinance) { fail('Home neobsahuje finanční widget.'); bootOk = false; }
    if (!initialValue.homeAttention) { fail('Home neobsahuje seznam Nadcházející.'); bootOk = false; }
    if (!initialValue.homeModules) { fail('Home neobsahuje Rychlé akce.'); bootOk = false; }
    if (initialValue.bottomNavCount !== 5) { fail(`Spodní lišta má ${initialValue.bottomNavCount} položek místo 5 včetně Více.`); bootOk = false; }
    if (!Number.isFinite(initialValue.bottomNavGap) || initialValue.bottomNavGap < 0 || initialValue.bottomNavGap > 8) { fail(`Spodní lišta není při bootu ukotvená dole (gap ${initialValue.bottomNavGap}, css bottom ${initialValue.bottomNavCssBottom}).`); bootOk = false; }
    if (!initialValue.navPool) { fail('Po seed bootu není dostupná navigace Bazén.'); bootOk = false; }
    if (!initialValue.navFinance) { fail('Po seed bootu není dostupná navigace Finance.'); bootOk = false; }
    if (!initialValue.navContracts) { fail('Po seed bootu není dostupná navigace Smlouvy.'); bootOk = false; }
    if (bootOk) ok('boot: nový Home, app root, verze, Finance, Bazén i Smlouvy navigace dostupné.');

    await page.send('Runtime.evaluate', {
      expression: `(() => {
        const main = document.querySelector('.home-redesign-shell.home-app-shell main');
        if (main) main.scrollTop = Math.min(180, Math.max(0, main.scrollHeight - main.clientHeight));
      })()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const homeScrollCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const main = document.querySelector('.home-redesign-shell.home-app-shell main');
        return { scrollTop: Number(main?.scrollTop || 0), range: main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0 };
      })()`
    });
    const homeScrollValue = homeScrollCheck.result?.value || {};
    if (!(homeScrollValue.range > 0) || !(homeScrollValue.scrollTop > 0)) fail(`Domů nejde skutečně posunout (rozsah ${homeScrollValue.range || 0}px, posun ${homeScrollValue.scrollTop || 0}px).`);
    else ok(`Domů: svislý obsah lze posunout o ${homeScrollValue.range}px.`);

    await page.send('Runtime.evaluate', {
      expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    await page.send('Runtime.evaluate', {
      expression: `(() => { const input = document.querySelector('[data-global-search-input]'); if (input) { input.value = 'Smoke nákup'; input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Smoke nákup', inputType: 'insertText' })); } })()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const globalToolsCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const searchModal = document.querySelector('.global-search-modal');
        const searchResults = document.querySelectorAll('.global-search-result').length;
        const shoppingResult = document.querySelector('.global-search-result[data-nav="shopping"]');
        const searchFocused = document.activeElement?.matches?.('[data-global-search-input]') || false;
        const searchSurface = document.querySelector('#app')?.dataset?.lastRenderSurface || '';
        document.querySelector('[data-action="close-global-tools"]')?.click();
        const closeSearchSurface = document.querySelector('#app')?.dataset?.lastRenderSurface || '';
        document.querySelector('[data-action="open-global-search"]')?.click();
        const directSearchSurface = document.querySelector('#app')?.dataset?.lastRenderSurface || '';
        document.querySelector('[data-action="close-global-tools"]')?.click();
        document.querySelector('[data-action="open-global-quick-add"]')?.click();
        const quickAddSurface = document.querySelector('#app')?.dataset?.lastRenderSurface || '';
        const quickItems = document.querySelectorAll('.global-quick-add-item').length;
        document.querySelector('[data-action="close-global-tools"]')?.click();
        document.querySelector('[data-action="open-global-alerts"]')?.click();
        const alertsSurface = document.querySelector('#app')?.dataset?.lastRenderSurface || '';
        const alertsModal = document.querySelector('.global-alerts-modal');
        const alertsSettings = document.querySelector('.global-alerts-modal [data-nav="settings"][data-target-tab="notifications"]');
        const advancePayerAlert = Boolean(alertsModal?.innerText?.includes('Aleš'));
        document.querySelector('[data-action="close-global-tools"]')?.click();
        return { searchModal: Boolean(searchModal), searchResults, shoppingResult: Boolean(shoppingResult), searchFocused, searchSurface, closeSearchSurface, directSearchSurface, quickAddSurface, alertsSurface, quickItems, alertsModal: Boolean(alertsModal), alertsSettings: Boolean(alertsSettings), advancePayerAlert };
      })()`
    });
    const globalToolsValue = globalToolsCheck.result?.value || {};
    let globalToolsOk = true;
    if (!globalToolsValue.searchModal || globalToolsValue.searchResults < 1) { fail('Globální hledání nevrátilo seed data.'); globalToolsOk = false; }
    if (!globalToolsValue.shoppingResult) { fail('Globální hledání neprohledává nákupní položky.'); globalToolsOk = false; }
    if (!globalToolsValue.searchFocused) { fail('Klávesová zkratka Ctrl/⌘ + K neotevřela hledání s fokusem v poli.'); globalToolsOk = false; }
    if (![globalToolsValue.closeSearchSurface, globalToolsValue.directSearchSurface, globalToolsValue.quickAddSurface, globalToolsValue.alertsSurface].every((surface) => surface === 'overlay')) { fail(`Globální nástroje nepoužily ve všech krocích samostatný overlay render (${[globalToolsValue.searchSurface, globalToolsValue.closeSearchSurface, globalToolsValue.directSearchSurface, globalToolsValue.quickAddSurface, globalToolsValue.alertsSurface].join(', ')}).`); globalToolsOk = false; }
    if (globalToolsValue.quickItems < 6) { fail('Rychlé přidání nenabízí všechny hlavní typy záznamů.'); globalToolsOk = false; }
    if (!globalToolsValue.alertsModal || !globalToolsValue.alertsSettings) { fail('Centrum upozornění nebo jeho nastavení se nevykreslilo.'); globalToolsOk = false; }
    if (globalToolsValue.advancePayerAlert) { fail('Upozornění označilo Aleše jako dlužníka, přestože má dostatečný kredit z platby dopředu.'); globalToolsOk = false; }
    if (globalToolsOk) ok('Globální nástroje: Ctrl/⌘ + K, rozšířené hledání, rychlé přidání a upozornění fungují bez přestavby shellu.');
    const homeScrollBeforeNavCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `Number(document.querySelector('.home-redesign-shell.home-app-shell main')?.scrollTop || 0)`
    });
    const homeScrollBeforeNav = Number(homeScrollBeforeNavCheck.result?.value || 0);
    if (!(homeScrollBeforeNav > 0)) fail('Globální nástroje vynulovaly pozici posunu Domů.');

    await page.send('Runtime.evaluate', {
      expression: `document.querySelector('.nav-shell .nav-item[data-nav="finance"]')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))`
    });
    const financeIntentWarm = await waitForExpression(page, `Boolean(window.DomacnostFinance)`, 2600, 40);
    const financeIntentState = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ warmed: Boolean(window.DomacnostFinance), stayedHome: document.querySelector('.nav-shell .nav-item[data-nav="home"]')?.classList.contains('active') === true, busy: document.documentElement.classList.contains('app-module-loading') || document.querySelector('#module-load-status')?.classList.contains('is-visible') })`
    });
    if (!financeIntentWarm || !financeIntentState.result?.value?.warmed) fail('Performance: záměr otevřít Finance nepřipravil modul před kliknutím.');
    else if (!financeIntentState.result?.value?.stayedHome) fail('Performance: přednačtení Financí samo změnilo otevřený modul.');
    else if (financeIntentState.result?.value?.busy) fail('Performance: tiché přednačtení Financí zobrazilo rušivý stav načítání.');
    else ok('Performance: najetí připraví Finance bez změny otevřené obrazovky.');

    const firstPhysicalNav = await measurePhysicalNavClick(page, 'finance');
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG first physical nav:', JSON.stringify(firstPhysicalNav, null, 2));
    }
    if (!firstPhysicalNav.found) {
      fail('Performance: fyzicky kliknutelne Finance ve spodni liste nebyly nalezeny.');
    } else if (!firstPhysicalNav.active) {
      fail('Performance: prvni fyzicky klik na Finance neprepnul modul vcas.');
    } else if (Number(firstPhysicalNav.latencyMs || 0) > 1800) {
      fail(`Performance: prvni fyzicky klik na Finance trval ${firstPhysicalNav.latencyMs} ms.`);
    } else {
      ok(`Performance: prvni fyzicky klik na Finance ${firstPhysicalNav.latencyMs} ms.`);
    }
    const financeLazyReady = await page.send('Runtime.evaluate', { returnByValue: true, expression: `({ ready: Boolean(window.DomacnostFinance && document.querySelector('[data-tab-area="finance"]')), busy: document.documentElement.classList.contains('app-module-loading') || document.querySelector('#module-load-status')?.classList.contains('is-visible') })` });
    if (!financeLazyReady.result?.value?.ready) fail('Finance se po prvním kliknutí nenačetly jako odložený modul.');
    else if (financeLazyReady.result?.value?.busy) fail('Stav načítání zůstal viset i po otevření Financí.');
    else ok('Lazy loading: připravené Finance se po prvním kliknutí správně vykreslily.');

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('finance', 'add')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 140));
    await page.send('Runtime.evaluate', {
      expression: `(() => {
        const input = document.querySelector('form[data-form="add-finance"] input[name="title"]');
        if (!input) return false;
        input.value = 'Rozepsaný nákup E2E';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Rozepsaný nákup E2E', inputType: 'insertText' }));
        return true;
      })()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 340));
    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('home')`, awaitPromise: true });
    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('finance', 'add')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 160));
    const financeDraftCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const form = document.querySelector('form[data-form="add-finance"]');
        return {
          value: form?.querySelector('input[name="title"]')?.value || '',
          restored: form?.dataset?.draftRestored === 'true',
          stored: (sessionStorage.getItem('domacnostPlus.formDrafts.v1') || '').includes('Rozepsaný nákup E2E')
        };
      })()`
    });
    const financeDraftValue = financeDraftCheck.result?.value || {};
    if (financeDraftValue.value !== 'Rozepsaný nákup E2E' || !financeDraftValue.restored || !financeDraftValue.stored) {
      fail(`Koncept formuláře se po přechodu mezi moduly neobnovil (${JSON.stringify(financeDraftValue)}).`);
    } else {
      ok('Formuláře: rozepsané údaje přežijí přechod do jiného modulu i session uložení.');
    }

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('finance', 'summary')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="delete-finance"][data-id="finance-entry-e2e-smoke"]')?.click()` });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const financeUndoDeleted = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ removed: !document.querySelector('[data-action="delete-finance"][data-id="finance-entry-e2e-smoke"]'), undoVisible: Boolean(document.querySelector('#undo-toast.show .undo-toast-button')), undoText: document.querySelector('#undo-toast')?.innerText || '' })`
    });
    const financeUndoDeletedValue = financeUndoDeleted.result?.value || {};
    if (!financeUndoDeletedValue.removed || !financeUndoDeletedValue.undoVisible || !financeUndoDeletedValue.undoText.includes('Záznam smazán')) {
      fail(`Finance: smazání nenabídlo funkční návrat (${JSON.stringify(financeUndoDeletedValue)}).`);
    } else {
      await page.send('Runtime.evaluate', { expression: `document.querySelector('#undo-toast .undo-toast-button')?.click()` });
      await waitForExpression(page, `document.querySelectorAll('[data-action="delete-finance"][data-id="finance-entry-e2e-smoke"]').length === 1`, 2200, 50);
      const financeUndoRestored = await page.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({ count: document.querySelectorAll('[data-action="delete-finance"][data-id="finance-entry-e2e-smoke"]').length, undoGone: !document.querySelector('#undo-toast'), toast: document.querySelector('#copy-toast')?.textContent || '' })`
      });
      const financeUndoRestoredValue = financeUndoRestored.result?.value || {};
      if (financeUndoRestoredValue.count !== 1 || !financeUndoRestoredValue.undoGone) {
        fail(`Finance: Vrátit zpět neobnovilo právě jeden záznam (${JSON.stringify(financeUndoRestoredValue)}).`);
      } else ok('Finance: omylem smazaný pohyb lze vrátit zpět bez duplicity.');
    }

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('subscriptions', 'services')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="delete-subscription"][data-id="subscription-e2e-smoke"]')?.click()` });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const subscriptionUndoDeleted = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ removed: !document.querySelector('[data-action="delete-subscription"][data-id="subscription-e2e-smoke"]'), undoVisible: Boolean(document.querySelector('#undo-toast.show .undo-toast-button')), undoText: document.querySelector('#undo-toast')?.innerText || '' })`
    });
    const subscriptionUndoDeletedValue = subscriptionUndoDeleted.result?.value || {};
    if (!subscriptionUndoDeletedValue.removed || !subscriptionUndoDeletedValue.undoVisible || !subscriptionUndoDeletedValue.undoText.includes('Předplatné smazané')) {
      fail(`Předplatné: smazání nenabídlo funkční návrat (${JSON.stringify(subscriptionUndoDeletedValue)}).`);
    } else {
      await page.send('Runtime.evaluate', { expression: `document.querySelector('#undo-toast .undo-toast-button')?.click()` });
      await waitForExpression(page, `document.querySelectorAll('[data-action="delete-subscription"][data-id="subscription-e2e-smoke"]').length === 1`, 2200, 50);
      const subscriptionUndoRestored = await page.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({ count: document.querySelectorAll('[data-action="delete-subscription"][data-id="subscription-e2e-smoke"]').length, undoGone: !document.querySelector('#undo-toast'), toast: document.querySelector('#copy-toast')?.textContent || '' })`
      });
      const subscriptionUndoRestoredValue = subscriptionUndoRestored.result?.value || {};
      if (subscriptionUndoRestoredValue.count !== 1 || !subscriptionUndoRestoredValue.undoGone) {
        fail(`Předplatné: Vrátit zpět neobnovilo právě jednu službu (${JSON.stringify(subscriptionUndoRestoredValue)}).`);
      } else ok('Předplatné: smazanou službu lze vrátit včetně navázaných dat.');
    }

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('shopping', 'list')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="delete"][data-collection="shopping"][data-id="shopping-item-open-e2e-smoke"]')?.click()` });
    await waitForExpression(page, `!document.querySelector('[data-action="delete"][data-collection="shopping"][data-id="shopping-item-open-e2e-smoke"]') && Boolean(document.querySelector('#undo-toast.show .undo-toast-button'))`, 2400, 50);
    const shoppingUndoDeleted = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ removed: !document.querySelector('[data-action="delete"][data-collection="shopping"][data-id="shopping-item-open-e2e-smoke"]'), undoVisible: Boolean(document.querySelector('#undo-toast.show .undo-toast-button')) })`
    });
    if (!shoppingUndoDeleted.result?.value?.removed || !shoppingUndoDeleted.result?.value?.undoVisible) {
      fail(`Nákupy: smazání položky nenabídlo návrat (${JSON.stringify(shoppingUndoDeleted.result?.value || {})}).`);
    } else {
      await page.send('Runtime.evaluate', { expression: `document.querySelector('#undo-toast .undo-toast-button')?.click()` });
      await new Promise((resolveWait) => setTimeout(resolveWait, 180));
      const restored = await page.send('Runtime.evaluate', { returnByValue: true, expression: `document.querySelectorAll('[data-action="delete"][data-collection="shopping"][data-id="shopping-item-open-e2e-smoke"]').length` });
      if (restored.result?.value !== 1) fail('Nákupy: položka se po Vrátit zpět neobnovila právě jednou.');
      else ok('Nákupy: smazanou položku lze vrátit zpět.');
    }

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('calendar', 'overview')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="calendar-event-detail"][data-id="calendar-event-e2e-smoke"]')?.click()` });
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="delete-calendar"][data-id="calendar-event-e2e-smoke"]')?.click()` });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const calendarUndoDeleted = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ removed: !document.querySelector('[data-action="calendar-event-detail"][data-id="calendar-event-e2e-smoke"]'), undoVisible: Boolean(document.querySelector('#undo-toast.show .undo-toast-button')) })`
    });
    if (!calendarUndoDeleted.result?.value?.removed || !calendarUndoDeleted.result?.value?.undoVisible) {
      fail(`Kalendář: smazání události nenabídlo návrat (${JSON.stringify(calendarUndoDeleted.result?.value || {})}).`);
    } else {
      await page.send('Runtime.evaluate', { expression: `document.querySelector('#undo-toast .undo-toast-button')?.click()` });
      const calendarRestoredReady = await waitForExpression(page, `document.querySelectorAll('[data-action="calendar-event-detail"][data-id="calendar-event-e2e-smoke"]').length === 1`, 1600, 50);
      const restored = await page.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const saved = JSON.parse(localStorage.getItem('domacnostPlus.v0.1_86') || '{}'); return { domCount: document.querySelectorAll('[data-action="calendar-event-detail"][data-id="calendar-event-e2e-smoke"]').length, savedCount: (saved.calendar || []).filter((item) => item.id === 'calendar-event-e2e-smoke').length, calendarText: document.querySelector('[data-tab-area="calendar"]')?.innerText?.includes('Smoke udalost') || false }; })()` });
      if (!calendarRestoredReady || restored.result?.value?.domCount !== 1) fail(`Kalendář: událost se po Vrátit zpět neobnovila právě jednou (${JSON.stringify(restored.result?.value || {})}).`);
      else ok('Kalendář: smazanou událost lze vrátit zpět.');
    }

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('warranties', 'overview')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="open-warranty-detail"][data-id="warranty-e2e-smoke"]')?.click()` });
    await waitForExpression(page, `Boolean(document.querySelector('[data-action="delete-warranty"][data-id="warranty-e2e-smoke"]'))`, 1600, 50);
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="delete-warranty"][data-id="warranty-e2e-smoke"]')?.click()` });
    await waitForExpression(page, `!document.querySelector('[data-action="open-warranty-detail"][data-id="warranty-e2e-smoke"]') && Boolean(document.querySelector('#undo-toast.show .undo-toast-button'))`, 2400, 50);
    const warrantyUndoDeleted = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ removed: !document.querySelector('[data-action="open-warranty-detail"][data-id="warranty-e2e-smoke"]'), undoVisible: Boolean(document.querySelector('#undo-toast.show .undo-toast-button')) })`
    });
    if (!warrantyUndoDeleted.result?.value?.removed || !warrantyUndoDeleted.result?.value?.undoVisible) {
      fail(`Záruky: smazání nenabídlo návrat (${JSON.stringify(warrantyUndoDeleted.result?.value || {})}).`);
    } else {
      await page.send('Runtime.evaluate', { expression: `document.querySelector('#undo-toast .undo-toast-button')?.click()` });
      const warrantyRestoredReady = await waitForExpression(page, `document.querySelectorAll('[data-action="open-warranty-detail"][data-id="warranty-e2e-smoke"]').length === 1`, 1600, 50);
      await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="open-warranty-detail"][data-id="warranty-e2e-smoke"]')?.click()` });
      await waitForExpression(page, `Boolean(document.querySelector('[data-action="delete-warranty"][data-id="warranty-e2e-smoke"]'))`, 1200, 40);
      const restored = await page.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({ warrantyCount: document.querySelectorAll('[data-action="delete-warranty"][data-id="warranty-e2e-smoke"]').length, fileCount: document.querySelectorAll('[data-action="open-warranty-file"][data-id="warranty-file-e2e-smoke"]').length })`
      });
      if (!warrantyRestoredReady || restored.result?.value?.warrantyCount !== 1 || restored.result?.value?.fileCount < 1) fail(`Záruky: záruka nebo příloha se neobnovila (${JSON.stringify(restored.result?.value || {})}).`);
      else ok('Záruky: smazanou záruku lze vrátit včetně příloh.');
      await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="close-modal"]')?.click()` });
    }

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('readings', 'history')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="delete-reading-entry"][data-id="reading-entry-latest-e2e-smoke"]')?.click()` });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const readingUndoDeleted = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ removed: !document.querySelector('[data-action="delete-reading-entry"][data-id="reading-entry-latest-e2e-smoke"]'), undoVisible: Boolean(document.querySelector('#undo-toast.show .undo-toast-button')) })`
    });
    if (!readingUndoDeleted.result?.value?.removed || !readingUndoDeleted.result?.value?.undoVisible) {
      fail(`Odečty: smazání nenabídlo návrat (${JSON.stringify(readingUndoDeleted.result?.value || {})}).`);
    } else {
      await page.send('Runtime.evaluate', { expression: `document.querySelector('#undo-toast .undo-toast-button')?.click()` });
      await new Promise((resolveWait) => setTimeout(resolveWait, 180));
      const restored = await page.send('Runtime.evaluate', { returnByValue: true, expression: `document.querySelectorAll('[data-action="delete-reading-entry"][data-id="reading-entry-latest-e2e-smoke"]').length` });
      if (restored.result?.value !== 1) fail('Odečty: odečet se po Vrátit zpět neobnovil právě jednou.');
      else ok('Odečty: smazaný odečet lze vrátit zpět.');
    }

    const verifyHouseholdUndo = async ({ label, nav, selector, beforeExpression = '', restoredExpression = '' }) => {
      await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__(${JSON.stringify(nav.module)}, ${JSON.stringify(nav.tab || '')})`, awaitPromise: true });
      if (beforeExpression) {
        await page.send('Runtime.evaluate', { expression: beforeExpression, awaitPromise: true });
      }
      const selectorJson = JSON.stringify(selector);
      const found = await waitForExpression(page, `Boolean(document.querySelector(${selectorJson}))`, 2400, 50);
      if (!found) {
        fail(`${label}: mazací akce nebyla v modulu nalezena.`);
        return;
      }
      await page.send('Runtime.evaluate', { expression: `window.confirm = () => true; document.querySelector(${selectorJson})?.click()` });
      const removed = await waitForExpression(page, `!document.querySelector(${selectorJson}) && Boolean(document.querySelector('#undo-toast.show .undo-toast-button'))`, 2400, 50);
      if (!removed) {
        fail(`${label}: smazání nenabídlo Vrátit zpět.`);
        return;
      }
      await page.send('Runtime.evaluate', { expression: `document.querySelector('#undo-toast .undo-toast-button')?.click()` });
      const restored = await waitForExpression(page, restoredExpression || `Boolean(document.querySelector(${selectorJson}))`, 3000, 50);
      if (!restored) fail(`${label}: data se po Vrátit zpět neobnovila.`);
      else ok(`${label}: smazání lze vrátit zpět bez ztráty dat.`);
    };

    await verifyHouseholdUndo({
      label: 'HDO',
      nav: { module: 'hdo' },
      selector: '[data-action="delete-hdo"][data-id="hdo-e2e-smoke"]',
      restoredExpression: `(() => { const saved = JSON.parse(localStorage.getItem('domacnostPlus.v0.1_86') || '{}'); return (saved.hdoWindows || []).filter((item) => item.id === 'hdo-e2e-smoke').length === 1; })()`
    });
    await verifyHouseholdUndo({
      label: 'Odpad',
      nav: { module: 'waste' },
      selector: '[data-action="delete-waste"][data-id="waste-e2e-smoke"]'
    });
    await verifyHouseholdUndo({
      label: 'Zápisník / úkoly',
      nav: { module: 'tasks' },
      beforeExpression: `document.querySelector('[data-action="set-section-tab"][data-area="notebook"][data-tab="tasks"]')?.click()`,
      selector: '[data-action="task-delete"][data-id="task-e2e-smoke"]'
    });
    await verifyHouseholdUndo({
      label: 'Bazén / měření',
      nav: { module: 'pool', tab: 'overview' },
      selector: '[data-action="pool-measurement-delete"][data-id="pool-measure-3"]'
    });
    await verifyHouseholdUndo({
      label: 'Smlouvy / přílohy',
      nav: { module: 'contracts' },
      selector: '[data-action="delete"][data-collection="contracts"][data-id="contract-e2e-smoke"]',
      restoredExpression: `(() => { const saved = JSON.parse(localStorage.getItem('domacnostPlus.v0.1_86') || '{}'); return (saved.contracts || []).filter((item) => item.id === 'contract-e2e-smoke').length === 1 && (saved.contractFiles || []).filter((item) => item.id === 'contract-file-e2e-smoke').length === 1; })()`
    });
    await verifyHouseholdUndo({
      label: 'Garáž / auto',
      nav: { module: 'garage', tab: 'detail' },
      selector: '[data-action="delete-vehicle"][data-id="vehicle-e2e-smoke"]',
      restoredExpression: `(() => { const saved = JSON.parse(localStorage.getItem('domacnostPlus.v0.1_86') || '{}'); return (saved.vehicles || []).filter((item) => item.id === 'vehicle-e2e-smoke').length === 1 && (saved.fuel || []).filter((item) => item.id === 'fuel-e2e-smoke').length === 1 && (saved.services || []).filter((item) => item.id === 'service-e2e-smoke').length === 1; })()`
    });

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('hdo')`, awaitPromise: true });
    await waitForExpression(page, `Boolean(document.querySelector('[data-action="delete-hdo"][data-id="hdo-e2e-smoke"]'))`, 1800, 50);
    await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="delete-hdo"][data-id="hdo-e2e-smoke"]')?.click()` });
    await waitForExpression(page, `Boolean(document.querySelector('#undo-toast.show'))`, 1200, 40);
    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_EXPIRE_UNDO__?.()` });
    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('settings', 'data')`, awaitPromise: true });
    const trashVisible = await waitForExpression(page, `Boolean(document.querySelector('[data-trash-card] [data-action="restore-trash"]'))`, 1800, 50);
    const trashState = await page.send('Runtime.evaluate', { returnByValue: true, expression: `window.__DOMACNOST_E2E_TRASH_SNAPSHOT__?.()` });
    if (!trashVisible || !(trashState.result?.value?.trash || []).some((entry) => /Smoke/i.test(entry.label || '') || /tarif/i.test(entry.label || ''))) {
      fail(`Koš: smazaný HDO záznam nezůstal dostupný po vypršení rychlého návratu (${JSON.stringify(trashState.result?.value || {})}).`);
    } else {
      await page.send('Runtime.evaluate', { expression: `document.querySelector('[data-trash-card] [data-action="restore-trash"]')?.click()` });
      await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('hdo')`, awaitPromise: true });
      const restoredFromTrash = await waitForExpression(page, `Boolean(document.querySelector('[data-action="delete-hdo"][data-id="hdo-e2e-smoke"]'))`, 2200, 50);
      if (!restoredFromTrash) fail('Koš: obnovení nevrátilo HDO záznam do modulu.');
      else ok('Koš: po vypršení rychlého návratu lze záznam obnovit z 30denního koše.');
    }

    const submitGuardCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const host = document.querySelector('[data-module-content]') || document.querySelector('main');
        const form = document.createElement('form');
        form.dataset.form = 'e2e-submit-guard';
        form.innerHTML = '<button class="primary-btn" type="submit">Uložit test</button>';
        let starts = 0;
        form.addEventListener('domacnost:submit-start', () => { starts += 1; });
        host.appendChild(form);
        const button = form.querySelector('button');
        form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
        form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
        window.__DOMACNOST_E2E_SUBMIT_FORM__ = form;
        return {
          starts,
          busy: form.getAttribute('aria-busy'),
          disabled: button.disabled,
          label: button.textContent.trim()
        };
      })()`
    });
    const submitGuardValue = submitGuardCheck.result?.value || {};
    let submitGuardOk = true;
    if (submitGuardValue.starts !== 1 || submitGuardValue.busy !== 'true' || !submitGuardValue.disabled || submitGuardValue.label !== 'Ukládám…') {
      fail(`Ochrana proti dvojímu uložení se neaktivovala správně (${JSON.stringify(submitGuardValue)}).`);
      submitGuardOk = false;
    }

    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('home')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const restoredHomeScroll = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({ scrollTop: Number(document.querySelector('.home-redesign-shell.home-app-shell main')?.scrollTop || 0), saved: window.__DOMACNOST_E2E_SCROLL_POSITIONS__?.() || {} })`
    });
    const restoredHomeScrollValue = restoredHomeScroll.result?.value || {};
    if (!(Number(restoredHomeScrollValue.scrollTop || 0) >= Math.max(1, homeScrollBeforeNav - 2))) fail(`Domů po návratu z jiného modulu zapomnělo pozici posunu (${restoredHomeScrollValue.scrollTop || 0}px místo ${homeScrollBeforeNav}px; uložené ${JSON.stringify(restoredHomeScrollValue.saved || {})}).`);
    else ok('Navigace: každý modul si zachovává vlastní pozici posunu.');
    await page.send('Runtime.evaluate', { expression: `window.__DOMACNOST_E2E_NAV__('finance')`, awaitPromise: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));

    await page.send('Runtime.evaluate', {
      expression: `window.__DOMACNOST_E2E_NAV__ ? window.__DOMACNOST_E2E_NAV__('more') : (() => { const item = document.querySelector('[data-nav="more"]'); item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); })()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const moreCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const headings = Array.from(document.querySelectorAll('.more-module-section h2')).map((node) => node.textContent.trim());
        const hub = document.querySelector('.more-clean-hub');
        const hubStyle = hub ? getComputedStyle(hub) : null;
        const hubRect = hub ? hub.getBoundingClientRect() : null;
        const settingsCard = document.querySelector('.more-settings-card[data-nav="settings"]');
        const settingsCardStyle = settingsCard ? getComputedStyle(settingsCard) : null;
        const section = document.querySelector('.more-module-section');
        const sectionStyle = section ? getComputedStyle(section) : null;
        const moduleGrid = document.querySelector('.more-module-section .more-module-grid');
        const moduleGridStyle = moduleGrid ? getComputedStyle(moduleGrid) : null;
        const moduleCard = document.querySelector('.more-module-section .more-module-card');
        const moduleCardStyle = moduleCard ? getComputedStyle(moduleCard) : null;
        const moduleCardRect = moduleCard ? moduleCard.getBoundingClientRect() : null;
        const moduleCopy = moduleCard ? moduleCard.querySelector('.more-module-copy strong') : null;
        const moduleCopyStyle = moduleCopy ? getComputedStyle(moduleCopy) : null;
        return {
          text: (document.body?.innerText || '').slice(0, 400),
          lastNav: window.__DOMACNOST_E2E_LAST_NAV__ || '',
          moreButton: document.querySelector('[data-nav="more"]')?.outerHTML?.slice(0, 220) || '',
          moreInApp: Boolean(document.querySelector('[data-nav="more"]')?.closest('#app')),
          settings: Boolean(document.querySelector('.more-settings-card[data-nav="settings"]')),
          sectionCount: document.querySelectorAll('.more-module-section').length,
          hasDaily: headings.includes('Přehled'),
          hasHome: headings.includes('Domácnost'),
          hasMoney: headings.includes('Finance'),
          moduleShortcutCount: document.querySelectorAll('.more-module-section [data-nav]').length,
          hubOneColumn: Boolean(hubStyle && hubStyle.display === 'grid' && hubStyle.gridTemplateColumns.trim().split(/\\s+/).length === 1),
          settingsSurface: Boolean(settingsCardStyle && settingsCardStyle.display === 'grid' && parseFloat(settingsCardStyle.borderTopLeftRadius) >= 16),
          sectionSurface: Boolean(sectionStyle && sectionStyle.display === 'grid' && parseFloat(sectionStyle.borderTopLeftRadius) >= 16),
          moduleGridSurface: Boolean(moduleGridStyle && moduleGridStyle.display === 'grid' && moduleGridStyle.gridTemplateColumns.trim().split(/\\s+/).length === 1),
          moduleCardSurface: Boolean(moduleCardStyle && moduleCardStyle.display === 'grid' && parseFloat(moduleCardStyle.borderTopLeftRadius) >= 16),
          moduleCardFits: Boolean(hubRect && moduleCardRect && moduleCardRect.width <= hubRect.width + 1),
          moduleCopyClamp: Boolean(moduleCopyStyle && moduleCopyStyle.overflow === 'hidden' && moduleCopyStyle.textOverflow === 'ellipsis')
        };
      })()`
    });
    const moreValue = moreCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG more:', JSON.stringify(moreValue, null, 2));
    }
    let moreOk = true;
    if (!moreValue.settings) { fail('Více neobsahuje vstup do Nastavení.'); moreOk = false; }
    if (moreValue.sectionCount < 3) { fail('Více nemá skupiny modulů.'); moreOk = false; }
    if (!moreValue.hasDaily) { fail('Více nemá sekci Přehled.'); moreOk = false; }
    if (!moreValue.hasHome) { fail('Více nemá sekci Domácnost.'); moreOk = false; }
    if (!moreValue.hasMoney) { fail('Více nemá sekci Finance.'); moreOk = false; }
    if (moreValue.moduleShortcutCount < 8) { fail('Více nemá dost modulových zkratek.'); moreOk = false; }
    if (!moreValue.hubOneColumn) { fail('Vice hub neni na mobilu jednosloupcovy grid.'); moreOk = false; }
    if (!moreValue.settingsSurface) { fail('Vice Nastaveni karta nema novy grid povrch.'); moreOk = false; }
    if (!moreValue.sectionSurface) { fail('Vice sekce modulu nema novy povrch.'); moreOk = false; }
    if (!moreValue.moduleGridSurface) { fail('Vice modulova sekce neni na mobilu jednosloupcovy grid.'); moreOk = false; }
    if (!moreValue.moduleCardSurface) { fail('Vice modulova karta nema novy grid povrch.'); moreOk = false; }
    if (!moreValue.moduleCardFits) { fail('Vice modulova karta presahuje sirku hubu.'); moreOk = false; }
    if (!moreValue.moduleCopyClamp) { fail('Vice modulova karta nema kontrolovany orez dlouheho nazvu.'); moreOk = false; }
    if (moreOk) ok('Vice: nastaveni, skupiny modulu a novy povrch renderuji.');

    await page.send('Runtime.evaluate', {
      expression: `(() => {
        if (typeof window.__DOMACNOST_E2E_NAV__ === 'function') {
          window.__DOMACNOST_E2E_NAV__('weather', 'astronomy');
          return;
        }
        const item = Array.from(document.querySelectorAll('[data-nav="weather"]')).find((node) => node.offsetParent !== null);
        item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        setTimeout(() => document.querySelector('[data-action="set-section-tab"][data-area="weather"][data-tab="astronomy"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })), 100);
      })()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const weatherCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const module = document.querySelector('.module-tabbed[data-tab-area="weather"]');
        const panel = document.querySelector('.weather-astronomy-card');
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const text = document.body?.innerText || '';
        return {
          module: Boolean(module),
          panel: Boolean(panel),
          panelSurface: Boolean(panelStyle && parseFloat(panelStyle.borderTopLeftRadius) >= 16),
          moonIcon: Boolean(document.querySelector('.weather-moon-icon')),
          text: text.slice(0, 500),
          lastNav: window.__DOMACNOST_E2E_LAST_NAV__ || '',
          errorCard: document.querySelector('.module-error-card')?.innerText?.slice(0, 300) || '',
          noDetailText: !text.includes('Detail ›'),
          noAstronomyNote: !text.includes('Východ a západ slunce jsou z počasí'),
          sunMoonText: text.includes('Slunce a měsíc') && text.includes('Východ slunce') && text.includes('Nasvícení')
        };
      })()`
    });
    const weatherValue = weatherCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG weather:', JSON.stringify(weatherValue, null, 2));
    }
    let weatherOk = true;
    if (!weatherValue.module) { fail('Počasí se neotevřelo do module-tabbed layoutu.'); weatherOk = false; }
    if (!weatherValue.panel) { fail('Počasí/Další nerenderuje kartu Slunce a měsíc.'); weatherOk = false; }
    if (!weatherValue.panelSurface) { fail('Počasí/Další nemá sjednocený kartový povrch.'); weatherOk = false; }
    if (!weatherValue.moonIcon) { fail('Počasí/Další nemá vizuální fázi měsíce.'); weatherOk = false; }
    if (!weatherValue.noDetailText) { fail('Počasí pořád někde ukazuje text Detail.'); weatherOk = false; }
    if (!weatherValue.noAstronomyNote) { fail('Počasí/Další pořád obsahuje vysvětlující poznámku o východu/západu slunce.'); weatherOk = false; }
    if (!weatherValue.sunMoonText) { fail('Počasí/Další nemá očekávané údaje Slunce/Měsíc.'); weatherOk = false; }
    if (weatherOk) ok('Počasí: Home detail text je pryč a záložka Další má Slunce/Měsíc v novém povrchu.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('vape', 'items') : document.querySelector('[data-nav="vape"]')?.click()`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const vapeCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const module = document.querySelector('.module-tabbed[data-tab-area="vape"]');
        const panel = document.querySelector('.vape-items-panel');
        const row = document.querySelector('.vape-item-row');
        const innerTabs = panel ? panel.querySelector('.section-tabs') : null;
        const moduleStyle = module ? getComputedStyle(module) : null;
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const rowStyle = row ? getComputedStyle(row) : null;
        const innerTabsStyle = innerTabs ? getComputedStyle(innerTabs) : null;
        const text = document.body?.innerText || '';
        return {
          module: Boolean(module),
          moduleGrid: Boolean(moduleStyle && moduleStyle.display === 'grid'),
          panelSurface: Boolean(panelStyle && parseFloat(panelStyle.borderTopLeftRadius) >= 16),
          rowSurface: Boolean(rowStyle && rowStyle.display === 'grid' && parseFloat(rowStyle.borderTopLeftRadius) >= 14),
          innerTabsRail: Boolean(innerTabsStyle && /auto|scroll/.test(innerTabsStyle.overflowX)),
          seedItems: text.includes('Smoke booster') && text.includes('Smoke aroma')
        };
      })()`
    });
    const vapeValue = vapeCheck.result?.value || {};
    let vapeOk = true;
    if (!vapeValue.module) { fail('Vape se neotevřel do module-tabbed layoutu.'); vapeOk = false; }
    if (!vapeValue.moduleGrid) { fail('Vape module-tabbed není grid.'); vapeOk = false; }
    if (!vapeValue.panelSurface) { fail('Vape Ceník nemá sjednocený panelový povrch.'); vapeOk = false; }
    if (!vapeValue.rowSurface) { fail('Vape položky nemají sjednocený seznamový povrch.'); vapeOk = false; }
    if (!vapeValue.innerTabsRail) { fail('Vape kategorie nejsou vodorovný rail.'); vapeOk = false; }
    if (!vapeValue.seedItems) { fail('Vape neukazuje seed položky pro kontrolu ceníku.'); vapeOk = false; }
    if (vapeOk) ok('Vape: Kalkulačky/Ceník/Přehled jsou ve společném module-tabbed povrchu.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('calendar', 'sources') : document.querySelector('[data-nav="calendar"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const calendarCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const calendar = document.querySelector('.module-tabbed[data-tab-area="calendar"]');
        const sourceDetails = document.querySelector('.calendar-source-list-details');
        if (sourceDetails) sourceDetails.open = true;
        const sourceItem = document.querySelector('.calendar-source-item');
        const sourceItemStyle = sourceItem ? getComputedStyle(sourceItem) : null;
        const sourceDetailsStyle = sourceDetails ? getComputedStyle(sourceDetails) : null;
        const sourceSurface = Boolean(sourceItemStyle && sourceItemStyle.display === 'grid' && parseFloat(sourceItemStyle.borderTopLeftRadius) >= 14);
        const sourceDetailsSurface = Boolean(sourceDetailsStyle && parseFloat(sourceDetailsStyle.borderTopLeftRadius) >= 16);
        const sourceDisplay = sourceItemStyle?.display || '';
        const sourceRadius = sourceItemStyle?.borderTopLeftRadius || '';
        const sourceDetailsDisplay = sourceDetailsStyle?.display || '';
        const sourceDetailsRadius = sourceDetailsStyle?.borderTopLeftRadius || '';
        const sourceText = sourceItem?.innerText || '';
        if (typeof window.__DOMACNOST_E2E_NAV__ === 'function') {
          window.__DOMACNOST_E2E_NAV__('calendar', 'overview');
        } else {
          document.querySelector('.section-tabs [data-area="calendar"][data-tab="overview"]')?.click();
        }
        const overview = document.querySelector('.calendar-panel.panel-overview');
        const monthView = document.querySelector('.calendar-month-view');
        const toolbar = document.querySelector('.calendar-month-toolbar');
        const grid = document.querySelector('.calendar-grid[data-no-swipe]');
        const weekRow = document.querySelector('.calendar-week-row');
        const day = document.querySelector('.calendar-day');
        const eventButton = document.querySelector('.calendar-day-event[data-action="calendar-event-detail"]');
        const overviewStyle = overview ? getComputedStyle(overview) : null;
        const monthViewStyle = monthView ? getComputedStyle(monthView) : null;
        const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
        const weekRowStyle = weekRow ? getComputedStyle(weekRow) : null;
        const dayStyle = day ? getComputedStyle(day) : null;
        const eventStyle = eventButton ? getComputedStyle(eventButton) : null;
        return {
          calendar: Boolean(calendar),
          sourceSurface,
          sourceDetailsSurface,
          overviewSurface: Boolean(overviewStyle && parseFloat(overviewStyle.borderTopLeftRadius) >= 16),
          monthSurface: Boolean(monthViewStyle && monthViewStyle.display === 'grid' && parseFloat(monthViewStyle.borderTopLeftRadius) >= 16),
          toolbarGrid: Boolean(toolbarStyle && toolbarStyle.display === 'grid'),
          gridNoSwipe: Boolean(grid),
          weekSevenColumns: Boolean(weekRowStyle && weekRowStyle.display === 'grid' && weekRow?.querySelectorAll('.calendar-day').length === 7),
          daySurface: Boolean(dayStyle && dayStyle.display === 'grid' && parseFloat(dayStyle.borderTopLeftRadius) >= 10),
          eventSurface: Boolean(eventStyle && eventStyle.display === 'grid' && parseFloat(eventStyle.borderTopLeftRadius) >= 8),
          eventText: eventButton?.innerText || '',
          sourceText,
          sourceDisplay,
          sourceRadius,
          sourceDetailsDisplay,
          sourceDetailsRadius
        };
      })()`
    });
    const calendarValue = calendarCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG calendar:', JSON.stringify(calendarValue, null, 2));
    }
    let calendarOk = true;
    if (!calendarValue.calendar) { fail('Kalendář se neotevřel do module-tabbed layoutu.'); calendarOk = false; }
    if (!calendarValue.sourceSurface) { fail('Kalendář zdroj nemá nový seznamový povrch.'); calendarOk = false; }
    if (!calendarValue.sourceDetailsSurface) { fail('Kalendář zdroje nemají nový details povrch.'); calendarOk = false; }
    if (!calendarValue.overviewSurface) { fail('Kalendář přehled panel nemá sjednocený povrch.'); calendarOk = false; }
    if (!calendarValue.monthSurface) { fail('Kalendář měsíční mřížka nemá nový povrch.'); calendarOk = false; }
    if (!calendarValue.toolbarGrid) { fail('Kalendář měsíční toolbar není grid.'); calendarOk = false; }
    if (!calendarValue.gridNoSwipe) { fail('Kalendář mřížka nemá data-no-swipe ochranu.'); calendarOk = false; }
    if (!calendarValue.weekSevenColumns) { fail('Kalendář týden nemá 7 stabilních sloupců.'); calendarOk = false; }
    if (!calendarValue.daySurface) { fail('Kalendář den nemá stabilní kartový povrch.'); calendarOk = false; }
    if (!calendarValue.eventSurface) { fail('Kalendář událost nemá nový kartový povrch.'); calendarOk = false; }
    if (!/Smoke udalost/.test(calendarValue.eventText || '')) { fail('Kalendář neukazuje seed událost.'); calendarOk = false; }
    if (!/Smoke kalendar/.test(calendarValue.sourceText || '')) { fail('Kalendář neukazuje seed zdroj.'); calendarOk = false; }

    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
    await page.send('Runtime.evaluate', {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('.calendar-day-event[data-action="calendar-event-detail"]'));
        const item = items.find((node) => /Smoke udalost/.test(node.innerText || node.textContent || '')) || items[0];
        const id = item?.dataset?.id || '';
        if (typeof window.__DOMACNOST_E2E_OPEN_CALENDAR_DETAIL__ === 'function') {
          window.__DOMACNOST_E2E_OPEN_CALENDAR_DETAIL__(id);
          return;
        }
        item?.click();
      })()`
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 350));
      const readyCheck = await page.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `Boolean(document.querySelector('.calendar-event-modal.app-modal'))`
      });
      if (readyCheck.result?.value) break;
      await page.send('Runtime.evaluate', {
        expression: `typeof window.__DOMACNOST_E2E_OPEN_CALENDAR_DETAIL__ === 'function' ? window.__DOMACNOST_E2E_OPEN_CALENDAR_DETAIL__('calendar-event-e2e-smoke') : document.querySelector('.calendar-day-event[data-action="calendar-event-detail"]')?.click()`
      });
    }
    const calendarModalCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const modal = document.querySelector('.calendar-event-modal.app-modal');
        const head = modal ? modal.querySelector('.app-modal-head') : null;
        const detail = modal ? modal.querySelector('.modal-detail-card') : null;
        const actions = modal ? modal.querySelector('.modal-actions') : null;
        const modalStyle = modal ? getComputedStyle(modal) : null;
        const headStyle = head ? getComputedStyle(head) : null;
        const detailStyle = detail ? getComputedStyle(detail) : null;
        const actionsStyle = actions ? getComputedStyle(actions) : null;
        return {
          modal: Boolean(modal),
          modalSurface: Boolean(modalStyle && parseFloat(modalStyle.borderTopLeftRadius) >= 18),
          headLayout: Boolean(headStyle && headStyle.display === 'grid' && headStyle.position === 'sticky'),
          detailSurface: Boolean(detailStyle && parseFloat(detailStyle.borderTopLeftRadius) >= 14),
          actionsSticky: Boolean(actionsStyle && actionsStyle.position === 'sticky'),
          text: (modal?.innerText || '').slice(0, 240)
        };
      })()`
    });
    const calendarModalValue = calendarModalCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG calendarModal:', JSON.stringify(calendarModalValue, null, 2));
    }
    if (!calendarModalValue.modal) { fail('Kalendář detail události se neotevřel.'); calendarOk = false; }
    if (!calendarModalValue.modalSurface) { fail('Kalendář detail události nemá nový modal povrch.'); calendarOk = false; }
    if (!calendarModalValue.headLayout) { fail('Kalendář detail události nemá sticky hlavičku.'); calendarOk = false; }
    if (!calendarModalValue.detailSurface) { fail('Kalendář detail události nemá detailní karty.'); calendarOk = false; }
    if (!calendarModalValue.actionsSticky) { fail('Kalendář detail události nemá sticky akce.'); calendarOk = false; }
    if (!/Smoke udalost/.test(calendarModalValue.text || '')) { fail('Kalendář detail neukazuje seed událost.'); calendarOk = false; }
    if (calendarOk) ok('Kalendář: mřížka, zdroje a detail události renderují v novém povrchu.');
    await page.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-action="close-modal"]')?.click();`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    await page.send('Runtime.evaluate', {
      expression: `window.__DOMACNOST_E2E_NAV__ ? window.__DOMACNOST_E2E_NAV__('more') : (() => { const item = document.querySelector('[data-nav="more"]'); item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); })();`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));

    await page.send('Runtime.evaluate', {
      expression: `(async () => {
        if (typeof window.__DOMACNOST_E2E_NAV__ === 'function') {
          await window.__DOMACNOST_E2E_NAV__('shopping');
          return;
        }
        const item = Array.from(document.querySelectorAll('[data-nav="shopping"]')).find((node) => node.offsetParent !== null);
        item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      })()`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.send('Runtime.evaluate', {
        expression: `typeof window.__DOMACNOST_E2E_OPEN_SHOPPING_DONE__ === 'function' ? window.__DOMACNOST_E2E_OPEN_SHOPPING_DONE__() : document.querySelector('[data-action="open-shopping-done-modal"]')?.click()`
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      const readyCheck = await page.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `Boolean(document.querySelector('.shopping-done-modal.app-modal'))`
      });
      if (readyCheck.result?.value) break;
    }
    const shoppingDoneCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const modal = document.querySelector('.shopping-done-modal.app-modal');
        const backdrop = document.querySelector('.shopping-done-modal-backdrop.app-modal-backdrop');
        const head = modal ? modal.querySelector('.app-modal-head') : null;
        const actions = modal ? modal.querySelector('.shopping-done-actions.modal-actions') : null;
        const row = modal ? modal.querySelector('.shopping-listonic-item.done') : null;
        const modalStyle = modal ? getComputedStyle(modal) : null;
        const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
        const headStyle = head ? getComputedStyle(head) : null;
        const actionsStyle = actions ? getComputedStyle(actions) : null;
        const rowStyle = row ? getComputedStyle(row) : null;
        return {
          modal: Boolean(modal),
          helper: typeof window.__DOMACNOST_E2E_OPEN_SHOPPING_DONE__,
          helperState: window.__DOMACNOST_E2E_LAST_SHOPPING_DONE__ || null,
          bodyText: (document.body?.innerText || '').slice(0, 360),
          bodyOpen: document.body.classList.contains('overview-open'),
          backdrop: Boolean(backdrop),
          modalSurface: Boolean(modalStyle && parseFloat(modalStyle.borderTopLeftRadius) >= 18 && /auto|scroll/.test(modalStyle.overflowY) && modalStyle.overscrollBehaviorY === 'contain'),
          modalFitsMobile: Boolean(modal && modal.getBoundingClientRect().width <= window.innerWidth && modal.getBoundingClientRect().height <= window.innerHeight),
          backdropMobileSheet: Boolean(backdropStyle && ['flex-end', 'end'].includes(backdropStyle.alignItems)),
          headLayout: Boolean(headStyle && headStyle.display === 'grid' && headStyle.position === 'sticky'),
          actionsStickyRail: Boolean(actionsStyle && actionsStyle.position === 'sticky' && /auto|scroll/.test(actionsStyle.overflowX)),
          doneRowSurface: Boolean(rowStyle && rowStyle.display === 'grid' && parseFloat(rowStyle.borderTopLeftRadius) >= 16),
          text: (modal?.innerText || '').slice(0, 260)
        };
      })()`
    });
    const shoppingDoneValue = shoppingDoneCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG shoppingDone:', JSON.stringify(shoppingDoneValue, null, 2));
    }
    let shoppingDoneOk = true;
    if (!shoppingDoneValue.modal) { fail('Nakup Hotovo modal se neotevrel.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.bodyOpen) { fail('Nakup Hotovo modal nenastavil modalni stav body.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.backdrop) { fail('Nakup Hotovo modal nepouziva spolecny app-modal-backdrop.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.modalSurface) { fail('Nakup Hotovo modal nema novy povrch a vnitrni scroll.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.modalFitsMobile) { fail('Nakup Hotovo modal presahuje mobilni viewport.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.backdropMobileSheet) { fail('Nakup Hotovo modal nedrzi mobilni sheet u spodni hrany.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.headLayout) { fail('Nakup Hotovo modal nema spolecnou sticky hlavicku.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.actionsStickyRail) { fail('Nakup Hotovo modal nema sticky modalni akce.'); shoppingDoneOk = false; }
    if (!shoppingDoneValue.doneRowSurface) { fail('Nakup Hotovo polozky nemaji sjednoceny seznamovy povrch.'); shoppingDoneOk = false; }
    if (!/Rohl/.test(shoppingDoneValue.text || '')) { fail('Nakup Hotovo modal neukazuje seed koupenou polozku.'); shoppingDoneOk = false; }
    if (shoppingDoneOk) ok('Nakup: Hotovo podslozka se otevira jako novy mobilni modal.');
    await page.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-action="close-shopping-done-modal"]')?.click();`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('settings', 'data') : document.querySelector('[data-nav="settings"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const settingsCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const settings = document.querySelector('.settings-tabbed[data-tab-area="settings"]');
        const card = document.querySelector('.compact-settings-card');
        const cardStyle = card ? getComputedStyle(card) : null;
        const visualChoice = document.querySelector('.visual-choice-card');
        const visualChoiceStyle = visualChoice ? getComputedStyle(visualChoice) : null;
        const importDrawer = document.querySelector('.panel-data .settings-form-drawer');
        if (importDrawer) importDrawer.open = true;
        const importTextarea = document.querySelector('.panel-data textarea[name="json"]');
        const importTextareaStyle = importTextarea ? getComputedStyle(importTextarea) : null;
        return {
          settings: Boolean(settings),
          settingsClass: settings?.className || '',
          compactCardCount: document.querySelectorAll('.compact-settings-card').length,
          visualChoiceCount: document.querySelectorAll('.visual-choice-card').length,
          settingsText: (settings?.innerText || '').slice(0, 220),
          cardSurface: Boolean(cardStyle && parseFloat(cardStyle.borderTopLeftRadius) >= 16),
          cardDisplay: cardStyle?.display || '',
          cardRadius: cardStyle?.borderTopLeftRadius || '',
          cardBackground: cardStyle?.backgroundColor || '',
          visualChoiceSurface: Boolean(visualChoiceStyle && (visualChoiceStyle.display === 'grid' || visualChoiceStyle.display === 'flex') && parseFloat(visualChoiceStyle.borderTopLeftRadius) >= 16),
          visualChoiceDisplay: visualChoiceStyle?.display || '',
          visualChoiceRadius: visualChoiceStyle?.borderTopLeftRadius || '',
          dataPanel: Boolean(document.querySelector('.settings-tab-data .panel-data, .panel-data')),
          importDrawer: Boolean(importDrawer),
          importTextarea: Boolean(importTextareaStyle && parseFloat(importTextareaStyle.minHeight) >= 120)
        };
      })()`
    });
    const settingsValue = settingsCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG settings:', JSON.stringify(settingsValue, null, 2));
    }
    let settingsOk = true;
    if (!settingsValue.settings) { fail('Nastavení nerenderuje settings-tabbed layout.'); settingsOk = false; }
    if (!settingsValue.cardSurface) { fail('Nastavení karty nemají sjednocený povrch.'); settingsOk = false; }
    if (!settingsValue.visualChoiceSurface) { fail('Nastavení vzhledu nemá nový grid povrch voleb.'); settingsOk = false; }
    if (!settingsValue.dataPanel) { fail('Nastavení Data panel není dostupný.'); settingsOk = false; }
    if (!settingsValue.importDrawer) { fail('Nastavení Data nemá import drawer.'); settingsOk = false; }
    if (!settingsValue.importTextarea) { fail('Import JSON textarea nemá stabilní výšku.'); settingsOk = false; }
    if (settingsOk) ok('Nastavení: karty, volby vzhledu a import dat renderují v novém povrchu.');

    await page.send('Runtime.evaluate', {
      expression: `window.__DOMACNOST_E2E_NAV__('settings', 'notifications')`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    const notificationSettingsCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const switches = document.querySelectorAll('[data-action="toggle-notification-type"]');
        const first = switches[0];
        const before = first?.getAttribute('aria-checked');
        first?.click();
        const after = document.querySelector('[data-action="toggle-notification-type"]')?.getAttribute('aria-checked');
        return { panel: Boolean(document.querySelector('.panel-notifications')), count: switches.length, before, after };
      })()`
    });
    const notificationSettingsValue = notificationSettingsCheck.result?.value || {};
    if (!notificationSettingsValue.panel || notificationSettingsValue.count !== 7 || notificationSettingsValue.before === notificationSettingsValue.after) fail('Upozornění nejdou nastavovat samostatně podle typu.');
    else ok('Upozornění: sedm typů lze samostatně zapnout nebo vypnout.');

    await page.send('Runtime.evaluate', {
      expression: `(window.__DOMACNOST_E2E_SET_CLOUD_STATUS__?.(), window.__DOMACNOST_E2E_NAV__('settings', 'cloud'))`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    const unifiedCloudCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => ({
        unified: document.querySelectorAll('.panel-cloud .unified-cloud-control').length,
        legacy: document.querySelectorAll('.panel-cloud [data-action="cloud-load-all"], .panel-cloud [data-action="cloud-sync-pending"], .panel-cloud [data-action="cloud-setup-realtime"]').length,
        retry: document.querySelectorAll('.panel-cloud [data-action="cloud-sync-unified"]').length,
        text: document.querySelector('.panel-cloud .unified-cloud-control')?.innerText || ''
      }))()`
    });
    const unifiedCloudValue = unifiedCloudCheck.result?.value || {};
    if (unifiedCloudValue.unified !== 1 || unifiedCloudValue.legacy !== 0 || unifiedCloudValue.retry !== 0 || !/změn[a-y ]*ček/i.test(unifiedCloudValue.text)) fail('Cloud nastavení nemá jediný automatický stav bez nadbytečné ruční akce.');
    else ok('Cloud: běžný stav i čekající změny jsou sjednocené bez ručních synchronizačních tlačítek.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('pool') : document.querySelector('[data-nav="pool"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const poolOverviewCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const text = document.body?.innerText || '';
        const poolChartWrap = document.querySelector('.pool-chart-wrap');
        const poolChartWrapStyle = poolChartWrap ? getComputedStyle(poolChartWrap) : null;
        return {
          volume: text.includes('21,6 m³') || text.includes('21.6 m³') || text.includes('objem vody'),
          ph: text.includes('pH') && (text.includes('pH-') || text.includes('pH+')),
          temperature: text.includes('teplota vody') && text.includes('24,5'),
          chart: Boolean(document.querySelector('.pool-chart .pool-chart-line.ph')) && Boolean(document.querySelector('.pool-chart .pool-chart-line.temp')),
          chartSurface: Boolean(poolChartWrapStyle && parseFloat(poolChartWrapStyle.borderTopLeftRadius) >= 16 && poolChartWrapStyle.overflow === 'hidden')
        };
      })()`
    });
    const poolOverviewValue = poolOverviewCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG pool overview:', JSON.stringify(poolOverviewValue, null, 2));
    }
    let poolOk = true;
    if (!poolOverviewValue.volume) { fail('Bazén po kliknutí neukazuje objem vody.'); poolOk = false; }
    if (!poolOverviewValue.ph) { fail('Bazén po kliknutí neukazuje pH část.'); poolOk = false; }
    if (!poolOverviewValue.temperature) { fail('Bazén po kliknutí neukazuje teplotu vody.'); poolOk = false; }
    if (!poolOverviewValue.chart) { fail('Bazén po kliknutí nerenderuje graf pH/teploty.'); poolOk = false; }
    if (!poolOverviewValue.chartSurface) { fail('Bazénový graf nemá sjednocený detailní/grafový povrch.'); poolOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('pool', 'add') : document.querySelector('[data-action="set-section-tab"][data-area="pool"][data-tab="add"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const poolAddCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => ({
        form: Boolean(document.querySelector('form[data-form="pool-add-measurement"]')),
        tempInput: Boolean(document.querySelector('form[data-form="pool-add-measurement"] input[name="waterTempC"]')),
        settingsFormHidden: !document.querySelector('form[data-form="pool-settings"] input[name="waterTempC"]')
      }))()`
    });
    const poolAddValue = poolAddCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG pool add:', JSON.stringify(poolAddValue, null, 2));
    }
    if (!poolAddValue.form) { fail('Bazén po kliknutí nerenderuje pool-settings formulář.'); poolOk = false; }
    if (!poolAddValue.tempInput) { fail('Bazén po kliknutí nemá vstup pro teplotu vody.'); poolOk = false; }
    if (poolOk) ok('Bazén: přehled (objem/pH/teplota/graf) i záložka Nové měření s formulářem renderují.');

    await page.send('Runtime.evaluate', {
      expression: `window.__DOMACNOST_E2E_NAV__('readings', 'overview')`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const readingsOverviewCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => ({
        moduleLoaded: Boolean(window.DomacnostReadings),
        module: Boolean(document.querySelector('.readings-module.readings-tab-overview')),
        meter: Boolean(document.querySelector('.reading-meter-card')),
        seedText: (document.body?.innerText || '').includes('Smoke elektroměr')
      }))()`
    });
    const readingsOverviewValue = readingsOverviewCheck.result?.value || {};
    let readingsOk = true;
    if (!readingsOverviewValue.moduleLoaded) { fail('Odečty se při prvním otevření nenačetly jako samostatný modul.'); readingsOk = false; }
    if (!readingsOverviewValue.module || !readingsOverviewValue.meter || !readingsOverviewValue.seedText) { fail('Odečty po načtení nerenderují přehled a kartu měřidla.'); readingsOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `window.__DOMACNOST_E2E_NAV__('readings', 'entry')`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const readingsEntryReady = await waitForExpression(page, `Boolean(document.querySelector('form[data-form="add-reading-entry"] input[name="value"]'))`, 2500, 40);
    if (!readingsEntryReady) { fail('Odečty: záložka Odečet nemá formulář pro zadání stavu.'); readingsOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `window.__DOMACNOST_E2E_NAV__('readings', 'detail')`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const readingsDetailReady = await waitForExpression(page, `Boolean(document.querySelector('.readings-module.readings-tab-detail .readings-line-chart svg'))`, 2500, 40);
    if (!readingsDetailReady) { fail('Odečty: detail měřidla nerenderuje graf spotřeby.'); readingsOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `window.__DOMACNOST_E2E_NAV__('readings', 'history')`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const readingsHistoryReady = await waitForExpression(page, `document.querySelectorAll('.readings-module.readings-tab-history .readings-history-list .item').length >= 2`, 2500, 40);
    if (!readingsHistoryReady) { fail('Odečty: historie nerenderuje uložené odečty.'); readingsOk = false; }
    if (readingsOk) ok('Odečty: samostatný lazy modul, přehled, zadání, detail s grafem i historie renderují.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('finance', 'loans') : document.querySelector('[data-nav="finance"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    // Běžný klik na modul v dolní liště teď vždy resetuje zapamatovanou
    // záložku na výchozí (viz app.js click handler pro [data-nav]) - do
    // Půjček je proto potřeba přepnout výslovným kliknutím na záložku,
    // stejně jako se to řeší výš u Bazénu/"Nové měření". Spoléhat na
    // předvyplněné moduleTabs.finance='loans' v localStorage už nestačí.
    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('finance', 'loans') : document.querySelector('[data-action="set-section-tab"][data-area="finance"][data-tab="loans"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const financeCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const text = document.body?.innerText || '';
        const sectionTabs = document.querySelector('.section-tabs[aria-label="Záložky modulu"]');
        const sectionTabsStyle = sectionTabs ? getComputedStyle(sectionTabs) : null;
        const financeFormActions = document.querySelector('form[data-form="finance-refinance"] .form-actions');
        const financeFormActionsStyle = financeFormActions ? getComputedStyle(financeFormActions) : null;
        const financeModule = document.querySelector('.module-tabbed[data-tab-area="finance"]');
        const financeModuleStyle = financeModule ? getComputedStyle(financeModule) : null;
        const financeModuleRect = financeModule ? financeModule.getBoundingClientRect() : null;
        const financeCards = financeModule ? Array.from(financeModule.querySelectorAll(':scope > .card')) : [];
        const financeDetails = document.querySelector('.finance-form-drawer.action-details');
        const financeDetailsStyle = financeDetails ? getComputedStyle(financeDetails) : null;
        const financeDetailsSummary = financeDetails ? financeDetails.querySelector('summary') : null;
        const financeDetailsSummaryStyle = financeDetailsSummary ? getComputedStyle(financeDetailsSummary) : null;
        const financeLoanItem = document.querySelector('.finance-loan-item');
        const financeLoanItemStyle = financeLoanItem ? getComputedStyle(financeLoanItem) : null;
        const financeLoanTop = financeLoanItem ? financeLoanItem.querySelector('.item-top') : null;
        const financeLoanTopStyle = financeLoanTop ? getComputedStyle(financeLoanTop) : null;
        const financeLoanMeta = financeLoanItem ? financeLoanItem.querySelector('.item-meta') : null;
        const financeLoanMetaStyle = financeLoanMeta ? getComputedStyle(financeLoanMeta) : null;
        return {
          tabsNoSwipe: Boolean(sectionTabs?.hasAttribute('data-no-swipe')),
          tabsScrollable: Boolean(sectionTabs && sectionTabsStyle && /auto|scroll/.test(sectionTabsStyle.overflowX) && sectionTabs.scrollWidth > sectionTabs.clientWidth),
          formActionsRail: Boolean(financeFormActionsStyle && /auto|scroll/.test(financeFormActionsStyle.overflowX) && financeFormActionsStyle.flexWrap === 'nowrap' && financeFormActionsStyle.overscrollBehaviorX === 'contain'),
          moduleOneColumn: Boolean(financeModuleStyle && financeModuleStyle.display === 'grid' && financeModuleStyle.gridTemplateColumns.trim().split(/\\s+/).length === 1),
          moduleCardsFit: Boolean(financeModuleRect && financeCards.length && financeCards.every((card) => card.getBoundingClientRect().width <= financeModuleRect.width + 1)),
          detailsSurface: Boolean(financeDetails?.open && financeDetailsStyle && parseFloat(financeDetailsStyle.borderTopLeftRadius) >= 18 && financeDetailsStyle.overflow === 'hidden'),
          detailsSummaryGrid: Boolean(financeDetailsSummaryStyle && financeDetailsSummaryStyle.display === 'grid' && parseFloat(financeDetailsSummaryStyle.minHeight) >= 46 && parseFloat(financeDetailsSummaryStyle.columnGap) >= 8),
          loanItemSurface: Boolean(financeLoanItemStyle && parseFloat(financeLoanItemStyle.borderTopLeftRadius) >= 16 && financeLoanItemStyle.display === 'grid'),
          loanItemTopGrid: Boolean(financeLoanTopStyle && financeLoanTopStyle.display === 'grid' && financeLoanTopStyle.gridTemplateColumns.trim().split(/\\s+/).length >= 2),
          loanItemMetaClamp: Boolean(financeLoanMetaStyle && financeLoanMetaStyle.webkitLineClamp === '3'),
          loanForm: Boolean(document.querySelector('form[data-form="add-finance-loan"]')),
          refinanceForm: Boolean(document.querySelector('form[data-form="finance-refinance"]')),
          loanText: text.includes('Smoke půjčka') && text.includes('Refinancování')
        };
      })()`
    });
    const financeValue = financeCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG finance:', JSON.stringify(financeValue, null, 2));
    }
    let financeOk = true;
    if (!financeValue.tabsNoSwipe) { fail('Finance modulové záložky nejsou chráněné proti swipe přepnutí.'); financeOk = false; }
    if (!financeValue.tabsScrollable) { fail('Finance modulové záložky nejsou na mobilu vodorovně posuvné.'); financeOk = false; }
    if (!financeValue.formActionsRail) { fail('Finance formulářové akce nemají mobilní rail chování.'); financeOk = false; }
    if (!financeValue.moduleOneColumn) { fail('Finance module-tabbed není na mobilu jednosloupcový grid.'); financeOk = false; }
    if (!financeValue.moduleCardsFit) { fail('Finance module-tabbed karty na mobilu přesahují šířku modulu.'); financeOk = false; }
    if (!financeValue.detailsSurface) { fail('Finance rozbalovací formulář nemá nový sjednocený povrch.'); financeOk = false; }
    if (!financeValue.detailsSummaryGrid) { fail('Finance rozbalovací formulář nemá nový summary layout.'); financeOk = false; }
    if (!financeValue.loanItemSurface) { fail('Finance půjčka nemá nový sjednocený seznamový povrch.'); financeOk = false; }
    if (!financeValue.loanItemTopGrid) { fail('Finance půjčka nemá nový item-top grid layout.'); financeOk = false; }
    if (!financeValue.loanItemMetaClamp) { fail('Finance půjčka nemá kontrolovaný ořez metadat.'); financeOk = false; }
    if (!financeValue.loanForm) { fail('Finance/Půjčky nerenderují add-finance-loan formulář.'); financeOk = false; }
    if (!financeValue.refinanceForm) { fail('Finance/Půjčky nerenderují finance-refinance formulář.'); financeOk = false; }
    if (!financeValue.loanText) { fail('Finance/Půjčky neukazují seed půjčku/refinancování.'); financeOk = false; }
    if (financeOk) ok('Finance: půjčka a refinancování renderují.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('contracts') : document.querySelector('[data-nav="contracts"]')?.click()`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const contractsCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const text = document.body?.innerText || '';
        const detailPanel = document.querySelector('.contracts-panel.panel-detail');
        const detailPanelStyle = detailPanel ? getComputedStyle(detailPanel) : null;
        return {
          addForm: Boolean(document.querySelector('form[data-form="add-contract"]')),
          updateForm: Boolean(document.querySelector('form[data-form="update-contract"]')),
          fileForm: Boolean(document.querySelector('form[data-form="add-contract-file"]')),
          detailSurface: Boolean(detailPanelStyle && parseFloat(detailPanelStyle.borderTopLeftRadius) >= 16),
          contractText: text.includes('Smoke pojistka') && text.includes('Smlouvy a pojistky')
        };
      })()`
    });
    const contractsValue = contractsCheck.result?.value || {};
    let contractsOk = true;
    if (!contractsValue.addForm) { fail('Smlouvy nerenderují add-contract formulář.'); contractsOk = false; }
    if (!contractsValue.updateForm) { fail('Smlouvy nerenderují update-contract formulář v detailu.'); contractsOk = false; }
    if (!contractsValue.fileForm) { fail('Smlouvy nerenderují add-contract-file formulář.'); contractsOk = false; }
    if (!contractsValue.detailSurface) { fail('Smlouvy detail nemá sjednocený detailní povrch.'); contractsOk = false; }
    if (!contractsValue.contractText) { fail('Smlouvy neukazují seed smlouvu/přehled.'); contractsOk = false; }
    if (contractsOk) ok('Smlouvy: přehled, detail i příloha formuláře renderují.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('subscriptions', 'overview') : document.querySelector('[data-nav="subscriptions"]')?.click()`,
      awaitPromise: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    await page.send('Runtime.evaluate', {
      expression: `(() => {
        window.__DOMACNOST_E2E_SHELL_NODES__ = {
          sidebar: document.querySelector('.app-sidebar'),
          nav: document.querySelector('.nav-shell'),
          frame: document.querySelector('.app-frame'),
          overlays: document.querySelector('[data-app-overlays]')
        };
        document.querySelector('[data-action="subscription-filter"][data-filter="debtors"]')?.click();
      })()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const moduleOnlyRenderCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const saved = window.__DOMACNOST_E2E_SHELL_NODES__ || {};
        return {
          scope: document.querySelector('#app')?.dataset?.lastRenderScope || '',
          surface: document.querySelector('#app')?.dataset?.lastRenderSurface || '',
          sidebarSame: saved.sidebar === document.querySelector('.app-sidebar'),
          navSame: saved.nav === document.querySelector('.nav-shell'),
          frameSame: saved.frame === document.querySelector('.app-frame'),
          overlaysSame: saved.overlays === document.querySelector('[data-app-overlays]'),
          filterActive: Boolean(document.querySelector('[data-action="subscription-filter"][data-filter="debtors"].active'))
        };
      })()`
    });
    const moduleOnlyRenderValue = moduleOnlyRenderCheck.result?.value || {};
    let moduleOnlyRenderOk = true;
    if (moduleOnlyRenderValue.scope !== 'module-only') { fail(`Předplatné: filtr nepoužil render pouze modulu (${moduleOnlyRenderValue.scope || 'bez scope'}).`); moduleOnlyRenderOk = false; }
    if (moduleOnlyRenderValue.surface !== 'module') { fail(`Předplatné: modulový filtr neoznačil změnu hlavního obsahu (${moduleOnlyRenderValue.surface || 'bez surface'}).`); moduleOnlyRenderOk = false; }
    if (!moduleOnlyRenderValue.sidebarSame || !moduleOnlyRenderValue.navSame || !moduleOnlyRenderValue.frameSame || !moduleOnlyRenderValue.overlaysSame) { fail('Předplatné: modulový filtr znovu vytvořil část aplikačního shellu.'); moduleOnlyRenderOk = false; }
    if (!moduleOnlyRenderValue.filterActive) { fail('Předplatné: filtr Dlužníci se po modulovém renderu neaktivoval.'); moduleOnlyRenderOk = false; }
    if (moduleOnlyRenderOk) ok('Modulový render: filtr překreslí jen otevřený modul a zachová celý aplikační shell.');
    await page.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-action="subscription-debtor-info"]')?.click(); window.__DOMACNOST_E2E_SUBSCRIPTION_OVERLAY_RENDER__ = { scope: document.querySelector('#app')?.dataset?.lastRenderScope || '', surface: document.querySelector('#app')?.dataset?.lastRenderSurface || '' }`
    });
    const subscriptionInputReady = await waitForExpression(
      page,
      `Boolean(document.querySelector('.subscription-debtor-modal input[name="amount"]'))`,
      3000,
      50
    );
    if (!subscriptionInputReady) fail('Předplatné: po otevření dlužníka se nevykreslilo pole částky.');
    await page.send('Runtime.evaluate', {
      expression: `(() => {
        const input = document.querySelector('.subscription-debtor-modal input[name="amount"]');
        if (input) input.value = '175';
        input?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '175' }));
        input?.focus({ preventScroll: true });
      })()`
    });
    const subscriptionInputPrepared = await waitForExpression(
      page,
      `(() => {
        const input = document.querySelector('.subscription-debtor-modal input[name="amount"]');
        return Boolean(input && input.value === '175' && document.activeElement === input);
      })()`,
      1500,
      40
    );
    if (!subscriptionInputPrepared) fail('Předplatné: test nedokázal připravit rozepsanou částku a fokus.');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 520,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
    const subscriptionPaymentModalCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const modal = document.querySelector('.subscription-debtor-modal.app-modal');
        const input = modal?.querySelector('input[name="amount"]');
        const rect = modal?.getBoundingClientRect();
        return {
          modal: Boolean(modal),
          partialRender: window.__DOMACNOST_E2E_SUBSCRIPTION_OVERLAY_RENDER__?.scope === 'overlay-only' && window.__DOMACNOST_E2E_SUBSCRIPTION_OVERLAY_RENDER__?.surface !== 'module',
          bodyOpen: document.body.classList.contains('overview-open'),
          amount: input?.value || '',
          focused: document.activeElement === input,
          visible: Boolean(rect && rect.bottom > 0 && rect.top < window.innerHeight)
        };
      })()`
    });
    const subscriptionPaymentModalValue = subscriptionPaymentModalCheck.result?.value || {};
    let subscriptionPaymentModalOk = true;
    if (!subscriptionPaymentModalValue.modal) { fail('Předplatné: dialog platby po fokusu částky zmizel.'); subscriptionPaymentModalOk = false; }
    if (!subscriptionPaymentModalValue.partialRender) { fail(`Předplatné: otevření dialogu nepoužilo samostatný overlay render (${JSON.stringify(subscriptionPaymentModalValue)}).`); subscriptionPaymentModalOk = false; }
    if (!subscriptionPaymentModalValue.bodyOpen) { fail('Předplatné: dialog platby nezamkl podkladovou stránku pro mobilní klávesnici.'); subscriptionPaymentModalOk = false; }
    if (subscriptionPaymentModalValue.amount !== '175') { fail('Předplatné: dialog platby neudržel rozepsanou částku.'); subscriptionPaymentModalOk = false; }
    if (!subscriptionPaymentModalValue.focused) { fail('Předplatné: pole částky po změně mobilního viewportu ztratilo fokus.'); subscriptionPaymentModalOk = false; }
    if (!subscriptionPaymentModalValue.visible) { fail('Předplatné: dialog platby po otevření mobilní klávesnice není ve viewportu.'); subscriptionPaymentModalOk = false; }
    if (subscriptionPaymentModalOk) ok('Předplatné: dialog platby zůstává při psaní částky otevřený, zaostřený a viditelný.');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await page.send('Runtime.evaluate', {
      expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const subscriptionModalClosedCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `!document.querySelector('.subscription-debtor-modal.app-modal') && !document.body.classList.contains('overview-open')`
    });
    if (!subscriptionModalClosedCheck.result?.value) fail('Předplatné: společný modulový kontrakt nezavřel dialog klávesou Escape.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('garage') : document.querySelector('[data-nav="garage"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const garageOverviewCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const module = document.querySelector('.module-tabbed[data-tab-area="garage"]');
        const overview = document.querySelector('.garage-panel.panel-overview');
        const picker = document.querySelector('.garage-vehicle-dropdown');
        const pickerSummary = picker ? picker.querySelector('summary') : null;
        const dashboard = document.querySelector('.garage-dashboard-panel');
        const chartCarousel = document.querySelector('.garage-chart-carousel[data-no-swipe]');
        const chartCard = document.querySelector('.garage-chart-card');
        const chartSvg = document.querySelector('.garage-line-chart');
        const overviewStyle = overview ? getComputedStyle(overview) : null;
        const pickerStyle = picker ? getComputedStyle(picker) : null;
        const pickerSummaryStyle = pickerSummary ? getComputedStyle(pickerSummary) : null;
        const dashboardStyle = dashboard ? getComputedStyle(dashboard) : null;
        const chartCarouselStyle = chartCarousel ? getComputedStyle(chartCarousel) : null;
        const chartCardStyle = chartCard ? getComputedStyle(chartCard) : null;
        const chartSvgStyle = chartSvg ? getComputedStyle(chartSvg) : null;
        return {
          moduleLoaded: Boolean(window.DomacnostGarage),
          module: Boolean(module),
          overviewSurface: Boolean(overviewStyle && parseFloat(overviewStyle.borderTopLeftRadius) >= 16),
          pickerSurface: Boolean(pickerStyle && parseFloat(pickerStyle.borderTopLeftRadius) >= 16),
          pickerSummaryGrid: Boolean(pickerSummaryStyle && pickerSummaryStyle.display === 'grid'),
          dashboardSurface: Boolean(dashboardStyle && dashboardStyle.display === 'grid' && parseFloat(dashboardStyle.borderTopLeftRadius) >= 16),
          chartNoSwipe: Boolean(chartCarousel),
          chartScrollable: Boolean(chartCarouselStyle && /auto|scroll/.test(chartCarouselStyle.overflowX) && chartCarouselStyle.overscrollBehaviorX === 'contain'),
          chartSurface: Boolean(chartCardStyle && parseFloat(chartCardStyle.borderTopLeftRadius) >= 16),
          chartStableSize: Boolean(chartCardStyle && parseFloat(chartCardStyle.minHeight) >= 160),
          chartHeight: chartSvgStyle?.height || chartCardStyle?.minHeight || '',
          text: (overview?.innerText || '').slice(0, 360)
        };
      })()`
    });
    const garageOverviewValue = garageOverviewCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG garageOverview:', JSON.stringify(garageOverviewValue, null, 2));
    }
    let garageOk = true;
    if (!garageOverviewValue.moduleLoaded) { fail('Garáž se při prvním otevření nenačetla jako samostatný modul.'); garageOk = false; }
    if (!garageOverviewValue.module) { fail('Garáž se neotevřela do module-tabbed layoutu.'); garageOk = false; }
    if (!garageOverviewValue.overviewSurface) { fail('Garáž přehled nemá sjednocený panelový povrch.'); garageOk = false; }
    if (!garageOverviewValue.pickerSurface) { fail('Garáž výběr auta nemá nový povrch.'); garageOk = false; }
    if (!garageOverviewValue.pickerSummaryGrid) { fail('Garáž výběr auta nemá stabilní summary grid.'); garageOk = false; }
    if (!garageOverviewValue.dashboardSurface) { fail('Garáž palivový dashboard nemá nový grid povrch.'); garageOk = false; }
    if (!garageOverviewValue.chartNoSwipe) { fail('Garáž grafový carousel nemá data-no-swipe ochranu.'); garageOk = false; }
    if (!garageOverviewValue.chartScrollable) { fail('Garáž grafový carousel nemá vnitřní horizontální posun.'); garageOk = false; }
    if (!garageOverviewValue.chartSurface) { fail('Garáž graf nemá sjednocený kartový povrch.'); garageOk = false; }
    if (!garageOverviewValue.chartStableSize) { fail('Garáž graf nemá stabilní výšku.'); garageOk = false; }
    if (!/Smoke auto/.test(garageOverviewValue.text || '')) { fail('Garáž přehled neukazuje seed auto.'); garageOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('garage', 'detail') : document.querySelector('.section-tabs [data-area="garage"][data-tab="detail"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    await page.send('Runtime.evaluate', {
      expression: `(() => { const lazyCharts = document.querySelector('.garage-detail-chart-details[data-lazy-render]'); if (lazyCharts) lazyCharts.open = true; })()`
    });
    await waitForExpression(page, `Boolean(document.querySelector('.garage-detail-chart-section'))`, 1600, 50);
    const garageDetailCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const detail = document.querySelector('.garage-panel.panel-detail');
        const head = document.querySelector('.vehicle-detail-head');
        const headActions = document.querySelector('.vehicle-detail-head-actions');
        const statusGrid = document.querySelector('.garage-status-grid');
        const summaryStack = document.querySelector('.detail-summary-grid > .detail-stack');
        const detailCharts = document.querySelector('.garage-detail-chart-section');
        const serviceDetails = document.querySelector('.garage-service-plan-details');
        if (serviceDetails) serviceDetails.open = true;
        const serviceBody = document.querySelector('.service-plan-body');
        const serviceItem = document.querySelector('.service-plan-item');
        const serviceForm = document.querySelector('form[data-form="service-plan-item"]');
        const history = document.querySelector('.garage-history-panel');
        if (history) history.open = true;
        const historyToolbar = document.querySelector('.garage-history-toolbar');
        const historyRow = document.querySelector('.garage-history-row');
        const detailStyle = detail ? getComputedStyle(detail) : null;
        const headStyle = head ? getComputedStyle(head) : null;
        const headActionsStyle = headActions ? getComputedStyle(headActions) : null;
        const statusGridStyle = statusGrid ? getComputedStyle(statusGrid) : null;
        const summaryStackStyle = summaryStack ? getComputedStyle(summaryStack) : null;
        const detailChartsStyle = detailCharts ? getComputedStyle(detailCharts) : null;
        const serviceBodyStyle = serviceBody ? getComputedStyle(serviceBody) : null;
        const serviceItemStyle = serviceItem ? getComputedStyle(serviceItem) : null;
        const historyToolbarStyle = historyToolbar ? getComputedStyle(historyToolbar) : null;
        const historyRowStyle = historyRow ? getComputedStyle(historyRow) : null;
        return {
          detailSurface: Boolean(detailStyle && parseFloat(detailStyle.borderTopLeftRadius) >= 16),
          headGrid: Boolean(headStyle && headStyle.display === 'grid'),
          headActionsRail: Boolean(headActionsStyle && /auto|scroll/.test(headActionsStyle.overflowX) && headActionsStyle.overscrollBehaviorX === 'contain'),
          statusSurface: Boolean(statusGridStyle && parseFloat(statusGridStyle.borderTopLeftRadius) >= 16),
          summarySurface: Boolean(summaryStackStyle && parseFloat(summaryStackStyle.borderTopLeftRadius) >= 16),
          detailChartSurface: Boolean(detailChartsStyle && detailChartsStyle.display === 'grid' && parseFloat(detailChartsStyle.borderTopLeftRadius) >= 16),
          serviceBodySurface: Boolean(serviceBodyStyle && serviceBodyStyle.display === 'grid' && parseFloat(serviceBodyStyle.borderTopLeftRadius) >= 16),
          serviceItemSurface: Boolean(serviceItemStyle && serviceItemStyle.display === 'grid' && parseFloat(serviceItemStyle.borderTopLeftRadius) >= 16),
          serviceForm: Boolean(serviceForm),
          historyToolbarSurface: Boolean(historyToolbarStyle && /auto|scroll/.test(historyToolbarStyle.overflowX) && historyToolbarStyle.overscrollBehaviorX === 'contain'),
          historyRowSurface: Boolean(historyRowStyle && historyRowStyle.display === 'grid' && parseFloat(historyRowStyle.borderTopLeftRadius) >= 16),
          serviceText: serviceItem?.innerText || '',
          historyText: history?.innerText || historyRow?.innerText || '',
          text: (detail?.innerText || '').slice(0, 520)
        };
      })()`
    });
    const garageDetailValue = garageDetailCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG garageDetail:', JSON.stringify(garageDetailValue, null, 2));
    }
    if (!garageDetailValue.detailSurface) { fail('Garáž detail panel nemá sjednocený povrch.'); garageOk = false; }
    if (!garageDetailValue.headGrid) { fail('Garáž detail hlavička není stabilní grid.'); garageOk = false; }
    if (!garageDetailValue.headActionsRail) { fail('Garáž detail akce nejsou mobilní horizontální rail.'); garageOk = false; }
    if (!garageDetailValue.statusSurface) { fail('Garáž termíny/STK grid nemá nový povrch.'); garageOk = false; }
    if (!garageDetailValue.summarySurface) { fail('Garáž detail souhrn nemá nový povrch.'); garageOk = false; }
    if (!garageDetailValue.detailChartSurface) { fail('Garáž detail grafy nemají nový povrch.'); garageOk = false; }
    if (!garageDetailValue.serviceBodySurface) { fail('Garáž servisní plán nemá nový povrch.'); garageOk = false; }
    if (!garageDetailValue.serviceItemSurface) { fail('Garáž servisní položka nemá nový seznamový povrch.'); garageOk = false; }
    if (!garageDetailValue.serviceForm) { fail('Garáž servisní plán nemá formulář.'); garageOk = false; }
    if (!garageDetailValue.historyToolbarSurface) { fail('Garáž historie filtry nejsou mobilní rail.'); garageOk = false; }
    if (!garageDetailValue.historyRowSurface) { fail('Garáž historie řádek nemá nový seznamový povrch.'); garageOk = false; }
    if (!/Olej/.test(garageDetailValue.serviceText || '') || !/Smoke servis/.test(garageDetailValue.historyText || '')) { fail('Garáž detail neukazuje seed servisní plán a historii.'); garageOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('garage', 'stats') : document.querySelector('.section-tabs [data-area="garage"][data-tab="stats"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
    const garageStatsCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const panel = document.querySelector('.garage-panel.panel-stats');
        const block = document.querySelector('.garage-stat-block');
        const filters = document.querySelector('.garage-stats-filters');
        const kpis = document.querySelector('.garage-stats-kpis');
        const blockStyle = block ? getComputedStyle(block) : null;
        const filtersStyle = filters ? getComputedStyle(filters) : null;
        const kpisStyle = kpis ? getComputedStyle(kpis) : null;
        return {
          panel: Boolean(panel),
          blockSurface: Boolean(blockStyle && blockStyle.display === 'grid' && parseFloat(blockStyle.borderTopLeftRadius) >= 16),
          filtersGrid: Boolean(filtersStyle && filtersStyle.display === 'grid'),
          kpiGrid: Boolean(kpisStyle && kpisStyle.display === 'grid'),
          text: (panel?.innerText || '').slice(0, 260)
        };
      })()`
    });
    const garageStatsValue = garageStatsCheck.result?.value || {};
    if (!garageStatsValue.panel) { fail('Garáž statistiky se neotevřely.'); garageOk = false; }
    if (!garageStatsValue.blockSurface) { fail('Garáž statistický blok nemá nový povrch.'); garageOk = false; }
    if (!garageStatsValue.filtersGrid) { fail('Garáž statistické filtry nejsou grid.'); garageOk = false; }
    if (!garageStatsValue.kpiGrid) { fail('Garáž statistiky KPI nejsou grid.'); garageOk = false; }
    if (!/Statistiky/.test(garageStatsValue.text || '')) { fail('Garáž statistiky neukazují obsah.'); garageOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('garage', 'calculator') : document.querySelector('.section-tabs [data-area="garage"][data-tab="calculator"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
    const garageCalculatorCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const panel = document.querySelector('.garage-panel.panel-calculator');
        const form = document.querySelector('form[data-form="garage-trip-calc"]');
        const result = document.querySelector('.garage-trip-result');
        const resultStyle = result ? getComputedStyle(result) : null;
        return {
          panel: Boolean(panel),
          form: Boolean(form),
          resultSurface: Boolean(resultStyle && resultStyle.display === 'grid' && parseFloat(resultStyle.borderTopLeftRadius) >= 16),
          text: (panel?.innerText || '').slice(0, 260)
        };
      })()`
    });
    const garageCalculatorValue = garageCalculatorCheck.result?.value || {};
    if (!garageCalculatorValue.panel) { fail('Garáž kalkulačka se neotevřela.'); garageOk = false; }
    if (!garageCalculatorValue.form) { fail('Garáž kalkulačka nemá formulář.'); garageOk = false; }
    if (!garageCalculatorValue.resultSurface) { fail('Garáž kalkulačka výsledek nemá nový povrch.'); garageOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('garage', 'add') : document.querySelector('.section-tabs [data-area="garage"][data-tab="add"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
    const garageAddCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const panel = document.querySelector('.garage-panel.panel-add');
        const preset = document.querySelector('.garage-preset-tool');
        const tech = document.querySelector('.garage-technical-fields');
        const form = document.querySelector('form[data-form="add-vehicle"]');
        const presetStyle = preset ? getComputedStyle(preset) : null;
        const techStyle = tech ? getComputedStyle(tech) : null;
        return {
          panel: Boolean(panel),
          form: Boolean(form),
          presetSurface: Boolean(presetStyle && parseFloat(presetStyle.borderTopLeftRadius) >= 16),
          techSurface: Boolean(techStyle && parseFloat(techStyle.borderTopLeftRadius) >= 16)
        };
      })()`
    });
    const garageAddValue = garageAddCheck.result?.value || {};
    if (!garageAddValue.panel) { fail('Garáž přidání auta se neotevřelo.'); garageOk = false; }
    if (!garageAddValue.form) { fail('Garáž přidání auta nemá formulář.'); garageOk = false; }
    if (!garageAddValue.presetSurface) { fail('Garáž preset auta nemá nový povrch.'); garageOk = false; }
    if (!garageAddValue.techSurface) { fail('Garáž technický list nemá nový povrch.'); garageOk = false; }

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('garage', 'import') : document.querySelector('.section-tabs [data-area="garage"][data-tab="import"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
    const garageImportCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const panel = document.querySelector('.garage-panel.panel-import');
        const form = document.querySelector('form[data-form="fuelio-preview"]');
        const upload = document.querySelector('.upload-box');
        const uploadStyle = upload ? getComputedStyle(upload) : null;
        return {
          panel: Boolean(panel),
          form: Boolean(form),
          uploadSurface: Boolean(uploadStyle && parseFloat(uploadStyle.borderTopLeftRadius) >= 14)
        };
      })()`
    });
    const garageImportValue = garageImportCheck.result?.value || {};
    if (!garageImportValue.panel) { fail('Garáž Fuelio import se neotevřel.'); garageOk = false; }
    if (!garageImportValue.form) { fail('Garáž Fuelio import nemá formulář.'); garageOk = false; }
    if (!garageImportValue.uploadSurface) { fail('Garáž Fuelio upload nemá nový povrch.'); garageOk = false; }
    if (garageOk) ok('Garáž: přehled, detail, historie, servisní plán, statistiky, kalkulačka, přidání i import renderují.');

    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('garage', 'detail') : document.querySelector('.section-tabs [data-area="garage"][data-tab="detail"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_OPEN_GARAGE_MODAL__ === 'function' ? window.__DOMACNOST_E2E_OPEN_GARAGE_MODAL__('add-fuel') : document.querySelector('button[data-action="open-garage-detail"][data-garage-target="add-fuel"], button[data-action="select-vehicle"][data-garage-target="add-fuel"]')?.click()`
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 450));
      const readyCheck = await page.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `Boolean(document.querySelector('.app-modal.garage-record-modal form[data-form="add-fuel"]'))`
      });
      if (readyCheck.result?.value) break;
      await page.send('Runtime.evaluate', {
        expression: `typeof window.__DOMACNOST_E2E_OPEN_GARAGE_MODAL__ === 'function' ? window.__DOMACNOST_E2E_OPEN_GARAGE_MODAL__('add-fuel') : document.querySelector('button[data-action="open-garage-detail"][data-garage-target="add-fuel"], button[data-action="select-vehicle"][data-garage-target="add-fuel"]')?.click()`
      });
    }
    const modalCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const modal = document.querySelector('.app-modal.garage-record-modal');
        const backdrop = document.querySelector('.app-modal-backdrop');
        const head = modal ? modal.querySelector('.app-modal-head') : null;
        const form = modal ? modal.querySelector('form[data-form="add-fuel"]') : null;
        const actions = modal ? modal.querySelector('.modal-actions') : null;
        const modalStyle = modal ? getComputedStyle(modal) : null;
        const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
        const headStyle = head ? getComputedStyle(head) : null;
        const actionsStyle = actions ? getComputedStyle(actions) : null;
        const formGrid = form ? form.querySelector('.form-grid.two') : null;
        const formGridStyle = formGrid ? getComputedStyle(formGrid) : null;
        return {
          modal: Boolean(modal),
          bodyOpen: document.body.classList.contains('overview-open'),
          form: Boolean(form),
          fuelFields: form ? form.querySelectorAll('input[name="date"], input[name="odometer"], input[name="liters"], input[name="price"]').length : 0,
          modalSurface: Boolean(modalStyle && parseFloat(modalStyle.borderTopLeftRadius) >= 18 && /auto|scroll/.test(modalStyle.overflowY) && modalStyle.overscrollBehaviorY === 'contain'),
          modalFitsMobile: Boolean(modal && modal.getBoundingClientRect().width <= window.innerWidth && modal.getBoundingClientRect().height <= window.innerHeight),
          backdropMobileSheet: Boolean(backdropStyle && ['flex-end', 'end'].includes(backdropStyle.alignItems)),
          headLayout: Boolean(headStyle && headStyle.display === 'grid' && headStyle.position === 'sticky'),
          actionsStickyRail: Boolean(actionsStyle && actionsStyle.position === 'sticky' && /auto|scroll/.test(actionsStyle.overflowX) && actionsStyle.flexWrap === 'nowrap'),
          formSingleColumn: Boolean(formGridStyle && formGridStyle.gridTemplateColumns.trim().split(/\\s+/).length === 1)
        };
      })()`
    });
    const modalValue = modalCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG modal:', JSON.stringify(modalValue, null, 2));
    }
    let modalOk = true;
    if (!modalValue.modal) { fail('Garage add-fuel modal se neotevrel.'); modalOk = false; }
    if (!modalValue.bodyOpen) { fail('Otevreny modal nenastavil modalni stav body.'); modalOk = false; }
    if (!modalValue.form) { fail('Garage modal neobsahuje add-fuel formular.'); modalOk = false; }
    if (modalValue.fuelFields < 4) { fail('Garage modal nema zakladni pole tankovani.'); modalOk = false; }
    if (!modalValue.modalSurface) { fail('Garage modal nema sjednoceny modalni povrch a vnitrni scroll.'); modalOk = false; }
    if (!modalValue.modalFitsMobile) { fail('Garage modal presahuje mobilni viewport.'); modalOk = false; }
    if (!modalValue.backdropMobileSheet) { fail('Modal backdrop na mobilu nedrzi sheet u spodni hrany.'); modalOk = false; }
    if (!modalValue.headLayout) { fail('Modal hlavicka nema sticky grid layout.'); modalOk = false; }
    if (!modalValue.actionsStickyRail) { fail('Modalni akce nemaji sticky mobilni rail.'); modalOk = false; }
    if (!modalValue.formSingleColumn) { fail('Modalni formular neni na mobilu jednosloupcovy.'); modalOk = false; }
    if (modalOk) ok('Modaly: garage tankovani se otevira jako novy mobilni sheet s formularovou akci.');

    await page.send('Runtime.evaluate', {
      expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`
    });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await page.send('Runtime.evaluate', {
      expression: `typeof window.__DOMACNOST_E2E_NAV__ === 'function' ? window.__DOMACNOST_E2E_NAV__('home') : document.querySelector('[data-nav="home"]')?.click()`
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    const desktopViewportCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const row = document.querySelector('.app-desktop-row');
        const sidebar = document.querySelector('.app-sidebar');
        const frame = document.querySelector('.app-desktop-row .app-frame');
        const main = document.querySelector('.home-redesign-shell.home-app-shell .home-clean-frame > main');
        const nav = document.querySelector('.nav-shell');
        const rowRect = row?.getBoundingClientRect();
        const sidebarRect = sidebar?.getBoundingClientRect();
        const frameRect = frame?.getBoundingClientRect();
        const mainRect = main?.getBoundingClientRect();
        return {
          row: Boolean(row),
          sidebar: Boolean(sidebarRect && sidebarRect.width >= 240),
          frame: Boolean(frameRect),
          rightGap: frameRect ? Math.round(window.innerWidth - frameRect.right) : 9999,
          availableWidthGap: frameRect && sidebarRect ? Math.round(window.innerWidth - sidebarRect.right - frameRect.width) : 9999,
          bottomGap: mainRect ? Math.round(window.innerHeight - mainRect.bottom) : 9999,
          rowWidth: rowRect ? Math.round(rowRect.width) : 0,
          navHidden: nav ? getComputedStyle(nav).display === 'none' : true
        };
      })()`
    });
    const desktopViewportValue = desktopViewportCheck.result?.value || {};
    let desktopViewportOk = true;
    if (!desktopViewportValue.row || !desktopViewportValue.sidebar || !desktopViewportValue.frame) { fail('Desktop layout nema kompletni sidebar/frame strukturu.'); desktopViewportOk = false; }
    if (Math.abs(Number(desktopViewportValue.rightGap || 0)) > 24) { fail(`Desktop obsah nevyuziva pravou hranu viewportu (mezera ${desktopViewportValue.rightGap}px).`); desktopViewportOk = false; }
    if (Math.abs(Number(desktopViewportValue.availableWidthGap || 0)) > 24) { fail(`Desktop frame nevyuziva sirku vedle sidebaru (rozdil ${desktopViewportValue.availableWidthGap}px).`); desktopViewportOk = false; }
    if (Math.abs(Number(desktopViewportValue.bottomGap || 0)) > 32) { fail(`Home na desktopu nevyuziva vysku viewportu (spodni mezera ${desktopViewportValue.bottomGap}px).`); desktopViewportOk = false; }
    if (!desktopViewportValue.navHidden) { fail('Mobilni navigace zustala viditelna na desktopu.'); desktopViewportOk = false; }
    if (desktopViewportOk) ok('Desktop: aplikace vyuziva celou sirku i vysku dostupne plochy.');

    const submitGuardReleased = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const form = window.__DOMACNOST_E2E_SUBMIT_FORM__;
        const button = form?.querySelector('button');
        const result = { busy: form?.hasAttribute('aria-busy'), disabled: button?.disabled, label: button?.textContent?.trim() || '' };
        form?.remove();
        delete window.__DOMACNOST_E2E_SUBMIT_FORM__;
        return result;
      })()`
    });
    const submitGuardReleasedValue = submitGuardReleased.result?.value || {};
    if (submitGuardReleasedValue.busy || submitGuardReleasedValue.disabled || submitGuardReleasedValue.label !== 'Uložit test') {
      fail(`Formulář se po uložení neodemkl správně (${JSON.stringify(submitGuardReleasedValue)}).`);
      submitGuardOk = false;
    }
    if (submitGuardOk) ok('Formuláře: dvojklik spustí uložení jen jednou a tlačítko ukáže průběh.');

    const renderTimingCheck = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const timings = Array.isArray(window.__DOMACNOST_E2E_RENDER_TIMINGS__) ? window.__DOMACNOST_E2E_RENDER_TIMINGS__ : [];
        const sorted = [...timings].sort((a, b) => Number(b.ms || 0) - Number(a.ms || 0));
        return {
          count: timings.length,
          slowest: sorted.slice(0, 5).map((item) => ({ module: item.module || '', ms: Number(item.ms || 0) })),
          maxMs: sorted.length ? Number(sorted[0].ms || 0) : 0
        };
      })()`
    });
    const renderTimingValue = renderTimingCheck.result?.value || {};
    if (process.env.E2E_DEBUG === '1') {
      console.log('DEBUG render timings:', JSON.stringify(renderTimingValue, null, 2));
    }
    if (!renderTimingValue.count) {
      fail('E2E nesebral render timingy pro kontrolu prvni navigace.');
    } else if (Number(renderTimingValue.maxMs || 0) > 2200) {
      const slowest = (renderTimingValue.slowest || []).map((item) => `${item.module}:${item.ms}ms`).join(', ');
      fail(`Nektery render trval pres 2,2 s (${slowest}).`);
    } else {
      const slowest = (renderTimingValue.slowest || []).slice(0, 3).map((item) => `${item.module}:${item.ms}ms`).join(', ');
      ok(`Performance: render tasky zustaly pod 2,2 s (${slowest || 'bez pomalych renderu'}).`);
    }

  } finally {
    if (browserCdp) {
      try {
        await Promise.race([
          browserCdp.send('Browser.close'),
          new Promise((resolveWait) => setTimeout(resolveWait, 1200))
        ]);
      } catch {}
    }
    if (page) page.close();
    if (browserCdp) browserCdp.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await new Promise((resolveExit) => {
      if (browserProcess.exitCode !== null) return resolveExit();
      browserProcess.once('exit', resolveExit);
      setTimeout(resolveExit, 1500);
    });
    if (browserProcess.exitCode === null) {
      stopBrowserProcessTree(browserProcess);
      await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    } catch (error) {
      console.warn(`Varování: dočasný profil prohlížeče nejde hned smazat (${error.code || error.message}).`);
    }
  }
}

await run();

console.log('E2E smoke pro Domácnost+');
notes.forEach((line) => console.log(`  ok: ${line}`));

if (errors.length) {
  console.error('\nProblémy:');
  errors.forEach((line) => console.error(`  ! ${line}`));
  console.error(`\nNeprošlo ${errors.length} kontrol.`);
  process.exit(1);
}

console.log('\nReal-browser E2E smoke prošel.');
