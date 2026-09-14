import { readFileSync } from 'node:fs';

const app = readFileSync('app.js', 'utf8');
const css = readFileSync('styles.css', 'utf8');
const readings = readFileSync('readings.js', 'utf8');
const warranty = readFileSync('warranty.js', 'utf8');
const readingsSurface = `${app}\n${readings}`;

const checks = [
  {
    name: 'render captures and restores whole form snapshots',
    ok: app.includes('captureFormStabilitySnapshot()') &&
      app.includes('restoreFormStabilitySnapshot(formSnapshot)') &&
      app.includes('namedFormControls(form)')
  },
  {
    name: 'dirty business forms survive module navigation and page reload in session storage',
    ok: app.includes("const FORM_DRAFT_STORAGE_KEY = 'domacnostPlus.formDrafts.v1'") &&
      app.includes('function rememberSessionFormDraft(form)') &&
      app.includes('function restoreSessionFormDrafts()') &&
      app.includes('restoreSessionFormDrafts();\n      restoreFormStabilitySnapshot(formSnapshot)') &&
      app.includes('clearSessionFormDraft(form);') &&
      app.includes('flushSessionFormDrafts();')
  },
  {
    name: 'form submit guard blocks duplicate saves and exposes an accessible busy state',
    ok: app.includes("if (!form || form.dataset.busy === 'true') return false;") &&
      app.includes("form.setAttribute('aria-busy', 'true');") &&
      app.includes("activeButton.dataset.busySubmit = 'true';") &&
      app.includes("form.dispatchEvent(new CustomEvent('domacnost:submit-start'));") &&
      app.includes("if (!form || form.dataset.busy === 'true') return;") &&
      app.includes('guardedHandleForm(form, event.submitter)') &&
      app.includes('button.disabled = disabled;') &&
      css.includes('button[data-busy-submit="true"]::before') &&
      css.includes('@keyframes form-submit-spin')
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
    ok: readingsSurface.includes('readingEntryValuePlaceholder') &&
      readingsSurface.includes('readingEntryValueField') &&
      readingsSurface.includes('naposledy') &&
      !readingsSurface.includes(' min="${escapeHtml(String(latest.value))}"')
  },
  {
    name: 'reading entries stay open after save and confirm before accepting a lower current value',
    ok: readingsSurface.includes('readingsEntryDrawerOpen = true;') &&
      readingsSurface.includes('item.value < Number(latest.value)') &&
      readingsSurface.includes('value < Number(latest.value)') &&
      readingsSurface.includes('Vyměnil/a jsi měřidlo? Uložit i tak?')
  },
  {
    name: 'average reading price is direct unit price first',
    ok: readingsSurface.includes('const direct = decimalValue(meter?.pricePerUnit);') &&
      readingsSurface.includes('directAverageFields') &&
      readingsSurface.includes('Průměrná cena za')
  },
  {
    name: 'reading price mode toggles without full form render',
    ok: readingsSurface.includes('function syncReadingPriceModeFields(form)') &&
      readingsSurface.includes('const readingsPricingModeControl = event.target.closest') &&
      !readingsSurface.includes('const readingsMeterStructureControl = event.target.closest')
  },
  {
    name: 'reading submeter relation is normalized and netted from parent',
    ok: readingsSurface.includes('parentMeterId: normalizeText(item.parentMeterId') &&
      readingsSurface.includes('function readingParentMeterOptions') &&
      readingsSurface.includes('parent.type !== item.type || parent.unit !== item.unit') &&
      readingsSurface.includes('parent.submeterValue = Number') &&
      readingsSurface.includes('relationNote')
  },
  {
    name: 'reading meter monthly deposit is entered and compared per meter',
    ok: readingsSurface.includes('monthlyDeposit: normalizeReadingPricePart') &&
      readingsSurface.includes("field('Měsíční záloha', 'monthlyDeposit'") &&
      readingsSurface.includes('function readingCostBalance(meter = null, row = null)') &&
      readingsSurface.includes('const latestByMeter = new Map();') &&
      readingsSurface.includes('renderReadingsCostSummary(consumptionRows)')
  },
  {
    name: 'reading meter billing period overrides group period and rolls yearly',
    ok: readingsSurface.includes('function readingMeterBillingPeriod(meter = null, referenceDate = todayISO())') &&
      readingsSurface.includes('rolledFrom: base.from') &&
      readingsSurface.includes("field('Fakturační období od', 'billingFrom'") &&
      readingsSurface.includes("field('Fakturační období do', 'billingTo'") &&
      readingsSurface.includes('readingMeterBillingLabel(item.meter)')
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
