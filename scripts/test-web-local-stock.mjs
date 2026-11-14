import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';
import path from 'node:path';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
import {writeVariantImageFixtures} from './variant-image-fixture.mjs';
import {verifyStaffPortalHttp} from './test-staff-portal.mjs';

// Only disposable loopback databases. Never use DATABASE_URL or live accounts.
const resources=[],servers=[],password='Fixture-Local-Stock-06!';
const base=path.resolve('.local-desktop-data','web-local-stock-'+randomUUID());
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(kind,dbPort,port){
 const dataRoot=path.join(base,kind),db=await openLocalDatabase(dataRoot,process.cwd(),{port:dbPort});resources.push(db);
 const sql=postgres(db.url,{max:1,prepare:false});resources.push({close:()=>sql.end({timeout:2})});
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' limit 1"),salt=randomBytes(16).toString('hex');
 await sql.unsafe('update users set pin_hash=$1 where id=$2',[salt+':'+scryptSync('246810',salt,64).toString('hex'),admin.id]);
 const mediaRoot=path.join(dataRoot,'fixture-media'),photos=await writeVariantImageFixtures(mediaRoot);
 const origin='http://127.0.0.1:'+port,jar=new Map(),setupToken=randomBytes(48).toString('base64url');
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,DATABASE_URL:db.url,BIRKASSA_LOCAL:kind==='local'?'1':'0',BIRKASSA_ADMIN_SETUP_TOKEN:setupToken,BIRKASSA_DATA_DIR:dataRoot,BIRKASSA_PUBLIC_MEDIA_DIR:mediaRoot,NODE_ENV:'production',SMTP_HOST:'',SMTP_PASSWORD:''}});servers.push(server);
 server.stderr.on('data',chunk=>process.stderr.write(kind+': '+chunk));
 async function request(url,{method='GET',body,auth=true,headers={}}={}){
  const response=await fetch(origin+url,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:[...jar].map(([key,value])=>key+'='+value).join('; ')}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],split=pair.indexOf('=');jar.set(pair.slice(0,split),pair.slice(split+1));}
  const text=await response.text();return {status:response.status,data:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text,headers:response.headers};
 }
 let ready=false;for(let index=0;index<100;index++){try{if((await request('/api/auth')).status===200){ready=true;break;}}catch{}if(server.exitCode!==null)break;await delay(300);}assert.ok(ready,kind+' fixture server starts');
 const login=()=>request('/api/auth',{method:'POST',body:{action:'login',userId:admin.id,password}});
 const enrollment={action:'setup-password',userId:admin.id,pin:'246810',password,confirmPassword:password};
 if(kind==='web')assert.equal((await request('/api/auth',{method:'POST',body:enrollment})).status,401,'PIN cannot bypass the private web setup key');
 assert.equal((await request('/api/auth',{method:'POST',body:{...enrollment,setupToken,pin:'000000'}})).status,401,'Existing PIN still needs explicit verification');
 assert.equal((await request('/api/auth',{method:'POST',body:{...enrollment,setupToken}})).status,200,'Strong password enrollment works in the intended runtime');
 const signed=await login();assert.equal(signed.status,200,JSON.stringify(signed.data));assert.equal(signed.data.local,kind==='local');
 return {kind,dataRoot,sql,admin,origin,jar,photos,request,login};
}
const deniedPaths=['/api/products','/api/dashboard','/api/warehouses','/api/stock/receipts','/api/stock/transfers','/api/stock/adjustments','/api/inventory-counts','/api/purchase-orders','/api/suppliers','/api/sales','/api/shifts','/api/orders','/api/pos-options','/api/returns','/api/finance','/api/reports','/api/audit','/api/system?view=dump','/api/system?view=backups'];
function noStockFields(value){
 if(Array.isArray(value)){value.forEach(noStockFields);return;}
 if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assert.ok(!['stock','cost','cost_price','min_stock','min','unit_cost','warehouse_id','location','barcode','price_history'].includes(key),'Web product DTO must omit '+key);noStockFields(item);}
}
const oldProduct={action:'product',name:'Kompüter stoku sınağı',sku:'LOCAL-ONLY-FIXTURE',category:'Sınaq məhsulları',unit:'ədəd',sale_price:40,description:'İzolə edilmiş sınaq',specifications:'Material: Dəmir',discount_price:null,is_active:true};
try{
 const web=await start('web',55451,5767),local=await start('local',55452,5769);
 const [legacy]=await web.sql.unsafe("insert into products(sku,name,sale_price,cost_price,min_stock) values('LEGACY-PRIVATE','Əvvəlki stok sınağı',40,14.25,9) returning id");
 const [warehouse]=await web.sql.unsafe('select id from warehouses limit 1');
 await web.sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by) values($1,$2,'receipt',103.25,14.25,$3)",[legacy.id,warehouse.id,web.admin.id]);
 const [legacyOption]=await web.sql.unsafe("insert into product_options(product_id,label,size,color,price,cost_price,image_url) values($1,'40 · Qırmızı','40','Qırmızı',40,12.5,$2) returning id",[legacy.id,web.photos.red]);
 const privateState=async()=>({movements:await web.sql.unsafe('select * from stock_movements order by id'),inventory:await web.sql.unsafe('select * from inventory_counts order by id'),sales:await web.sql.unsafe('select * from sales order by id'),finance:await web.sql.unsafe('select * from finance_transactions order by id'),cost:await web.sql.unsafe('select cost_price,min_stock from products where id=$1',[legacy.id]),optionCost:await web.sql.unsafe('select cost_price from product_options where id=$1',[legacyOption.id])});
 const before=await privateState();
 for(const url of deniedPaths){
  assert.equal((await web.request(url,{auth:false})).status,401,'Anonymous authentication remains first: '+url);
  for(const method of ['GET','POST']){const denied=await web.request(url,{method,...(method==='POST'?{body:{local:true,BIRKASSA_LOCAL:'1',action:'backup',quantity:999}}:{})});assert.equal(denied.status,403,'Web inventory is unavailable: '+method+' '+url);if(method==='GET')assert.equal(denied.data.code,'INVENTORY_LOCAL_ONLY',url);if(denied.data.code==='INVENTORY_LOCAL_ONLY')assert.match(denied.headers.get('cache-control'),/no-store/,url);}
 }
 for(const headers of [{'x-birkassa-local':'1'},{'x-birkassa-user-id':web.admin.id,'x-birkassa-role':'admin'},{'BIRKASSA_LOCAL':'1'}])assert.equal((await web.request('/api/products?local=1&desktop=1',{headers})).status,403,'Caller cannot enable local inventory');
 for(const [url,body]of [['/api/settings',{action:'warehouse',name:'Qadağan',code:'BAD'}],['/api/settings',{action:'rules',lowStockAlert:true}],['/api/locations',{action:'warehouse',branchId:web.admin.branch_id,name:'Qadağan',code:'BAD'}],['/api/locations',{action:'assign',userId:web.admin.id,warehouseId:warehouse.id,branchId:web.admin.branch_id}]])assert.equal((await web.request(url,{method:'POST',body})).status,403,'No indirect inventory setting writes');
 assert.deepEqual(await privateState(),before,'Rejected web operations never alter historical stock/cost/sales/finance');
 let cms=await web.request('/api/store-admin/commerce');assert.equal(cms.status,200);assert.equal(cms.data.local,false);assert.equal(cms.data.canManageProducts,true);noStockFields(cms.data.products);
 for(const url of ['/api/settings','/api/locations','/api/employees','/api/admin/delivery','/api/admin/smtp','/api/store-admin/chat?view=summary'])assert.equal((await web.request(url)).status,200,'Web management still works: '+url);
 assert.equal((await web.request('/api/settings')).data.rules,null);
 const [barcodeBefore]=await web.sql.unsafe('select count(*)::int n from product_barcodes where product_id=$1',[legacy.id]);
 const legacyBody={...oldProduct,id:legacy.id,sku:'LEGACY-PRIVATE',name:'Kataloq redaktəsi saxlanıldı',cost_price:999999,min_stock:999,stock:999,barcode:'FORBIDDEN-WEB-BARCODE',options:[{id:legacyOption.id,label:'40 · Qırmızı',size:'40',color:'Qırmızı',kind:'Dəmir',price:42,cost_price:999999,position:0,is_active:true,image_url:web.photos.black,attributes:{'Qalınlıq':'2 mm'}}]};
 assert.equal((await web.request('/api/store-admin/commerce',{method:'POST',body:legacyBody})).status,200,'Web public editing and variant photos still save');
 assert.deepEqual(await privateState(),before,'Web product edit preserves old private costs and stock');
 const [barcodeAfter]=await web.sql.unsafe('select count(*)::int n from product_barcodes where product_id=$1',[legacy.id]);assert.equal(barcodeAfter.n,barcodeBefore.n,'Web does not create inventory barcodes');
 const [savedPhoto]=await web.sql.unsafe('select image_url,price from product_options where id=$1',[legacyOption.id]);assert.equal(savedPhoto.image_url,web.photos.black);assert.equal(Number(savedPhoto.price),42);
 const audits=await web.sql.unsafe("select after_json from audit_logs where entity_id=$1 and action like 'commerce.%'",[legacy.id]);for(const row of audits)noStockFields(JSON.parse(row.after_json));
 const created=await web.request('/api/store-admin/commerce',{method:'POST',body:{...oldProduct,cost_price:9876,stock:999,options:[{label:'30 · Qırmızı',size:'30',color:'Qırmızı',kind:'',price:30,cost_price:7654,image_url:web.photos.red,is_active:true,position:0,attributes:{}}]}});assert.equal(created.status,200,JSON.stringify(created.data));
 const [newProduct]=await web.sql.unsafe('select id,cost_price,min_stock from products where sku=$1',[oldProduct.sku]);assert.equal(Number(newProduct.cost_price),0);assert.equal(Number(newProduct.min_stock),0);
 const [newOption]=await web.sql.unsafe('select id,cost_price from product_options where product_id=$1',[newProduct.id]);assert.equal(newOption.cost_price,null,'Web variant does not save submitted private costs');
 cms=await web.request('/api/store-admin/commerce');noStockFields(cms.data.products);
 const catalog=await web.request('/api/catalog',{auth:false});assert.equal(catalog.status,200);noStockFields(catalog.data.products);assert.ok(catalog.data.products.some(p=>p.id===newProduct.id));
 const customer=await web.request('/api/customer-account',{method:'POST',body:{action:'register',email:'local-stock-'+randomUUID()+'@example.test',password,name:'Sınaq müştərisi',phone:'+994501234567'}});assert.equal(customer.status,200,JSON.stringify(customer.data));
 const orderBody={requestKey:randomUUID(),expectedTotal:30,fulfillment:'pickup',address:'',name:'Sınaq müştərisi',phone:'+994501234567',note:'',items:[{id:newProduct.id,optionId:newOption.id,quantity:1}]};
 const order=await web.request('/api/customer-orders',{method:'POST',body:orderBody});assert.equal(order.status,201,JSON.stringify(order.data));assert.equal((await web.request('/api/customer-orders',{method:'POST',body:orderBody})).data.order_no,order.data.order_no);
 assert.ok((await web.request('/api/my-orders')).data.orders.some(row=>row.order_no===order.data.order_no));
 assert.deepEqual(await privateState(),before,'Online checkout without web stock does not create inventory/payment records');
 assert.equal((await web.request('/api/online-orders')).status,200);
 await verifyStaffPortalHttp({origin:web.origin,request:web.request,sql:web.sql,admin:web.admin,adminSession:web.jar.get('birkassa_session'),password,inventoryLocal:false,setSession:value=>web.jar.set('birkassa_session',value)});
 // A genuinely separate local database keeps the full inventory/POS contract.
 assert.equal((await local.request('/api/store-admin/commerce',{method:'POST',body:{...oldProduct,cost_price:14.25}})).status,200);
 const [lp]=await local.sql.unsafe('select id from products where sku=$1',[oldProduct.sku]);
 assert.equal((await local.request('/api/stock/receipts',{method:'POST',body:{productId:lp.id,quantity:5,unitCost:14.25}})).status,201);
 assert.equal((await local.request('/api/shifts',{method:'POST',body:{action:'open',openingCash:0}})).status,201);
 const sale=await local.request('/api/sales',{method:'POST',body:{paymentMethod:'cash',buyerName:'Sınaq alıcısı',items:[{productId:lp.id,quantity:2}]}});assert.equal(sale.status,201,JSON.stringify(sale.data));assert.equal(sale.data.total,80);
 const product=(await local.request('/api/products')).data.find(p=>p.id===lp.id);assert.equal(product.stock,3);assert.equal(product.cost,14.25);
 assert.equal((await local.request('/api/dashboard')).status,200);assert.equal((await local.request('/api/finance')).status,200);
 console.log('PASS: web inventory/POS/aggregate APIs blocked after authentication, header/query spoofing denied, no indirect settings writes, safe CMS DTOs and public-field-only editing, historical private data unchanged, customer checkout without stock, local-only receipt/POS and separate stock decrement.');
 if(process.argv.includes('--serve')){console.log('LOCAL-STOCK UI FIXTURES: '+web.origin+' (web), '+local.origin+' (desktop); isolated staff password: '+password);await new Promise(resolve=>{process.once('SIGINT',resolve);process.stdin.once('data',resolve);process.stdin.resume();});process.stdin.pause();}
}finally{
 for(const server of servers){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await Promise.race([stopped,delay(5000)]);}
 for(const resource of resources.reverse())await resource.close();
 process.stdin.pause();
}
