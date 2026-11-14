import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHash,scryptSync} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
const root=path.resolve('.local-desktop-data','catalog-only-'+randomUUID()),resources=[],servers=[];
const password='Fixture-Only-Password-04!',setupToken=randomBytes(48).toString('base64url');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(kind,dbPort,port){
 const dataRoot=path.join(root,kind),database=await openLocalDatabase(dataRoot,process.cwd(),{port:dbPort});resources.push(database);
 const sql=postgres(database.url,{max:1,prepare:false});resources.push({close:()=>sql.end({timeout:2})});
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' limit 1"),salt=randomBytes(16).toString('hex');
 await sql.unsafe('update users set pin_hash=$1 where id=$2',[salt+':'+scryptSync('246810',salt,64).toString('hex'),admin.id]);
 const origin='http://127.0.0.1:'+port,pollToken=randomBytes(32).toString('hex'),jar=new Map();
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,DATABASE_URL:database.url,BIRKASSA_LOCAL:kind==='local'?'1':'0',BIRKASSA_ADMIN_SETUP_TOKEN:setupToken,BIRKASSA_DATA_DIR:dataRoot,BIRKASSA_PUBLIC_MEDIA_DIR:path.join(dataRoot,'public-media'),BIRKASSA_DESKTOP_TOKEN:pollToken,VEXIRA_API_KEY:'',NODE_ENV:'production'}});servers.push(server);
 server.stderr.on('data',chunk=>process.stderr.write(kind+': '+chunk));
 let ready=false;for(let n=0;n<90;n++){try{if((await fetch(origin+'/api/auth')).ok){ready=true;break;}}catch{}await sleep(300);}assert.ok(ready,'Server starts');
 async function request(url,{method='GET',body,auth=true,bearer,headers={}}={}){
  const response=await fetch(origin+url,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),Origin:origin,...(auth?{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  const raw=await response.text();return {status:response.status,data:raw?JSON.parse(raw):null,headers:response.headers};
 }
 const login=()=>request('/api/auth',{method:'POST',body:{action:'login',userId:admin.id,password}});
 return {dataRoot,database,sql,admin,request,login,origin,pollToken,jar};
}
function noPrivateFields(value){if(Array.isArray(value)){value.forEach(noPrivateFields);return;}if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assert.ok(!['stock','quantity','warehouse','warehouses','cost','cost_price','min_stock','barcode','pin_hash','password_hash','salary'].includes(key),'Private field must not be transmitted: '+key);noPrivateFields(item);}}
try{
 const web=await start('web',55440,5762),local=await start('local',55441,5763);
 for(const app of [web,local]){
  const state=await app.request('/api/auth');assert.equal(state.data.strongAuth,true);assert.equal(state.data.passwordSetupRequired,true);
  assert.equal((await app.request('/api/auth',{method:'POST',body:{action:'setup-password',userId:app.admin.id,setupToken,pin:'000000',password,confirmPassword:password}})).status,401);
  const enrolled=await app.request('/api/auth',{method:'POST',body:{action:'setup-password',userId:app.admin.id,setupToken,pin:'246810',password,confirmPassword:password}});assert.equal(enrolled.status,200,JSON.stringify(enrolled.data));assert.match(enrolled.headers.get('set-cookie'),/HttpOnly/);assert.match(enrolled.headers.get('set-cookie'),/SameSite=Strict/i);
 }
 assert.equal((await web.request('/api/products')).status,403,'Even a strong web admin cannot access local-only inventory');
 assert.equal((await web.request('/api/finance')).status,403,'Stock-derived aggregate financial records stay local');
 assert.equal((await local.request('/api/products',{auth:false,headers:{'x-birkassa-role':'admin','x-birkassa-user-id':local.admin.id}})).status,401);
 const [manager]=await local.sql.unsafe("insert into users(branch_id,full_name,role) values($1,'Test manager','manager') returning id",[local.admin.branch_id]);
 const fake=randomBytes(32).toString('hex');await local.sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password')",[manager.id,createHash('sha256').update(fake).digest('hex')]);
 assert.equal((await local.request('/api/products',{auth:false,headers:{Cookie:'birkassa_session='+fake}})).status,401,'Only admin can access local stock');
 const token=local.jar.get('birkassa_session'),tokenHash=createHash('sha256').update(token).digest('hex');
 await local.sql.unsafe("update auth_sessions set last_seen_at=now()-interval '11 minutes' where token_hash=$1",[tokenHash]);assert.equal((await local.request('/api/products')).status,401);assert.equal((await local.login()).status,200);
 for(let n=0;n<5;n++)assert.equal((await local.request('/api/auth',{method:'POST',body:{action:'login',userId:local.admin.id,password:'incorrect-password'}})).status,401);
 assert.equal((await local.login()).status,429,'Sixth attempt is rate limited even with the correct password');await local.sql.unsafe('delete from staff_auth_attempts');assert.equal((await local.login()).status,200);
 assert.equal((await local.request('/api/desktop-lock',{method:'POST',auth:false})).status,401);assert.equal((await local.request('/api/desktop-lock',{method:'POST',auth:false,bearer:local.pollToken})).status,200);assert.equal((await local.request('/api/products')).status,401);await local.login();
 const [p]=await local.sql.unsafe("insert into products(sku,name,sale_price,cost_price,min_stock,category) values('PRIVATE-SKU','Masaüstü məhsulu',50,21,9,'Sınaq') returning id");
 const [warehouse]=await local.sql.unsafe('select id from warehouses limit 1');await local.sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,performed_by) values($1,$2,'receipt',3,$3)",[p.id,warehouse.id,local.admin.id]);
 const [option]=await local.sql.unsafe("insert into product_options(product_id,label,size,price) values($1,'Kiçik','S',40) returning id",[p.id]);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfocAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.set('file',new Blob([bytes],{type:'image/png'}),'fixture.png');form.set('productId',p.id);assert.equal((await local.request('/api/store-admin/upload',{method:'POST',body:form})).status,200,'Desktop photos work without cloud credentials');
 const readOnly=(await web.request('/api/desktop-link',{method:'POST',body:{action:'rotate'}})).data.key;
 assert.equal((await web.request('/api/desktop-bridge',{method:'POST',auth:false,bearer:readOnly,body:{}})).status,401);
 const issued=await web.request('/api/desktop-link',{method:'POST',body:{action:'rotate-catalog'}});assert.equal(issued.status,200);const key=issued.data.key;assert.match(key,/^bk_catalog_/);
 assert.equal((await web.request('/api/desktop-feed',{auth:false,bearer:'bk_sync_'+'0'.repeat(64)})).status,401,'Old stock-writing credentials are not accepted');
 await mkdir(path.join(local.dataRoot,'.private'),{recursive:true});await writeFile(path.join(local.dataRoot,'.private','desktop-sync.json'),JSON.stringify({url:web.origin,key}));
 const sync=()=>local.request('/api/desktop-poll',{method:'POST',auth:false,bearer:local.pollToken});
 const published=await sync();assert.equal(published.status,200,JSON.stringify(published.data));
 const [wp]=await web.sql.unsafe('select * from products where sku=$1',['PRIVATE-SKU']);assert.equal(wp.name,'Masaüstü məhsulu');assert.equal(Number(wp.sale_price),50);assert.equal(Number(wp.cost_price),0);assert.equal(Number(wp.min_stock),0);
 assert.equal(Number((await web.sql.unsafe('select count(*) n from stock_movements'))[0].n),0,'No stock is stored on the web');
 const catalogue=await web.request('/api/catalog',{auth:false});assert.equal(catalogue.data.products.length,1,'A product can be ordered without any web stock');noPrivateFields(catalogue.data.products);
 const imageUrl=catalogue.data.products[0].image;assert.match(imageUrl,/^\/api\/catalog-media\//);assert.deepEqual(Buffer.from(await (await fetch(web.origin+imageUrl)).arrayBuffer()),bytes);
 const webEditor=await web.request('/api/store-admin/commerce');assert.ok(!('cost_price' in webEditor.data.products[0]));assert.ok(!('stock' in webEditor.data.products[0]));assert.ok(!('min_stock' in webEditor.data.products[0]));assert.ok(webEditor.data.products[0].options.every(option=>!('cost_price' in option)));
 const customer=await web.request('/api/customer-account',{method:'POST',body:{action:'register',email:'fixture-'+randomUUID()+'@example.test',password:'Fixture-Customer-123!',name:'Hesab sahibi',phone:'+994500000001'}});assert.equal(customer.status,200);
 const customerInfo=(await web.request('/api/customer-account')).data.user;
 const webOption=catalogue.data.products[0].options[0].id;
 const requestKey=randomUUID(),payload={requestKey,expectedTotal:40,fulfillment:'delivery',address:'Bakı, Sınaq küçəsi 10, mənzil 4',name:'Təhvil alan',phone:'+994500000002',note:'Mərtəbə 2',items:[{id:wp.id,optionId:webOption,quantity:1}]};
 assert.equal((await web.request('/api/customer-orders',{method:'POST',body:{...payload,address:''}})).status,400);
 const order=await web.request('/api/customer-orders',{method:'POST',body:payload});assert.equal(order.status,201,JSON.stringify(order.data));assert.equal((await web.request('/api/customer-orders',{method:'POST',body:payload})).data.order_no,order.data.order_no);
 const [remote]=await web.sql.unsafe('select * from sales_orders where order_no=$1',[order.data.order_no]);assert.equal(remote.customer_name_snapshot,'Təhvil alan');assert.equal(remote.customer_phone_snapshot,'+994500000002');
 await web.sql.unsafe("update sales_orders set delivery_fee=7.25,total=47.25,distance_meters=12345,delivery_lat=40.4,delivery_lng=49.8,delivery_pricing='distance' where id=$1",[remote.id]);
 // 105 orders with equal microseconds still paginate without skipping any IDs.
 const extra=[];for(let n=0;n<104;n++){const [row]=await web.sql.unsafe("insert into sales_orders(order_no,customer_id,total,source,updated_at) values($1,$2,40,'catalog','2026-10-24 01:00:00.123456+00') returning id",['FIXTURE-'+n,remote.customer_id]);await web.sql.unsafe('insert into sales_order_items(sales_order_id,product_id,option_id,option_snapshot,quantity,unit_price,line_total) values($1,$2,$3,$4,1,40,40)',[row.id,wp.id,webOption,'Kiçik']);extra.push(row.id);}
 const legacyFirst=await web.request('/api/desktop-feed',{auth:false,bearer:key});assert.equal(legacyFirst.status,200,'Fee-free pages remain compatible with old executables');
 const legacyFeed=await web.request('/api/desktop-feed?after='+encodeURIComponent(legacyFirst.data.next),{auth:false,bearer:key});assert.equal(legacyFeed.status,409,'Old executables must not silently undercharge delivery');assert.ok(!('next' in legacyFeed.data),'Rejected batch cannot advance an old cursor');
 const capability={'X-Restamarket-Delivery':'1'},first=await web.request('/api/desktop-feed',{auth:false,bearer:key,headers:capability}),second=await web.request('/api/desktop-feed?after='+encodeURIComponent(first.data.next),{auth:false,bearer:key,headers:capability});assert.equal(first.data.rows.length,100);assert.equal(second.data.rows.length,5);assert.equal(new Set([...first.data.rows,...second.data.rows].map(r=>r.id)).size,105);
 assert.equal((await sync()).data.received,105);assert.equal((await sync()).data.received,0);
 let inbox=(await local.request('/api/desktop-inbox')).data.rows;const entry=inbox.find(row=>row.remote_id===remote.id||row.payload.id===remote.id);assert.equal(entry.payload.full_name,'Təhvil alan');assert.equal(entry.payload.phone,'+994500000002');assert.equal(entry.payload.delivery_fee,7.25);assert.equal(entry.payload.distance_meters,12345);assert.equal(entry.payload.delivery_pricing,'distance');
 const imported=await local.request('/api/desktop-inbox',{method:'POST',body:{action:'import',id:entry.id}});assert.equal(imported.status,200,JSON.stringify(imported.data));
 const [importedDelivery]=await local.sql.unsafe('select delivery_fee,distance_meters,delivery_lat,delivery_lng,delivery_pricing,total from sales_orders where id=$1',[imported.data.orderId]);assert.equal(Number(importedDelivery.delivery_fee),7.25);assert.equal(Number(importedDelivery.total),47.25);assert.equal(importedDelivery.distance_meters,12345);assert.equal(importedDelivery.delivery_pricing,'distance');
 const stage=stage=>local.request('/api/desktop-inbox',{method:'POST',body:{action:'delivery-stage',id:entry.id,stage}});
 assert.equal((await stage('preparing')).status,200);assert.equal((await stage('ready')).status,200);await sync();
 await local.sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,0)',[local.admin.branch_id,local.admin.id]);
 const sale=await local.request('/api/sales',{method:'POST',body:{paymentMethod:'cash',salesOrderId:imported.data.orderId,items:[{productId:p.id,optionId:option.id,quantity:1}]}});assert.equal(sale.status,201,JSON.stringify(sale.data));assert.equal(sale.data.total,47.25);assert.equal(sale.data.receipt.subtotal,40);assert.equal(sale.data.receipt.deliveryFee,7.25);assert.equal(sale.data.receipt.items.length,1,'Delivery never consumes stock');assert.equal((await sync()).status,200);
 const [paidWeb]=await web.sql.unsafe('select status,delivery_stage from sales_orders where id=$1',[remote.id]);assert.equal(paidWeb.status,'completed');assert.equal(paidWeb.delivery_stage,'ready','Payment must not falsely mark a delivery as delivered');
 assert.equal((await stage('dispatched')).status,200);await sync();assert.equal((await stage('delivered')).status,200);await sync();assert.equal((await web.sql.unsafe('select delivery_stage from sales_orders where id=$1',[remote.id]))[0].delivery_stage,'delivered');
 assert.equal(Number((await local.sql.unsafe('select sum(quantity) n from stock_movements'))[0].n),2);assert.equal(Number((await web.sql.unsafe('select count(*) n from stock_movements'))[0].n),0);assert.equal(Number((await web.sql.unsafe('select count(*) n from sales'))[0].n),0);assert.equal(Number((await web.sql.unsafe('select count(*) n from finance_transactions'))[0].n),0);
 assert.equal((await web.request('/api/online-orders')).data.canManage,true,'Web administrator can manage order stages');
 await web.sql.unsafe('update products set cost_price=23,min_stock=7 where id=$1',[wp.id]);
 // An interrupted publication is retried from durable local storage.
 await local.sql.unsafe("update products set name='Yenilənmiş ad' where id=$1",[p.id]);await web.sql.unsafe("update system_settings set value=$1 where key='desktop_catalog_device'",[randomUUID()]);assert.equal((await sync()).status,502);assert.equal(Number((await local.sql.unsafe('select count(*) n from desktop_sync_outbox where acknowledged_at is null'))[0].n),1);
 await web.sql.unsafe("delete from system_settings where key='desktop_catalog_device'");assert.equal((await sync()).status,200);assert.equal((await web.sql.unsafe('select name from products where id=$1',[wp.id]))[0].name,'Yenilənmiş ad');
 const [sent]=await local.sql.unsafe('select * from desktop_sync_outbox order by revision desc limit 1');noPrivateFields(sent.payload);
 const forbidden={...sent.payload,id:randomUUID(),revision:String(BigInt(sent.revision)+1n),stock:[]};assert.equal((await web.request('/api/desktop-bridge',{method:'POST',auth:false,bearer:key,body:forbidden})).status,400,'Stock fields are rejected by the protocol');
 const stale={...sent.payload,id:randomUUID(),revision:String(sent.revision),catalog:sent.payload.catalog.map(row=>({...row,name:'OLD'}))};assert.equal((await web.request('/api/desktop-bridge',{method:'POST',auth:false,bearer:key,body:stale})).data.stale,true);assert.equal((await web.sql.unsafe('select name from products where id=$1',[wp.id]))[0].name,'Yenilənmiş ad');
 const [webPrivate]=await web.sql.unsafe('select cost_price,min_stock from products where id=$1',[wp.id]);assert.equal(Number(webPrivate.cost_price),23);assert.equal(Number(webPrivate.min_stock),7,'Catalogue publication preserves private web inventory values');
 const [oldName]=await web.sql.unsafe('select product_name_snapshot from sales_order_items where sales_order_id=$1',[remote.id]);assert.equal(oldName.product_name_snapshot,'Masaüstü məhsulu','Past order names are snapshots');
 const closedEntry=inbox.find(row=>row.payload.id===extra[0]);const closedLocal=await local.request('/api/desktop-inbox',{method:'POST',body:{action:'import',id:closedEntry.id}});await web.sql.unsafe("update sales_orders set status='completed',updated_at=now() where id=$1",[extra[0]]);await sync();assert.equal((await local.sql.unsafe('select status from sales_orders where id=$1',[closedLocal.data.orderId]))[0].status,'cancelled');
 const backup=await local.request('/api/system',{method:'POST',body:{action:'backup'}});assert.equal(backup.status,201,JSON.stringify(backup.data));await local.sql.unsafe('delete from product_images');await local.sql.unsafe("update product_options set price=9 where id=$1",[option.id]);
 const restored=await local.request('/api/system',{method:'POST',body:{action:'restore',backupId:backup.data.id,confirm:'BƏRPA'}});assert.equal(restored.status,200,JSON.stringify(restored.data));assert.equal((await local.request('/api/products')).status,401);await local.login();assert.equal(Number((await local.sql.unsafe('select price from product_options where id=$1',[option.id]))[0].price),40);assert.equal(Number((await local.sql.unsafe('select count(*) n from product_images'))[0].n),1);
 assert.equal((await web.request('/api/my-orders')).data.orders.find(row=>row.order_no===order.data.order_no).delivery_stage,'delivered');assert.ok(customerInfo.id);
 console.log('PASS: strong administrator passwords, PIN upgrade, rate limits, idle/process locks, role enforcement, public-only catalogue and photo publication, public stock/cost privacy, price-based orders without inventory, contact snapshots, 105-order pagination, local payment and delivery tracking, durable retries, forbidden-field rejection, stale revisions and full restore.');
 if(process.argv.includes('--serve')){console.log('TEST PREVIEW: '+web.origin+' and '+local.origin);await new Promise(resolve=>{process.once('SIGINT',resolve);process.stdin.once('data',resolve);process.stdin.resume();});}
}finally{for(const server of servers){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),sleep(5000)]);}for(const resource of resources.reverse())await resource.close();process.stdin.pause();}
