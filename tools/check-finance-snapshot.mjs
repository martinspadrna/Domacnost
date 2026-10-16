#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const finance=readFileSync(join(root,'finance.js'),'utf8');
const app=readFileSync(join(root,'app.js'),'utf8');
const part=(src,a,b)=>{
  const i=src.indexOf(a), j=src.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'Missing code section: '+a);
  return src.slice(i,j);
};
const state={financeTemplates:[],financeLoans:[],financeCloud:{},cloud:{provider:'supabase',householdId:'h1',userId:'u1'}};
const norm=x=>String(x??'').trim();
const num=x=>Number(x||0);
const defaults=[{id:'builtin',name:'Výchozí',title:'Výchozí',type:'expense',system:true}];
let seq=0;
const makeModel=new Function('normalizeText','uid','currentHouseholdId','currentProfileId','decimalValue','financeCategoryLabel','normalizeKey','DEFAULT_FINANCE_TEMPLATES','getState',
  part(finance,'    function normalizeFinanceTemplate(template = {}) {','    function financeTemplateAccountFallback(')+
  '\nreturn {normalizeFinanceTemplates,normalizeFinanceTemplate,normalizeFinanceLoans,normalizeFinanceLoan,mergeFinanceTemplates,mergeFinanceLoans,getFinanceLoans,financeTemplateDefinitions,financeTemplateById};');
const model=makeModel(norm,()=> 'id-'+(++seq),()=> 'h1',()=> 'p1',num,()=> 'Kategorie',x=>norm(x).toLowerCase(),defaults,()=>state);
const loan={id:'l1',name:'Úvěr',currentBalance:50000,monthlyPayment:2500,remainingMonths:24,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
const tomb={...loan,currentBalance:0,monthlyPayment:0,principal:0,deleted:true,updatedAt:'2026-10-16T10:00:00Z'};
assert.equal(model.normalizeFinanceLoans([tomb])[0].deleted,true);
assert.equal(model.mergeFinanceLoans([tomb],[loan])[0].deleted,true);
assert.equal(model.mergeFinanceLoans([tomb],[loan],{preferLocal:true})[0].deleted,true);
state.financeLoans=[loan,tomb];
assert.equal(model.getFinanceLoans().length,0);
assert.equal(state.financeLoans.length,1);
state.financeLoans=[loan];
assert.equal(model.getFinanceLoans().length,1);
assert.equal(model.normalizeFinanceTemplates([{id:'t',name:'Mine',title:'Mine',deleted:true}])[0].deleted,true);

let undo=null,saves=0;
const makeDelete=new Function('getState','window','financeTemplateById','normalizeFinanceTemplates','normalizeFinanceTemplate','getFinanceTemplateEditId','setFinanceTemplateEditId','persistFinanceTemplatesState','showUndoToast','render','getFinanceLoans','normalizeFinanceLoans','normalizeFinanceLoan','persistFinanceLoans','DEFAULT_FINANCE_TEMPLATES','touchState','saveState','showToast',
  'let financeLoanEditId = "";\n'+
  part(finance,'    function deleteFinanceTemplate(id) {','    function setFinanceCopy(id) {')+
  part(finance,'    function deleteFinanceLoan(id) {','    function calculateFinanceRefinance(')+
  '\nreturn {deleteFinanceTemplate,deleteFinanceLoan};');
const del=makeDelete(()=>state,{confirm:()=>true},model.financeTemplateById,model.normalizeFinanceTemplates,model.normalizeFinanceTemplate,()=>'',()=>{},
  async()=>{saves++;},(_,cb)=>{undo=cb;},()=>{},model.getFinanceLoans,model.normalizeFinanceLoans,model.normalizeFinanceLoan,
  async()=>{saves++;},defaults,()=>{},()=>{},()=>{});
state.financeTemplates=[{id:'custom',name:'Moje',title:'Moje',type:'expense'}];
del.deleteFinanceTemplate('custom');
assert.equal(state.financeTemplates.find(x=>x.id==='custom').deleted,true);
assert.equal(model.financeTemplateDefinitions().some(x=>x.id==='custom'),false);
await undo();
assert.equal(state.financeTemplates.find(x=>x.id==='custom').deleted,false);
del.deleteFinanceTemplate('builtin');
assert.equal(state.financeTemplates.find(x=>x.id==='builtin').deleted,true);
await undo();
assert.equal(state.financeTemplates.find(x=>x.id==='builtin').deleted,false);
state.financeLoans=[loan,{...loan,id:'other',deleted:true}];
del.deleteFinanceLoan('l1');
assert.equal(state.financeLoans.find(x=>x.id==='l1').deleted,true);
assert.equal(state.financeLoans.find(x=>x.id==='other').deleted,true);
assert.equal(model.getFinanceLoans().length,0);
await undo();
assert.equal(state.financeLoans.find(x=>x.id==='l1').deleted,false);
assert.equal(state.financeLoans.find(x=>x.id==='other').deleted,true);
assert.equal(saves,6,'each delete and undo queues cloud snapshot');

const lazySource=part(app,'    const normalizeFinanceLoan = (loan = {}) => {','    const mergeByFreshness = ');
const lazy=new Function('normalizeText','decimalValue','uid','runtimeStateRef',lazySource+'\nreturn normalizeFinanceLoans;')(
  norm,num,()=> 'id-'+(++seq),{household:{id:'h1'},activeProfileId:'p1'});
assert.equal(lazy([tomb])[0].deleted,true,'lazy start must retain deletion');
assert.equal(lazy([tomb]).length,1);

const cloudApply=part(app,'    // Cloudový snapshot je autoritativní jen pro sekce','    if (Array.isArray(layout.pools))');
const apply=new Function('state','layout','normalizeFinanceTemplates','normalizeFinanceLoans',cloudApply);
state.financeTemplates=[{id:'local',name:'Lokální',title:'Lokální',type:'expense'}];
state.financeLoans=[loan];
state.financeCloud={templatesPendingAt:'',loansPendingAt:''};
apply(state,{financeTemplates:[],financeLoans:[]},model.normalizeFinanceTemplates,model.normalizeFinanceLoans);
assert.equal(state.financeTemplates.length,0);
assert.equal(state.financeLoans.length,0);
state.financeTemplates=[{id:'pending',name:'Lokální',title:'Lokální',deleted:true}];
state.financeLoans=[tomb];
state.financeCloud={templatesPendingAt:'2026-10-16',loansPendingAt:'2026-10-16'};
apply(state,{financeTemplates:[{id:'pending',name:'Cloud',title:'Cloud'}],financeLoans:[loan]},
  model.normalizeFinanceTemplates,model.normalizeFinanceLoans);
assert.equal(state.financeTemplates[0].deleted,true);
assert.equal(state.financeLoans[0].deleted,true);
assert(state.financeCloud.templatesLoadedAt&&state.financeCloud.loansLoadedAt);
const marker=part(app,'  function markRestoredCollectionsPending(collections) {','  function restoreTrashEntry(');
const mark=new Function('state',marker+'\nreturn markRestoredCollectionsPending;')(state);
state.financeCloud={templatesPendingAt:'',loansPendingAt:''};
mark(['financeLoans']);
assert(state.financeCloud.loansPendingAt);
assert.equal(state.financeCloud.templatesPendingAt,'');
state.financeCloud={templatesPendingAt:'',loansPendingAt:''};
mark(['financeTemplates']);
assert(state.financeCloud.templatesPendingAt);
assert.equal(state.financeCloud.loansPendingAt,'');
console.log('PASS Finance tombstones, undo, lazy startup, cloud authority and pending markers');
