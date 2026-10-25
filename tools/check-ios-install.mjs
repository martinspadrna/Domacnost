#!/usr/bin/env node
// TEST v590: committed Edge iOS installer uses the same opaque original logo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from './generate-pwa-icons.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name));
const build = JSON.parse(read('release.json')).build;
assert.equal(build, 590);
const png = read('icons/domacnost-plus-ios-180.png');
const image = decodePng(png);
assert.equal(image.width, 180);
assert.equal(image.height, 180);
for (let i = 3; i < image.pixels.length; i += 4) {
  assert.equal(image.pixels[i], 255, 'iOS PNG must be fully opaque');
}
const page = read('ios-install.html').toString('utf8');
const embedded = page.match(/rel="apple-touch-icon" sizes="180x180" href="data:image\/png;base64,([^"]+)"/);
assert(embedded, 'The committed HTML must contain inline base64 Apple icon');
assert(Buffer.from(embedded[1], 'base64').equals(png), 'Inline icon must match physical PNG');
assert(page.includes('window.navigator.standalone===true'));
assert(page.includes("window.location.replace('./index.html?source=pwa')"));
assert(page.includes('domacnost-plus-ios-180.png?v=0-1-590'));
const index = read('index.html').toString('utf8');
assert(index.includes('rel="apple-touch-icon" sizes="180x180" href="./icons/domacnost-plus-ios-180.png?v=0-1-590"'));
const manifest = JSON.parse(read('manifest.webmanifest'));
assert(manifest.icons.every((icon) => icon.purpose === 'any' && icon.src.includes('0-1-590')));
const sw = read('sw.js').toString('utf8');
assert(sw.includes("'./ios-install.html'"));
assert(sw.includes("'./icons/domacnost-plus-ios-180.png'"));
assert(sw.includes("requestUrl.pathname.endsWith('/ios-install.html')"));
assert(sw.includes("fetch(event.request, { cache: 'no-store' })"));
console.log('PASS iOS Edge install v590: committed inline icon, opaque 180px, SW routing, version');