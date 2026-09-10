import { readFileSync } from 'node:fs';

const app = readFileSync('app.js', 'utf8');
const warranty = readFileSync('warranty.js', 'utf8');

const checks = [
  {
    name: 'render captures and restores whole form snapshots',
    ok: app.includes('captureFormStabilitySnapshot()') &&
      app.includes('restoreFormStabilitySnapshot(formSnapshot)') &&
      app.includes('namedFormControls(form)')
  },
  {
    name: 'scrollable app panels preserve their own scroll across renders',
    ok: app.includes('data-preserve-scroll="home-edit-sheet"') &&
      app.includes('data-preserve-scroll="module-main-${escapeHtml(active.id)}"') &&
      app.includes('const moduleScrollPositions = new Map()') &&
      app.includes('function scrollStabilityElements()') &&
      app.includes('function isScrollStabilityCandidate(node)') &&
      app.includes('function scrollStabilityKey(node)') &&
      app.includes('captureScrollStabilitySnapshot()') &&
      app.includes('restoreScrollStabilitySnapshot(snapshot)') &&
      app.includes('safeAnimationFrame(() => restoreScrollStabilitySnapshot(snapshot))')
  },
  {
    name: 'background render waits while a form is being edited',
    ok: app.includes('FORM_RENDER_QUIET_MS') &&
      app.includes('shouldDelayBackgroundRender()') &&
      app.includes('scheduleQuietRender()')
  },
  {
    // Zámerně BEZ nativního min="" - to blokovalo odeslání formuláře dřív, než
    // se stihl zeptat JS potvrzovací dialog (viz check níže), takže po výměně
    // měřidla nešlo zadat legitimně nižší stav vůbec.
    name: 'reading entry form uses last-value placeholder without a hard native min block',
    ok: app.includes('readingEntryValuePlaceholder') &&
      app.includes('readingEntryValueField') &&
      app.includes('naposledy') &&
      !app.includes(' min="${escapeHtml(String(latest.value))}"')
  },
  {
    name: 'reading entries stay open after save and confirm before accepting a lower current value',
    ok: app.includes('readingsEntryDrawerOpen = true;') &&
      app.includes('item.value < Number(latest.value)') &&
      app.includes('value < Number(latest.value)') &&
      app.includes('Vyměnil/a jsi měřidlo? Uložit i tak?')
  },
  {
    name: 'average reading price is direct unit price first',
    ok: app.includes('const direct = decimalValue(meter?.pricePerUnit);') &&
      app.includes('directAverageFields') &&
      app.includes('Průměrná cena za')
  },
  {
    name: 'reading price mode toggles without full form render',
    ok: app.includes('function syncReadingPriceModeFields(form)') &&
      app.includes('const readingsPricingModeControl = event.target.closest') &&
      !app.includes('const readingsMeterStructureControl = event.target.closest')
  },
  {
    name: 'reading submeter relation is normalized and netted from parent',
    ok: app.includes('parentMeterId: normalizeText(item.parentMeterId') &&
      app.includes('function readingParentMeterOptions') &&
      app.includes('parent.type !== item.type || parent.unit !== item.unit') &&
      app.includes('parent.submeterValue = Number') &&
      app.includes('relationNote')
  },
  {
    name: 'reading meter monthly deposit is entered and compared per meter',
    ok: app.includes('monthlyDeposit: normalizeReadingPricePart') &&
      app.includes("field('Měsíční záloha', 'monthlyDeposit'") &&
      app.includes('function readingCostBalance(meter = null, row = null)') &&
      app.includes('const latestByMeter = new Map();') &&
      app.includes('renderReadingsCostSummary(consumptionRows)')
  },
  {
    name: 'reading meter billing period overrides group period and rolls yearly',
    ok: app.includes('function readingMeterBillingPeriod(meter = null, referenceDate = todayISO())') &&
      app.includes('rolledFrom: base.from') &&
      app.includes("field('Fakturační období od', 'billingFrom'") &&
      app.includes("field('Fakturační období do', 'billingTo'") &&
      app.includes('readingMeterBillingLabel(item.meter)')
  },
  {
    name: 'warranty files survive renders through an in-memory queue',
    ok: warranty.includes('const warrantyPendingFiles = new Map();') &&
      warranty.includes('stageWarrantyFilesFromForm') &&
      warranty.includes('pendingWarrantyFilesFor(queueKey)')
  },
  {
    name: 'warranty UI shows selected queued files',
    ok: warranty.includes('renderPendingWarrantyFiles') &&
      warranty.includes('Vybráno:')
  },
  {
    name: 'app wires warranty file selection to the queue',
    ok: app.includes('function stageWarrantyFilesFromForm(form)') &&
      app.includes('form[data-form="add-warranty-files"]') &&
      app.includes('stageWarrantyFilesFromForm(warrantyFilesForm)')
  }
];

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error('Form stability checks failed:');
  failed.forEach((check) => console.error(`- ${check.name}`));
  process.exit(1);
}

console.log(`Form stability checks OK (${checks.length}/${checks.length})`);
