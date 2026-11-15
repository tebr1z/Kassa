import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import postgres from 'postgres';
import ts from 'typescript';
import {openLocalDatabase} from '../desktop/local-database.mjs';
const fixture=path.resolve('.local-desktop-data','support-mirror-'+randomUUID());
process.env.BIRKASSA_BUNDLED_PG_BIN=path.resolve('desktop/vendor/postgres/bin');process.env.BIRKASSA_REQUIRE_BUNDLED_PG='1';
const database=await openLocalDatabase(fixture,process.cwd(),{port:55444});
const sql=postgres(database.url,{max:1,prepare:false,onnotice:()=>{}}),pools=[];
const require=createRequire(import.meta.url),cache=new Map(),realFetch=globalThis.fetch;
const config={url:'https://support-fixture.invalid',key:'bk_catalog_'+'a'.repeat(64)};
let mode='desktop',offline=false,corrupt=false;
function noPrivate(value){if(Array.isArray(value))value.forEach(noPrivate);else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assert.ok(!['password_hash','pin_hash','account_id','staff_user_id','smtp_password','stock','cost_price'].includes(key),key);noPrivate(item);}}
async function load(file){
 if(cache.has(file))return cache.get(file);
 const source=await readFile(file,'utf8'),m={exports:{}},compiled=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mocks={
  'server-only':{},'@/lib/store-db':{storeDb:()=>{const pool=postgres(database.url,{max:1,prepare:false,onnotice:()=>{}});pools.push(pool);return pool;}},
  '@/lib/desktop-sync':{isDesktop:()=>mode==='desktop',readSyncConfig:async()=>config,hashKey:key=>createHash('sha256').update(key).digest('hex')},
  '@/lib/desktop-bridge':{desktopAuthorization:async(_sql,key,write)=>key===config.key&&write?{userId:randomUUID()}:null},
  '@/lib/require-admin':{withAdminSession:handler=>handler},
 };
 if(file!=='lib/desktop-support-contract.ts')mocks['@/lib/desktop-support-contract']=await load('lib/desktop-support-contract.ts');
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),m,m.exports);cache.set(file,m.exports);return m.exports;
}
try{
 const feed=await load('app/api/desktop-support-feed/route.ts'),mirror=await load('lib/desktop-web-support.ts'),local=await load('app/api/desktop-web-support/route.ts');
 globalThis.fetch=async(url,options)=>{
  assert.equal(new URL(url).origin,config.url);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+config.key);
  if(offline)throw Error('Fixture offline');
  if(corrupt)return Response.json({tickets:[{password_hash:'must-not-be-accepted'}],next:null});
  mode='web';try{const response=await feed.GET(new Request(url,{headers:options.headers}));const data=await response.clone().json();if(response.ok)noPrivate(data);return response;}finally{mode='desktop';}
 };
 mode='web';assert.equal((await feed.GET(new Request(config.url+'/api/desktop-support-feed'))).status,401);
 assert.equal((await feed.GET(new Request(config.url+'/api/desktop-support-feed',{headers:{Authorization:'Bearer bk_orders_'+'a'.repeat(64)}}))).status,401);
 mode='desktop';assert.equal((await feed.GET(new Request(config.url+'/api/desktop-support-feed',{headers:{Authorization:'Bearer '+config.key}}))).status,404);
 const [customer]=await sql.unsafe("insert into customers(full_name,phone) values('Dəstək sınağı','+994701234567') returning id");
 const [account]=await sql.unsafe("insert into customer_accounts(customer_id,email,password_hash) values($1,'fixture@example.invalid','fixture-only-not-a-real-login') returning id",[customer.id]);
 const [ticket]=await sql.unsafe("insert into support_tickets(ticket_no,account_id,subject,kind) values('MIRROR-TEST',$1,'Çatdırılma sualı','order') returning id",[account.id]);
 const [first]=await sql.unsafe("insert into support_ticket_messages(ticket_id,sender,body) values($1,'customer','Ünvanımı dəqiqləşdirmək istəyirəm.') returning id",[ticket.id]);
 const [product]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('SUPPORT-PRIVATE','Özəl yerli məhsul',35,17.43) returning id");
 const before=await sql.unsafe('select id,cost_price from products where id=$1',[product.id]);
 const one=await mirror.syncDesktopWebSupport();assert.equal(one.received,1);
 let listing=await (await local.GET(new Request('http://127.0.0.1/api/desktop-web-support'))).json();noPrivate(listing);assert.equal(listing.tickets.length,1);assert.equal(listing.attention.unread,1);assert.equal(listing.attention.unanswered,1);
 let detail=await (await local.GET(new Request('http://127.0.0.1/api/desktop-web-support?ticket='+ticket.id))).json();assert.equal(detail.messages.length,1);assert.equal(detail.complete,true);assert.equal(detail.messages[0].body,'Ünvanımı dəqiqləşdirmək istəyirəm.');
 assert.equal((await mirror.syncDesktopWebSupport()).received,0,'Replay cannot duplicate a ticket');
 const [{updated_at:oldUpdated}]=await sql.unsafe('select updated_at::text from support_tickets where id=$1',[ticket.id]);
 await sql.unsafe('update support_tickets set staff_read_revision=customer_revision where id=$1',[ticket.id]);
 assert.equal((await sql.unsafe('select updated_at::text from support_tickets where id=$1',[ticket.id]))[0].updated_at,oldUpdated,'Web read intentionally leaves timestamp unchanged');
 await mirror.syncDesktopWebSupport();listing=await (await local.GET(new Request('http://127.0.0.1/api/desktop-web-support?summary=1'))).json();assert.equal(listing.attention.unread,0);assert.ok(!('tickets' in listing),'Sidebar summary avoids correspondence bodies');
 await sql.unsafe("insert into support_ticket_messages(ticket_id,sender,body) select $1,'staff','Sınaq cavabı '||n from generate_series(1,349) n",[ticket.id]);
 await mirror.syncDesktopWebSupport();detail=await (await local.GET(new Request('http://127.0.0.1/api/desktop-web-support?ticket='+ticket.id))).json();assert.equal(detail.complete,false,'300-message budget must not acknowledge a partial conversation');
 await sql.unsafe("update support_ticket_messages set body='Dəyişdirilmiş ilk mesaj',edited_at=clock_timestamp() where id=$1",[first.id]);
 await mirror.syncDesktopWebSupport();await mirror.syncDesktopWebSupport();
 detail=await (await local.GET(new Request('http://127.0.0.1/api/desktop-web-support?ticket='+ticket.id))).json();assert.equal(detail.complete,true);assert.equal(detail.messages.length,350);assert.equal(detail.messages.find(message=>message.id===first.id).body,'Dəyişdirilmiş ilk mesaj','A new content version restarts an old partial cursor');
 assert.equal((await sql.unsafe('select count(*)::int n from desktop_support_messages'))[0].n,350,'Replays upsert stable message IDs');
 offline=true;await assert.rejects(mirror.syncDesktopWebSupport());offline=false;
 assert.equal((await sql.unsafe('select count(*)::int n from desktop_support_messages'))[0].n,350,'Offline failure preserves cached history');
 corrupt=true;await assert.rejects(mirror.syncDesktopWebSupport());corrupt=false;
 await mirror.syncDesktopWebSupport();assert.deepEqual(await sql.unsafe('select id,cost_price from products where id=$1',[product.id]),before);
 assert.equal((await sql.unsafe('select count(*)::int n from sales'))[0].n,0);assert.equal((await sql.unsafe('select count(*)::int n from stock_movements'))[0].n,0);
 console.log('PASS: isolated support feed authorization/private-field boundary, ticket/message mirroring, changed read flags without timestamp updates, replay, large-history continuation, edits during partial scan, offline/cache preservation, strict schemas and summary without bodies; no real customers, email, network, stock or credentials.');
}finally{globalThis.fetch=realFetch;await sql.end({timeout:2});for(const pool of pools)await pool.end({timeout:2});await database.close();}
