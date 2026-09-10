#!/usr/bin/env node
// Domácnost+ syntax check.
// Bez npm závislostí — přes `process.execPath --check <file>` ověří, že
// klíčové JS soubory projektu se dají naparsovat. Neprovádí runtime appky,
// jen parse. Dohromady s check-release.mjs a check-static-smoke.mjs tvoří
// `npm run check` pipeline.
//
// Kontrolované soubory:
//   * lokální JS z index.html (script src="./...")
//   * sw.js
//   * všechny tools/*.mjs (self-check je bezpečný, --check jen parsuje)
//
// Spustit: node tools/check-syntax.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');

const targets = [];
const errors = [];
const notes = [];

function addTarget(relPath, source) {
  if (!relPath) return;
  const absPath = join(projectRoot, relPath);
  if (!existsSync(absPath)) {
    errors.push(`Chybí soubor pro syntax check: ${relPath} (${source})`);
    return;
  }
  if (targets.some((t) => t.absPath === absPath)) return;
  targets.push({ relPath, absPath, source });
}

// 1. Lokální JS z index.html.
try {
  const index = readFileSync(join(projectRoot, 'index.html'), 'utf8');
  const scriptHits = [...index.matchAll(/<script\s+src="([^"]+)"/g)];
  scriptHits.forEach((m) => {
    const href = m[1];
    if (/^https?:\/\//i.test(href)) return; // externí (Supabase CDN)
    const clean = href.split('?')[0].replace(/^\.\//, '');
    if (clean) addTarget(clean, 'index.html');
  });
} catch (error) {
  errors.push(`index.html: ${error.message}`);
}

// 1b. JS načítaný přes module-loader.js (odložené moduly + app.js).
try {
  const loader = readFileSync(join(projectRoot, 'module-loader.js'), 'utf8');
  const lazyScriptHits = [...loader.matchAll(/'([^']+\.js)'/g)];
  lazyScriptHits.forEach((match) => addTarget(match[1], 'module-loader.js'));
} catch (error) {
  errors.push(`module-loader.js: ${error.message}`);
}

// Dynamicky načítaný app.js už nemusí mít vlastní script tag v index.html.
addTarget('app.js', 'dynamic bootstrap');

// 2. sw.js.
addTarget('sw.js', 'root');

// 3. tools/*.mjs.
try {
  const toolsDir = join(projectRoot, 'tools');
  const entries = readdirSync(toolsDir).filter((name) => name.endsWith('.mjs'));
  entries.forEach((name) => addTarget(join('tools', name), 'tools/'));
} catch (error) {
  errors.push(`tools/: ${error.message}`);
}

if (!targets.length) {
  errors.push('Nenašel jsem žádný soubor ke kontrole.');
}

let failed = 0;
for (const target of targets) {
  const result = spawnSync(process.execPath, ['--check', target.absPath], {
    encoding: 'utf8'
  });
  if (result.status === 0) {
    notes.push(`ok: ${target.relPath}`);
  } else {
    failed += 1;
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const message = stderr || stdout || `exit ${result.status}`;
    errors.push(`${target.relPath}: ${message.split('\n').slice(0, 5).join(' | ')}`);
  }
}

console.log(`Syntax check pro Domácnost+ (${targets.length} souborů)`);
notes.forEach((line) => console.log(`  ${line}`));

if (errors.length) {
  console.error('\nProblémy:');
  errors.forEach((line) => console.error(`  ! ${line}`));
  console.error(`\nNeprošlo ${failed || errors.length} kontrol.`);
  process.exit(1);
} else {
  console.log('\nVšechny soubory parsují.');
}
