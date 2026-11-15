import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Runs the real publisher and image receiver against in-memory SQL/media/fetch
// fixtures. No merchant data, credentials, databases or network are accessed.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const compiled=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],file);
 const result={exports:{}};
 new Function('require','module','exports',compiled.outputText)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),result,result.exports);
 return result.exports;
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const images=await load('lib/product-option-image.ts');
const delta=await load('lib/desktop-catalog-delta.ts');
const origin='https://catalogue-fixture.test',key='bk_catalog_'+'0'.repeat(64);
const ids={product:'11111111-1111-4111-8111-111111111111',client:'22222222-2222-4222-8222-222222222222',batch:'33333333-3333-4333-8333-333333333333'};
const cache=new Map(['main','gallery','variant'].map(name=>{
 const url='https://res.cloudinary.com/fixture/image/upload/'+name+'.png';
 const bytes=Buffer.from('isolated '+name+' image byte fixture');
 const cacheKey=hash(url),contentHash=hash(bytes);
 assert.notEqual(cacheKey,contentHash,'Legacy cached images must exercise URL-hash versus bytes-hash mismatch');
 return [cacheKey,{body:bytes,type:'image/png',contentHash}];
}));
const urls=[...cache.keys()].map(id=>'/api/desktop-media/'+id);
function product(){return {id:ids.product,sku:'PUBLICATION-FIXTURE',name:'Ölçülü sınaq məhsulu',code:'123456',category:'Sınaq',unit:'ədəd',price:'12.50',discountPrice:null,image:urls[0],images:[urls[1]],options:[{label:'40 · Qırmızı',size:'40',color:'Qırmızı',kind:'',image:urls[2],price:'15.00',position:0,isActive:true,attributes:{Qalınlıq:'2 mm'}}],isActive:true};}
function noPrivateFields(value){
 if(Array.isArray(value)){value.forEach(noPrivateFields);return;}
 if(value&&typeof value==='object')for(const [name,item] of Object.entries(value)){
  assert.ok(!['stock','quantity','warehouse','warehouses','cost','cost_price','min_stock','barcode','password_hash','pin_hash','salary'].includes(name),'Private field crossed catalogue boundary: '+name);
  noPrivateFields(item);
 }
}
async function run({existsStatus=404,uploadStatus=200,mutate=()=>{},missingCache=false,fetchFailure=false,baselineRow}={}){
 const row=product();mutate(row);
 const state={lookups:[],checks:[],uploads:[],batches:[],settings:new Map([[delta.desktopCatalogBaselineKey(origin),JSON.stringify(delta.seedDesktopCatalogBaseline(baselineRow?[baselineRow]:[]))]]),acknowledged:false,outboxCreated:false,ended:false,remote:new Map()};
 const sql={
  async begin(fn){return fn(sql);},
  async end(){state.ended=true;},
  async unsafe(query,params=[]){
   if(query.startsWith('select id,revision,payload from desktop_sync_outbox'))return [];
   if(query.startsWith('set transaction isolation level'))return [];
   if(query.startsWith('select i.remote_id'))return [];
   if(query.startsWith('select value from system_settings'))return query.includes('desktop_sync_client_id')?[{value:ids.client}]:state.settings.has(params[0])?[{value:state.settings.get(params[0])}]:[];
   if(query.startsWith('select pg_advisory_xact_lock'))return [];
   if(query.startsWith("insert into system_settings(key,value) values('desktop_sync_client_id'"))return [];
   if(query.startsWith('insert into desktop_sync_outbox')){state.outboxCreated=true;return [{id:ids.batch,revision:'1'}];}
   if(query.startsWith('update desktop_sync_outbox')){state.acknowledged=true;return [];}
   if(query.startsWith('delete from desktop_sync_outbox'))return [];
   if(query.startsWith("insert into system_settings(key,value) values('desktop_sync_last_error'")){state.settings.set('desktop_sync_last_error',params[0]);return [];}
   if(query.startsWith('insert into system_settings(key,value) values($1,$2)')){state.settings.set(params[0],params[1]);return [];}
   throw new Error('Unexpected fixture query: '+query);
  },
 };
 const publisher=await load('lib/desktop-bridge.ts',{
  '@/lib/desktop-sync':{isDesktop:()=>true,readSyncConfig:async()=>({url:origin,key})},
  '@/lib/desktop-media':{cachedMedia:async id=>{state.lookups.push(id);return missingCache?null:cache.get(id)||null;}},
  '@/lib/store-db':{storeDb:()=>sql},'@/lib/product-option-image':images,
  '@/lib/desktop-catalog-delta':delta,
  '@/lib/desktop-catalog-source':{readDesktopPublicProducts:async()=>[delta.normalizeDesktopPublicProduct(row)]},
  '@/lib/desktop-catalog-apply':{applyPublicProduct:async()=>{throw Error('Sender-only fixture must not apply products');}},
 });
 const receiver=await load('app/api/desktop-image/route.ts',{
  '@/lib/store-db':{storeDb:()=>({end:async()=>{}})},
  '@/lib/desktop-bridge':{desktopAuthorization:async(_sql,supplied,write)=>supplied===key&&write?{userId:'fixture'}:null},
  '@/lib/catalog-media':{saveImage:async bytes=>{const id=hash(bytes);state.remote.set(id,bytes);return {hash:id,url:'/api/catalog-media/'+id};}},
 });
 const previousFetch=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options={})=>{
   assert.equal(new URL(url).origin,origin,'Only the isolated mock origin may be contacted');
   if(fetchFailure)throw new Error('Fixture network unavailable');
   if(options.method==='POST'&&url===origin+'/api/desktop-image'){
    assert.equal(options.headers.Authorization,'Bearer '+key);
    assert.equal(options.headers['X-Image-Hash'],hash(options.body),'Web upload identifier must match the actual image bytes');
    state.uploads.push({id:options.headers['X-Image-Hash'],bytes:Buffer.from(options.body)});
    if(uploadStatus!==200)return new Response(null,{status:uploadStatus});
    return receiver.POST(new Request(url,{method:'POST',headers:options.headers,body:options.body}));
   }
   if(url.startsWith(origin+'/api/catalog-media/')){
    assert.equal(options.method,undefined);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
    assert.equal(options.headers,undefined,'Public image existence check sends no connection credentials');
    state.checks.push(url.slice((origin+'/api/catalog-media/').length));
    return new Response(null,{status:existsStatus});
   }
   if(url===origin+'/api/desktop-bridge'&&options.method==='POST'){
    const batch=JSON.parse(options.body);noPrivateFields(batch);state.batches.push(batch);
    return Response.json({acknowledged:batch.id,stale:false,conflicts:[]});
   }
   throw new Error('Unexpected fixture request');
  };
  try{await publisher.pushDesktopChanges();}catch(error){state.error=error;}
 }finally{globalThis.fetch=previousFetch;}
 assert.equal(state.ended,true,'Local database connection always closes');
 return state;
}

const published=await run();assert.equal(published.error,undefined);assert.equal(published.batches.length,1);assert.equal(published.uploads.length,3);assert.equal(published.remote.size,3,'Real image receiver accepts all three byte-hashed cached images');
const expected=[...cache.values()].map(image=>'/api/catalog-media/'+image.contentHash),catalogue=published.batches[0].catalog[0];
assert.equal(catalogue.image,expected[0]);assert.deepEqual(catalogue.images,[expected[1]]);assert.equal(catalogue.options[0].image,expected[2]);
assert.equal(catalogue.options[0].size,'40');assert.equal(catalogue.options[0].color,'Qırmızı');assert.equal(catalogue.options[0].price,15);assert.deepEqual(catalogue.options[0].attributes,{Qalınlıq:'2 mm'});
assert.deepEqual(new Set(published.lookups),new Set(cache.keys()),'Original URL-derived hash is used only to read the local cache');
assert.deepEqual(new Set(published.checks),new Set([...cache.values()].map(image=>image.contentHash)),'Remote existence checks use content hashes');
assert.equal(published.acknowledged,true);assert.ok(published.settings.get('desktop_sync_last_success'));assert.equal(published.settings.get('desktop_sync_last_error'),'');

const edited=await run({baselineRow:product(),mutate:row=>{row.options[0].price='17.00';}});
assert.equal(edited.error,undefined);assert.equal(edited.batches.length,1);assert.equal(edited.uploads.length,3,'The shared image cache avoids uploading current/baseline photos twice in one publication');
const editedWire=edited.batches[0].catalog[0];assert.deepEqual(editedWire.changedFields,['options']);assert.equal(editedWire.options[0].price,17);assert.equal(editedWire.previous.options[0].price,15);assert.equal(editedWire.previous.image,expected[0]);assert.equal(editedWire.previous.options[0].image,expected[2]);assert.equal(Object.hasOwn(edited.batches[0],'localCatalog'),false,'Raw local baseline bookkeeping never crosses the HTTP boundary');
const acknowledgedBaseline=JSON.parse(edited.settings.get(delta.desktopCatalogBaselineKey(origin))).products[ids.product];assert.equal(acknowledgedBaseline.options[0].price,17);assert.equal(acknowledgedBaseline.options[0].image,urls[2],'Acknowledgement stores raw local image URLs rather than web-transformed paths');

const existing=await run({existsStatus:200});assert.equal(existing.error,undefined);assert.equal(existing.uploads.length,0);assert.equal(existing.batches.length,1);assert.equal(existing.batches[0].catalog[0].image,expected[0]);
for(const status of [401,403,429,500,503]){
 const failed=await run({existsStatus:status});assert.match(failed.error?.message||'',new RegExp(String(status)));assert.equal(failed.uploads.length,0,'Only 404 triggers an upload');assert.equal(failed.batches.length,0);assert.equal(failed.acknowledged,false);assert.equal(failed.settings.has('desktop_sync_last_success'),false);assert.ok(failed.settings.get('desktop_sync_last_error'));
}
for(const status of [400,401,413,500]){
 const failed=await run({uploadStatus:status});assert.match(failed.error?.message||'',new RegExp(String(status)));assert.equal(failed.batches.length,0);assert.equal(failed.acknowledged,false);assert.equal(failed.settings.has('desktop_sync_last_success'),false);
}
for(const config of [{missingCache:true},{fetchFailure:true}]){
 const failed=await run(config);assert.ok(failed.error);assert.equal(failed.batches.length,0);assert.equal(failed.acknowledged,false);assert.equal(failed.settings.has('desktop_sync_last_success'),false);
}
const invalid=await run({mutate:row=>{row.options[0].price=-123456.78;}});
assert.match(invalid.error?.message||'',/Ölçülü sınaq məhsulu/);assert.match(invalid.error.message,/PUBLICATION-FIXTURE/);assert.match(invalid.error.message,/ölçü, rəng və digər seçimlər/);assert.doesNotMatch(invalid.error.message,/-123456\.78|"options"|attributes|bk_catalog_|image byte fixture/,'Actionable error names the product/field but never serializes the row or connection key');assert.equal(invalid.outboxCreated,false);assert.equal(invalid.batches.length,0);assert.equal(invalid.settings.get('desktop_sync_last_error'),invalid.error.message);
console.log('PASS: cached URL-hash main/gallery/variant photos are published by byte hash and accepted by the real receiver; existing files, 404-only upload, HTTP/network/cache failures, no false acknowledgements, actionable product errors and public-only payload. No real SQL, media, credentials or network used.');
