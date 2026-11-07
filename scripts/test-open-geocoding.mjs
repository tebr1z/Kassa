import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Pure fixtures only: no real database, coordinates belonging to customers,
// provider requests, credentials, keys, billing, browser or listening server.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const source=await readFile(path,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);
 return loaded.exports;
}
const country=await load('lib/azerbaijan-location.ts');
const security=await load('lib/admin-security.ts');
const roles=await load('lib/staff-access.ts');
let state,connectionId=0;
const normalBody=()=>[{display_name:'Bakı, Azərbaycan',lat:'40.4093',lon:'49.8671',address:{country_code:'az'}}];
function reset(changes={}){
 state={now:10_000,next:0,owner:null,cache:new Map(),calls:[],events:[],fetches:[],reserves:0,releases:0,ends:0,customer:{id:'fixture-customer'},session:{id:'fixture-admin',role:'admin'},sessionMethod:'password',sessionIdle:0,sessionExpired:false,sessionActive:true,sessionPassword:true,body:normalBody(),status:200,activeFetches:0,maxFetches:0,...changes};
 return state;
}
function database(){
 const id=++connectionId;
 let snapshot;
 const unsafe=async(query,params=[])=>{
  state.calls.push({query,params,id});
  if(state.databaseError)throw Error('Fixture database failure with private diagnostics');
  if(query.includes('from auth_sessions')){
   assert.match(query,/s\.authentication_method='password'/);
   assert.match(query,/s\.last_seen_at>now\(\)-interval '10 minutes'/);
   assert.match(query,/s\.expires_at>now\(\)/);
   assert.match(query,/u\.is_active=true/);
   assert.match(query,/u\.password_hash is not null/);
   const token=createHash('sha256').update('fixture-staff-token').digest('hex');
   return state.session&&params[0]===token&&state.sessionMethod==='password'&&state.sessionIdle<10&&!state.sessionExpired&&state.sessionActive&&state.sessionPassword?[state.session]:[];
  }
  if(query.startsWith('select response from open_geocoding_cache')){
   state.reads=(state.reads||0)+1;
   if(state.cacheOnSecondRead&&state.reads===2)state.cache.set(params[0],{response:state.cacheOnSecondRead,expires:state.now+10000,created:state.now});
   const saved=state.cache.get(params[0]);return saved&&saved.expires>state.now?[{response:saved.response}]:[];
  }
  if(query.startsWith('select pg_try_advisory_lock')){
   assert.match(query,/672033/);if(state.owner!==null&&state.owner!==id)return [{locked:false}];state.owner=id;return [{locked:true}];
  }
  if(query.startsWith('select pg_advisory_unlock')){assert.equal(state.owner,id);state.owner=null;return [{pg_advisory_unlock:true}];}
  if(query.startsWith('insert into open_geocoding_rate'))return [];
  if(query.startsWith('update open_geocoding_rate set next_request_at=clock_timestamp()')){
   assert.equal(snapshot,undefined,'Rate reservation is not part of a later rollback-able cache transaction');
   if(state.next>state.now)return [];state.next=state.now+1100;state.events.push('rate-committed');return [{id:1}];
  }
  if(query.startsWith('update open_geocoding_rate set next_request_at=greatest')){state.next=Math.max(state.next,state.now+1100);return [];}
  if(query==='begin'){assert.equal(snapshot,undefined);snapshot=new Map(state.cache);return [];}
  if(query.startsWith('set local statement_timeout')){assert.ok(snapshot);return [];}
  if(query==='commit'){assert.ok(snapshot);snapshot=undefined;return [];}
  if(query==='rollback'){assert.ok(snapshot);state.cache=snapshot;snapshot=undefined;state.events.push('cache-rollback');return [];}
  if(query==='delete from open_geocoding_cache where expires_at<=now()'){
   for(const [key,row]of state.cache)if(row.expires<=state.now)state.cache.delete(key);return [];
  }
  if(query.startsWith('insert into open_geocoding_cache')){
   if(state.cacheError)throw Error('Fixture cache failure');
   assert.match(params[0],/^[0-9a-f]{64}$/);assert.equal(params[0].includes('Bakı'),false);
   assert.equal(params[2],JSON.parse(params[1]).length?86400:300);
   state.cache.set(params[0],{response:JSON.parse(params[1]),expires:state.now+params[2]*1000,created:state.now});return [];
  }
  if(query.startsWith('delete from open_geocoding_cache where cache_key in')){
   assert.match(query,/offset 1000/);
   const keys=[...state.cache].sort((a,b)=>b[1].created-a[1].created||b[0].localeCompare(a[0]));for(const [key]of keys.slice(1000))state.cache.delete(key);return [];
  }
  throw Error('Unexpected fixture SQL: '+query);
 };
 return {
  unsafe,
  // Match postgres 3.4.7's runtime reserved client: it has no .begin() method,
  // even though its TypeScript declaration currently claims otherwise.
  async reserve(){state.reserves++;return {unsafe,release(){state.releases++;}};},
  async end(){state.ends++;if(state.owner===id)state.owner=null;},
 };
}
const db={storeDb:database};
const geocoder=await load('lib/open-geocoding.ts',{'@/lib/store-db':db,'@/lib/azerbaijan-location':country});
const guard=await load('lib/require-admin.ts',{'@/lib/store-db':db,'@/lib/admin-security':security,'@/lib/staff-access':roles});
const route=await load('app/api/places/route.ts',{'@/lib/customer-session':{customerAccount:async()=>{if(state.accountError)throw Error('Fixture account DB failure');return state.customer;}},'@/lib/require-admin':guard,'@/lib/open-geocoding':geocoder});
const originalFetch=globalThis.fetch;
const savedEnv=Object.fromEntries(['OPEN_GEOCODING_URL','OPEN_GEOCODING_ENABLED','BIRKASSA_LOCAL'].map(name=>[name,process.env[name]]));
const search=(q='Bakı',language='az')=>geocoder.searchOpenPlaces({query:q,language});
const parse=path=>geocoder.parseOpenPlaceSearch(new URL('https://shop.example/api/places'+path));
const request=(path='?q=Bakı',headers={},protocol='https:')=>new Request(protocol+'//shop.example/api/places'+path,{headers:{host:'shop.example',...headers}});
const post=(body={q:'Bakı',lang:'az'},headers={})=>new Request('https://shop.example/api/places',{method:'POST',headers:{host:'shop.example',origin:'https://shop.example','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const status=async(promise,expected)=>{const response=await promise;assert.equal(response.status,expected);assert.equal(response.headers.get('cache-control'),'private, no-store');return response;};
const rejectsStatus=(promise,expected)=>assert.rejects(promise,error=>error instanceof geocoder.OpenGeocodingError&&error.status===expected);
globalThis.fetch=async(url,options)=>{
 state.fetches.push({url:new URL(url),options});state.events.push('fetch');
 assert.equal(state.events.includes('rate-committed'),true,'The app-wide reservation must commit before external HTTP');
 assert.notEqual(state.owner,null,'A global PG session lock is held across the request');
 assert.ok(state.next>state.now);
 state.activeFetches++;state.maxFetches=Math.max(state.maxFetches,state.activeFetches);
 try{
  if(state.wait)await state.wait;
  if(state.providerError)throw Error('Fixture private provider diagnostics');
  return state.rawResponse?state.rawResponse():Response.json(state.body,{status:state.status});
 }finally{state.activeFetches--;}
};
try{
 delete process.env.OPEN_GEOCODING_URL;delete process.env.OPEN_GEOCODING_ENABLED;delete process.env.BIRKASSA_LOCAL;
 assert.deepEqual(parse('?q=%20Bakı%20%20mərkəz%20&lang=ru'),{query:'Bakı mərkəz',language:'ru'});
 assert.deepEqual(parse('?q=Bakı'),{query:'Bakı',language:'az'});
 for(const path of ['', '?q=', '?q=ab', '?q='+('a'.repeat(121)), '?q=Bakı&q=Naxçıvan','?q=Bakı%0Aşəhər','?lat=40&lng=49','?lat=&lng=','?lng=49','?q=Bakı&lat=40']){
  assert.throws(()=>parse(path),error=>error.status===400,path);
 }
 for(const path of ['?q=Bakı&lang=de','?q=Bakı&lang=az&lang=ru'])assert.throws(()=>parse(path),error=>error.status===400);
 for(const lang of ['az','ru','en','tr','zh'])assert.equal(parse('?q=Bakı&lang='+lang).language,lang);
 assert.equal(country.isAzerbaijanCoordinate(39.2,45.4),true,'Nakhchivan is not accidentally excluded');

 reset();assert.deepEqual(await search(),[{label:'Bakı, Azərbaycan',lat:40.4093,lng:49.8671}]);
 assert.equal(state.fetches.length,1);assert.equal(state.releases,1);assert.equal(state.owner,null);
 const first=state.fetches[0];assert.equal(first.url.origin,'https://nominatim.openstreetmap.org');assert.equal(first.url.pathname,'/search');
 for(const [key,value]of Object.entries({countrycodes:'az',addressdetails:'1',limit:'5',format:'jsonv2',q:'Bakı'}))assert.equal(first.url.searchParams.get(key),value);
 assert.match(first.url.searchParams.get('accept-language'),/^az/);assert.match(first.options.headers['User-Agent'],/RestaMarket.+https:\/\/restamarket\.az/);
 assert.equal(first.options.cache,'no-store');assert.equal(first.options.redirect,'error');assert.ok(first.options.signal instanceof AbortSignal);
 assert.deepEqual(await search('baki'.replace('i','ı')),await search(),'Case-normalized repeated query uses persistent cache');assert.equal(state.fetches.length,1);
 await rejectsStatus(search('Naxçıvan'),429);assert.equal(state.fetches.length,1,'Cooldown prevents an uncached request from another connection');
 state.now+=1100;await search('Naxçıvan');assert.equal(state.fetches.length,2);
 state.now+=1100;await search('Bakı','en');assert.equal(state.fetches.length,3,'Language is part of cache identity');

 reset({body:[...normalBody(),{display_name:'Naxçıvan, Azərbaycan',lat:'39.2',lon:'45.4',address:{country_code:'AZ'}},{display_name:'Foreign location inside broad rectangle',lat:'40',lon:'45',address:{country_code:'am'}},{display_name:'Missing country',lat:'40',lon:'49'},{display_name:'Missing latitude',lon:'49',address:{country_code:'az'}}]});
 assert.deepEqual((await search()).map(row=>row.label),['Bakı, Azərbaycan','Naxçıvan, Azərbaycan']);
 reset({body:[{display_name:'Invalid point',lat:'',lon:'49',address:{country_code:'az'}},{display_name:'Invalid point',lat:null,lon:'49',address:{country_code:'az'}},{display_name:'Invalid point',lat:'40abc',lon:'49',address:{country_code:'az'}},{display_name:'Outside bounds',lat:'10',lon:'20',address:{country_code:'az'}}]});
 assert.deepEqual(await search(),[]);assert.deepEqual(await search(),[]);assert.equal(state.fetches.length,1,'Empty search is cached too');
 state.now+=300001;await search();assert.equal(state.fetches.length,2,'Negative entries expire in five minutes');

 reset();let release;state.wait=new Promise(resolve=>{release=resolve;});const pending=search();
 while(state.fetches.length===0)await new Promise(resolve=>setImmediate(resolve));
 state.now+=5000;await rejectsStatus(search('Naxçıvan'),429);assert.equal(state.fetches.length,1,'Slow provider is globally serialized even after the start-slot elapsed');
 release();await pending;assert.equal(state.maxFetches,1);assert.equal(state.next,state.now+1100,'Cooldown is extended from completion, not stale reservation time');

 reset({cacheOnSecondRead:[{label:'Bakı, Azərbaycan',lat:40.4093,lng:49.8671}]});
 assert.deepEqual(await search(),state.cacheOnSecondRead);assert.equal(state.fetches.length,0,'Recheck after acquiring lock avoids a stale cache-miss fetch');assert.equal(state.owner,null);

 for(const changes of [{status:429},{status:503},{providerError:true},{body:{error:'Fixture upstream error'}},{rawResponse:()=>new Response('<html>login</html>')},{rawResponse:()=>new Response('x'.repeat(65537))},{rawResponse:()=>new Response('[]',{headers:{'content-length':'70000'}})}]){
  reset(changes);await rejectsStatus(search(),503);assert.equal(state.fetches.length,1);assert.equal(state.owner,null);assert.equal(state.releases,1);assert.ok(state.next>state.now,'Provider failures cannot undo reserved rate');
  await rejectsStatus(search(),429);assert.equal(state.fetches.length,1);
 }
 reset({cacheError:true});await rejectsStatus(search(),503);assert.ok(state.events.includes('cache-rollback'));assert.equal(state.cache.size,0);assert.ok(state.next>state.now);
 reset({databaseError:true});await rejectsStatus(search(),503);assert.equal(state.fetches.length,0,'Missing migration/DB failure must fail closed, never bypass cache and global limits');
 reset();for(let n=0;n<1003;n++)state.cache.set(String(n).padStart(64,'0'),{response:[],created:n,expires:state.now+500000});
 state.cache.set('expired',{response:[],created:999999,expires:state.now-1});await search();assert.equal(state.cache.size,1000);assert.equal(state.cache.has('expired'),false);

 reset();process.env.OPEN_GEOCODING_URL='https://geocoder.example/self-hosted/';await search();assert.equal(state.fetches[0].url.href.startsWith('https://geocoder.example/self-hosted/search?'),true);
 reset();process.env.OPEN_GEOCODING_ENABLED='0';await rejectsStatus(search(),503);assert.equal(state.fetches.length,0);delete process.env.OPEN_GEOCODING_ENABLED;
 for(const base of ['http://geocoder.example/','https://name:password@geocoder.example/','https://geocoder.example/?key=private']){
  reset();process.env.OPEN_GEOCODING_URL=base;await rejectsStatus(search(),503);assert.equal(state.fetches.length,0);
 }
 delete process.env.OPEN_GEOCODING_URL;
 reset();process.env.BIRKASSA_LOCAL='1';await rejectsStatus(search(),503);assert.equal(state.fetches.length,0,'Desktop default cannot bypass the shared application-wide public limit');
 reset();process.env.OPEN_GEOCODING_URL='https://geocoder.example/self-hosted/';await search();assert.equal(state.fetches.length,1,'A dedicated provider can be explicitly configured for desktop');
 reset();process.env.OPEN_GEOCODING_URL='https://nominatim.openstreetmap.org/custom/';await rejectsStatus(search(),503);assert.equal(state.fetches.length,0);
 delete process.env.OPEN_GEOCODING_URL;delete process.env.BIRKASSA_LOCAL;

 reset({customer:null});await status(route.GET(request()),401);assert.equal(state.fetches.length,0);
 reset({customer:null});await status(route.GET(request('?q=Bakı',{'x-birkassa-role':'admin','x-birkassa-user-id':'spoof'})),401);assert.equal(state.fetches.length,0);
 reset();await status(route.GET(request('?q=Bakı',{'sec-fetch-site':'cross-site'})),403);assert.equal(state.fetches.length,0);
 reset();await status(route.GET(request('?q=Bakı',{origin:'https://evil.example'})),403);assert.equal(state.fetches.length,0);
 reset();await status(route.GET(request()),200);assert.equal(state.fetches.length,1);
 reset();await status(route.POST(post()),200);assert.equal(state.fetches.length,1);assert.equal(state.fetches[0].url.searchParams.get('q'),'Bakı');
 reset();await status(route.POST(post({q:'Bakı',lang:'zh'})),200);assert.match(state.fetches[0].url.searchParams.get('accept-language'),/^zh/);
 for(const body of ['{broken',null,[],{q:5},{q:'ab'},{q:'Bakı',lang:5},{q:'Bakı',lang:'de'},{q:'Bakı',lat:40,lng:49}]){reset();await status(route.POST(post(body)),400);assert.equal(state.fetches.length,0);}
 reset();await status(route.POST(post({q:'Bakı'},{'content-type':'text/plain'})),400);assert.equal(state.fetches.length,0);
 reset();await status(route.POST(post({q:'Bakı'},{'content-length':'3001'})),413);assert.equal(state.fetches.length,0);assert.equal(state.calls.length,0);
 reset();await status(route.POST(post({q:'a'.repeat(3001)})),413);assert.equal(state.fetches.length,0,'Actual body-size guard does not trust Content-Length');
 reset();await status(route.POST(post({q:'地'.repeat(1000)})),413);assert.equal(state.fetches.length,0,'The limit counts UTF-8 bytes, not JavaScript characters');
 reset();await status(route.POST(post({q:'a'.repeat(1501)},{'content-length':'1'})),400);assert.equal(state.fetches.length,0,'Short inaccurate Content-Length does not bypass query validation');
 reset();await status(route.POST(post({q:'Bakı'},{origin:'https://evil.example'})),403);assert.equal(state.fetches.length,0);assert.equal(state.calls.length,0);
 reset({customer:null});await status(route.POST(post()),401);assert.equal(state.fetches.length,0);
 reset({customer:null});await status(route.POST(post({q:'Bakı'},{cookie:'birkassa_session=fixture-staff-token'})),200);assert.equal(state.fetches.length,1,'Strong admin fallback also supports the preferred POST transport');
 reset();for(const path of ['', '?lat=40&lng=49','?lng=49','?q=ab','?q=Bakı&lang=de'])await status(route.GET(request(path)),400);assert.equal(state.fetches.length,0,'Invalid and reverse requests never reach provider');
 reset({owner:-1});const throttled=await status(route.GET(request()),429);assert.equal(throttled.headers.get('retry-after'),'2');assert.equal(state.fetches.length,0);
 reset({customer:null});await status(route.GET(request('?q=Bakı',{cookie:'birkassa_session=fixture-staff-token'})),200);assert.equal(state.fetches.length,1,'Strong authenticated admin can search the origin');
 for(const role of ['manager','cashier','warehouse','accountant','online_manager','online_assistant','unknown']){
  reset({customer:null,session:{id:'fixture-user',role}});const denied=await route.GET(request('?q=Bakı',{cookie:'birkassa_session=fixture-staff-token','x-birkassa-role':'admin'}));assert.ok([401,403].includes(denied.status));assert.equal(state.fetches.length,0,role);
 }
 for(const changes of [{sessionMethod:'pin'},{sessionIdle:10},{sessionExpired:true},{sessionActive:false},{sessionPassword:false}]){
  reset({customer:null,...changes});await status(route.GET(request('?q=Bakı',{cookie:'birkassa_session=fixture-staff-token'})),401);assert.equal(state.fetches.length,0);
 }
 reset({customer:null});await status(route.GET(request('?q=Bakı',{cookie:'birkassa_session=fixture-staff-token'},'http:')),426);assert.equal(state.fetches.length,0);
 reset({accountError:true});await status(route.GET(request()),503);assert.equal(state.fetches.length,0);
 reset();await status(route.HEAD(),405);assert.equal(state.fetches.length,0);assert.equal(state.calls.length,0,'HEAD never invokes auth DB or geocoder');

 const translations=(await load('lib/open-geocoding-translations.ts')).openGeocodingTranslations;
 assert.equal(new Set(translations.map(row=>row[0])).size,translations.length);
 for(const row of translations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));}
 const source=await readFile('lib/open-geocoding.ts','utf8');
 assert.doesNotMatch(source,/console\.|logSystemError|\/reverse\?/,'Do not log private inputs or support public reverse geocoding');
 assert.match(source,/pg_try_advisory_lock/);assert.match(source,/1100 milliseconds/);assert.match(source,/countrycodes:'az'/);assert.match(source,/address\.country_code\.toLowerCase\(\)!=='az'/);
 console.log('Open geocoding tests passed: query-only validation, AZ country verification, private bounded cache, cross-worker rate/serialization, failure cooldown, runtime provider switch, customer/admin auth and 5-language messages.');
}finally{
 globalThis.fetch=originalFetch;
 for(const [name,value]of Object.entries(savedEnv))if(value===undefined)delete process.env[name];else process.env[name]=value;
}
