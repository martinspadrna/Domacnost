#!/usr/bin/env node
// PWA v581: verify exact RGBA PNG pixels, native Windows ICO, browser references and
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
 'icons/domacnost-plus-icon-48.png','icons/domacnost-plus-icon-64.png',
 'icons/domacnost-plus-icon-120.png','icons/domacnost-plus-icon-128.png','icons/domacnost-plus-icon-152.png',
 'icons/domacnost-plus-icon-167.png','icons/domacnost-plus-icon-180.png',
 'icons/domacnost-plus-icon-192.png','icons/domacnost-plus-icon-256.png','icons/domacnost-plus-icon-384.png',
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
assert.equal(ico.readUInt16LE(4),5,'Windows ICO must contain 16/32/48/64/256 px variants');
assert(ico.equals(read('icons/domacnost-plus-windows.ico')),'Windows desktop .ico and favicon must use identical alpha artwork');
for(let i=0;i<5;i++){
 const p=6+i*16,size=ico[p]||256,offset=ico.readUInt32LE(p+12),length=ico.readUInt32LE(p+8);
 assert.equal(ico[p+1]||256,size,'Square Windows ICO layer required');
 if(size<256){
  assert.equal(ico.readUInt32LE(offset),40,'Small Windows ICO must be native BMP/DIB, not PNG: '+size);
  assert.equal(ico.readInt32LE(offset+4),size,'BMP width must match '+size);
  assert.equal(ico.readInt32LE(offset+8),size*2,'BMP height must include transparent AND mask');
  assert.equal(ico.readUInt16LE(offset+14),32,'Windows ICO should have BGRA32 pixels');
  const xorStart=offset+40, alphaAtTopLeft=xorStart+((size-1)*size)*4+3;
  assert.equal(ico[alphaAtTopLeft],0,'Windows ICO corner must carry alpha');
  const andStride=Math.ceil(size/32)*4;
  const maskStart=xorStart+size*size*4;
  assert.equal(ico[maskStart+(size-1)*andStride]&0x80,0x80,'AND mask must mark corner transparent');
  assert.equal(length,40+size*size*4+andStride*size,'Windows DIB frame length mismatch');
 }else{
  assert(ico.subarray(offset,offset+8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'256px ICO uses PNG alpha');
 }
}
const manifest=JSON.parse(read('manifest.webmanifest').toString('utf8'));
assert.deepEqual(manifest.icons.map(x=>x.sizes),['48x48','64x64','128x128','192x192','256x256','384x384','512x512']);
for(const entry of manifest.icons){
 assert.equal(entry.type,'image/png');
 assert.equal(entry.purpose,'any','No maskable selection with colored background');
 assert.match(entry.src,/\?v=0-1-581$/,'versioned Android resource URLs prevent stale icons');
}
const html=read('index.html').toString('utf8');
assert(!html.includes('msapplication-TileColor'),'Windows tile must not force old blue square background');
for(const size of [16,32,120,152,167,180]){
 assert(html.includes('domacnost-plus-icon-'+size+'.png?v=0-1-581'),'versioned HTML icon missing: '+size);
}
assert(html.includes('favicon.ico?v=0-1-581'));
assert(html.includes('domacnost-plus-windows.ico?v=0-1-581'),'Windows shortcut icon must be explicitly linked');
assert(html.includes('apple-touch-icon.png?v=0-1-581'));
assert(html.includes('apple-touch-icon-precomposed.png?v=0-1-581'));
const sw=read('sw.js').toString('utf8');
assert(sw.includes('v0-1-581'));
assert(sw.includes("'./icons/domacnost-plus-windows.ico'"));
assert(!sw.includes("'./icons/domacnost-plus-maskable-"),'old maskable icons must not enter new offline cache');
for(const size of [16,32,48,64,120,128,152,167,180,192,256,384,512])assert(sw.includes("'./icons/domacnost-plus-icon-"+size+".png'"));
console.log('PASS PWA icons v581: RGBA transparency, Windows native BGRA/AND-mask ICO, Android any, iOS, manifest + SW cache');
