#!/usr/bin/env node
// Domácnost+ app wiring smoke.
// Dependency-free kontrola, která hlídá, že nové uživatelské funkce nejsou
// jen v jednom souboru, ale jsou zapojené do rendereru, formulářů, cloudu,
// PWA cache a release/check pipeline.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const errors = [];
const notes = [];

function read(relPath) {
  try {
    return readFileSync(join(projectRoot, relPath), 'utf8');
  } catch (error) {
    errors.push(`Nelze číst ${relPath}: ${error.message}`);
    return '';
  }
}

function expect(source, pattern, label) {
  const ok = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
  if (!ok) errors.push(label);
  else notes.push(label);
}

function expectAbsent(source, pattern, label) {
  const found = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
  if (found) errors.push(label);
  else notes.push(label);
}

const app = read('app.js');
const finance = read('finance.js');
const pool = read('pool.js');
const readings = read('readings.js');
const garage = read('garage.js');
const subscriptions = read('subscriptions.js');
const contracts = read('contracts.js');
const calendar = read('calendar.js');
const warranty = read('warranty.js');
const edgeCalendarIcs = read('edge-calendar-ics-sync.ts');
const weather = read('weather.js');
const vape = read('vape.js');
const index = read('index.html');
const sw = read('sw.js');
const pkg = read('package.json');
const styles = read('styles.css');
const shoppingCss = read('shopping.css');
const moduleLoader = read('module-loader.js');
const e2e = read('tools/check-e2e-smoke.mjs');

if (app && finance) {
  expect(app, "financeLoans: []", 'app.js: financeLoans jsou ve výchozím stavu.');
  expect(app, "financeRefinanceResult: null", 'app.js: refinance výsledek má lokální stav.');
  expect(app, /migrated\.financeLoans = normalizeFinanceLoans\(migrated\.financeLoans\)/, 'app.js: financeLoans prochází migrací.');
  expect(app, /financeLoans: normalizeFinanceLoans\(state\.financeLoans \|\| \[\]\)/, 'app.js: financeLoans se ukládají do household UI payloadu.');
  expect(app, /Array\.isArray\(layout\.financeLoans\)/, 'app.js: financeLoans se obnovují z cloud layoutu.');
  expect(app, /finance: \[loadHouseholdUiForModule, cloudLoadFinance\]/, 'app.js: finance lazy loader tahá i household UI.');
  expect(app, "'add-finance-loan': () => addFinanceLoanFromForm(data, form)", 'app.js: add-finance-loan form handler existuje.');
  expect(app, "'finance-refinance': () => calculateFinanceRefinance(data, form)", 'app.js: finance-refinance form handler existuje.');
  expect(app, "action === 'finance-loan-edit'", 'app.js: edit půjčky má action handler.');
  expect(finance, 'function normalizeFinanceLoan', 'finance.js: normalizeFinanceLoan existuje.');
  expect(finance, 'function financeLoanMonthlyPayment', 'finance.js: splátkový výpočet existuje.');
  expect(finance, 'function renderFinanceRefinancePanel', 'finance.js: refinance panel existuje.');
  expect(finance, "data-form=\"finance-refinance\"", 'finance.js: refinance formulář se renderuje.');
  expect(finance, "{ id: 'loans'", 'finance.js: Půjčky jsou samostatný tab.');
}

if (app && pool && index && sw) {
  expectAbsent(index, './pool.js?v=', 'index.html: pool.js neblokuje první vykreslení.');
  expect(moduleLoader, "pool: {\n      scripts: ['pool.js']", 'module-loader.js: Bazén se načítá při prvním použití.');
  expect(sw, "'./pool.js'", 'sw.js: pool.js je v odložené offline cache.');
  expect(app, "{ id: 'pool'", 'app.js: pool je v module registry/Home konfiguraci.');
  expect(app, 'let poolInstance = null', 'app.js: pool má modulovou instanci.');
  expect(app, 'function getPoolModule()', 'app.js: getPoolModule factory wrapper existuje.');
  expect(app, 'pool: renderPool', 'app.js: pool renderer je v renderModule mapě.');
  expect(app, "'pool-settings': () => savePoolFromForm(data, form)", 'app.js: pool-settings form handler existuje.');
  expect(app, /migrated\.pools = normalizePools\(migrated\.pools\)/, 'app.js: pool prochází migrací.');
  expect(app, "poolCloud: { loadedAt: '', pendingAt: '', deletedIds: {} }", 'app.js: pool cloud metadata má default stav.');
  expect(app, 'function normalizePoolCloudState', 'app.js: pool cloud metadata se normalizuje.');
  expect(app, 'function poolDeleteWinsOverCloud', 'app.js: smazaný bazén chrání tombstone proti starému cloudu.');
  expect(app, /pools: normalizePools\(state\.pools \|\| \[\]\)/, 'app.js: pool se ukládá do household UI payloadu.');
  expect(app, /layout\.pool && typeof layout\.pool === 'object'/, 'app.js: pool se obnovuje z cloud layoutu.');
  expectAbsent(app, 'state.pools = normalizePools([...merged, ...cloudOnly]);', 'app.js: pool cloud restore už neudržuje lokální orphan bazény.');
  expect(app, /pool: \[loadHouseholdUiForModule\]/, 'app.js: pool lazy/background loader tahá household UI.');
  expect(pool, 'function normalizePools', 'pool.js: normalizePools existuje.');
  expect(pool, 'function markPoolCloudPending', 'pool.js: změny bazénu značí pending cloud sync.');
  expect(pool, 'deletedIds[deletedId] = now', 'pool.js: smazání bazénu ukládá tombstone podle id.');
  expect(pool, 'saveState({ immediate: options.immediate === true })', 'pool.js: smazání bazénu se umí uložit okamžitě.');
  expect(pool, 'persistPools(next, { deletedId: id, immediate: true })', 'pool.js: deletePool zapisuje tombstone a okamžitý lokální save.');
  expect(app, "'pool-measurement': () => updatePoolMeasurementFromForm(form.dataset.id, data, form)", 'app.js: úprava měření bazénu má form handler.');
  expect(app, "action === 'pool-measurement-delete'", 'app.js: smazání měření bazénu má action handler.');
  expect(pool, 'function normalizePool(', 'pool.js: jednotlivý bazén se normalizuje (více bazénů podporováno).');
  expect(pool, 'function normalizePoolMeasurements', 'pool.js: historie měření bazénu se normalizuje.');
  expect(pool, 'function normalizePoolTime', 'pool.js: měření bazénu normalizuje čas HH:MM.');
  expect(pool, "data-form=\"pool-measurement\"", 'pool.js: měření bazénu má inline editační formulář.');
  expect(pool, 'function poolVolumeM3', 'pool.js: výpočet objemu existuje.');
  expect(pool, 'function poolPhDose', 'pool.js: dávkování pH existuje.');
  expect(pool, 'waterTempC', 'pool.js: teplota vody je součást stavu/renderu.');
  expect(pool, 'function renderPoolMeasurementChart', 'pool.js: graf pH/teploty existuje.');
  expect(pool, 'data-form="pool-settings"', 'pool.js: formulář nastavení bazénu se renderuje.');
  expect(pool, 'data-form="pool-add-measurement"', 'pool.js: nové měření má vlastní zjednodušený formulář (jen pH + teplota).');
  expect(pool, 'function addPoolMeasurementFromForm', 'pool.js: nové měření se ukládá bez zásahu do nastavení bazénu.');
  expect(app, "'pool-add-measurement': () => addPoolMeasurementFromForm(data, form)", 'app.js: nové měření bazénu má form handler.');
  expect(pool, "id: 'settings', label: 'Nastavení'", 'pool.js: bazén má samostatnou záložku Nastavení.');
}

if (app && readings && index && sw && moduleLoader) {
  expectAbsent(index, './readings.js?v=', 'index.html: readings.js neblokuje první vykreslení.');
  expect(moduleLoader, "readings: {\n      scripts: ['readings.js']", 'module-loader.js: Odečty se načítají při prvním otevření.');
  expect(sw, "'./readings.js'", 'sw.js: readings.js je v odložené offline cache.');
  expect(app, 'let readingsInstance = null', 'app.js: Odečty mají samostatnou modulovou instanci.');
  expect(app, 'function getReadingsModule()', 'app.js: getReadingsModule factory wrapper existuje.');
  expect(app, 'return getReadingsModule().renderReadings()', 'app.js: renderer Odečtů jde přes samostatný modul.');
  expectAbsent(app, 'function renderReadingMeterCard(', 'app.js: karty měřidel už nejsou v hlavním souboru.');
  expect(readings, 'function createReadings(deps)', 'readings.js: factory samostatného modulu existuje.');
  expect(readings, 'function renderReadingMeterCard(', 'readings.js: karty měřidel žijí v modulu.');
  expect(readings, 'function renderReadingsLineChart(', 'readings.js: graf Odečtů žije v modulu.');
  expect(readings, 'function renderReadingDetailPanel(', 'readings.js: detail Odečtů žije v modulu.');
  expect(readings, 'window.DomacnostReadings = { createReadings }', 'readings.js: modul publikuje factory rozhraní.');
}

if (app && garage && index && sw && moduleLoader) {
  expectAbsent(index, './garage.js?v=', 'index.html: garage.js neblokuje první vykreslení.');
  expect(moduleLoader, "garage: {\n      scripts: ['garage.js']", 'module-loader.js: Garáž se načítá při prvním otevření.');
  expect(sw, "'./garage.js'", 'sw.js: garage.js je v odložené offline cache.');
  expect(app, 'let garageInstance = null', 'app.js: Garáž má samostatnou modulovou instanci.');
  expect(app, 'function getGarageModule()', 'app.js: getGarageModule factory wrapper existuje.');
  expect(app, 'return getGarageModule().renderGarage()', 'app.js: renderer Garáže jde přes samostatný modul.');
  expect(app, 'return getGarageModule().renderGarageRecordEditForm(collection, item)', 'app.js: modal úpravy záznamu používá rozhraní Garáže.');
  expect(app, 'async function saveServicePlanItemFromForm', 'app.js: ukládání servisního plánu zůstává v datové vrstvě.');
  expectAbsent(app, 'function renderGarageStatsPanel(', 'app.js: statistické UI Garáže už není v hlavním souboru.');
  expectAbsent(app, 'function renderVehicleDetail(', 'app.js: detail auta už není v hlavním souboru.');
  expect(garage, 'function createGarage(deps)', 'garage.js: factory samostatného modulu existuje.');
  expect(garage, 'function renderGarageStatsPanel(', 'garage.js: statistiky auta žijí v modulu.');
  expect(garage, 'function renderGarageTripCalculator(', 'garage.js: kalkulačka cesty žije v modulu.');
  expect(garage, 'function renderVehicleDetail(', 'garage.js: detail auta žije v modulu.');
  expect(garage, 'function renderFuelioImport(', 'garage.js: Fuelio import žije v modulu.');
  expectAbsent(garage, 'async function saveServicePlanItemFromForm', 'garage.js: vizuální modul nepřebírá ukládání servisního plánu.');
  expect(garage, 'window.DomacnostGarage = { createGarage }', 'garage.js: modul publikuje factory rozhraní.');
}

if (app && pool && subscriptions && calendar && warranty) {
  expect(app, 'const moduleUiContracts = new Map()', 'app.js: modulové UI kontrakty mají centrální registr.');
  expect(app, 'function registerModuleUiContract', 'app.js: modulová instance umí zaregistrovat svůj UI kontrakt.');
  expect(app, 'function moduleHasOpenOverlay', 'app.js: shell zjišťuje otevřený overlay přes společné rozhraní.');
  expect(app, 'function hasOpenModuleOverlay', 'app.js: shell zamkne podklad i pro overlay otevřený z jiného modulu.');
  expect(app, '|| hasOpenModuleOverlay()', 'app.js: otevřený overlay libovolného modulu se započítá mezi aplikační dialogy.');
  expect(app, 'function closeOpenAppModals', 'app.js: zavírání modalů je sjednocené v jednom místě.');
  expect(app, 'if (nextModule !== activeModule) closeAllModuleOverlays()', 'app.js: přechod mezi moduly zavře i detail otevřený z Home.');
  expect(app, "registerModuleUiContract('pool'", 'app.js: Bazén registruje společný UI kontrakt.');
  expect(app, "registerModuleUiContract('subscriptions'", 'app.js: Předplatné registruje společný UI kontrakt.');
  expect(app, "registerModuleUiContract('calendar'", 'app.js: Kalendář registruje společný UI kontrakt.');
  expect(app, "registerModuleUiContract('warranties'", 'app.js: Záruky registrují společný UI kontrakt.');
  expectAbsent(app, 'getSubscriptionsModule().isDebtorModalOpen()', 'app.js: shell už nezná konkrétní stav dialogu Předplatného.');
  expectAbsent(app, 'getSubscriptionsModule().closeDebtorModal()', 'app.js: shell už nezavírá dialog Předplatného napřímo.');
  expect(pool, 'isOpen: isPhInfoModalOpen', 'pool.js: Bazén publikuje overlay přes UI kontrakt.');
  expect(subscriptions, 'isOpen: isDebtorModalOpen', 'subscriptions.js: Předplatné publikuje overlay přes UI kontrakt.');
  expect(calendar, 'isOpen: isCalendarEventDetailOpen', 'calendar.js: Kalendář publikuje detail přes UI kontrakt.');
  expect(warranty, 'isOpen: isWarrantyDetailOpen', 'warranty.js: Záruky publikují detail přes UI kontrakt.');
  expect(pool, 'render: () => renderPhInfoModal(getActivePool())', 'pool.js: Bazén publikuje obsah modalu do společné overlay vrstvy.');
  expect(subscriptions, 'render: () => renderDebtorModal(subscriptionMonthSummary())', 'subscriptions.js: Předplatné publikuje platební modal do společné overlay vrstvy.');
  expect(calendar, 'render: renderCalendarEventDetailModal', 'calendar.js: Kalendář publikuje detail do společné overlay vrstvy.');
  expect(warranty, 'render: renderWarrantyDetailModal', 'warranty.js: Záruky publikuje detail do společné overlay vrstvy.');
  expect(app, 'function renderOverlaysOnly()', 'app.js: modaly a rychlé přehledy mají samostatnou render cestu.');
  expect(app, "app.dataset.lastRenderSurface = changed ? 'overlay' : 'none'", 'app.js: overlay render neoznačuje změnu hlavního modulu.');
  expect(app, 'renderOverlays: renderOverlaysOnly', 'app.js: modulům se předává úzká overlay render cesta.');
  expectAbsent(app, 'calendarDetailEventId', 'app.js: shell už nedrží interní stav detailu Kalendáře.');
  expectAbsent(app, 'activeWarrantyDetailId', 'app.js: shell už nedrží interní stav detailu Záruk.');
}

if (app && contracts && index && sw && moduleLoader) {
  expectAbsent(index, './contracts.js?v=', 'index.html: contracts.js neblokuje první vykreslení.');
  expect(moduleLoader, "contracts: {\n      scripts: ['contracts.js']", 'module-loader.js: Smlouvy se načítají při prvním použití.');
  expect(sw, "'./contracts.js'", 'sw.js: contracts.js je v APP_ASSETS.');
  expect(app, 'let contractsInstance = null', 'app.js: contracts má modulovou instanci.');
  expect(app, 'function getContractsModule()', 'app.js: getContractsModule factory wrapper existuje.');
  expect(app, 'contracts: renderContracts', 'app.js: contracts renderer je v renderModule mapě.');
  expect(app, 'return getContractsModule().renderContracts();', 'app.js: renderContracts je už jen wrapper.');
  expect(app, 'return getContractsModule().renderContractOverviewItem(contract);', 'app.js: overview smlouvy jde přes contracts module.');
  expect(app, 'return getContractsModule().cloudLoadContracts(showMessage);', 'app.js: cloudLoadContracts je už jen wrapper.');
  expect(app, 'return getContractsModule().addContractFromForm(data, form);', 'app.js: add-contract formulář jde přes contracts module.');
  expectAbsent(app, 'function cloudContractPayload', 'app.js: cloudContractPayload už není v monolitu.');
  expectAbsent(app, 'function cloudUploadContractFile', 'app.js: cloudUploadContractFile už není v monolitu.');
  expect(contracts, 'function renderContracts()', 'contracts.js: renderContracts existuje.');
  expect(contracts, 'function renderContractDetail', 'contracts.js: renderContractDetail existuje.');
  expect(contracts, 'function cloudContractPayload', 'contracts.js: cloudContractPayload žije v modulu.');
  expect(contracts, 'async function cloudLoadContracts', 'contracts.js: cloudLoadContracts žije v modulu.');
  expect(contracts, 'async function addContractFromForm', 'contracts.js: add-contract handler žije v modulu.');
  expect(contracts, 'async function cloudUploadContractFile', 'contracts.js: upload příloh smluv žije v modulu.');
  expect(contracts, 'async function cloudLoadContractFiles', 'contracts.js: načtení příloh smluv žije v modulu.');
  expect(contracts, 'async function openOrDownloadContractFile', 'contracts.js: otevření/stahování příloh žije v modulu.');
  expect(contracts, 'data-form="add-contract"', 'contracts.js: add-contract formulář se renderuje.');
  expect(contracts, 'data-form="add-contract-file"', 'contracts.js: add-contract-file formulář se renderuje.');
  expect(contracts, 'window.DomacnostContracts', 'contracts.js: factory export existuje.');
}

if (app) {
  const autosyncBody = app.match(/async function runCloudAutosyncNow[\s\S]*?\n  function setCloudAutosyncEnabled/)?.[0] || '';
  expect(app, "const SUPABASE_STORAGE_KEY = 'domacnost-plus-auth-hyyehcskthqmncqlechi';", 'app.js: přihlášení má úložiště oddělené pro novou Supabase.');
  expect(app, "const LEGACY_SUPABASE_STORAGE_KEYS = ['domacnost-plus-auth'];", 'app.js: původní obecný auth klíč se bezpečně migruje nebo odstraní.');
  expect(app, 'function storedSupabaseSessionMatchesProject', 'app.js: uložený JWT se ověřuje proti aktuálnímu Supabase projektu.');
  expect(app, "state.meta?.mode === 'e2e-smoke' || ['127.0.0.1', 'localhost'].includes(window.location.hostname)", 'app.js: izolovaný E2E režim nemusí používat skutečný Supabase JWT.');
  expect(app, /prepareSupabaseAuthStorage\(\);\s*render\(\);/, 'app.js: kontrola Supabase relace proběhne před prvním vykreslením.');
  expect(app, 'const CLOUD_AUTOSYNC_RETRY_DELAYS_MS = [15000, 30000, 60000, 120000];', 'app.js: autosync má omezené postupné opakování po výpadku.');
  expect(app, 'function ensurePendingCloudModuleCode', 'app.js: autosync připraví jen moduly s čekajícími změnami.');
  expectAbsent(autosyncBody, 'cloudLoadAllModules(', 'app.js: běžný autosync po jedné změně už nenačítá všechny moduly.');
  expect(app, "window.addEventListener('online', () => {", 'app.js: návrat internetu obnoví cloudovou aktivitu.');
  expect(app, "window.addEventListener('offline', () => {", 'app.js: ztráta internetu přepne synchronizaci do čekajícího stavu.');
  expect(app, 'householdUiPendingAt', 'app.js: neodeslané společné nastavení domácnosti je trvale evidované.');
  expect(app, 'entry.items.filter((item) => !item.cloudId || item.syncStatus)', 'app.js: přehled cloudu počítá i neodeslané úpravy existujících záznamů.');
  expect(app, 'function requestBackgroundRender()', 'app.js: background/cloud render ma tichy vstup.');
  expect(app, "document.documentElement.classList.add('app-quiet-render')", 'app.js: tiche rendery umi vypnout rusivou animaci obsahu.');
  expect(app, 'function markModuleTransition()', 'app.js: rucni prepnuti modulu ma explicitni prechod.');
  expect(app, /markModuleTransition\(\);\s*render\(\);/, 'app.js: modulovy prechod se pousti jen pred rucnim nav renderem.');
  expectAbsent(app, 'function syncMobileDockRuntimeOffset()', 'app.js: mobilni dock uz nema mrtvy runtime-sync mechanismus (5 listeneru, ktere jen porad nastavovaly stejnou konstantu) - offset je staticka CSS hodnota v styles.css.');
  expectAbsent(app, 'const currentGap = viewportBottom - rect.bottom;', 'app.js: mobilni dock uz se po startu neposouva podle dodatecneho mereni viewportu.');
  expectAbsent(app, 'SIDEBAR_PINNED_IDS', 'app.js: desktop sidebar už nemá natvrdo duplikovanou sekci Oblíbené.');
  expectAbsent(app, '<div class="app-sidebar-label">Oblíbené</div>', 'app.js: desktop sidebar nerenderuje sekci Oblíbené.');
  expect(app, 'function garageVehicleDedupeKeys', 'app.js: Garáž deduplikuje auta přes více aliasů.');
  expect(app, 'function garageKnownBrandModelFromName', 'app.js: Garáž umí rozpoznat značka/model i z názvu auta.');
  expect(app, 'keys.find((candidate) => map.has(candidate))', 'app.js: dedupe aut sloučí lokální/cloud záznam podle libovolného aliasu.');
  expect(app, 'function remapVehicleServicePlanMap', 'app.js: servisní plán auta se přemapuje při sloučení duplicitních vozidel.');
  expect(app, 'state.settings.vehicleServicePlans = remapVehicleServicePlanMap', 'app.js: dedupe aut neponechá servisní plán pod odstraněným vehicleId.');
  expect(app, 'function getVehicleLastKnownOdometer', 'app.js: Garáž umí zjistit poslední známý nájezd auta.');
  expect(app, 'naposled ${formatKm(lastOdometer)}', 'app.js: tankování ukazuje placeholder s posledním nájezdem.');
  expect(app, 'odometer < lastOdometer', 'app.js: tankování blokuje menší nájezd než poslední známý.');
  expect(calendar, 'function parseIcsEvents', 'calendar.js: ICS/iCal ma frontend fallback parser.');
  expect(calendar, 'function syncIcsSourcesInBrowser', 'calendar.js: ICS/iCal umi nacist udalosti i bez edge funkce.');
  expect(calendar, "filter((event) => !keys.includes(String(event.sourceId || '')))", 'calendar.js: browser ICS sync maze lokalni udalosti, ktere uz ve zdroji nejsou.');
  expect(calendar, "parsed.name === 'RECURRENCE-ID'", 'calendar.js: browser ICS parser cte RECURRENCE-ID pro zrusene vyskyty opakovanych udalosti.');
  expect(calendar, "String(raw.status || '').toUpperCase() === 'CANCELLED'", 'calendar.js: browser ICS parser vyrazuje zrusene vyskyty opakovanych udalosti.');
  expect(calendar, 'function calendarSourceIdSet', 'calendar.js: cloud calendar load umi porovnat lokalni udalosti s aliasy cloud/source id.');
  expect(calendar, 'cloudBackedIcsSourceIds', 'calendar.js: cloud calendar load cisti lokalni ICS kopie po nacteni cloud zdroje.');
  expect(calendar, '!event.cloudId && !isEventFromSourceSet(event, cloudBackedIcsSourceIds)', 'calendar.js: zrusene ICS udalosti nezustavaji v lokalnim fallback stavu po cloud syncu.');
  expect(calendar, 'const CALENDAR_AUTO_SYNC_MAX_AGE_MS = 30 * 60 * 1000;', 'calendar.js: ICS/iCal auto-sync se kontroluje priblizne po 30 minutach.');
  expect(calendar, 'scheduleCalendarAutoSync(\'periodic\'', 'calendar.js: ICS/iCal auto-sync se sam znovu naplanuje.');
  expect(calendar, 'eventsRemoved', 'calendar.js: ICS/iCal sync vraci pocet odstranenych udalosti.');
  expect(calendar, 'fallbackPruned: true', 'calendar.js: pri stare edge funkci umi ICS sync uklidit lokalni udalosti browser fallbackem.');
  expect(edgeCalendarIcs, 'async function cancelMissingEventsForSource', 'edge-calendar-ics-sync.ts: cloud ICS sync umi zrusit udalosti, ktere zmizely ze zdroje.');
  expect(edgeCalendarIcs, 'cancelledRecurrenceIds', 'edge-calendar-ics-sync.ts: cloud ICS sync vyrazuje STATUS:CANCELLED recurrence override.');
  expect(edgeCalendarIcs, 'event.rrule || event.recurrenceId', 'edge-calendar-ics-sync.ts: cloud ICS provider id rozlisuje upravene jednotlive vyskyty opakovani.');
  expect(edgeCalendarIcs, "status: 'cancelled'", 'edge-calendar-ics-sync.ts: zmizele ICS udalosti se v cloudu oznaci jako cancelled.');
  expect(edgeCalendarIcs, 'eventsRemoved', 'edge-calendar-ics-sync.ts: cloud ICS sync vraci pocet odstraneni.');
  expect(edgeCalendarIcs, 'function localPartsToIcsDateTime', 'edge-calendar-ics-sync.ts: RRULE se expanduje v lokalnim case zdroje kvuli DST/letnimu casu.');
  expect(edgeCalendarIcs, 'withLocalWeekday(cursor, weekday)', 'edge-calendar-ics-sync.ts: tydenni RRULE kandidati pouzivaji lokalni weekday, ne UTC weekday.');
  expect(edgeCalendarIcs, 'occurrenceKeys(occurrence).some((key) => exSet.has(key))', 'edge-calendar-ics-sync.ts: EXDATE se porovnava podle UTC i lokalniho occurrence klice.');
  expectAbsent(edgeCalendarIcs, 'let cursor = new Date(startMs);', 'edge-calendar-ics-sync.ts: RRULE se nesmi vratit na stary UTC cursor, ktery v lete minul EXDATE.');
  expect(calendar, 'function calendarSourceColorPicker', 'calendar.js: barva zdroje kalendare je vyber ze swatchu.');
  expect(calendar, 'function calendarSourceColor', 'calendar.js: udalosti umi nacist barvu sveho zdroje.');
  expect(calendar, 'style="--calendar-source-color:', 'calendar.js: udalosti v kalendari dostavaji CSS barvu zdroje.');
  expect(calendar, 'calendarSourceDedupeKeys', 'calendar.js: zdroje kalendare se deduplikuji podle provider/url aliasu.');
  expect(styles, '.calendar-color-picker', 'styles.css: kalendar ma swatch vyber barvy zdroje.');
  expect(styles, 'border-left: 4px solid var(--calendar-source-color', 'styles.css: kalendarove seznamove udalosti maji barevny okraj podle zdroje.');
  expect(calendar, 'function scheduleCalendarAutoSync', 'calendar.js: iCal auto-sync uz nema Google OAuth wrapper.');
  expectAbsent(calendar, 'function googleCalendarStart', 'calendar.js: Google OAuth pripojeni je odstranene.');
  expectAbsent(app, 'google-calendar-start', 'app.js: Google OAuth action handlery jsou odstranene.');
  expect(app, 'const upcomingEvents = calendarPanelEvents.slice(0, 8);', 'app.js: Home Nadchazejici pripravi 8 polozek pro desktop 4x2.');
  expect(app, ".slice(0, 8)\n      .forEach((event) => add({\n        icon: '📅'", 'app.js: Home Nadchazejici doplnuje az 8 kalendarovych udalosti, ne jen 6.');
  expect(app, 'function compareHomeAttentionItems', 'app.js: Home Nadchazejici ma vlastni comparator pro casove razeni.');
  expect(app, 'sortAt: calendarEventStartMs(event)', 'app.js: kalendarove udalosti na Home se radi podle skutecneho zacatku.');
  expect(styles, 'grid-template-columns: repeat(4, minmax(0, 1fr));', 'styles.css: Home Nadchazejici ma desktop 4 sloupce.');
  expect(styles, '.app-desktop-row .app-frame {\n    max-width: none;\n    margin: 0;', 'styles.css: desktopový obsah využívá celou dostupnou šířku.');
  expect(styles, 'padding-bottom: max(12px, env(safe-area-inset-bottom, 0px)) !important;', 'styles.css: desktop už nedědí spodní rezervu mobilní navigace.');
  expect(app, 'function readingGroupIdOrDefault', 'app.js: Odecty maji bezpecny fallback pro skupinu meridla.');
  expect(app, 'groupId: readingGroupIdOrDefault(data.groupId)', 'app.js: pridani meridla uklada jen existujici skupinu.');
  expect(app, 'groupId: readingGroupIdOrDefault(data.groupId || original.groupId)', 'app.js: uprava meridla uklada jen existujici skupinu.');
  expect(readings, '<strong>Místa</strong><span>skupiny, ceny, zálohy</span>', 'readings.js: Odečty ukazují správu skupin jako Místa, ne jen jako Ceny.');
  expect(app, 'function resetSubscriptionMonthToCurrentForOpen', 'app.js: Predplatne ma reset mesice pri otevreni modulu.');
  expect(app, "if (activeModule === 'subscriptions') resetSubscriptionMonthToCurrentForOpen();", 'app.js: otevreni Predplatneho prepne prehled na aktualni mesic.');
  expect(app, 'function isHorizontallyScrollableTarget', 'app.js: swipe guard umí poznat horizontálně scrollovatelný blok.');
  expect(app, 'const NAVIGATION_SWIPE_IGNORE_SELECTOR', 'app.js: swipe guard má centrální seznam chráněných oblastí.');
  expect(app, 'function isNavigationSwipeIgnoredTarget', 'app.js: navigační swipe má jednotný ignore helper.');
  expect(app, 'swipeStartTarget', 'app.js: navigační swipe kontroluje i místo začátku gesta.');
  expect(app, 'isNavigationSwipeIgnoredTarget(event.target) || isNavigationSwipeIgnoredTarget(swipeStartTarget)', 'app.js: swipe navigace ignoruje start i konec v chráněném bloku.');
  expect(app, 'function deferUiStorageSet', 'app.js: UI storage preference se zapisují odloženě mimo klik.');
  expect(app, 'function persistActiveModuleSoon', 'app.js: aktivní modul má odložený persistence helper.');
  expect(app, 'function persistModuleTabsSoon', 'app.js: modulové záložky mají odložený persistence helper.');
  expect(app, "cloudWarmStartTimer = runWhenUiQuiet(() => {\n        cloudWarmStartTimer = null;", 'app.js: cloud warm-start u přihlášeného uživatele ustoupí první interakci.');
  expect(app, 'function schedulePostRenderLayoutWork', 'app.js: layout práce po renderu je odložená mimo klikový task.');
  expect(app, 'schedulePostRenderLayoutWork(navMotion, navMotionFromIndex, activeBottomNavIndex);', 'app.js: render odkládá nav/layout stabilizaci až po přepisu DOM.');
  expect(app, 'window.__DOMACNOST_E2E_RENDER_TIMINGS__', 'app.js: E2E sbírá render timingy pro hlídání dlouhých prvních navigací.');
  expect(e2e, 'renderTimingCheck', 'tools/check-e2e-smoke.mjs: E2E kontroluje render timingy.');
  expect(e2e, 'maxMs || 0) > 2200', 'tools/check-e2e-smoke.mjs: E2E failne render v řádu sekund.');
  expect(e2e, 'async function measurePhysicalNavClick', 'tools/check-e2e-smoke.mjs: E2E meri skutecny fyzicky klik na prvni navigaci.');
  expect(e2e, 'Input.dispatchMouseEvent', 'tools/check-e2e-smoke.mjs: fyzicky nav test pouziva CDP vstup, ne interni helper.');
  expect(e2e, 'firstPhysicalNav.latencyMs', 'tools/check-e2e-smoke.mjs: fyzicky nav test hlida latenci prvniho prepnuti.');
  expect(e2e, "ok('Desktop: aplikace vyuziva celou sirku i vysku dostupne plochy.')", 'tools/check-e2e-smoke.mjs: real-browser test hlídá plnou desktopovou plochu.');
  expectAbsent(app, 'function readNavRunnerSnapshot', 'app.js: klik na spodni navigaci nesmi pred renderem cist layout rozmery.');
  expectAbsent(app, 'placeNavRunnerAt', 'app.js: nav runner uz nepotrebuje pixel snapshot z klikoveho tasku.');
  expectAbsent(app, "localStorage.setItem('homeWeb.activeModule', activeModule);", 'app.js: přepnutí modulu nesmí synchronně zapisovat activeModule do localStorage.');
  expectAbsent(app, "localStorage.setItem('domacnostPlus.moduleTabs', JSON.stringify(moduleTabs));", 'app.js: přepnutí záložek nesmí synchronně zapisovat moduleTabs do localStorage.');
  expect(app, "'.form-actions'", 'app.js: formulářové akce jsou chráněné proti swipe přepnutí.');
  expect(app, "'.finance-toolbar'", 'app.js: finance toolbar je chráněný proti swipe přepnutí.');
  expect(app, "'.garage-history-toolbar'", 'app.js: garážové filtry jsou chráněné proti swipe přepnutí.');
  expect(app, 'aria-label="Záložky modulu" data-no-swipe', 'app.js: společné modulové záložky jsou chráněné proti swipe přepnutí.');
  expectAbsent(app, 'function renderModuleCockpit', 'app.js: module cockpit byl odstraněn (redesign v0.1_373 – jedna hlavička na modul).');
}

if (styles) {
  expect(styles, '/* Domacnost+ v0.1_418 - klidne cloud rendery a stabilni mobilni dock */', 'styles.css: existuje finalni blok pro klidne cloud rendery a stabilni mobilni dock.');
  expect(styles, 'html.app-quiet-render .app-frame main', 'styles.css: app-quiet-render vypina animaci main obsahu.');
  expect(styles, 'html.app-module-transition:not(.app-quiet-render) .app-frame main', 'styles.css: main animace je povolena jen pri rucnim prepnuti modulu.');
  expect(styles, '--mobile-dock-runtime-offset: 0px;', 'styles.css: runtime korekce mobilniho docku startuje na 0px.');
  expect(styles, '.section-tabs {\n  display: flex;', 'styles.css: společné modulové záložky používají horizontální rail.');
  expect(styles, '.finance-tab-loans .finance-panel:not(.panel-loans)', 'styles.css: Finance Půjčky mají vlastní tab visibility pravidlo.');
  expect(styles, '/* Domácnost+ – jednotný obsah modulů */', 'styles.css: existuje finální blok pro jednotný obsah modulů.');
  expect(styles, '.grid.two.module-tabbed,\n  .grid.three.module-tabbed', 'styles.css: module-tabbed má mobilní jednosloupcové pravidlo.');
  expect(styles, '.module-tabbed > .card {\n    grid-column: auto;', 'styles.css: module-tabbed umí na desktopu vrátit běžné karty do gridu.');
  expect(styles, '/* Domácnost+ – jednotné rozbalovací formuláře */', 'styles.css: existuje finální blok pro rozbalovací formuláře.');
  expect(styles, '.action-details > summary,\n.compact-edit-details > summary', 'styles.css: action-details a compact-edit-details sdílí summary layout.');
  expect(styles, '.inline-edit-card {\n  display: grid;', 'styles.css: inline edit panely mají nový grid povrch.');
  expect(styles, '/* Domácnost+ – jednotné seznamové položky */', 'styles.css: existuje finální blok pro seznamové položky.');
  expect(styles, '.item-top {\n  display: grid;', 'styles.css: item-top používá stabilní grid řádek.');
  expect(styles, '.compact-list .item-meta,\n.overview-list .item-meta', 'styles.css: kompaktní seznamy mají kontrolovaný ořez dlouhých metadat.');
  expect(styles, '/* Domácnost+ – jednotné dashboard a history povrchy */', 'styles.css: existuje finální blok pro dashboard/history povrchy.');
  expect(styles, '/* Domacnost+ - sjednoceny Home */', 'styles.css: existuje finalni blok pro jednotny Home.');
  expect(styles, '.home-daily-hero .glass-icon.station-summary-icon {', 'styles.css: Home glass fallback je ukotveny ve finalni Home vrstve.');
  expect(styles, '.home-daily-hero .hero-weather-pill .weather-anime-icon svg,', 'styles.css: Home pocasi a ikonove SVG sloty ziji ve finalni Home vrstve.');
  expect(app, '<span class="app-sidebar-logo" aria-hidden="true"><img src="${BRAND_ICON_SRC}" alt=""></span>', 'app.js: desktop sidebar pouziva skutecne logo aplikace.');
  expect(app, 'class="home-weather-astronomy"', 'app.js: Home pocasi ma pravy blok Slunce/Mesic misto textu Detail.');
  expectAbsent(app, 'home-weather-widget-link">Detail', 'app.js: Home pocasi uz nezobrazuje text Detail.');
  expect(styles, '.home-weather-astronomy {\n  display: grid;', 'styles.css: Home pocasi ma kompaktni astronomicky blok.');
  expect(styles, '/* Domacnost+ v0.1_423 - pocasi, desktop logo a sjednoceny Vape povrch */', 'styles.css: existuje finalni blok pro pocasi, sidebar logo a Vape.');
  expect(styles, 'grid-template-columns: 22px 43px 43px;', 'styles.css: Home pocasi ma na desktopu pevne sloupce pro Slunce/Mesic.');
  expect(weather, 'function weatherAstronomyForDay(day = null, location = null)', 'weather.js: pocasi umi spocitat Slunce/Mesic pro den.');
  expect(weather, 'function renderMoonPhaseIcon', 'weather.js: pocasi renderuje vizualni fazi Mesice.');
  expect(weather, "{ id: 'astronomy', label: 'Další', icon: '🌙' }", 'weather.js: modul Pocasi ma zalozku Dalsi pro Slunce a Mesic.');
  expectAbsent(weather, 'Východ a západ slunce jsou z počasí', 'weather.js: astronomicka zalozka uz nema vysvetlujici popis.');
  expect(weather, 'class="weather-astronomy-columns"', 'weather.js: Slunce a Mesic jsou v oddelenych sloupcich.');
  expect(weather, 'weather-astronomy-section-sun', 'weather.js: Slunce ma vlastni astronomy sekci.');
  expect(weather, 'weather-astronomy-section-moon', 'weather.js: Mesic ma vlastni astronomy sekci.');
  expect(styles, '.weather-astronomy-card {', 'styles.css: modul Pocasi ma astronomickou kartu.');
  expect(styles, '.weather-astronomy-columns {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));', 'styles.css: Pocasi/Dalsi ma na desktopu 2 sloupce Slunce/Mesic.');
  expect(styles, '.vape-calc-panel.card,\n.vape-item-form-panel.card,\n.vape-items-panel.card,\n.vape-stats-panel.card', 'styles.css: Vape panely maji sjednoceny povrch.');
  expect(styles, '.vape-item-row.item {\n  border: 1px solid var(--line);', 'styles.css: Vape polozky maji sjednoceny seznamovy povrch.');
  expect(vape, 'class="grid two module-tabbed vape-tab-${escapeHtml(activeTab)}" data-tab-area="vape"', 'vape.js: Vape pouziva spolecny module-tabbed layout.');
  expect(styles, '/* Domacnost+ v0.1_424 - jednotny povrch napric vsemi moduly mimo Home */', 'styles.css: existuje finalni vrstva pro sjednoceny povrch vsech modulu.');
  expect(styles, 'body:not(.home-active) .app-frame main .module-tabbed > .section-tabs', 'styles.css: vnitrni zalozky v module-tabbed drzi plnou sirku.');
  expect(styles, 'body:not(.home-active) .app-frame main .item,\nbody:not(.home-active) .app-frame main .compact-item', 'styles.css: radky a polozky maji jednotny modulovy povrch mimo Home.');
  expect(styles, '.home-primary-action,\n.home-attention-item,\n.focus-tile,\n.timeline-item,\n.setup-item,\n.sync-overview-row {\n  grid-template-columns: auto minmax(0, 1fr) auto;', 'styles.css: dashboard/history řádky sdílí stabilní třísloupcový grid.');
  expect(styles, '.empty,\n.empty-cta {', 'styles.css: prázdné stavy mají sjednocený nový povrch.');
  expect(styles, '/* Domácnost+ – jednotné detailní a grafové povrchy */', 'styles.css: existuje finální blok pro detailní/grafové povrchy.');
  expect(styles, '.consumption-chart,\n.pool-chart,\n.garage-line-chart,\n.readings-line-chart svg', 'styles.css: grafy mají stabilní responzivní rozměry.');
  expect(styles, '.garage-stats-kpis {\n    grid-template-columns: repeat(2, minmax(0, 1fr));', 'styles.css: KPI gridy mají společné mobilní pravidlo.');
  expect(styles, '/* Domácnost+ – jednotné Nastavení, importy a dlouhé formuláře */', 'styles.css: existuje finální blok pro Nastavení/formuláře.');
  expect(styles, '.compact-edit-details,\n.finance-form-drawer,\n.hdo-manual-details,\n.readings-form-drawer,\n.subscription-form-drawer,\n.inline-edit-card {', 'styles.css: Finance, HDO, Odečty i Předplatné formuláře jsou explicitně ve společném rozbalovacím povrchu.');
  expect(styles, '.settings-tabbed .textarea {\n  min-height: 148px;', 'styles.css: import/dlouhé textarea mají stabilní výšku.');
  expect(styles, '.install-steps {\n  grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));', 'styles.css: instalační kroky PWA drží nový responzivní grid.');
  expect(styles, '.visual-choice-card,\n.module-toggle,\n.switch-row,\n.cloud-household-row,\n.install-step,\n.pwa-diagnostic-item {\n  display: grid;', 'styles.css: settings volby a řádky sdílí nový grid povrch.');
  expect(styles, '.form-actions,\n  .item-actions,\n  .finance-filter-chips', 'styles.css: společné akční lišty používají mobilní rail.');
  expect(styles, '.garage-history-toolbar {\n    display: flex;', 'styles.css: garážové filtry používají mobilní rail.');
  expect(styles, '.module-cockpit-metrics,\n  .module-cockpit-actions', 'styles.css: cockpit metriky a akce sdílí mobilní rail.');
  expect(styles, 'overscroll-behavior-x: contain;', 'styles.css: cockpit rail drží horizontální posun uvnitř panelu.');
  expect(styles, 'scroll-snap-type: x proximity;', 'styles.css: cockpit rail má jemné snapování položek.');
}

if (styles) {
  expect(styles, '/* Domacnost+ - sjednocene modaly a prekryvy */', 'styles.css: existuje finalni blok pro modaly a prekryvy.');
  expect(styles, '.app-modal,\n.overview-panel {\n  width: min(100%, 760px);', 'styles.css: app modal a overview panel sdili novy povrch.');
  expect(styles, '.modal-actions {\n  position: sticky;', 'styles.css: modalni akce jsou ukotvene uvnitr modalu.');
  expect(styles, '.loyalty-code-stage,\n.file-preview-stage,\n.loyalty-action-sheet', 'styles.css: vnorene modalni plochy maji sjednoceny povrch.');
  expect(styles, '/* Domacnost+ - sjednoceny hub Vice */', 'styles.css: existuje finalni blok pro hub Vice.');
  expect(styles, '.more-clean-hub .more-settings-card,\n.more-clean-hub .more-module-card {\n  display: grid;', 'styles.css: Vice karty pouzivaji novy grid povrch.');
  expect(styles, '.more-module-section .more-module-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit', 'styles.css: Vice modulove sekce maji responzivni grid.');
  expect(styles, '/* Domacnost+ - sjednoceny kalendar */', 'styles.css: existuje finalni blok pro kalendar.');
  expect(styles, '.calendar-month-toolbar {\n  display: grid;', 'styles.css: kalendarovy mesicni toolbar pouziva grid.');
  expect(styles, '.calendar-weekdays,\n.calendar-week-row {\n  display: grid;\n  grid-template-columns: repeat(7, minmax(0, 1fr));', 'styles.css: kalendarovy tyden ma stabilnich 7 sloupcu.');
  expect(styles, '.calendar-day-event {\n  width: 100%;\n  display: grid;', 'styles.css: kalendarova udalost ma stabilni kartovy grid.');
  expect(styles, '.calendar-source-item {\n  display: grid;', 'styles.css: kalendarovy zdroj ma novy seznamovy povrch.');
  expect(styles, '/* Domacnost+ - sjednocena Garaz */', 'styles.css: existuje finalni blok pro Garaz.');
  expect(styles, '.garage-chart-carousel {\n  display: grid;\n  grid-auto-flow: column;\n  grid-auto-columns:', 'styles.css: Garaz grafovy carousel ma vlastni responzivni rail.');
  expect(styles, '.vehicle-detail-head {\n  display: grid;', 'styles.css: Garaz detail hlavicka pouziva stabilni grid.');
  expect(styles, '.garage-history-row,\n.service-plan-item {\n  display: grid;', 'styles.css: Garaz historie a servisni plan sdili seznamovy povrch.');
  expect(styles, '.garage-trip-result {\n  padding: 10px;', 'styles.css: Garaz kalkulacka ma sjednoceny vysledkovy povrch.');
  expect(styles, '/* Domacnost+ - sjednoceny Zapisnik */', 'styles.css: existuje finalni blok pro Zapisnik.');
  expect(styles, '.notebook-section-card,\n.notebook-tasks-tab,\n.notebook-create-card,\n.notebook-note-card,\n.notebook-task-group,\n.notebook-empty-actions {', 'styles.css: Zapisnik karty a prazdne stavy sdili novy povrch.');
  expect(styles, '.notebook-section-pill {', 'styles.css: Zapisnik sekcni stitek je ve finalni vrstve.');
  expect(styles, '.notebook-checklist {', 'styles.css: Zapisnik checklist je ve finalni vrstve.');
  expect(styles, '.notebook-task-form input[type="date"],\n.notebook-task-form .input[type="date"],\n.notebook-date-input {', 'styles.css: Zapisnik datum a formulare jsou ve finalni vrstve.');
}

if (styles) {
  expect(styles, '/* Domacnost+ - sjednocene Odecty */', 'styles.css: existuje finalni blok pro sjednocene Odecty.');
  expect(styles, '.readings-tool-page,\n.readings-price-details,\n.readings-add-group-form,\n.readings-group-card,\n.readings-energy-box,\n.reading-due-card,\n.reading-meter-card {', 'styles.css: Odecty karty sdili novy povrch.');
  expect(styles, '.readings-meter-tool-tabs > .readings-tool-card {\n    flex: 0 0 min(78vw, 260px);', 'styles.css: Odecty nastroje maji mobilni rail misto stareho skladani panelu.');
}

if (shoppingCss) {
  expect(shoppingCss, '/* Domacnost+ - novy povrch nakupnich podslozek */', 'shopping.css: existuje finalni blok pro nakupni podslozky.');
  expect(shoppingCss, '.shopping-list-chip,\n.shopping-cloud-strip,\n.shopping-progress-card,\n.shopping-done-open-card,\n.loyalty-add-panel,\n.loyalty-scan-card {', 'shopping.css: nakupni seznamy, cloud a loyalty formulare sdili finalni povrch.');
  expect(shoppingCss, '.shopping-done-modal {\n  width: min(100%, 760px);', 'shopping.css: hotovo modal sdili mobilni sheet rozmery.');
  expect(shoppingCss, '.shopping-done-actions {\n  margin-top: 14px;', 'shopping.css: hotovo modal ma spodní akce v modalnim railu.');
  expect(shoppingCss, '.loyalty-wallet-grid .loyalty-card-item:not(.is-editing) {\n  min-height: 158px;', 'shopping.css: kompaktni vernostni karty ziji ve finalni vrstve bez !important override.');
}

if (app) {
  expect(app, 'window.__DOMACNOST_E2E_OPEN_SHOPPING_DONE__', 'app.js: E2E umi otevrit Nakup Hotovo modal deterministicky.');
}

if (pkg) {
  expect(pkg, '"check:wiring"', 'package.json: check:wiring je v npm skriptech.');
  expect(pkg, 'npm run check:wiring', 'package.json: hlavní check spouští wiring smoke.');
  expect(pkg, '"check:e2e"', 'package.json: check:e2e real-browser smoke je dostupný.');
}

if (app && index && moduleLoader) {
  ['shopping-utils.js', 'shopping-render.js', 'shopping-actions.js', 'notes.js', 'contracts.js', 'subscriptions.js', 'warranty.js', 'hdo.js', 'waste.js', 'finance.js', 'pool.js', 'readings.js', 'garage.js', 'calendar.js', 'vape.js'].forEach((asset) => {
    expectAbsent(index, `./${asset}?v=`, `index.html: ${asset} neblokuje první vykreslení.`);
    expect(moduleLoader, `'${asset}'`, `module-loader.js: ${asset} je dostupný na vyžádání.`);
  });
  expect(app, 'const canPatchCurrentModule =', 'app.js: opakovaný render stejného modulu zachovává shell.');
  expect(app, "await ensureModuleCodeForInteraction(nextModule)", 'app.js: navigace počká na kód odloženého modulu.');
  expectAbsent(moduleLoader, 'initialHomeDependencies', 'module-loader.js: domovské widgety už nestahují celé moduly při startu.');
  expect(moduleLoader, "async function start() {\n    // Domovské souhrny používají lehké datové adaptéry", 'module-loader.js: první obrazovka spouští jen hlavní shell.');
  expect(app, 'function buildGlobalSearchIndex()', 'app.js: globální hledání používá sdílený paměťový index.');
  expect(app, 'globalSearchIndexRevision += 1', 'app.js: změna dat zneplatní index globálního hledání.');
  expect(app, "add('shopping', 'list'", 'app.js: globální hledání prohledává nákupní položky.');
  expect(app, "add('finance', 'overview'", 'app.js: globální hledání prohledává finance.');
  expect(app, "add('readings', 'overview'", 'app.js: globální hledání prohledává měřidla.');
  expect(app, "(event.ctrlKey || event.metaKey) && key === 'k'", 'app.js: Ctrl/Command+K otevírá globální hledání.');
  expect(moduleLoader, 'const ASSET_LOAD_TIMEOUT_MS = 15000', 'module-loader.js: načítání modulu má časový limit.');
  expect(moduleLoader, 'assetPromises.delete(key)', 'module-loader.js: neúspěšný asset lze při dalším kliknutí načíst znovu.');
  expect(moduleLoader, "script.dataset.domacnostAsset === path", 'module-loader.js: po chybě odstraní jen vlastní neúspěšný script.');
  expect(index, 'id="module-load-status"', 'index.html: pomalé načtení modulu má samostatný stavový prvek.');
  expect(app, 'let moduleLoadBusyCount = 0', 'app.js: souběžné načítání modulů používá bezpečný čítač.');
  expect(styles, '.module-load-status.is-visible', 'styles.css: stav načítání je viditelný až při práci modulu.');
  expect(app, 'function moduleIdFromNavigationTarget', 'app.js: klik i přednačtení sdílí stejné určení cílového modulu.');
  expect(app, 'function allowModuleIntentPrefetch', 'app.js: přednačítání respektuje úsporné a velmi pomalé připojení.');
  expect(app, "app.addEventListener('pointerover', (event) => scheduleModuleIntentPrefetch(event.target))", 'app.js: najetí na navigaci připraví odložený modul.');
  expect(app, "app.addEventListener('focusin', (event) => scheduleModuleIntentPrefetch(event.target))", 'app.js: klávesnicové zaměření připraví odložený modul.');
  expect(app, "scheduleModuleIntentPrefetch(event.target, { immediate: true })", 'app.js: dotyk začne modul načítat ještě před kliknutím.');
  expect(app, 'primeModuleCode(moduleId, { renderOnReady: false })', 'app.js: příprava modulu na základě záměru nepřekreslí otevřenou obrazovku.');
  expect(app, 'let notificationItemsCache =', 'app.js: seznam upozornění má paměťovou cache.');
  expect(app, 'notificationItemsCache.revision === globalSearchIndexRevision', 'app.js: upozornění se přepočítají až po změně dat nebo dne.');
  expect(app, 'source === notificationItemsCache.sources[index]', 'app.js: výměna cloudových kolekcí zneplatní cache upozornění i bez mutace pole.');
  expect(app, 'const subscriptionSummary = subscriptionMonthSummary(currentMonth, { prime: false })', 'app.js: upozornění na předplatné používá stejnou kreditní matematiku bez předčasného načtení modulu.');
  expect(app, 'let creditBefore = 0', 'app.js: rychlý Home výpočet započítává kredit z dřívější platby.');
  expect(app, 'creditBefore = Math.max(0, creditBefore + monthPaid - expected)', 'app.js: kredit platby dopředu se přenáší měsíc po měsíci.');
  expect(app, 'const moduleScrollPositions = new Map()', 'app.js: moduly si pamatují vlastní pozici posunu.');
  expect(app, 'function rememberModuleScrollPosition(moduleId = activeModule)', 'app.js: pozice posunu se uloží ještě před asynchronním přepnutím modulu.');
  expect(app, 'data-preserve-scroll="module-main-${escapeHtml(active.id)}"', 'app.js: hlavní scroll má stabilní klíč oddělený pro každý modul.');
  expect(styles, '/* Domacnost+ v0.1_491 - spolehlivy svisly scroll Home ve vsech layoutech */', 'styles.css: existuje finální oprava svislého scrollu Domů.');
  expect(styles, '.home-redesign-shell.home-app-shell .app-desktop-row {\n  height: 100%;', 'styles.css: Home předává skutečnou výšku vnitřnímu scrollovacímu kontejneru.');
}

console.log('App wiring smoke pro Domácnost+');
notes.forEach((line) => console.log(`  ok: ${line}`));

if (errors.length) {
  console.error('\nProblémy:');
  errors.forEach((line) => console.error(`  ! ${line}`));
  console.error(`\nNeprošlo ${errors.length} kontrol.`);
  process.exit(1);
}

console.log('\nVšechny wiring kontroly sedí.');
