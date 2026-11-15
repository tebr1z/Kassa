import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import postgres from 'postgres';
import ts from 'typescript';
import {openLocalDatabase} from '../desktop/local-database.mjs';

// All SQL and media belong to a newly generated workspace fixture. Never read
// an environment file or reuse a real profile/database; fetch is a strict mock.
const fixtureParent=path.resolve('.local-desktop-data'),fixture=path.join(fixtureParent,'web-catalog-'+randomUUID()),port=55441;
const realFetch=globalThis.fetch,require=createRequire(import.meta.url),origin='https://catalog-fixture.invalid';
const old={bin:process.env.BIRKASSA_PG_BIN,data:process.env.BIRKASSA_DATA_DIR};
let database,sql,stopped=true,phase='setup',localMode=true,config=null,auth=true;
const modules=new Map(),requestLog=[];
function load(file){
 const absolute=path.resolve(file);if(modules.has(absolute))return modules.get(absolute).exports;
 const loaded={exports:{}};modules.set(absolute,loaded);
 const custom=name=>{
  if(name==='server-only')return {};
  if(name==='@/lib/store-db')return {storeDb:()=>sql};
  if(name==='@/lib/desktop-sync')return {isDesktop:()=>localMode,readSyncConfig:async()=>config};
  if(name==='@/lib/desktop-bridge')return {desktopAuthorization:async(_sql,key,write)=>auth&&write&&/^bk_catalog_[a-f0-9]{64}$/.test(key)?{userId:'fixture-admin'}:null};
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
  return require(name);
 };
 const compiled=ts.transpileModule(require('node:fs').readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',compiled)(custom,loaded,loaded.exports);return loaded.exports;
}
const {applyDesktopWebCatalog,desktopWebCatalogSchema,readDesktopCatalogResponse,syncDesktopWebCatalog}=load('lib/desktop-web-catalog.ts');
const {readDesktopPublicProducts}=load('lib/desktop-catalog-source.ts');
const {desktopCatalogBaselineKey,seedDesktopCatalogBaseline,buildDesktopCatalogChanges}=load('lib/desktop-catalog-delta.ts');
const baseKey=desktopCatalogBaselineKey(origin),copy=value=>structuredClone(value),photo=letter=>'https://res.cloudinary.com/fixture/image/upload/'+letter+'.jpg';
async function getProduct(id){return (await readDesktopPublicProducts(sql)).find(row=>row.id===id);}
async function baseline(){const [row]=await sql.unsafe('select value from system_settings where key=$1',[baseKey]);return JSON.parse(row.value);}
async function seedBaseline(){const value=seedDesktopCatalogBaseline(await readDesktopPublicProducts(sql));await sql.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[baseKey,JSON.stringify(value)]);return value;}
async function settings(){return JSON.parse((await sql.unsafe("select value from system_settings where key='desktop_web_catalog_status'"))[0].value);}
async function privateState(){
 const data={};
 data.products=await sql.unsafe('select id,cost_price,min_stock,deleted_at from products order by id');
 data.options=await sql.unsafe('select id,product_id,label,cost_price from product_options order by id');
 for(const table of ['stock_movements','sales','sale_items','payments','finance_transactions','purchase_orders','users','auth_sessions','customer_accounts','customer_sessions'])data[table]=(await sql.unsafe("select coalesce(jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'[]'::jsonb) rows from "+table+' source'))[0].rows;
 return JSON.parse(JSON.stringify(data));
}
async function fixtureProduct(sku,extra={}){
 const [row]=await sql.unsafe('insert into products(sku,name,sale_price,cost_price,min_stock,image_url) values($1,$2,12.5,17.25,3,$3) returning id',[sku,'Fixture '+sku,photo('a')]);
 await sql.unsafe('insert into product_images(product_id,image_url,position) values($1,$2,0)',[row.id,photo('a')]);
 const [option]=await sql.unsafe("insert into product_options(product_id,label,size,color,kind,price,cost_price,attributes,image_url) values($1,'40 · Qırmızı','40','Qırmızı','Dəmir',14.5,7.75,$2::text::jsonb,$3) returning id",[row.id,JSON.stringify({thickness:'2 mm'}),photo('a')]);
 if(Object.keys(extra).length)throw Error('Unexpected fixture override');
 return {id:row.id,option:option.id};
}
try{
 await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
 process.env.BIRKASSA_PG_BIN=path.resolve('desktop/vendor/postgres/bin');process.env.BIRKASSA_DATA_DIR=fixture;
 assert.equal((await readFile(path.join(process.env.BIRKASSA_PG_BIN,'..','PG_MAJOR'),'utf8')).trim(),'17');
 database=await openLocalDatabase(fixture,process.cwd(),{port});stopped=false;
 sql=postgres(database.url,{max:1,prepare:false,connect_timeout:5});
 const [identity]=await sql.unsafe("select current_setting('data_directory') directory,inet_server_port() port");
 assert.equal(path.resolve(identity.directory).toLowerCase(),path.join(fixture,'postgres').toLowerCase());assert.equal(identity.port,port);
 const first=await fixtureProduct('MIRROR-FIRST'),other=await fixtureProduct('LOCAL-ONLY'),renamed=await fixtureProduct('MIRROR-RENAME'),fallback=await fixtureProduct('MIRROR-FALLBACK'),attributeCollision=await fixtureProduct('ATTRIBUTE-COLLISION');
 const [admin]=await sql.unsafe("select id from users where role='admin' limit 1"),[warehouse]=await sql.unsafe('select id from warehouses limit 1');
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by,note) values($1,$2,'receipt',12.5,17.25,$3,'Private fixture inventory')",[first.id,warehouse.id,admin.id]);
 await seedBaseline();const beforePrivate=await privateState(),remote=copy(await getProduct(first.id)),originalOption=remote.options[0];
 phase='wire schema and bounded response';
 assert.ok(desktopWebCatalogSchema.safeParse({protocol:1,catalog:[remote]}).success);
 for(const injected of [{...remote,stock:9},{...remote,cost_price:8},{...remote,auth_sessions:[]},{...remote,options:[{...originalOption,cost_price:7}]},{...remote,image:'https://arbitrary.invalid/a.jpg'},{...remote,image:'/api/desktop-media/'+'a'.repeat(64)},{...remote,price:Infinity},{...remote,options:[originalOption,originalOption]}])assert.equal(desktopWebCatalogSchema.safeParse({protocol:1,catalog:[injected]}).success,false);
 assert.equal(desktopWebCatalogSchema.safeParse({protocol:1,catalog:[remote,{...remote,id:randomUUID()}]}).success,false);
 await assert.rejects(()=>readDesktopCatalogResponse(new Response('{}',{headers:{'content-length':String(33*1024*1024)}})),/çox böyük/);
 assert.deepEqual(await readDesktopCatalogResponse(new Response(JSON.stringify({protocol:1,catalog:[remote]}))),{protocol:1,catalog:[remote]});
 phase='public edits and preserved private identities';
 remote.name='Vebdən yeni ad';remote.description='Public SEO copy';remote.price=19.5;remote.category='Veb kateqoriyası';remote.image=photo('b');remote.images=[photo('a'),photo('b')];remote.options[0]={...originalOption,size:'50',price:22,image:photo('b')};remote.options.push({...copy(originalOption),label:'60 · Yaşıl',size:'60',color:'Yaşıl',price:25,position:1});
 let result=await applyDesktopWebCatalog(sql,origin,[remote]);assert.equal(result.changed,1);assert.equal(result.conflicts,0);
 let saved=await getProduct(first.id);assert.equal(saved.name,remote.name);assert.equal(saved.price,19.5);assert.equal(saved.options.length,2);assert.equal(saved.options[0].size,'50');
 const [kept]=await sql.unsafe('select id,cost_price from product_options where product_id=$1 and label=$2',[first.id,originalOption.label]);assert.equal(kept.id,first.option);assert.equal(Number(kept.cost_price),7.75);
 assert.deepEqual(buildDesktopCatalogChanges(await readDesktopPublicProducts(sql),await baseline()).catalog,[],'Accepted inbound fields are acknowledged, not republished');
 let unchanged=await privateState();for(const table of Object.keys(beforePrivate))if(!['options'].includes(table))assert.deepEqual(unchanged[table],beforePrivate[table],'Private table/columns preserved: '+table);
 assert.ok((await getProduct(other.id)).isActive,'An absent remote product does not archive local-only stock');
 result=await applyDesktopWebCatalog(sql,origin,[remote]);assert.deepEqual(result,{changed:0,conflicts:0},'Snapshot replay is idempotent');
 phase='canonical custom-attribute identity collision';
 const collisionRemote=copy(await getProduct(attributeCollision.id));collisionRemote.options[0].attributes={thickness:'Unrelated 6 mm'};
 result=await applyDesktopWebCatalog(sql,origin,[collisionRemote]);assert.equal(result.conflicts,1);assert.equal((await getProduct(attributeCollision.id)).options[0].attributes.thickness,'2 mm');assert.equal((await sql.unsafe('select id from product_options where product_id=$1',[attributeCollision.id]))[0].id,attributeCollision.option);
 result=await applyDesktopWebCatalog(sql,origin,[collisionRemote]);assert.equal(result.conflicts,1,'Canonical identity conflicts require review instead of disappearing on replay');
 phase='concurrent unsent scalar/gallery/option edits';
 await sql.unsafe('update products set name=$1,image_url=$2 where id=$3',['Unsent local name',photo('local'),first.id]);
 await sql.unsafe('insert into product_images(product_id,image_url,position) values($1,$2,2)',[first.id,photo('local')]);
 await sql.unsafe('update product_options set color=$1 where id=$2',['Yerli yaşıl',first.option]);
 result=await applyDesktopWebCatalog(sql,origin,[remote]);assert.deepEqual(result,{changed:0,conflicts:0},'Local-only unsent edits are not mistaken for concurrent web conflicts');
 let localOnlyDirty=buildDesktopCatalogChanges(await readDesktopPublicProducts(sql),await baseline()).catalog.find(row=>row.id===first.id);assert.ok(localOnlyDirty.changedFields.includes('name'));assert.ok(localOnlyDirty.changedFields.includes('options'));assert.ok(localOnlyDirty.changedFields.includes('images'));
 remote.price=23;remote.name='Concurrent remote name';remote.image=photo('c');remote.images=[photo('b'),photo('c')];remote.options[0].color='Veb mavi';remote.options[0].size='55';
 result=await applyDesktopWebCatalog(sql,origin,[remote]);assert.equal(result.conflicts,1);
 saved=await getProduct(first.id);assert.equal(saved.name,'Unsent local name');assert.equal(saved.image,photo('local'));assert.equal(saved.price,23);assert.equal(saved.options[0].color,'Yerli yaşıl');assert.equal(saved.options[0].size,'55');assert.ok(saved.images.includes(photo('local')));assert.ok(saved.images.includes(photo('c')));assert.ok(!saved.images.includes(photo('a')));
 const dirty=buildDesktopCatalogChanges(await readDesktopPublicProducts(sql),await baseline()).catalog.find(row=>row.id===first.id);assert.ok(dirty.changedFields.includes('name'));assert.ok(dirty.changedFields.includes('image'));assert.ok(dirty.changedFields.includes('images'));assert.ok(dirty.changedFields.includes('options'));assert.ok(!dirty.changedFields.includes('price'));
 assert.equal((await baseline()).products[first.id].options[0].color,'Qırmızı','Unsent color is not falsely acknowledged');assert.equal((await baseline()).products[first.id].options[0].size,'55','Accepted size is acknowledged');
 result=await applyDesktopWebCatalog(sql,origin,[remote]);assert.equal(result.conflicts,1,'A previously unresolved concurrent conflict survives the next unchanged web snapshot');assert.equal((await getProduct(first.id)).name,'Unsent local name');
 phase='pending immutable publication gate';
 const frozen=copy(saved),frozenBase=await baseline();await sql.unsafe('insert into desktop_sync_outbox(store_url,payload) values($1,$2::jsonb)',[origin,JSON.stringify({fixture:true})]);
 result=await applyDesktopWebCatalog(sql,origin,[{...remote,price:99}]);assert.deepEqual(result,{changed:0,conflicts:0});assert.deepEqual(await getProduct(first.id),frozen);assert.deepEqual(await baseline(),frozenBase);assert.equal((await settings()).pending,true);
 await sql.unsafe('update desktop_sync_outbox set acknowledged_at=now() where store_url=$1',[origin]);
 phase='stable ID renames and SKU fallback mapping';
 let renameRemote=copy(await getProduct(renamed.id));renameRemote.sku='MIRROR-RENAMED';renameRemote.name='Stable ID renamed';result=await applyDesktopWebCatalog(sql,origin,[renameRemote]);assert.equal(result.conflicts,0);assert.equal((await getProduct(renamed.id)).sku,'MIRROR-RENAMED');
 let fallbackRemote=copy(await getProduct(fallback.id));fallbackRemote.id=randomUUID();fallbackRemote.name='Mapped different remote ID';result=await applyDesktopWebCatalog(sql,origin,[fallbackRemote]);assert.equal(result.conflicts,0);const [mapping]=await sql.unsafe('select local_product_id from desktop_web_catalog_map where store_url=$1 and remote_id=$2',[origin,fallbackRemote.id]);assert.equal(mapping.local_product_id,fallback.id);
 fallbackRemote.sku='MAPPED-SKU-RENAMED';result=await applyDesktopWebCatalog(sql,origin,[fallbackRemote]);assert.equal(result.conflicts,0);assert.equal((await getProduct(fallback.id)).sku,'MAPPED-SKU-RENAMED');
 phase='identity collision rejects complete per-product update';
 const renameBefore=await getProduct(renamed.id);result=await applyDesktopWebCatalog(sql,origin,[{...renameRemote,name:'Must not partially apply',sku:(await getProduct(other.id)).sku}]);assert.equal(result.conflicts,1);assert.deepEqual(await getProduct(renamed.id),renameBefore);
 result=await applyDesktopWebCatalog(sql,origin,[{...renameRemote,name:'Must not apply',code:(await getProduct(other.id)).code}]);assert.equal(result.conflicts,1);assert.deepEqual(await getProduct(renamed.id),renameBefore);
 const [held]=await sql.unsafe('select conflicts from desktop_web_catalog_map where store_url=$1 and remote_id=$2',[origin,renamed.id]);assert.ok(held.conflicts.includes('name')&&held.conflicts.includes('options'),'A failed inbound product is held from outbound overwrite');
 phase='savepoint rolls back a mid-product database failure';
 await sql.unsafe("alter table product_options add constraint fixture_catalog_failure check(label<>'FAIL-CATALOG-OPTION')");
 const validOther=copy(await getProduct(other.id));validOther.name='Valid product after rejected neighbor';
 result=await applyDesktopWebCatalog(sql,origin,[{...renameRemote,name:'Rollback this partial scalar',options:[...renameRemote.options,{...copy(originalOption),label:'FAIL-CATALOG-OPTION'}]},validOther]);assert.equal(result.conflicts,1);assert.equal(result.changed,1);assert.deepEqual(await getProduct(renamed.id),renameBefore);assert.equal((await getProduct(other.id)).name,validOther.name);assert.equal((await sql.unsafe("select id from product_options where label='FAIL-CATALOG-OPTION'")).length,0);
 assert.equal((await settings()).storeUrl,origin);
 phase='new web product stays inactive and cannot leak zero-cost stock';
 const added={...copy(remote),id:randomUUID(),sku:'WEB-ONLY-NEW',code:'990091',name:'New web-only product',options:[{...copy(originalOption),label:'New option'}],images:[],image:''};
 result=await applyDesktopWebCatalog(sql,origin,[added]);assert.equal(result.changed,1);assert.equal(result.conflicts,1);let newLocal=await getProduct(added.id);assert.equal(newLocal.isActive,false);const [newPrivate]=await sql.unsafe('select cost_price,min_stock,(select coalesce(sum(quantity),0) from stock_movements where product_id=products.id) stock from products where id=$1',[added.id]);assert.equal(Number(newPrivate.cost_price),0);assert.equal(Number(newPrivate.stock),0);assert.equal(Number(newPrivate.min_stock),0);
 assert.equal(buildDesktopCatalogChanges(await readDesktopPublicProducts(sql),await baseline()).catalog.some(row=>row.id===added.id),false,'Local review inactivity is not published back as a web deactivation');
 result=await applyDesktopWebCatalog(sql,origin,[added]);assert.equal((await getProduct(added.id)).isActive,false);assert.equal(result.changed,0);
 await sql.unsafe('update products set is_active=true,cost_price=9 where id=$1',[added.id]);result=await applyDesktopWebCatalog(sql,origin,[added]);assert.equal(result.conflicts,0);assert.equal((await getProduct(added.id)).isActive,true);assert.equal(Number((await sql.unsafe('select cost_price from products where id=$1',[added.id]))[0].cost_price),9);
 phase='explicit archive, option removals and local deleted-row protection';
 result=await applyDesktopWebCatalog(sql,origin,[{...renameRemote,isActive:false,options:[]}]);assert.equal(result.conflicts,0);assert.equal((await getProduct(renamed.id)).isActive,false);assert.equal((await getProduct(renamed.id)).options[0].isActive,false);
 await sql.unsafe('update products set deleted_at=now(),is_active=false where id=$1',[fallback.id]);const deletedBefore=await getProduct(fallback.id);result=await applyDesktopWebCatalog(sql,origin,[fallbackRemote]);assert.equal(result.conflicts,1);assert.deepEqual(await getProduct(fallback.id),deletedBefore);
 phase='client no-op modes, endpoint authorization and hash-verified image cache';
 const noNetwork=async()=>{throw Error('Unexpected real/external request');};globalThis.fetch=noNetwork;
 config={url:origin,key:'bk_orders_'+'a'.repeat(64)};assert.deepEqual(await syncDesktopWebCatalog(),{changed:0,conflicts:0});localMode=false;config={url:origin,key:'bk_catalog_'+'a'.repeat(64)};assert.deepEqual(await syncDesktopWebCatalog(),{changed:0,conflicts:0});
 const feed=load('app/api/desktop-catalog-feed/route.ts'),key='bk_catalog_'+'a'.repeat(64);
 // Feed closes its own connection in production; keep the fixture's single
 // connection open by wrapping only the route's storeDb dependency.
 const actualEnd=sql.end;sql.end=async()=>{};
 try{auth=false;assert.equal((await feed.GET(new Request(origin+'/api/desktop-catalog-feed',{headers:{Authorization:'Bearer '+key}}))).status,401);auth=true;assert.equal((await feed.GET(new Request(origin+'/api/desktop-catalog-feed',{headers:{Authorization:'Bearer bk_orders_'+'a'.repeat(64)}}))).status,401);const response=await feed.GET(new Request(origin+'/api/desktop-catalog-feed',{headers:{Authorization:'Bearer '+key}}));assert.equal(response.status,200);const text=await response.text();for(const privateField of ['cost_price','stock_movements','password_hash','pin_hash','auth_sessions','barcode','min_stock'])assert.ok(!text.includes('"'+privateField+'"'));assert.ok(desktopWebCatalogSchema.safeParse(JSON.parse(text)).success);}
 finally{sql.end=actualEnd;}
 localMode=true;
 const png=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex'),hash=createHash('sha256').update(png).digest('hex'),imageRemote={...copy(added),image:'/api/catalog-media/'+hash,images:['/api/catalog-media/'+hash],options:[]};
 // Preserve a clean source baseline for the existing fixture before the fetch.
 await seedBaseline();
 globalThis.fetch=async(input,options)=>{const url=String(input);requestLog.push([url,options]);assert.equal(options.redirect,'error');assert.ok(url.startsWith(origin+'/'));if(url===origin+'/api/desktop-catalog-feed')return new Response(JSON.stringify({protocol:1,catalog:[imageRemote]}));if(url===origin+'/api/catalog-media/'+hash)return new Response(png);throw Error('Unexpected mock URL');};
 const clientEnd=sql.end;sql.end=async()=>{};try{result=await syncDesktopWebCatalog();assert.equal(result.conflicts,0);}finally{sql.end=clientEnd;}
 newLocal=await getProduct(added.id);assert.equal(newLocal.image,'/api/desktop-media/'+hash);assert.equal(await readFile(path.join(fixture,'media',hash+'.bin')).then(bytes=>createHash('sha256').update(bytes).digest('hex')),hash);const info=JSON.parse(await readFile(path.join(fixture,'media',hash+'.json'),'utf8'));assert.equal(info.type,'image/png');assert.equal(info.url,origin+'/api/catalog-media/'+hash);assert.equal(info.size,png.length);assert.ok(requestLog.every(([url])=>url.startsWith(origin+'/')));assert.deepEqual(buildDesktopCatalogChanges(await readDesktopPublicProducts(sql),await baseline()).catalog,[],'Cached inbound pictures do not produce outgoing edits');
 const invalidHash='f'.repeat(64),unchangedImage=copy(newLocal);globalThis.fetch=async(input)=>String(input).endsWith('/api/desktop-catalog-feed')?new Response(JSON.stringify({protocol:1,catalog:[{...imageRemote,image:'/api/catalog-media/'+invalidHash,images:[]}]})):new Response(png);
 sql.end=async()=>{};try{result=await syncDesktopWebCatalog();assert.equal(result.conflicts,1);}finally{sql.end=clientEnd;}assert.deepEqual(await getProduct(added.id),unchangedImage,'Bad image content hash does not partially update the product');
 const finalPrivate=await privateState();for(const table of ['stock_movements','sales','sale_items','payments','finance_transactions','purchase_orders','users','auth_sessions','customer_accounts','customer_sessions'])assert.deepEqual(finalPrivate[table],beforePrivate[table],'Never synchronized/mutated private records: '+table);
 console.log('PASS: isolated PostgreSQL 17 public catalog mirror, strict allowlist/body limits/auth, stable ID and SKU mapping/rename/collision refusal, per-product savepoints, dirty field/gallery/option preservation, cost/stock/auth invariants, baseline acknowledgements and pending outbox gate, inactive zero-stock new-product review, archives and deleted-local protection, HTTPS same-origin hash-verified offline photos, idempotent snapshots. No real profiles, network or customer data accessed.');
}catch(error){console.error('Web catalog fixture phase: '+phase);throw error;}
finally{
 globalThis.fetch=realFetch;if(sql)await sql.end({timeout:2});if(database){await database.close();stopped=true;}
 for(const [key,value]of [['BIRKASSA_PG_BIN',old.bin],['BIRKASSA_DATA_DIR',old.data]])if(value===undefined)delete process.env[key];else process.env[key]=value;
 if(!stopped||path.dirname(path.resolve(fixture))!==fixtureParent||!/^web-catalog-[a-f0-9-]{36}$/.test(path.basename(fixture)))throw Error('Unsafe fixture cleanup refused');
 await rm(fixture,{recursive:true,force:true});
}
