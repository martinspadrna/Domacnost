#!/usr/bin/env node
// Domácnost+ release surface check.
// Bez npm závislostí — čte přímo app.js / index.html / sw.js a ověřuje,
// že APP_VERSION / APP_BUILD / cache klíč / query stringy / export filename
// sedí ke stejnému buildu. Nenulový exit code = neshoda k nápravě.
// Spustit: node tools/check-release.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const appPath = resolve(projectRoot, 'app.js');
const indexPath = resolve(projectRoot, 'index.html');
const swPath = resolve(projectRoot, 'sw.js');
const pwaPath = resolve(projectRoot, 'pwa.js');
const moduleLoaderPath = resolve(projectRoot, 'module-loader.js');
const releaseMarkerPath = resolve(projectRoot, 'release.json');

const errors = [];
const notes = [];

function readOrFail(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    errors.push(`Nelze číst ${path}: ${error.message}`);
    return '';
  }
}

function requireMatch(source, regex, label) {
  const match = source.match(regex);
  if (!match) {
    errors.push(`Nenašel jsem ${label}. Regex: ${regex}`);
    return null;
  }
  return match;
}

const app = readOrFail(appPath);
const index = readOrFail(indexPath);
const sw = readOrFail(swPath);
// pwa.js je od v0.1_323 součástí release surface — pokud ho index.html
// načítá, musí existovat a projít release kontrolou pro PWA_EXPECTED_CACHE.
const indexReferencesPwa = /<script\s+src="\.\/pwa\.js\?/.test(index);
const pwa = indexReferencesPwa ? readOrFail(pwaPath) : '';
const moduleLoader = readOrFail(moduleLoaderPath);
const releaseMarkerSource = readOrFail(releaseMarkerPath);
if (indexReferencesPwa && !existsSync(pwaPath)) {
  errors.push('index.html načítá ./pwa.js, ale soubor v repu chybí.');
}

// APP_VERSION = 'Domácnost+ v.0.1_<build>'
const versionMatch = requireMatch(
  app,
  /const APP_VERSION = 'Domácnost\+ v\.0\.1_(\d+)';/,
  'APP_VERSION v app.js'
);
// APP_BUILD = <build>
const buildMatch = requireMatch(
  app,
  /const APP_BUILD = (\d+);/,
  'APP_BUILD v app.js'
);

if (versionMatch && buildMatch) {
  const versionNumber = versionMatch[1];
  const buildNumber = buildMatch[1];
  if (versionNumber !== buildNumber) {
    errors.push(`APP_VERSION (v.0.1_${versionNumber}) neodpovídá APP_BUILD (${buildNumber}).`);
  } else {
    notes.push(`APP_VERSION a APP_BUILD sladěné na ${buildNumber}.`);
  }

  const expectedQuery = `0-1-${buildNumber}`;
  const expectedCache = `domacnost-plus-v0-1-${buildNumber}`;

  try {
    const releaseMarker = JSON.parse(releaseMarkerSource);
    if (String(releaseMarker.build) !== buildNumber) {
      errors.push(`release.json build=${releaseMarker.build} neodpovídá APP_BUILD=${buildNumber}.`);
    } else if (releaseMarker.version !== `Domácnost+ v.0.1_${buildNumber}`) {
      errors.push(`release.json má nesprávný text verze: ${releaseMarker.version}.`);
    } else {
      notes.push(`release.json: síťový marker odpovídá buildu ${buildNumber}.`);
    }
  } catch (error) {
    errors.push(`release.json není platný JSON: ${error.message}`);
  }

  // index.html title <title>Domácnost+ v.0.1_<build></title>
  if (!index.includes(`Domácnost+ v.0.1_${buildNumber}`)) {
    errors.push(`index.html neobsahuje 'Domácnost+ v.0.1_${buildNumber}' (title / boot fallback).`);
  } else {
    notes.push(`index.html: verze title match ${buildNumber}.`);
  }

  // index.html query strings ?v=0-1-<build>
  const queryHits = [...index.matchAll(/\?v=0-1-(\d+)/g)];
  if (!queryHits.length) {
    errors.push(`index.html neobsahuje žádné ?v=0-1-... script tagy.`);
  } else {
    const mismatched = queryHits.filter((hit) => hit[1] !== buildNumber);
    if (mismatched.length) {
      const set = new Set(mismatched.map((hit) => hit[1]));
      errors.push(
        `index.html má ${mismatched.length} script tagů s ?v=0-1-{${[...set].join(', ')}} místo ?v=${expectedQuery}.`
      );
    } else {
      notes.push(`index.html: ${queryHits.length} script tagů s ?v=${expectedQuery}.`);
    }
  }

  // sw.js CACHE_NAME. Od v0.1_321 to je template literal
  //   const CACHE_NAME = `${CACHE_PREFIX}v0-1-<build>`;
  // takže regex bere backticky i single quotes (single quote varianta
  // je ponechána pro zpětnou kompatibilitu s dřívějším tvarem).
  const cacheTemplateMatch = sw.match(/const CACHE_NAME = `\$\{CACHE_PREFIX\}v0-1-(\d+)`;/);
  const cacheLiteralMatch = sw.match(/const CACHE_NAME = 'domacnost-plus-v0-1-(\d+)';/);
  const cacheBuildStr = cacheTemplateMatch?.[1] || cacheLiteralMatch?.[1];
  if (!cacheBuildStr) {
    errors.push(
      'sw.js: nenašel jsem CACHE_NAME v očekávaném tvaru ' +
        '(`${CACHE_PREFIX}v0-1-<build>` nebo \'domacnost-plus-v0-1-<build>\').'
    );
  } else if (cacheBuildStr !== buildNumber) {
    errors.push(`sw.js CACHE_NAME build=${cacheBuildStr} neodpovídá APP_BUILD=${buildNumber}.`);
  } else {
    notes.push(`sw.js: CACHE_NAME rozřešeno na ${expectedCache}.`);
  }
  // Prefix musí existovat, jinak by šablona v CACHE_NAME nesedla ke cleanup filteru.
  if (cacheTemplateMatch && !/const CACHE_PREFIX = 'domacnost-plus-';/.test(sw)) {
    errors.push("sw.js: CACHE_NAME používá CACHE_PREFIX, ale chybí const CACHE_PREFIX = 'domacnost-plus-'.");
  }

  // Export filename derived from APP_BUILD.
  // Hledáme 'domacnost-plus-v0-1-${APP_BUILD}-${todayISO()}.json' (template literal).
  const exportRegex = /domacnost-plus-v0-1-\$\{APP_BUILD\}-\$\{todayISO\(\)\}\.json/;
  if (!exportRegex.test(app)) {
    errors.push(
      `Export filename v app.js není odvozený z APP_BUILD. Očekáváno: 'domacnost-plus-v0-1-\${APP_BUILD}-\${todayISO()}.json'.`
    );
  } else {
    notes.push(`app.js: export filename odvozený z APP_BUILD (${buildNumber}).`);
  }

  // PWA_EXPECTED_CACHE se od v0.1_323 sleduje v pwa.js (createPwa factory).
  // Musí být přesně `${PWA_CACHE_PREFIX}v0-1-${APP_BUILD}` — jinak by cache
  // klíč zobrazený v UI nesedl na skutečný CACHE_NAME v sw.js.
  if (indexReferencesPwa) {
    const pwaExpectedRegex = /const PWA_EXPECTED_CACHE = `\$\{PWA_CACHE_PREFIX\}v0-1-\$\{APP_BUILD\}`;/;
    const pwaPrefixRegex = /const PWA_CACHE_PREFIX = 'domacnost-plus-';/;
    if (!pwa) {
      errors.push('pwa.js: nedá se přečíst, ačkoli index.html ho načítá.');
    } else {
      if (!pwaPrefixRegex.test(pwa)) {
        errors.push("pwa.js: chybí const PWA_CACHE_PREFIX = 'domacnost-plus-'.");
      }
      if (!pwaExpectedRegex.test(pwa)) {
        errors.push(
          'pwa.js: chybí const PWA_EXPECTED_CACHE = `${PWA_CACHE_PREFIX}v0-1-${APP_BUILD}`.'
        );
      }
      if (pwaPrefixRegex.test(pwa) && pwaExpectedRegex.test(pwa)) {
        notes.push('pwa.js: PWA_CACHE_PREFIX + PWA_EXPECTED_CACHE odvozené z APP_BUILD.');
      }
    }
  }

  const loaderVersionMatch = moduleLoader.match(/const ASSET_VERSION = '0-1-(\d+)';/);
  if (!loaderVersionMatch) {
    errors.push('module-loader.js: chybí ASSET_VERSION pro verzování odložených souborů.');
  } else if (loaderVersionMatch[1] !== buildNumber) {
    errors.push(`module-loader.js ASSET_VERSION=${loaderVersionMatch[1]} neodpovídá APP_BUILD=${buildNumber}.`);
  } else if (!/loadScript\('app\.js'\)/.test(moduleLoader)) {
    errors.push('module-loader.js: hlavní app.js není zapojený do dynamického startu.');
  } else {
    notes.push(`module-loader.js: odložené soubory používají build ${buildNumber} a spouštějí app.js.`);
  }

  // Ochrana proti zbytkům předchozí verze na release surface.
  const staleQuery = `0-1-${Number(buildNumber) - 1}`;
  const staleCache = `domacnost-plus-v0-1-${Number(buildNumber) - 1}`;
  const staleVersion = `v.0.1_${Number(buildNumber) - 1}`;
  const staleHits = [];
  if (index.includes(`?v=${staleQuery}`)) staleHits.push(`index.html ?v=${staleQuery}`);
  if (index.includes(staleVersion)) staleHits.push(`index.html ${staleVersion}`);
  if (sw.includes(staleCache)) staleHits.push(`sw.js ${staleCache}`);
  if (app.includes(`APP_VERSION = 'Domácnost+ ${staleVersion}'`)) staleHits.push(`app.js ${staleVersion}`);
  if (staleHits.length) {
    errors.push(`Zbyla stará verze na release surface: ${staleHits.join('; ')}.`);
  } else {
    notes.push(`Žádné zbytky předchozí verze (${staleQuery}) na release surface.`);
  }
}

console.log('Release surface check pro Domácnost+');
notes.forEach((line) => console.log(`  ok: ${line}`));
if (errors.length) {
  console.error('\nProblémy:');
  errors.forEach((line) => console.error(`  ! ${line}`));
  console.error(`\nNeprošlo ${errors.length} kontrol.`);
  process.exit(1);
} else {
  console.log('\nVšechny kontrolní body sedí.');
}
