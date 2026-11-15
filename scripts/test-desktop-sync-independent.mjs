import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Execute the real scheduler and internal pullOrders/fetchOrderPage against
// fake filesystem/config, SQL and fetch. No real file, DB or network mutation.
const require=createRequire(import.meta.url),source=await readFile('lib/desktop-sync.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const originalLocal=process.env.BIRKASSA_LOCAL,originalFetch=globalThis.fetch;
const config={url:'https://fixture.invalid',key:'bk_catalog_'+'a'.repeat(64)};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function harness({status=200,configured=true,gate=null,pushGate=null,cacheFails=false,pushError=null}={}){
 const counts={config:0,sql:0,closed:0,fetch:0,push:0,cache:0};
 const state={status,configured,pushError},pushEntered=deferred();
 const sql={async unsafe(query,params){counts.sql++;assert.equal(query,'select value from system_settings where key=$1');assert.match(params[0],/^desktop_cursor:[a-f0-9]{64}$/);return [];},async end(){counts.closed++;}};
 const mocks={
  'server-only':{},
  'node:fs/promises':{async readFile(file,encoding){counts.config++;assert.ok(String(file).endsWith('desktop-sync.json'));assert.equal(encoding,'utf8');return JSON.stringify(state.configured?config:null);}},
  '@/lib/store-db':{storeDb:()=>sql},
  '@/lib/desktop-bridge':{async pushDesktopChanges(){counts.push++;pushEntered.resolve();if(pushGate)await pushGate.promise;if(state.pushError)throw state.pushError;}},
  '@/lib/desktop-media':{async cacheProductMedia(){counts.cache++;if(cacheFails)throw Error('Fixture cache is offline');return {cached:0,failed:0,total:0};}},
 };
 const mod={exports:{}};
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),mod,mod.exports);
 globalThis.fetch=async(url,options)=>{
  counts.fetch++;assert.equal(url,config.url+'/api/desktop-feed');assert.equal(options.headers.Authorization,'Bearer '+config.key);assert.equal(options.headers['X-Restamarket-Delivery'],'1');assert.equal(options.redirect,'error');
  if(gate)await gate.promise;
  return state.status===200?Response.json({rows:[],next:null}):new Response('',{status:state.status});
 };
 return {syncOrders:mod.exports.syncOrders,counts,state,pushEntered};
}
try{
 process.env.BIRKASSA_LOCAL='1';
 {
  const gate=deferred(),h=harness({status:500,gate});
  const one=h.syncOrders(),two=h.syncOrders();assert.equal(one,two,'Concurrent callers share the same whole pull+push attempt');
  gate.resolve();await assert.rejects(one,/Mağaza ilə əlaqə qurulmadı/);
  assert.deepEqual(h.counts,{config:1,sql:1,closed:1,fetch:1,push:1,cache:1},'Feed failure still closes SQL and attempts publication exactly once');
  h.state.status=200;
  assert.deepEqual(await h.syncOrders(),{received:0},'The in-flight guard resets after failure');
  assert.equal(h.counts.push,2);assert.equal(h.counts.fetch,2);assert.equal(h.counts.closed,2);
 }
 {
  const pushGate=deferred(),h=harness({pushGate});
  const one=h.syncOrders();await h.pushEntered.promise;
  assert.equal(h.syncOrders(),one,'Single-flight stays active after pulling is done while publication is still running');
  assert.equal(h.counts.fetch,1);assert.equal(h.counts.push,1);pushGate.resolve();assert.deepEqual(await one,{received:0});
 }
 {
  const h=harness({status:409});
  await assert.rejects(h.syncOrders(),error=>error.deliveryUpgrade===true&&/Masaüstü tətbiqi yeniləyin/.test(error.message));
  assert.equal(h.counts.push,1,'An independent order compatibility error cannot suppress product publication');assert.equal(h.counts.closed,1);
 }
 {
  const h=harness({status:401});await assert.rejects(h.syncOrders(),/Bağlantı açarı etibarsızdır/);assert.equal(h.counts.push,1,'Original feed authentication error remains observable after successful push');
 }
 {
  const h=harness({cacheFails:true});assert.deepEqual(await h.syncOrders(),{received:0});assert.equal(h.counts.push,1);assert.equal(h.counts.cache,1,'Optional media caching failure never blocks independent feed/publication');
 }
 {
  const h=harness({configured:false});assert.deepEqual(await h.syncOrders(),{received:0});assert.equal(h.counts.fetch,0);assert.equal(h.counts.sql,0);assert.equal(h.counts.push,1);
 }
 {
  const error=Error('Fixture publication unavailable'),h=harness({pushError:error});await assert.rejects(h.syncOrders(),caught=>caught===error);assert.equal(h.counts.fetch,1);assert.equal(h.counts.push,1);assert.equal(h.counts.closed,1);
 }
 console.log('PASS: real syncOrders independent publication after feed outage/401/upgrade failure, original pull errors, single in-flight pull+push, retry reset, normal/no-config results, nonblocking media cache and observable publication failure. Mock filesystem/SQL/network only.');
}finally{
 globalThis.fetch=originalFetch;
 if(originalLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=originalLocal;
}
