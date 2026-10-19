#!/usr/bin/env node
// PWA v580: verify exact RGBA PNG pixels, icon ICO, browser references and
// absence of opaque legacy Android maskable icon choices. No npm dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIcons, decodePng } from './generate-pwa-icons.mjs';

const root=resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(resolve(root,name));
const source=read('icons/source/domacnost-plus-original-512.png');
const {result}=buildIcons(source);
const alphaPaths=[
 'icons/domacnost-plus-icon-16.png','icons/domacnost-plus-icon-32.png',
 'icons/domacnost-plus-icon-120.png','icons/domacnost-plus-icon-152.png',
 'icons/domacnost-plus-icon-167.png','icons/domacnost-plus-icon-180.png',
 'icons/domacnost-plus-icon-192.png','icons/domacnost-plus-icon-384.png',
 'icons/domacnost-plus-icon-512.png',
 'icons/apple-touch-icon.png','icons/apple-touch-icon-precomposed.png',
 'icons/domacnost-plus-maskable-192.png','icons/domacnost-plus-maskable-512.png'
];
for(const file of alphaPaths) {
 const bytes=read(file),expected=result.get(file);
 assert(expected&&expected.equals(bytes),'PWA icon must match preserved original artwork and alpha extraction: '+file);
 const img=decodePng(bytes);
 assert(img.width===img.height);
 assert.equal(img.pixels[3],0,'Upper-left alpha must be transparent: '+file);
 assert.equal(img.pixels[(img.width-1)*4+3],0,'Upper-right corner must be transparent: '+file);
 assert.equal(img.pixels[(img.width*(img.height-1))*4+3],0,'Lower-left corner must be transparent: '+file);
 assert.equal(img.pixels[(img.width*img.height-1)*4+3],0,'Lower-right corner must be transparent: '+file);
 let visible=0,transparent=0;
 for(let i=3;i<img.pixels.length;i+=4){if(img.pixels[i]>128)visible++;if(img.pixels[i]===0)transparent++;}
 assert(visible>img.width*img.height*0.1,'Motif vanished: '+file);
 assert(transparent>img.width*img.height*0.1,'Opaque tile still exists: '+file);
}
const ico=read('icons/favicon.ico');
assert(ico.equals(result.get('icons/favicon.ico')),'ICO must derive from exactly the same logo');
assert.equal(ico.readUInt16LE(2),1);
assert.equal(ico.readUInt16LE(4),4,'Windows ICO must contain 16/32/48/256 px variants');
const manifest=JSON.parse(read('manifest.webmanifest').toString('utf8'));
assert.deepEqual(manifest.icons.map(x=>x.sizes),['192x192','384x384','512x512']);
for(const entry of manifest.icons){
 assert.equal(entry.type,'image/png');
 assert.equal(entry.purpose,'any','No maskable selection with colored background');
 assert.match(entry.src,/\?v=0-1-580$/,'versioned Android resource URLs prevent stale icons');
}
const html=read('index.html').toString('utf8');
assert(!html.includes('msapplication-TileColor'),'Windows tile must not force old blue square background');
for(const size of [16,32,120,152,167,180]){
 assert(html.includes('domacnost-plus-icon-'+size+'.png?v=0-1-580'),'versioned HTML icon missing: '+size);
}
assert(html.includes('favicon.ico?v=0-1-580'));
assert(html.includes('apple-touch-icon.png?v=0-1-580'));
assert(html.includes('apple-touch-icon-precomposed.png?v=0-1-580'));
const sw=read('sw.js').toString('utf8');
assert(sw.includes('v0-1-580'));
assert(!sw.includes("'./icons/domacnost-plus-maskable-"),'old maskable icons must not enter new offline cache');
for(const size of [16,32,120,152,167,180,192,384,512])assert(sw.includes("'./icons/domacnost-plus-icon-"+size+".png'"));
console.log('PASS PWA icons v580: RGBA transparency, original color/motif, Windows ICO, Android any, iOS apple-touch, SW cache');
