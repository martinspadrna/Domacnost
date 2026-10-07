#!/usr/bin/env node
// Domácnost+ memoization + výpočtové invarianty check.
// Bez npm závislostí — chrání proti regresi memoization invalidation
// (v0.1_325/326) a segmentového výpočtu spotřeby v Garáži (v0.1_328).
//
// Kontroly:
//   1. notes.js NEpoužívá slabý fingerprint `text.slice(0, 96)` v kódu
//      (komentář zmiňující starý pattern je OK — scanujeme jen kód).
//   2. notes.js signature používá full-text hash (fnv1aHashNoteText(text)).
//   3. calendar.js signature zahrnuje title (e.title) — je to tie-breaker
//      v sortCalendarEventsByStart, bez něj by přejmenování události se
//      stejným časem nechalo staré pořadí z cache.
//   4. app.js garageFuelConsumptionStats počítá segmentově — reuse
//      garageFuelEntryMetrics, ne z celkového nájezdu (lastKm − firstKm).
//
// Spustit: node tools/check-memoization.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');

const errors = [];
const notes = [];

function readOrFail(relPath) {
  try {
    return readFileSync(join(projectRoot, relPath), 'utf8');
  } catch (error) {
    errors.push(`Nelze číst ${relPath}: ${error.message}`);
    return '';
  }
}

// Odstraní řádkové `//` komentáře, aby zmínka o starém patternu v komentáři
// neshodila kontrolu. Blokové komentáře v těchto souborech nejsou, stačí `//`.
function stripLineComments(source) {
  return source
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

// Kontrola notes.js.
const notesSource = readOrFail('notes.js');
if (notesSource) {
  const notesCode = stripLineComments(notesSource);
  if (/text\.slice\(\s*0\s*,\s*96\s*\)/.test(notesCode)) {
    errors.push(
      'notes.js: signature používá slabý `text.slice(0, 96)` fingerprint. ' +
        'Edit za 96. znakem se stejnou délkou by nechal starou cache. ' +
        'Použij full-text hash (fnv1aHashNoteText).'
    );
  } else {
    notes.push('notes.js: žádný slabý text.slice(0, 96) fingerprint v kódu.');
  }
  if (!/function fnv1aHashNoteText\(/.test(notesSource)) {
    errors.push('notes.js: chybí fnv1aHashNoteText helper pro full-text fingerprint.');
  } else if (!/\$\{fnv1aHashNoteText\(text\)\}/.test(notesSource)) {
    errors.push('notes.js: computeNotesSignature nepoužívá fnv1aHashNoteText(text) v signature.');
  } else {
    notes.push('notes.js: signature používá full-text FNV-1a hash.');
  }
}

// Kontrola calendar.js.
const calendarSource = readOrFail('calendar.js');
if (calendarSource) {
  const sigMatch = calendarSource.match(/function computeCalendarSignature\(\)\s*\{[\s\S]*?\n {4}\}/);
  if (!sigMatch) {
    errors.push('calendar.js: nenašel jsem computeCalendarSignature().');
  } else {
    const sigBody = sigMatch[0];
    if (!/e\.title/.test(sigBody)) {
      errors.push(
        'calendar.js: computeCalendarSignature neobsahuje e.title. ' +
          'sortCalendarEventsByStart používá title jako tie-breaker — přejmenování ' +
          'události se stejným časem by nechalo staré pořadí z cache.'
      );
    } else {
      notes.push('calendar.js: signature zahrnuje e.title (sort tie-breaker).');
    }
    if (!/s\.isEnabled/.test(sigBody)) {
      errors.push('calendar.js: computeCalendarSignature neobsahuje source isEnabled (toggle zdroje by neinvalidoval).');
    } else {
      notes.push('calendar.js: signature zahrnuje source isEnabled.');
    }
  }
}

// Kontrola app.js — garageFuelConsumptionStats segmentový výpočet.
const appSource = readOrFail('app.js');
if (appSource) {
  const fnMatch = appSource.match(/function garageFuelConsumptionStats\([\s\S]*?\n {2}\}/);
  if (!fnMatch) {
    errors.push('app.js: nenašel jsem garageFuelConsumptionStats().');
  } else {
    const body = fnMatch[0];
    if (!/garageFuelEntryMetrics\(/.test(body)) {
      errors.push(
        'app.js: garageFuelConsumptionStats nepoužívá garageFuelEntryMetrics — ' +
          'spotřeba se musí počítat z platných segmentů mezi tankováními, ne ad-hoc.'
      );
    } else {
      notes.push('app.js: garageFuelConsumptionStats počítá segmentově (garageFuelEntryMetrics).');
    }
    // Denominátor dlouhodobé spotřeby nesmí být (lastKm − firstKm) — řádky
    // bez litrů by zvětšovaly jmenovatel. Hlídáme, že se scitají segmentove km.
    if (/last\.odometer[\s\S]*?-[\s\S]*?first\.odometer/.test(body)) {
      errors.push(
        'app.js: garageFuelConsumptionStats používá (last − first) odometer jako ' +
          'jmenovatel. Dlouhodobý průměr musí dělit součtem km platných segmentů.'
      );
    }
  }
}

// Kontrola app.js — per-vehicle/per-household mapy izolace mezi domácnostmi
// (v0.1_329/330). vehicleServicePlans i vehicleIconColors musí být v
// capture/save/restore workspace cestě, jinak po přepnutí domácnosti zůstane
// servisní plán / barvy z předchozí.
if (appSource) {
  const isolatedMaps = ['vehicleServicePlans', 'vehicleIconColors'];
  const workspaceFns = [
    'captureCurrentHouseholdWorkspace',
    'saveHouseholdWorkspace',
    'restoreHouseholdWorkspace'
  ];
  workspaceFns.forEach((fnName) => {
    const match = appSource.match(new RegExp(`function ${fnName}\\([\\s\\S]*?\\n {2}\\}`));
    if (!match) {
      errors.push(`app.js: nenašel jsem ${fnName}().`);
      return;
    }
    const delegatesToCompleteCapture = fnName === 'saveHouseholdWorkspace'
      && /captureCurrentHouseholdWorkspace\(\)/.test(match[0]);
    isolatedMaps.forEach((mapName) => {
      if (!new RegExp(mapName).test(match[0]) && !delegatesToCompleteCapture) {
        errors.push(
          `app.js: ${fnName} neřeší ${mapName} — po přepnutí domácnosti by ` +
            'zůstala mapa z předchozí. Přidej ho do workspace cesty.'
        );
      } else {
        notes.push(`app.js: ${fnName} izoluje ${mapName}${delegatesToCompleteCapture ? ' přes kompletní capture snapshot' : ''}.`);
      }
    });
  });
  // restoreHouseholdWorkspace bez snapshotu (else větev) musí obě mapy nulovat.
  const restoreMatch = appSource.match(/function restoreHouseholdWorkspace\([\s\S]*?\n {2}\}/);
  if (restoreMatch) {
    const elseMatch = restoreMatch[0].match(/\}\s*else\s*\{[\s\S]*$/);
    const elseBody = elseMatch ? elseMatch[0] : '';
    isolatedMaps.forEach((mapName) => {
      if (!new RegExp(`${mapName}\\s*=\\s*\\{\\s*\\}`).test(elseBody)) {
        errors.push(
          `app.js: restoreHouseholdWorkspace else větev (bez snapshotu) nenuluje ` +
            `${mapName} na {} — nová domácnost by zdědila mapu z předchozí.`
        );
      } else {
        notes.push(`app.js: restoreHouseholdWorkspace bez snapshotu nuluje ${mapName}.`);
      }
    });
  }
}

console.log('Memoization + výpočtové invarianty pro Domácnost+');
notes.forEach((line) => console.log(`  ok: ${line}`));
if (errors.length) {
  console.error('\nProblémy:');
  errors.forEach((line) => console.error(`  ! ${line}`));
  console.error(`\nNeprošlo ${errors.length} kontrol.`);
  process.exit(1);
} else {
  console.log('\nVšechny kontrolní body sedí.');
}
