import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHash,scryptSync} from 'node:crypto';
import {mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
const fixtureParent=path.resolve('.local-desktop-data'),root=path.join(fixtureParent,'catalog-only-'+randomUUID()),resources=[],servers=[],proxies=[];
const previousBin=process.env.BIRKASSA_PG_BIN,certificate=path.join(root,'fixture-ca.pem'),privateKey=path.join(root,'fixture-key.pem');
let phase='isolated fixture setup',stopped=false;
const password='Fixture-Only-Password-04!',setupToken=randomBytes(48).toString('base64url');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function prepareTLS(){
 await mkdir(root,{recursive:true});
 const bundled='C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
 const openssl=process.platform==='win32'&&await access(bundled).then(()=>true,()=>false)?bundled:'openssl';
 await new Promise((resolve,reject)=>{const child=spawn(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',privateKey,'-out',certificate,'-days','2','-subj','/CN=RestaMarket isolated fixture','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Fixture TLS certificate generation failed: '+code)));});
}
async function secureProxy(target,port){
 const proxy=https.createServer({key:await readFile(privateKey),cert:await readFile(certificate)},(incoming,outgoing)=>{
  const upstream=http.request(new URL(incoming.url,target),{method:incoming.method,headers:{...incoming.headers,host:new URL(target).host}},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
  upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502,{'Content-Type':'application/json'});outgoing.end('{"error":"Fixture upstream unavailable"}');});incoming.pipe(upstream);
 });
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(port,'127.0.0.1',resolve);});proxies.push(proxy);return 'https://127.0.0.1:'+port;
}
async function start(kind,dbPort,port){
 const dataRoot=path.join(root,kind),database=await openLocalDatabase(dataRoot,process.cwd(),{port:dbPort});resources.push(database);
 const sql=postgres(database.url,{max:1,prepare:false});resources.push({close:()=>sql.end({timeout:2})});
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' limit 1"),salt=randomBytes(16).toString('hex');
 await sql.unsafe('update users set pin_hash=$1 where id=$2',[salt+':'+scryptSync('246810',salt,64).toString('hex'),admin.id]);
 const origin='http://127.0.0.1:'+port,pollToken=randomBytes(32).toString('hex'),jar=new Map();
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,DATABASE_URL:database.url,BIRKASSA_LOCAL:kind==='local'?'1':'0',BIRKASSA_ADMIN_SETUP_TOKEN:setupToken,BIRKASSA_DATA_DIR:dataRoot,BIRKASSA_PUBLIC_MEDIA_DIR:path.join(dataRoot,'public-media'),BIRKASSA_DESKTOP_TOKEN:pollToken,VEXIRA_API_KEY:'',NODE_EXTRA_CA_CERTS:certificate,NODE_ENV:'production'}});servers.push(server);
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
 // Trust is scoped to these child servers and this freshly generated local CA.
 // Never disable TLS verification or contact a real storefront/profile.
 await prepareTLS();process.env.BIRKASSA_PG_BIN=path.resolve('desktop/vendor/postgres/bin');assert.equal((await readFile(path.join(process.env.BIRKASSA_PG_BIN,'..','PG_MAJOR'),'utf8')).trim(),'17');
 const web=await start('web',55440,5762),storeOrigin=await secureProxy(web.origin,5764),local=await start('local',55441,5763);
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
 assert.equal((await local.request('/api/desktop-link')).data.configured,false,'A fresh desktop explicitly reports no connection');
 assert.equal((await web.request('/api/desktop-link')).data.configured,false,'A fresh website has no connection key');
 // Pairing bookmarks current rows instead of blindly overwriting a website.
 // Seed before creating fixture products, so these are genuinely NEW local rows.
 const baselineKey='desktop_catalog_baseline:'+createHash('sha256').update(storeOrigin).digest('hex');
 await local.sql.unsafe('insert into system_settings(key,value) values($1,$2)',[baselineKey,JSON.stringify({version:1,products:{}})]);
 const [p]=await local.sql.unsafe("insert into products(sku,name,sale_price,cost_price,min_stock,category) values('PRIVATE-SKU','Masaüstü məhsulu',50,21,9,'Sınaq') returning id");
 const [warehouse]=await local.sql.unsafe('select id from warehouses limit 1');await local.sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,performed_by) values($1,$2,'receipt',3,$3)",[p.id,warehouse.id,local.admin.id]);
 const [option]=await local.sql.unsafe("insert into product_options(product_id,label,size,price) values($1,'Kiçik','S',40) returning id",[p.id]);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfocAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.set('file',new Blob([bytes],{type:'image/png'}),'fixture.png');form.set('productId',p.id);assert.equal((await local.request('/api/store-admin/upload',{method:'POST',body:form})).status,200,'Desktop photos work without cloud credentials');
 const readOnly=(await web.request('/api/desktop-link',{method:'POST',body:{action:'rotate'}})).data.key;
 assert.equal((await web.request('/api/desktop-catalog-feed',{auth:false,bearer:readOnly})).status,401,'Orders-only key cannot export the full public catalogue');
 assert.equal((await web.request('/api/desktop-support-feed',{auth:false,bearer:readOnly})).status,401,'Orders-only key cannot export customer correspondence');
 const ordersConnection=await web.request('/api/desktop-link');assert.equal(ordersConnection.data.mode,'orders');assert.equal(ordersConnection.data.configured,true);assert.ok(!('key' in ordersConnection.data),'Connection status never exposes a stored key');
 assert.equal((await web.request('/api/desktop-bridge',{method:'POST',auth:false,bearer:readOnly,body:{}})).status,401);
 const issued=await web.request('/api/desktop-link',{method:'POST',body:{action:'rotate-catalog'}});assert.equal(issued.status,200);const key=issued.data.key;assert.match(key,/^bk_catalog_/);
 assert.equal((await web.request('/api/desktop-link')).data.mode,'catalog');
 assert.equal((await web.request('/api/desktop-feed',{auth:false,bearer:'bk_sync_'+'0'.repeat(64)})).status,401,'Old stock-writing credentials are not accepted');
 await mkdir(path.join(local.dataRoot,'.private'),{recursive:true});
 assert.equal((await local.request('/api/desktop-link',{method:'POST',body:{url:web.origin,key}})).status,400,'The real pairing API rejects HTTP; the fixture must use its trusted HTTPS proxy');
 await writeFile(path.join(local.dataRoot,'.private','desktop-sync.json'),JSON.stringify({url:storeOrigin,key:readOnly}));
 assert.equal((await local.request('/api/desktop-link')).data.mode,'orders','An orders-only desktop key must not be presented as catalogue publishing');
 await writeFile(path.join(local.dataRoot,'.private','desktop-sync.json'),JSON.stringify({url:storeOrigin,key}));
 const localConnection=await local.request('/api/desktop-link');assert.equal(localConnection.data.mode,'catalog');assert.equal(localConnection.data.configured,true);assert.ok(!('key' in localConnection.data));noPrivateFields(localConnection.data);
 const sync=()=>local.request('/api/desktop-poll',{method:'POST',auth:false,bearer:local.pollToken});
 phase='HTTPS public catalogue publication';
 const published=await sync();assert.equal(published.status,200,JSON.stringify(published.data));assert.ok(!published.data.catalogError,JSON.stringify(published.data));assert.ok(!published.data.supportError,JSON.stringify(published.data));
 const linked=await local.request('/api/desktop-link');assert.equal(linked.data.pending,0);assert.ok(linked.data.lastSync);assert.equal(linked.data.lastError,'');
 const [wp]=await web.sql.unsafe('select * from products where sku=$1',['PRIVATE-SKU']);assert.equal(wp.name,'Masaüstü məhsulu');assert.equal(Number(wp.sale_price),50);assert.equal(Number(wp.cost_price),0);assert.equal(Number(wp.min_stock),0);
 assert.equal(Number((await web.sql.unsafe('select count(*) n from stock_movements'))[0].n),0,'No stock is stored on the web');
 const catalogue=await web.request('/api/catalog',{auth:false});assert.equal(catalogue.data.products.length,1,'A product can be ordered without any web stock');noPrivateFields(catalogue.data.products);
 const imageUrl=catalogue.data.products[0].image;assert.match(imageUrl,/^\/api\/catalog-media\//);assert.deepEqual(Buffer.from(await (await fetch(web.origin+imageUrl)).arrayBuffer()),bytes);
 const webEditor=await web.request('/api/store-admin/commerce');assert.ok(!('cost_price' in webEditor.data.products[0]));assert.ok(!('stock' in webEditor.data.products[0]));assert.ok(!('min_stock' in webEditor.data.products[0]));assert.ok(webEditor.data.products[0].options.every(option=>!('cost_price' in option)));
 const customer=await web.request('/api/customer-account',{method:'POST',body:{action:'register',email:'fixture-'+randomUUID()+'@example.test',password:'Fixture-Customer-123!',name:'Hesab sahibi',phone:'+994500000001'}});assert.equal(customer.status,200);
 const customerInfo=(await web.request('/api/customer-account')).data.user;
 phase='website support mirror, no read acknowledgement and role boundaries';
 const ticketSubject='Fixture website support';
 assert.equal((await web.request('/api/account-chat',{method:'POST',body:{action:'create',subject:ticketSubject,kind:'problem',message:'Sifariş üçün ölçü və təhvil məlumatını dəqiqləşdirin.'}})).status,200);
 const ticket=(await web.request('/api/account-chat')).data.tickets.find(row=>row.subject===ticketSubject);assert.ok(ticket?.id);
 assert.equal((await local.request('/api/desktop-web-support',{auth:false,headers:{'x-birkassa-role':'admin','x-birkassa-user-id':local.admin.id}})).status,401,'A forged staff header cannot expose correspondence');
 const supportPull=await sync();assert.equal(supportPull.status,200,JSON.stringify(supportPull.data));assert.equal(supportPull.data.supportReceived,1);assert.ok(!supportPull.data.supportError,JSON.stringify(supportPull.data));
 const supportSummary=await local.request('/api/desktop-web-support?summary=1');assert.equal(supportSummary.status,200);assert.deepEqual(supportSummary.data.attention,{total:1,unread:1,unanswered:1});
 let mirroredTicket=await local.request('/api/desktop-web-support?ticket='+ticket.id);assert.equal(mirroredTicket.status,200);assert.equal(mirroredTicket.data.complete,true);assert.equal(mirroredTicket.data.messages.length,1);assert.equal(mirroredTicket.data.messages[0].body,'Sifariş üçün ölçü və təhvil məlumatını dəqiqləşdirin.');
 assert.equal(Number((await web.sql.unsafe('select staff_read_revision from support_tickets where id=$1',[ticket.id]))[0].staff_read_revision),0,'Viewing the local mirror never acknowledges the website ticket');
 assert.equal(Number((await local.sql.unsafe('select count(*) n from customer_accounts'))[0].n),0,'Mirroring support never copies customer accounts or password hashes');
 const managerSalt=randomBytes(16).toString('hex');await local.sql.unsafe('update users set password_hash=$1 where id=$2',[managerSalt+':'+scryptSync(password,managerSalt,64).toString('hex'),manager.id]);
 await local.sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password') on conflict(token_hash) do update set expires_at=excluded.expires_at,last_seen_at=now(),authentication_method='password'",[manager.id,createHash('sha256').update(fake).digest('hex')]);
 assert.equal((await local.request('/api/desktop-web-support',{auth:false,headers:{Cookie:'birkassa_session='+fake}})).status,200,'A properly authenticated manager can read the support mirror');
 assert.equal((await local.request('/api/desktop-web-support',{method:'POST',auth:false,headers:{Cookie:'birkassa_session='+fake},body:{action:'reply',ticketId:ticket.id,message:'Must not send from the read-only mirror'}})).status,403,'The support mirror has no remote-reply write authority');
 const cashierSalt=randomBytes(16).toString('hex'),[cashier]=await local.sql.unsafe("insert into users(branch_id,full_name,role,password_hash) values($1,'Fixture cashier','cashier',$2) returning id",[local.admin.branch_id,cashierSalt+':'+scryptSync(password,cashierSalt,64).toString('hex')]),cashierToken=randomBytes(32).toString('hex');
 await local.sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,now()+interval '1 hour','password')",[cashier.id,createHash('sha256').update(cashierToken).digest('hex')]);
 const cashierHeaders={Cookie:'birkassa_session='+cashierToken};
 assert.equal((await local.request('/api/desktop-web-support',{auth:false,headers:cashierHeaders})).status,403,'Cashiers cannot read customer support correspondence');
 assert.equal((await local.request('/api/desktop-inbox',{auth:false,headers:cashierHeaders})).status,200,'Cashiers can access incoming web orders');
 assert.equal((await local.request('/api/desktop-link',{method:'POST',auth:false,headers:cashierHeaders,body:{action:'disconnect'}})).status,403,'A cashier cannot change pairing credentials');
 assert.equal((await web.request('/api/store-admin/chat',{method:'POST',body:{action:'reply',ticketId:ticket.id,message:'Ölçü təsdiqləndi; sifariş barədə məlumat hesabınızda görünür.'}})).status,200);await sync();
 mirroredTicket=await local.request('/api/desktop-web-support?ticket='+ticket.id);assert.equal(mirroredTicket.data.complete,true);assert.equal(mirroredTicket.data.messages.length,2);assert.equal(mirroredTicket.data.ticket.unanswered,false);assert.equal(mirroredTicket.data.messages.at(-1).sender,'staff');
 const webTicket=(await web.request('/api/store-admin/chat?ticket='+ticket.id)).data.ticket;
 assert.equal((await web.request('/api/store-admin/chat',{method:'POST',body:{action:'read',ticketId:ticket.id,customerRevision:webTicket.customerRevision}})).status,200);await sync();assert.equal((await local.request('/api/desktop-web-support?ticket='+ticket.id)).data.ticket.unread,false,'Round-robin metadata scan observes read changes even without an updated_at mutation');
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
 phase='automatic order import and unchanged stock';
 const pulled=await sync();assert.equal(pulled.status,200,JSON.stringify(pulled.data));assert.equal(pulled.data.received,105);assert.equal(pulled.data.imported,105,JSON.stringify(pulled.data));assert.equal(pulled.data.unresolved,0);assert.equal((await sync()).data.received,0);
 assert.equal(Number((await local.sql.unsafe('select count(*) n from sales'))[0].n),0,'Import does not create receipts');assert.equal(Number((await local.sql.unsafe('select sum(quantity) n from stock_movements'))[0].n),3,'Import does not decrement stock');
 let inbox=(await local.request('/api/desktop-inbox')).data.rows;const entry=inbox.find(row=>row.remote_id===remote.id||row.payload.id===remote.id);assert.equal(entry.payload.full_name,'Təhvil alan');assert.equal(entry.payload.phone,'+994500000002');assert.equal(entry.payload.delivery_fee,7.25);assert.equal(entry.payload.distance_meters,12345);assert.equal(entry.payload.delivery_pricing,'distance');
 assert.ok(entry.local_order_id,'New web orders are already available in POS without an administrator import');assert.ok(inbox.every(row=>row.local_order_id),'Every resolvable order is imported automatically');
 const imported=await local.request('/api/desktop-inbox',{method:'POST',body:{action:'import',id:entry.id}});assert.equal(imported.status,200,JSON.stringify(imported.data));assert.equal(imported.data.orderId,entry.local_order_id);assert.equal(imported.data.imported,false,'Manual retry after automatic import is idempotent');
 const [importedDelivery]=await local.sql.unsafe('select delivery_fee,distance_meters,delivery_lat,delivery_lng,delivery_pricing,total from sales_orders where id=$1',[imported.data.orderId]);assert.equal(Number(importedDelivery.delivery_fee),7.25);assert.equal(Number(importedDelivery.total),47.25);assert.equal(importedDelivery.distance_meters,12345);assert.equal(importedDelivery.delivery_pricing,'distance');
 const stage=stage=>local.request('/api/desktop-inbox',{method:'POST',body:{action:'delivery-stage',id:entry.id,stage}});
 assert.equal((await stage('preparing')).status,200);assert.equal((await stage('ready')).status,200);await sync();
 await local.sql.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash) values($1,$2,0)',[local.admin.branch_id,local.admin.id]);
 const saleBody={paymentMethod:'cash',salesOrderId:imported.data.orderId,items:[{productId:p.id,optionId:option.id,quantity:1}]};
 assert.equal((await local.request('/api/sales',{method:'POST',body:saleBody})).status,409,'Web POS requires an explicit expected total');
 assert.equal((await local.request('/api/sales',{method:'POST',body:{...saleBody,expectedTotal:40}})).status,409,'A stale POS total must not silently charge changed delivery');
 assert.equal(Number((await local.sql.unsafe('select count(*) n from sales'))[0].n),0,'Rejected stale payment creates no receipt');
 const sale=await local.request('/api/sales',{method:'POST',body:{...saleBody,expectedTotal:47.25}});assert.equal(sale.status,201,JSON.stringify(sale.data));assert.equal(sale.data.total,47.25);assert.equal(sale.data.receipt.subtotal,40);assert.equal(sale.data.receipt.deliveryFee,7.25);assert.equal(sale.data.receipt.items.length,1,'Delivery never consumes stock');assert.equal((await sync()).status,200);
 const [paidWeb]=await web.sql.unsafe('select status,delivery_stage from sales_orders where id=$1',[remote.id]);assert.equal(paidWeb.status,'completed');assert.equal(paidWeb.delivery_stage,'ready','Payment must not falsely mark a delivery as delivered');
 assert.equal((await stage('dispatched')).status,200);await sync();assert.equal((await stage('delivered')).status,200);await sync();assert.equal((await web.sql.unsafe('select delivery_stage from sales_orders where id=$1',[remote.id]))[0].delivery_stage,'delivered');
 assert.equal(Number((await local.sql.unsafe('select sum(quantity) n from stock_movements'))[0].n),2);assert.equal(Number((await web.sql.unsafe('select count(*) n from stock_movements'))[0].n),0);assert.equal(Number((await web.sql.unsafe('select count(*) n from sales'))[0].n),0);assert.equal(Number((await web.sql.unsafe('select count(*) n from finance_transactions'))[0].n),0);
 assert.equal((await web.request('/api/online-orders')).data.canManage,true,'Web administrator can manage order stages');
 await web.sql.unsafe('update products set cost_price=23,min_stock=7 where id=$1',[wp.id]);
 // Editing the actual desktop form endpoint publishes choices and photos,
 // while unrelated web merchandising survives an incremental publication.
 const uploadVariant=async suffix=>{const imageBytes=Buffer.concat([bytes,Buffer.from(suffix)]),body=new FormData();body.set('file',new Blob([imageBytes],{type:'image/png'}),'variant.png');body.set('purpose','variant');const result=await local.request('/api/store-admin/upload',{method:'POST',body});assert.equal(result.status,200,JSON.stringify(result.data));return {url:result.data.url,bytes:imageBytes};};
 const firstVariantImage=await uploadVariant('first variant fixture');
 const keepOption={id:option.id,label:'Kiçik',size:'S',price:40,is_active:true};
 const localVariant={label:'Orta',size:'40 sm',color:'Mavi',kind:'Polad',price:55,cost_price:17,image_url:firstVariantImage.url,is_active:true,attributes:{Qalınlıq:'2 mm'}};
 const saveOptions=options=>local.request('/api/products',{method:'PATCH',body:{productId:p.id,name:'Masaüstü məhsulu',sku:'PRIVATE-SKU',category:'Sınaq',salePrice:50,costPrice:21,minStock:9,options}});
 const addedVariant=await saveOptions([keepOption,localVariant]);assert.equal(addedVariant.status,200,JSON.stringify(addedVariant.data));assert.equal((await sync()).status,200);
 const initialVariant=(await web.request('/api/catalog',{auth:false})).data.products.find(row=>row.id===wp.id).options.find(row=>row.label==='Orta');assert.equal(initialVariant.size,'40 sm');assert.equal(initialVariant.color,'Mavi');assert.equal(initialVariant.price,55);assert.deepEqual(Buffer.from(await (await fetch(web.origin+initialVariant.image)).arrayBuffer()),firstVariantImage.bytes);
 const [secondary]=await local.sql.unsafe("insert into products(sku,name,sale_price,cost_price,category) values('SECOND-SKU','İkinci məhsul',12,6,'Yerli kateqoriya') returning id");assert.equal((await sync()).status,200);
 await web.sql.unsafe("update products set category='Vebdə seçilmiş kateqoriya' where id=$1",[secondary.id]);
 const webOnlyImage=initialVariant.image;
 const [webOnlyPhoto]=await web.sql.unsafe('insert into product_images(product_id,image_url,position) values($1,$2,7) returning id',[wp.id,webOnlyImage]);
 const [webOnlyOption]=await web.sql.unsafe("insert into product_options(product_id,label,size,color,price,image_url,position) values($1,'Yalnız veb','60 sm','Ağ',77,$2,9) returning id",[wp.id,webOnlyImage]);
 const changedVariantImage=await uploadVariant('changed variant fixture');
 const changedVariant=await saveOptions([keepOption,{...localVariant,size:'50 sm',color:'Qırmızı',price:57,image_url:changedVariantImage.url,attributes:{Qalınlıq:'3 mm'}}]);assert.equal(changedVariant.status,200,JSON.stringify(changedVariant.data));assert.equal((await sync()).status,200);
 const updatedProduct=(await web.request('/api/catalog',{auth:false})).data.products.find(row=>row.id===wp.id);noPrivateFields(updatedProduct);
 const updatedVariant=updatedProduct.options.find(row=>row.label==='Orta');assert.equal(updatedVariant.size,'50 sm');assert.equal(updatedVariant.color,'Qırmızı');assert.equal(updatedVariant.price,57);assert.equal(updatedVariant.attributes.Qalınlıq,'3 mm');assert.deepEqual(Buffer.from(await (await fetch(web.origin+updatedVariant.image)).arrayBuffer()),changedVariantImage.bytes);
 assert.ok(updatedProduct.images.includes(webOnlyImage),'Desktop option edits preserve a web-only gallery photo');assert.ok(updatedProduct.options.some(row=>row.id===webOnlyOption.id&&row.price===77&&row.image===webOnlyImage),'A third, web-only option stays active with its own photo and price');
 assert.equal((await web.sql.unsafe('select id from product_images where id=$1',[webOnlyPhoto.id]))[0].id,webOnlyPhoto.id,'Surviving web gallery photo keeps its ID');
 assert.equal((await web.sql.unsafe('select category from products where id=$1',[secondary.id]))[0].category,'Vebdə seçilmiş kateqoriya','Editing one desktop product must not undo another product category curated on the website');
 // Web-only inactive state must not be reversed by a local photo change.
 await web.sql.unsafe('update products set is_active=false where id=$1',[wp.id]);
 const gallery=new FormData();gallery.set('file',new Blob([changedVariantImage.bytes],{type:'image/png'}),'gallery.png');gallery.set('productId',p.id);assert.equal((await local.request('/api/store-admin/upload',{method:'POST',body:gallery})).status,200);assert.equal((await sync()).status,200);
 assert.equal((await web.sql.unsafe('select is_active from products where id=$1',[wp.id]))[0].is_active,false,'A photo-only desktop edit never reactivates a web-disabled product');
 assert.ok((await web.sql.unsafe('select id from product_images where id=$1',[webOnlyPhoto.id])).length,'Gallery merge preserves the unrelated web photo');
 // An interrupted publication is retried from durable local storage.
 phase='durable publication retry does not invalidate received orders';
 await local.sql.unsafe("update products set name='Yenilənmiş ad' where id=$1",[p.id]);await web.sql.unsafe("update system_settings set value=$1 where key='desktop_catalog_device'",[randomUUID()]);const deferred=await sync();assert.equal(deferred.status,200,JSON.stringify(deferred.data));assert.ok(deferred.data.publicationError,'Successful order polling returns publicationError instead of a misleading whole-sync 502');assert.equal(Number((await local.sql.unsafe('select count(*) n from desktop_sync_outbox where acknowledged_at is null'))[0].n),1);assert.equal((await local.request('/api/desktop-web-support?summary=1')).data.attention.total,1,'Publication failure does not erase mirrored support');
 await web.sql.unsafe("delete from system_settings where key='desktop_catalog_device'");assert.equal((await sync()).status,200);assert.equal((await web.sql.unsafe('select name from products where id=$1',[wp.id]))[0].name,'Yenilənmiş ad');
 const [sent]=await local.sql.unsafe('select * from desktop_sync_outbox order by revision desc limit 1');noPrivateFields(sent.payload);
 const {localCatalog,...wirePayload}=sent.payload;assert.ok(Array.isArray(localCatalog),'Durable outbox retains raw public rows for exact acknowledgement');assert.ok(!('localCatalog' in wirePayload),'Local acknowledgement metadata is never transmitted');
 const forbidden={...wirePayload,id:randomUUID(),revision:String(BigInt(sent.revision)+1n),stock:[]};assert.equal((await web.request('/api/desktop-bridge',{method:'POST',auth:false,bearer:key,body:forbidden})).status,400,'Stock fields are rejected by the protocol');
 assert.equal((await web.request('/api/desktop-bridge',{method:'POST',auth:false,bearer:key,body:{...wirePayload,localCatalog,id:randomUUID(),revision:String(BigInt(sent.revision)+1n)}})).status,400,'Local baseline metadata is not part of the public wire protocol');
 const stale={...wirePayload,id:randomUUID(),revision:String(sent.revision),catalog:wirePayload.catalog.map(row=>({...row,name:'OLD'}))};assert.equal((await web.request('/api/desktop-bridge',{method:'POST',auth:false,bearer:key,body:stale})).data.stale,true);assert.equal((await web.sql.unsafe('select name from products where id=$1',[wp.id]))[0].name,'Yenilənmiş ad');
 const [webPrivate]=await web.sql.unsafe('select cost_price,min_stock from products where id=$1',[wp.id]);assert.equal(Number(webPrivate.cost_price),23);assert.equal(Number(webPrivate.min_stock),7,'Catalogue publication preserves private web inventory values');
 const [oldName]=await web.sql.unsafe('select product_name_snapshot from sales_order_items where sales_order_id=$1',[remote.id]);assert.equal(oldName.product_name_snapshot,'Masaüstü məhsulu','Past order names are snapshots');
 const closedEntry=inbox.find(row=>row.payload.id===extra[0]);const closedLocal=await local.request('/api/desktop-inbox',{method:'POST',body:{action:'import',id:closedEntry.id}});await web.sql.unsafe("update sales_orders set status='completed',updated_at=now() where id=$1",[extra[0]]);await sync();assert.equal((await local.sql.unsafe('select status from sales_orders where id=$1',[closedLocal.data.orderId]))[0].status,'cancelled');
 await local.sql.unsafe("update products set sku='RENAMED-SKU' where id=$1",[p.id]);assert.equal((await sync()).status,200);
 const renamed=await web.sql.unsafe("select id,sku,is_active from products where id=$1 or sku in ('PRIVATE-SKU','RENAMED-SKU')",[wp.id]);assert.equal(renamed.length,1,'SKU rename must never duplicate the product');assert.equal(renamed[0].id,wp.id,'SKU rename preserves the stable product ID');assert.equal(renamed[0].sku,'RENAMED-SKU');assert.equal(renamed[0].is_active,false,'SKU edits also preserve web-only disabled state');
 const expectedImageCount=Number((await local.sql.unsafe('select count(*) n from product_images'))[0].n);
 const backup=await local.request('/api/system',{method:'POST',body:{action:'backup'}});assert.equal(backup.status,201,JSON.stringify(backup.data));await local.sql.unsafe('delete from product_images');await local.sql.unsafe("update product_options set price=9 where id=$1",[option.id]);
 const restored=await local.request('/api/system',{method:'POST',body:{action:'restore',backupId:backup.data.id,confirm:'BƏRPA'}});assert.equal(restored.status,200,JSON.stringify(restored.data));assert.equal((await local.request('/api/products')).status,401);await local.login();assert.equal(Number((await local.sql.unsafe('select price from product_options where id=$1',[option.id]))[0].price),40);assert.equal(Number((await local.sql.unsafe('select count(*) n from product_images'))[0].n),expectedImageCount);
 assert.equal((await web.request('/api/my-orders')).data.orders.find(row=>row.order_no===order.data.order_no).delivery_stage,'delivered');assert.ok(customerInfo.id);
 console.log('PASS: verified fixture-only HTTPS pairing transport, strong staff auth, connection modes/key privacy, public-only incremental catalogue publication and inbound merge, size-colour-price-photo options, preservation of web-only merchandising/private inventory, 105-order pagination and automatic unpaid imports, stale POS total rejection, local payment/delivery tracking, independent publicationError reporting/durable retry, forbidden fields/stale revisions and full restore.');
 if(process.argv.includes('--serve')){console.log('TEST PREVIEW: '+web.origin+' and '+local.origin);await new Promise(resolve=>{process.once('SIGINT',resolve);process.stdin.once('data',resolve);process.stdin.resume();});}
}catch(error){console.error('Desktop sync fixture phase: '+phase);throw error;}
finally{
 for(const server of servers){if(server.exitCode!==null||server.signalCode!==null)continue;const ended=new Promise(resolve=>server.once('exit',resolve));server.kill();await Promise.race([ended,sleep(5000)]);}
 for(const proxy of proxies){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
 for(const resource of resources.reverse())await resource.close();stopped=true;process.stdin.pause();
 if(previousBin===undefined)delete process.env.BIRKASSA_PG_BIN;else process.env.BIRKASSA_PG_BIN=previousBin;
 if(!stopped||path.dirname(path.resolve(root))!==fixtureParent||!/^catalog-only-[a-f0-9-]{36}$/.test(path.basename(root)))throw Error('Unsafe fixture cleanup refused');
 await rm(root,{recursive:true,force:true});
}
