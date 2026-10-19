#!/usr/bin/env node
// Reproducible alpha-only PWA asset conversion from the preserved v0.1_579 logo.
// Node built-ins only; run "node tools/generate-pwa-icons.mjs" locally if needed.
// Source: icons/source/domacnost-plus-original-512.png (intentionally unchanged).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SOURCE = resolve(ROOT, 'icons/source/domacnost-plus-original-512.png');
const FALLBACK = resolve(ROOT, 'icons/domacnost-plus-icon-512.png');
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const TABLE = Array.from({length:256}, (_,i) => {
  let value=i;
  for(let j=0;j<8;j++)value = value&1 ? (0xedb88320 ^ (value>>>1)) : value>>>1;
  return value>>>0;
});
function crc32(buf) {
  let result=0xffffffff;
  for(const byte of buf)result=TABLE[(result^byte)&255]^(result>>>8);
  return (result^0xffffffff)>>>0;
}
function chunk(name,data) {
  const type=Buffer.from(name,'ascii');
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const c=Buffer.alloc(4);c.writeUInt32BE(crc32(Buffer.concat([type,data])));
  return Buffer.concat([len,type,data,c]);
}
export function decodePng(bytes) {
  if(!bytes.subarray(0,8).equals(PNG_SIGNATURE))throw Error('Not PNG');
  let width=0,height=0,depth=0,type=0,off=8,plte=null,trns=null;
  const compressed=[];
  while(off<bytes.length){
    const size=bytes.readUInt32BE(off),name=bytes.toString('ascii',off+4,off+8);
    const data=bytes.subarray(off+8,off+8+size);off+=12+size;
    if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];type=data[9];}
    if(name==='PLTE')plte=data;
    if(name==='tRNS')trns=data;
    if(name==='IDAT')compressed.push(data);
    if(name==='IEND')break;
  }
  if(depth!==8 || ![2,3,6].includes(type))throw Error('Expected 8-bit RGB/RGBA/indexed PNG, got '+type+'/'+depth);
  const channels=type===6?4:type===2?3:1;
  const stride=width*channels;
  const raw=inflateSync(Buffer.concat(compressed)),pixels=Buffer.alloc(width*height*4);
  let previous=Buffer.alloc(stride),pos=0;
  for(let y=0;y<height;y++) {
    const mode=raw[pos++],row=Buffer.alloc(stride);
    for(let i=0;i<stride;i++) {
      const x=raw[pos++],left=i>=channels?row[i-channels]:0,up=previous[i],ul=i>=channels?previous[i-channels]:0;
      let p=0;
      if(mode===1)p=left;
      else if(mode===2)p=up;
      else if(mode===3)p=(left+up)>>1;
      else if(mode===4) {
        const a=left+up-ul,da=Math.abs(a-left),db=Math.abs(a-up),dc=Math.abs(a-ul);
        p=da<=db&&da<=dc?left:db<=dc?up:ul;
      } else if(mode!==0)throw Error('Unsupported PNG filter '+mode);
      row[i]=(x+p)&255;
    }
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4,q=x*channels;
      if(type===3) {
        const n=row[q]; pixels[i]=plte?.[n*3]||0;pixels[i+1]=plte?.[n*3+1]||0;pixels[i+2]=plte?.[n*3+2]||0;
        pixels[i+3]=trns?.[n]??255;
      }else{
        pixels[i]=row[q];pixels[i+1]=row[q+1];pixels[i+2]=row[q+2];pixels[i+3]=type===6?row[q+3]:255;
      }
    }
    previous=row;
  }
  return {width,height,pixels};
}
export function encodePng(width,height,pixels) {
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const rows=Buffer.alloc(height*(1+width*4));
  for(let y=0;y<height;y++){
    const i=y*(1+width*4);rows[i]=0;
    pixels.copy(rows,i+1,y*width*4,(y+1)*width*4);
  }
  return Buffer.concat([PNG_SIGNATURE,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
const pick=(img,x,y)=>Array.from(img.pixels.subarray((y*img.width+x)*4,(y*img.width+x)*4+3));
export function isolateLogo(img){
  if(img.width!==512||img.height!==512)throw Error('Original source logo must be 512px');
  // Base-card fill & original 3 geometric fills are sampled from the original
  // drawing, not redrawn. The bounding box prevents the blue outer tile from
  // contributing any pixels. The pale door is left as a transparent cutout.
  const bg=pick(img,130,270);
  const fills=[pick(img,200,290),pick(img,253,190),pick(img,355,150)];
  const out=Buffer.alloc(img.width*img.height*4);
  let minX=512,minY=512,maxX=0,maxY=0,visible=0;
  for(let y=108;y<418;y++)for(let x=137;x<428;x++){
    const i=(y*512+x)*4,px=[img.pixels[i],img.pixels[i+1],img.pixels[i+2]];
    let best=null;
    for(const rgb of fills){
      let dp=0,den=0;
      for(let k=0;k<3;k++){dp+=(bg[k]-px[k])*(bg[k]-rgb[k]);den+=(bg[k]-rgb[k])**2;}
      const a=Math.max(0,Math.min(1,den>0?dp/den:0));
      const err=Math.sqrt(rgb.reduce((sum,col,k)=>sum+(px[k]-(col*a+bg[k]*(1-a)))**2,0));
      if(a>0.065&&err<23&&(!best||err<best.err)){best={a,err,rgb};}
    }
    if(!best)continue;
    const opacity=Math.min(img.pixels[i+3],Math.round(best.a*255));
    if(opacity<10)continue;
    for(let k=0;k<3;k++)out[i+k]=best.rgb[k];
    out[i+3]=opacity;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);visible++;
  }
  if(visible<10000||maxX-minX<200||maxY-minY<200)throw Error('Unexpected logo cutout: '+visible+' px '+[minX,minY,maxX,maxY]);
  return {width:512,height:512,pixels:out,box:{minX,minY,maxX,maxY},samples:{bg,fills,visible}};
}
export function resizeLogo(logo,size){
  const {minX,minY,maxX,maxY}=logo.box;
  const shapeW=maxX-minX+1,shapeH=maxY-minY+1;
  const scale=(size*0.86)/Math.max(shapeW,shapeH);
  const targetW=shapeW*scale,targetH=shapeH*scale,originX=(size-targetW)/2,originY=(size-targetH)/2;
  const rgba=Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const sx=minX+(x+0.5-originX)/scale-0.5;
    const sy=minY+(y+0.5-originY)/scale-0.5;
    const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
    let aa=0,r=0,g=0,b=0;
    for(let j=0;j<2;j++)for(let k=0;k<2;k++){
      const px=x0+k,py=y0+j;if(px<0||py<0||px>=512||py>=512)continue;
      const w=(k?fx:1-fx)*(j?fy:1-fy),i=(py*512+px)*4,a=logo.pixels[i+3]/255;
      aa+=w*a;r+=w*a*logo.pixels[i];g+=w*a*logo.pixels[i+1];b+=w*a*logo.pixels[i+2];
    }
    const i=(y*size+x)*4;
    if(aa>0) {rgba[i]=Math.round(r/aa);rgba[i+1]=Math.round(g/aa);rgba[i+2]=Math.round(b/aa);rgba[i+3]=Math.round(aa*255);}
  }
  return encodePng(size,size,rgba);
}
function makeIco(entries){
  let offset=6+16*entries.length;const header=Buffer.alloc(offset);
  header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(entries.length,4);
  const segments=[];
  entries.forEach(([size,data],i)=>{
    const p=6+i*16;header[p]=size===256?0:size;header[p+1]=size===256?0:size;
    header[p+2]=0;header[p+3]=0;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);
    header.writeUInt32LE(data.length,p+8);header.writeUInt32LE(offset,p+12);
    offset+=data.length;segments.push(data);
  });
  return Buffer.concat([header,...segments]);
}
export function buildIcons(original){
  const logo=isolateLogo(decodePng(original));
  const sizes=[16,32,48,64,120,152,167,180,192,256,384,512];
  const pngs=new Map(sizes.map(size=>[size,resizeLogo(logo,size)]));
  const result=new Map();
  for(const size of [16,32,120,152,167,180,192,384,512])
    result.set('icons/domacnost-plus-icon-'+size+'.png',pngs.get(size));
  result.set('icons/apple-touch-icon.png',pngs.get(180));
  result.set('icons/apple-touch-icon-precomposed.png',pngs.get(180));
  // Keep deprecated URLs harmless: they must NOT appear as purpose=maskable
  // in the manifest, and even direct requests now return the alpha logo.
  result.set('icons/domacnost-plus-maskable-192.png',pngs.get(192));
  result.set('icons/domacnost-plus-maskable-512.png',pngs.get(512));
  result.set('icons/favicon.ico',makeIco([16,32,48,256].map(size=>[size,pngs.get(size)])));
  return {result,logo};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=readFileSync(existsSync(SOURCE)?SOURCE:FALLBACK);
  const {result,logo}=buildIcons(source);
  for(const [path,bytes] of result)writeFileSync(resolve(ROOT,path),bytes);
  console.log('PASS: generated transparent icons '+result.size+' from preserved original; pixels='+logo.samples.visible);
}
