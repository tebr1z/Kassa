import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import postgres from 'postgres';
import ts from 'typescript';
import {openLocalDatabase} from '../desktop/local-database.mjs';

// Only a newly generated fixture cluster and mocked HTTPS feed are used. Never
// read the installed profile, environment files, connection key or real orders.
const require=createRequire(import.meta.url),root=path.resolve('.local-desktop-data','order-autoimport-'+randomUUID());
const previousLocal=process.env.BIRKASSA_LOCAL,previousFetch=globalThis.fetch,previousBin=process.env.BIRKASSA_PG_BIN;
process.env.BIRKASSA_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
let database,sql;const pools=new Set();
const config={url:'https://order-fixture.invalid',key:'bk_catalog_'+'a'.repeat(64)};
const modules=new Map();
let publicationFailure=false,retryFailure=false,pageCursorFailure=false;
async function load(file,mocks={}){
 const source=await readFile(file,'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);
 modules.set(file,loaded.exports);return loaded.exports;
}
function micros(value){const fraction=value.match(/\.(\d+)/)?.[1]||'';return BigInt(Date.parse(value))*1000n+BigInt(fraction.padEnd(6,'0').slice(3,6));}
function compare(a,b){const difference=micros(a.updated_at)-micros(b.updated_at);return difference>0n?1:difference<0n?-1:a.id.localeCompare(b.id);}
let feed=[];
let requestCount=0;
function fixtureOrder(product,overrides={}){
 return {id:randomUUID(),order_no:'WEB-FIXTURE-'+randomUUID().slice(0,8),status:'pending',fulfillment:'pickup',delivery_address:'',delivery_stage:'received',
  total:10,coupon_discount:0,delivery_fee:0,distance_meters:null,delivery_lat:null,delivery_lng:null,delivery_pricing:'manual',
  cancellation_reason:null,cancelled_at:null,note:'Fixture note',full_name:'Sifarişi alan',phone:'+994501234567',
  created_at:'2026-11-15T10:00:00.000Z',updated_at:'2026-11-15 10:00:00.123456+00',
  items:[{product_id:product.id,sku:product.sku,name:product.name,option_snapshot:null,quantity:1,unit_price:10,line_total:10}],...overrides};
}
function bump(order,patch={}){Object.assign(order,patch);order.updated_at=new Date(Date.parse(order.updated_at)+1000).toISOString();}
async function inbox(order){return (await sql.unsafe('select * from desktop_order_inbox where remote_id=$1',[order.id]))[0];}
async function local(order){const entry=await inbox(order);return entry?.local_order_id?(await sql.unsafe('select * from sales_orders where id=$1',[entry.local_order_id]))[0]:null;}
async function fingerprints(){const result={};for(const table of ['stock_movements','sales','sale_items','payments','finance_transactions'])result[table]=await sql.unsafe('select * from '+table+' order by id');return JSON.stringify(result);}
try{
 database=await openLocalDatabase(root,process.cwd(),{port:55453});
 sql=postgres(database.url,{max:4,prepare:false});pools.add(sql);
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' order by id limit 1");
 const [warehouse]=await sql.unsafe('select id from warehouses order by id limit 1');
 const [plain]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price,min_stock) values('AUTO-PLAIN','Sadə məhsul',10,7,2) returning *");
 const [variant]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('AUTO-VARIANT','Ölçülü məhsul',12,8) returning *");
 const [choice]=await sql.unsafe("insert into product_options(product_id,label,size,color,price,cost_price,attributes) values($1,'40 sm · Qırmızı','40 sm','Qırmızı',12,8,$2::text::jsonb) returning id",[variant.id,JSON.stringify({'Qalınlıq':'2 mm'})]);
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by) values($1,$2,'receipt',10,7,$3)",[plain.id,warehouse.id,admin.id]);
 const before=await fingerprints();
 const productOptions=await load('lib/product-options.ts');
 const [savedChoice]=await sql.unsafe('select label,attributes from product_options where id=$1',[choice.id]);
 assert.equal(productOptions.optionSnapshot(savedChoice),'40 sm · Qırmızı · Qalınlıq: 2 mm',JSON.stringify(savedChoice));
 const core=await load('lib/desktop-order-import.ts',{'server-only':{},'@/lib/product-options':productOptions});
 const sync=await load('lib/desktop-sync.ts',{
  'server-only':{},'@/lib/desktop-order-import':core,
  'node:fs/promises':{async readFile(file){assert.ok(String(file).endsWith('desktop-sync.json'));return JSON.stringify(config);}},
  '@/lib/store-db':{storeDb(){
   const pool=postgres(database.url,{max:1,prepare:false});pools.add(pool);
   const unsafe=pool.unsafe,begin=pool.begin;
   pool.unsafe=(query,...args)=>{
    if(retryFailure&&query.startsWith('select id from desktop_order_inbox where')){retryFailure=false;return Promise.reject(Error('Fixture retry storage unavailable'));}
    return unsafe(query,...args);
   };
   pool.begin=(...args)=>{
    const callback=args.pop();return begin(...args,async tx=>{
     const transactionUnsafe=tx.unsafe;
     tx.unsafe=(query,...parameters)=>{
      if(pageCursorFailure&&query.startsWith('insert into system_settings')&&String(parameters[0]?.[0]).startsWith('desktop_cursor:')){
       pageCursorFailure=false;return Promise.reject(Error('Fixture page cursor commit unavailable'));
      }
      return transactionUnsafe(query,...parameters);
     };
     return callback(tx);
    });
   };
   return pool;
  }},
  '@/lib/desktop-bridge':{async pushDesktopChanges(){if(publicationFailure)throw Error('Fixture publication unavailable');}},
  '@/lib/desktop-media':{async cacheProductMedia(){return {cached:0,total:0,failed:0};}},
  '@/lib/desktop-web-catalog':{async syncDesktopWebCatalog(){return {changed:0,conflicts:0};}},
  '@/lib/desktop-web-support':{async syncDesktopWebSupport(){return {received:0,updated:0};}},
 });
 globalThis.fetch=async(url,options)=>{
  requestCount++;const parsed=new URL(url);assert.equal(parsed.origin,config.url);assert.equal(parsed.pathname,'/api/desktop-feed');
  assert.equal(options.headers.Authorization,'Bearer '+config.key);assert.equal(options.headers['X-Restamarket-Delivery'],'1');assert.equal(options.redirect,'error');
  const cursor=parsed.searchParams.get('after');
  const after=cursor?JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')):null;
  const rows=feed.filter(row=>!after||compare(row,{updated_at:after.time,id:after.id})>0).sort(compare).slice(0,100);
  const last=rows.at(-1),next=last?Buffer.from(JSON.stringify({time:last.updated_at,id:last.id})).toString('base64url'):null;
  return Response.json({rows,next});
 };
 process.env.BIRKASSA_LOCAL='1';
 const pending=fixtureOrder(plain,{created_by:randomUUID()});
 const ready=fixtureOrder(variant,{status:'ready',fulfillment:'delivery',delivery_address:'Bakı, Nizami küçəsi 1',delivery_stage:'ready',
  total:14,delivery_fee:2,distance_meters:3000,delivery_lat:40.4,delivery_lng:49.8,delivery_pricing:'distance',
  items:[{product_id:variant.id,sku:variant.sku,name:variant.name,option_snapshot:'40 sm · Qırmızı · Qalınlıq: 2 mm',quantity:1,unit_price:12,line_total:12}]});
 const missing=fixtureOrder({id:randomUUID(),sku:'MISSING-SKU',name:'Sonradan yaradılacaq'});
 const selectionMissing=fixtureOrder(variant);
 const invalid=fixtureOrder(plain,{total:11,items:[{product_id:plain.id,sku:plain.sku,name:plain.name,option_snapshot:null,quantity:1,unit_price:10,line_total:11}]});
 const completed=fixtureOrder(plain,{status:'completed'});
 feed=[pending,ready,missing,selectionMissing,invalid,completed];
 let result=await sync.syncOrders();assert.equal(result.received,6);assert.equal(result.imported,2,JSON.stringify(await sql.unsafe("select payload->>'order_no' order_no,import_error,sync_conflict,local_order_id from desktop_order_inbox")));assert.equal(result.invalid,1);assert.equal(result.unresolved,3);
 assert.equal(await fingerprints(),before,'Automatic inbox acceptance never writes stock, receipt, payment or finance tables');
 assert.equal((await local(ready)).status,'ready','Already-ready orders are payable without a second preparation');
 const firstLocal=await local(pending);assert.equal(firstLocal.created_by,admin.id,'The service resolves its own active administrator; incoming actor fields are not trusted');assert.equal(firstLocal.customer_name_snapshot,pending.full_name);assert.equal(firstLocal.customer_phone_snapshot,pending.phone);assert.equal(firstLocal.created_at.toISOString(),pending.created_at);
 assert.match((await inbox(missing)).import_error,/MISSING-SKU/);assert.match((await inbox(selectionMissing)).import_error,/seçim/);assert.match((await inbox(invalid)).import_error,/uyğun deyil/);
 assert.equal((await inbox(completed)).local_order_id,null,'A remote completed order is visible but never imported as a fresh payable order');
 const [linkedChoice]=await sql.unsafe('select option_id,option_snapshot from sales_order_items where sales_order_id=$1',[(await local(ready)).id]);
 assert.equal(linkedChoice.option_id,choice.id);assert.equal(linkedChoice.option_snapshot,ready.items[0].option_snapshot,'Custom attributes use the same complete snapshot as web checkout');
 result=await sync.syncOrders();assert.equal(result.received,0);assert.equal(result.imported,0);
 assert.equal(Number((await sql.unsafe('select count(*) n from sales_orders'))[0].n),2,'Replay cannot duplicate orders');
 const entry=await inbox(pending);
 const concurrent=await Promise.all([sql.begin(tx=>core.importDesktopOrder(tx,entry.id,admin.id)),sql.begin(tx=>core.importDesktopOrder(tx,entry.id,admin.id))]);
 assert.ok(concurrent.every(item=>item.orderId===firstLocal.id&&!item.imported),'Manual retries and the scheduler share exactly-once import locking');
 await sql.unsafe('insert into products(id,sku,name,sale_price,cost_price) values($1,$2,$3,10,4)',[missing.items[0].product_id,missing.items[0].sku,missing.items[0].name]);
 result=await sync.syncOrders();assert.equal(result.imported,1,'Unresolved local mappings are retried without requiring a new remote change');assert.equal((await inbox(missing)).import_error,'');
 const old=structuredClone(pending);bump(pending,{full_name:'Yenilənmiş alıcı',phone:'+994551234567',total:20,items:[{...pending.items[0],quantity:2,line_total:20}]});
 result=await sync.syncOrders();assert.ok(result.updated>0);assert.equal(Number((await local(pending)).total),20);assert.equal((await local(pending)).customer_name_snapshot,pending.full_name,'A still-unpaid untouched local snapshot safely refreshes with remote contact and amounts');
 assert.equal((await inbox(pending)).sync_conflict,'');
 bump(pending,{note:'Yeni veb qeydi'});await sync.syncOrders();assert.match((await local(pending)).note,/Yeni veb qeydi/,'Note-only remote edits are reflected on an untouched unpaid local order');
 // If the local copy was independently changed, do not overwrite it with a web edit.
 await sql.unsafe('update sales_orders set total=19 where id=$1',[firstLocal.id]);bump(pending,{total:30,items:[{...pending.items[0],quantity:3,line_total:30}]});await sync.syncOrders();
 assert.equal(Number((await local(pending)).total),19);assert.match((await inbox(pending)).sync_conflict,/məbləği dəyişib/);
 // An older response can never replace the new payload, even during rescans.
 const newest=(await inbox(pending)).payload;feed=feed.map(row=>row.id===pending.id?old:row);await sync.syncOrders();assert.deepEqual((await inbox(pending)).payload,newest);feed=feed.map(row=>row.id===pending.id?pending:row);
 bump(ready,{delivery_stage:'dispatched'});await sync.syncOrders();assert.equal((await local(ready)).delivery_stage,'dispatched');
 // Web cancellation includes the original reason and timestamp and closes unpaid POS payment.
 const cancellation='Məhsulun çatdırılması hazırda mümkün deyil.';
 bump(missing,{status:'cancelled',cancellation_reason:cancellation,cancelled_at:'2026-11-15T11:00:00.000Z'});await sync.syncOrders();
 assert.equal((await local(missing)).status,'cancelled');assert.equal((await local(missing)).cancellation_reason,cancellation);
 const cancelledId=(await local(missing)).id;
 const cancellationAudits=Number((await sql.unsafe("select count(*) n from audit_logs where entity_id=$1 and action='desktop.remote_order_updated'",[cancelledId]))[0].n);
 await sync.syncOrders();
 assert.equal(Number((await sql.unsafe("select count(*) n from audit_logs where entity_id=$1 and action='desktop.remote_order_updated'",[cancelledId]))[0].n),cancellationAudits,'Replaying an unchanged cancellation compares timestamp instants, not ISO-string versus PostgreSQL Date-object formatting');
 // A paid local receipt is not a reversible web status field.
 const [shift]=await sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,0) returning id',[admin.branch_id,admin.id]);
 const paid=await local(ready);await sql.unsafe("update sales_orders set status='completed' where id=$1",[paid.id]);
 const [sale]=await sql.unsafe("insert into sales(receipt_no,shift_id,cashier_id,subtotal,total,sales_order_id) values('FIXTURE-PAID',$1,$2,12,14,$3) returning id",[shift.id,admin.id,paid.id]);
 await sql.unsafe('insert into sale_items(sale_id,product_id,quantity,unit_price,cost_snapshot,line_total) values($1,$2,1,12,8,12)',[sale.id,variant.id]);
 await sql.unsafe("insert into payments(sale_id,method,amount) values($1,'cash',14)",[sale.id]);
 const paidFingerprint=await fingerprints();bump(ready,{status:'cancelled',cancellation_reason:cancellation,cancelled_at:'2026-11-15T11:01:00.000Z'});await sync.syncOrders();
 assert.equal((await local(ready)).status,'completed');assert.match((await inbox(ready)).sync_conflict,/kassada ödənilib/);assert.equal(await fingerprints(),paidFingerprint,'Remote cancellation never reverses an existing sale, payment or stock movement');
 const blocked=fixtureOrder(plain);feed.push(blocked);await sync.syncOrders();bump(blocked,{status:'completed'});await sync.syncOrders();assert.equal((await local(blocked)).status,'cancelled','Remote completion blocks a second unpaid local receipt');assert.match((await inbox(blocked)).sync_conflict,/kassada yeni çek yaradılmayıb/);
 // Insert a late-committed order behind the high-water cursor but inside replay window.
 const late=fixtureOrder(plain,{updated_at:'2026-11-15 10:00:00.123455+00'});feed.push(late);result=await sync.syncOrders();assert.equal(result.received,1);assert.ok((await local(late)).id,'Five-minute replay catches a late commit with earlier microseconds');
 const cursorKey='desktop_cursor:'+createHash('sha256').update(config.url).digest('hex');const highwater=(await sql.unsafe('select value from system_settings where key=$1',[cursorKey]))[0].value;
 const ancient=fixtureOrder(plain,{updated_at:'2026-11-15T09:00:00.000Z'});feed.push(ancient);await sync.syncOrders();assert.equal(await inbox(ancient),undefined);
 const rescanKey='desktop_rescan:'+createHash('sha256').update(config.url).digest('hex');await sql.unsafe('update system_settings set value=$1 where key=$2',['2000-01-01T00:00:00.000Z',rescanKey]);
 await sync.syncOrders();assert.ok((await local(ancient)).id,'Periodic complete replay eventually catches arbitrarily old late commits');assert.equal((await sql.unsafe('select value from system_settings where key=$1',[cursorKey]))[0].value,highwater,'Full replay never regresses the durable high-water cursor');
 const notification=fixtureOrder(plain,{updated_at:'2026-11-15T10:00:10.000Z'});feed.push(notification);publicationFailure=true;
 result=await sync.syncOrders();assert.equal(result.received,1);assert.equal(result.imported,1);assert.match(result.publicationError,/Fixture publication/,'Independent publication failure cannot erase committed import counters or suppress notifications');publicationFailure=false;
 const committedBeforeRetry=fixtureOrder(plain,{updated_at:'2026-11-15T10:00:11.000Z'});feed.push(committedBeforeRetry);retryFailure=true;
 result=await sync.syncOrders();assert.equal(result.received,1);assert.equal(result.imported,1);assert.match(result.orderError,/təkrar yoxlanması/);assert.ok(await local(committedBeforeRetry),'A later retry-channel failure keeps already committed notification counters and imports');
 const rolledBack=fixtureOrder(plain,{updated_at:'2026-11-15T10:00:12.000Z'});feed.push(rolledBack);pageCursorFailure=true;
 await assert.rejects(sync.syncOrders(),error=>{
  assert.match(error.message,/Fixture page cursor/);assert.ok(!error.desktopPartialResult,'An entirely rolled-back page cannot claim received/imported successes');return true;
 });
 assert.equal(await inbox(rolledBack),undefined,'Inbox, local order and cursor roll back together');
 result=await sync.syncOrders();assert.equal(result.received,1);assert.equal(result.imported,1);assert.ok(await local(rolledBack),'The same rolled-back order is safely accepted on the next attempt');
 assert.equal(Number((await sql.unsafe('select cost_price from products where id=$1',[plain.id]))[0].cost_price),7);
 assert.ok(requestCount>10);console.log('PASS: isolated automatic web-order import, exact custom variants, ready-state preservation, per-order malformed/missing mapping isolation and retry, idempotent concurrent import, safe unpaid snapshot refresh/conflicts, forward delivery updates, cancellation reasons, paid-receipt/stock isolation, microsecond late commits, periodic full replay and notification counters after publication failure.');
}finally{
 globalThis.fetch=previousFetch;
 if(previousLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=previousLocal;
 for(const pool of pools)await pool.end({timeout:2});if(database)await database.close();
 if(previousBin===undefined)delete process.env.BIRKASSA_PG_BIN;else process.env.BIRKASSA_PG_BIN=previousBin;
}
