import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),source=await readFile('lib/desktop-sync.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const originalLocal=process.env.BIRKASSA_LOCAL,originalFetch=globalThis.fetch;
const config={url:'https://fixture.invalid',key:'bk_catalog_'+'a'.repeat(64)};
const empty={received:0,updated:0,imported:0,unresolved:0,invalid:0,catalogChanged:0,catalogConflicts:0,supportReceived:0,supportUpdated:0};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function harness({status=200,configured=true,gate=null,pushGate=null,supportGate=null,cacheFails=false,pushError=null,catalogError=null,supportError=null,catalogChanged=0,supportReceived=0}={}){
 const counts={config:0,sql:0,closed:0,fetch:0,push:0,cache:0,catalog:0,support:0},events=[];
 const state={status,configured,pushError,catalogError,supportError},pushEntered=deferred(),supportEntered=deferred();
 const sql={async unsafe(query,params){counts.sql++;
  if(query.startsWith('select key,value from system_settings where key in')){assert.match(params[0],/^desktop_cursor:/);return [];}
  if(query.startsWith('select count(*) n from desktop_order_inbox'))return [{n:0}];
  if(query.startsWith('select id from desktop_order_inbox'))return [];
  if(query.startsWith('insert into system_settings')||query.startsWith('delete from system_settings'))return [];
  throw Error('Unexpected mock SQL: '+query);
 },async end(){counts.closed++;}};
 const mocks={
  'server-only':{},
  'node:fs/promises':{async readFile(file,encoding){counts.config++;assert.ok(String(file).endsWith('desktop-sync.json'));assert.equal(encoding,'utf8');return JSON.stringify(state.configured?config:null);}},
  '@/lib/store-db':{storeDb:()=>sql},
  '@/lib/desktop-bridge':{async pushDesktopChanges(){events.push('publish');counts.push++;pushEntered.resolve();if(pushGate)await pushGate.promise;if(state.pushError)throw state.pushError;}},
  '@/lib/desktop-media':{async cacheProductMedia(){counts.cache++;if(cacheFails)throw Error('Fixture cache offline');return {cached:0,failed:0,total:0};}},
  '@/lib/desktop-order-import':{remoteOrderSchema:require('zod').z.object({}),desktopOrderInvalidMessage:'Invalid fixture order',desktopImportError:()=>'',importDesktopOrder:()=>assert.fail('Empty feed must not import'),mergeRemoteDesktopOrder:()=>assert.fail('Empty feed must not merge')},
  '@/lib/desktop-web-catalog':{async syncDesktopWebCatalog(){events.push('catalog');counts.catalog++;if(state.catalogError)throw state.catalogError;return {changed:catalogChanged,conflicts:0};}},
  '@/lib/desktop-web-support':{async syncDesktopWebSupport(){events.push('support');counts.support++;supportEntered.resolve();if(supportGate)await supportGate.promise;if(state.supportError)throw state.supportError;return {received:supportReceived,updated:0};}},
 };
 const mod={exports:{}};
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),mod,mod.exports);
 globalThis.fetch=async(url,options)=>{events.push('orders');counts.fetch++;assert.equal(url,config.url+'/api/desktop-feed');assert.equal(options.headers.Authorization,'Bearer '+config.key);assert.equal(options.headers['X-Restamarket-Delivery'],'1');assert.equal(options.redirect,'error');if(gate)await gate.promise;return state.status===200?Response.json({rows:[],next:null}):new Response('',{status:state.status});};
 return {syncOrders:mod.exports.syncOrders,counts,state,events,pushEntered,supportEntered};
}
try{
 process.env.BIRKASSA_LOCAL='1';
 {
  const gate=deferred(),h=harness({status:500,gate});const one=h.syncOrders(),two=h.syncOrders();assert.equal(one,two);gate.resolve();await assert.rejects(one,/Mağaza ilə əlaqə qurulmadı/);
  for(const channel of ['push','catalog','support'])assert.equal(h.counts[channel],1);assert.equal(h.counts.closed,1);
  h.state.status=200;assert.deepEqual(await h.syncOrders(),empty);assert.equal(h.counts.push,2);
 }
 {
  const pushGate=deferred(),h=harness({pushGate}),one=h.syncOrders();await h.pushEntered.promise;assert.equal(h.syncOrders(),one);assert.equal(h.counts.fetch,1);pushGate.resolve();assert.deepEqual(await one,empty);
  assert.deepEqual(h.events,['catalog','orders','publish','support'],'Inbound conflict detection precedes publication');
 }
 {
  const supportGate=deferred(),h=harness({supportGate}),one=h.syncOrders();await h.supportEntered.promise;assert.equal(h.syncOrders(),one);supportGate.resolve();await one;
 }
 for(const status of [409,401]){const h=harness({status});await assert.rejects(h.syncOrders(),error=>status===409?error.deliveryUpgrade===true:/Bağlantı açarı/.test(error.message));assert.equal(h.counts.push,1);assert.equal(h.counts.support,1);}
 {const h=harness({cacheFails:true});assert.deepEqual(await h.syncOrders(),empty);assert.equal(h.counts.cache,1);}
 {const h=harness({configured:false});assert.deepEqual(await h.syncOrders(),empty);assert.equal(h.counts.fetch,0);assert.equal(h.counts.sql,0);}
 {
  const h=harness({pushError:Error('Fixture publication unavailable')}),reply=await h.syncOrders();assert.match(reply.publicationError,/Fixture publication unavailable/);assert.equal(reply.received,0);assert.equal(h.counts.support,1);
 }
 for(const [channel,options]of [['catalog',{catalogError:Error('Fixture catalog offline')}],['support',{supportError:Error('Fixture support offline')}]] ){
  const h=harness(options),reply=await h.syncOrders();assert.ok(reply[channel+'Error']);assert.equal(h.counts.fetch,1);assert.equal(h.counts.push,1);
 }
 {const h=harness({status:500,supportReceived:2}),reply=await h.syncOrders();assert.equal(reply.supportReceived,2);assert.ok(reply.orderError);}
 console.log('PASS: actual scheduler keeps order/catalog/publication/support independent, detects inbound edits before publishing, shares one in-flight operation and preserves partial notifications. Mock SQL/files/network only.');
}finally{globalThis.fetch=originalFetch;if(originalLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=originalLocal;}
