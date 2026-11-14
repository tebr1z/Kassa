import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import postgres from 'postgres';
import ts from 'typescript';
import {openLocalDatabase} from '../desktop/local-database.mjs';

// Disposable local PostgreSQL only: no Next server, live data or external calls.
const port=55450,probe=createServer();
await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(error=>error?reject(error):resolve()));});
const previous={bin:process.env.BIRKASSA_BUNDLED_PG_BIN,local:process.env.BIRKASSA_LOCAL,root:process.env.BIRKASSA_DATA_DIR};
process.env.BIRKASSA_BUNDLED_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
const dataRoot=path.resolve('.local-desktop-data','option-images-'+randomUUID()),database=await openLocalDatabase(dataRoot,process.cwd(),{port});
assert.equal(new URL(database.url).hostname,'127.0.0.1');assert.equal(new URL(database.url).port,String(port));
const sql=postgres(database.url,{max:2,prepare:false}),require=createRequire(import.meta.url);
async function load(file,mocks={}){const compiled=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,loaded={exports:{}};new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;}
const db={storeDb:()=>postgres(database.url,{max:1,prepare:false})},images=await load('lib/product-option-image.ts'),input=await load('lib/product-option-input.ts',{'./product-option-image':images}),save=await load('lib/save-product-options.ts');
try{
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' limit 1");
 await sql.unsafe("update users set password_hash='fixture-password-hash' where id=$1",[admin.id]);
 const token='option-images-'+randomUUID();await sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password')",[admin.id,createHash('sha256').update(token).digest('hex')]);
 const security=await load('lib/admin-security.ts'),roles=await load('lib/staff-access.ts'),guard=await load('lib/require-admin.ts',{'@/lib/store-db':db,'@/lib/admin-security':security,'@/lib/staff-access':roles});
 const barcode=await load('lib/barcode.ts'),discount=await load('lib/product-discount.ts'),media=await load('lib/desktop-media.ts',{'@/lib/store-db':db});
 const commerce=await load('app/api/store-admin/commerce/route.ts',{'@/lib/require-admin':guard,'@/lib/store-db':db,'@/lib/barcode':barcode,'@/lib/desktop-media':media,'@/lib/product-option-input':input,'@/lib/save-product-options':save,'@/lib/product-discount':discount});
 const request=(body,path='/api/store-admin/commerce',auth=true)=>new Request('https://fixture.example'+path,{method:body===undefined?'GET':'POST',headers:{host:'fixture.example',origin:'https://fixture.example',...(auth?{cookie:'birkassa_session='+token}:{}),...(body instanceof FormData?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
 const cloud='https://res.cloudinary.com/fixture/image/upload/red.png',hash='a'.repeat(64),catalog='/api/catalog-media/'+hash;
 const [product]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price,image_url) values('IMAGE-TEST','Rəngli manqal',9,3,'https://res.cloudinary.com/fixture/main.png') returning id");
 const [option]=await sql.unsafe("insert into product_options(product_id,label,size,color,price,cost_price) values($1,'40 · Qırmızı','40','Qırmızı',7,3) returning *",[product.id]);assert.equal(option.image_url,'','Migration default protects existing options');
 const base=input.productOptionInput.parse({id:option.id,label:option.label,size:'40',color:'Qırmızı',kind:'',price:7,cost_price:3,is_active:true});
 const bulk=options=>sql.begin(async tx=>{await tx.unsafe('select id from products where id=$1 for update',[product.id]);await save.saveProductOptions(tx,product.id,options);});
 const photo=async()=>String((await sql.unsafe('select image_url from product_options where id=$1',[option.id]))[0].image_url);
 await bulk([{...base,image_url:cloud}]);assert.equal(await photo(),cloud);
 await bulk([base]);assert.equal(await photo(),cloud,'Old inventory form preserves photo');
 await bulk([{...base,image_url:''}]);assert.equal(await photo(),'');
 await bulk([{...base,image_url:cloud}]);
 for(const image of [undefined,'',cloud]){
  const response=await commerce.POST(request({...base,action:'option',product_id:product.id,...(image===undefined?{}:{image_url:image})}));assert.equal(response.status,200,await response.text());assert.equal(await photo(),image??cloud);
 }
 assert.equal((await commerce.POST(request({...base,action:'option',product_id:product.id,image_url:'https://evil.test/a'}))).status,400);assert.equal(await photo(),cloud);
 assert.equal((await commerce.POST(request({...base,action:'option',product_id:product.id},undefined,false))).status,401);
 const [cashier]=await sql.unsafe("insert into users(branch_id,full_name,role,password_hash) values($1,'Fixture cashier','cashier','fixture-password-hash') returning id",[admin.branch_id]);
 const cashierToken='cashier-'+randomUUID();await sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password')",[cashier.id,createHash('sha256').update(cashierToken).digest('hex')]);
 const forbidden=request({...base,action:'option',product_id:product.id,image_url:''});forbidden.headers.set('cookie','birkassa_session='+cashierToken);assert.equal((await commerce.POST(forbidden)).status,403);assert.equal(await photo(),cloud);
 // Authenticated upload for a not-yet-saved choice is intentionally unattached.
 process.env.BIRKASSA_LOCAL='1';process.env.BIRKASSA_DATA_DIR=dataRoot;
 const imageStorage=await load('lib/catalog-media.ts',{'@/lib/desktop-media':media}),upload=await load('app/api/store-admin/upload/route.ts',{'@/lib/require-admin':guard,'@/lib/cloudinary-config':{cloudCredentials:async()=>({})},'@/lib/store-db':db,'@/lib/catalog-media':imageStorage,'@/lib/desktop-media':media,'@/lib/product-option-image':images});
 const before=await sql.unsafe('select image_url,(select logo from storefront_config where id=1) logo,(select count(*) from product_images) gallery from products where id=$1',[product.id]);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfocAAAAASUVORK5CYII=','base64'),form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'fixture.png');form.set('purpose','variant');
 const uploaded=await upload.POST(request(form,'/api/store-admin/upload'));assert.equal(uploaded.status,200);const url=(await uploaded.json()).url;assert.match(url,/^\/api\/desktop-media\/[a-f0-9]{64}$/);
 assert.deepEqual(await sql.unsafe('select image_url,(select logo from storefront_config where id=1) logo,(select count(*) from product_images) gallery from products where id=$1',[product.id]),before,'Uploading a variant must not modify logo/product/gallery');assert.equal(await photo(),cloud);
 // Publication from an old desktop preserves a web-assigned option photo.
 const bridge=await load('lib/desktop-bridge.ts',{'@/lib/desktop-sync':{},'@/lib/desktop-media':media,'@/lib/store-db':db,'@/lib/product-option-image':images});
 const clientId=randomUUID(),publicProduct={id:product.id,sku:'IMAGE-TEST',name:'Rəngli manqal',code:(await sql.unsafe('select public_code from products where id=$1',[product.id]))[0].public_code,category:'',unit:'ədəd',price:9,discountPrice:null,image:'',images:[],options:[{label:base.label,size:'40',color:'Qırmızı',kind:'',price:7,position:0,isActive:true}],isActive:true};
 const batch=(revision,image)=>bridge.syncBatch.parse({protocol:2,id:randomUUID(),clientId,revision:String(revision),catalog:[{...publicProduct,options:publicProduct.options.map(option=>({...option,...(image===undefined?{}:{image})}))}],statuses:[]});
 await bridge.applyDesktopBatch(sql,batch(1),{userId:admin.id});assert.equal(await photo(),cloud,'Old desktop omission must preserve web variant photo');
 await bridge.applyDesktopBatch(sql,batch(2,catalog),{userId:admin.id});assert.equal(await photo(),catalog);
 await bridge.applyDesktopBatch(sql,batch(3,''),{userId:admin.id});assert.equal(await photo(),'');
 await bridge.applyDesktopBatch(sql,batch(4,cloud),{userId:admin.id});assert.equal(await photo(),cloud);
 assert.equal(Number((await sql.unsafe('select cost_price from product_options where id=$1',[option.id]))[0].cost_price),3,'Public publication never overwrites private option cost');
 console.log('PASS: isolated PostgreSQL migration/default, real locked bulk and standalone SQL image preservation/clear, strong administrator authentication and cashier denial, local variant file storage without logo/gallery mutations, older desktop omission preservation and explicit image replacement/clear without private-cost overwrite.');
}finally{
 await sql.end({timeout:2});await database.close();
 for(const [key,value]of [['BIRKASSA_BUNDLED_PG_BIN',previous.bin],['BIRKASSA_LOCAL',previous.local],['BIRKASSA_DATA_DIR',previous.root]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
