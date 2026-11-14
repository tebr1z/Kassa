import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHash,scryptSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import ts from 'typescript';
import http from 'node:http';
import {openLocalDatabase} from '../desktop/local-database.mjs';
import {verifySeoHttp} from './test-seo-http.mjs';
import {STAFF_PORTAL_PATH,staffPortalPath,verifyStaffPortalPolicy,verifyStaffPortalHttp} from './test-staff-portal.mjs';
import {writeVariantImageFixtures} from './variant-image-fixture.mjs';

const policy=ts.transpile(await readFile('lib/admin-security.ts','utf8'),{module:ts.ModuleKind.ESNext});
const {secureAdminRequest}=await import('data:text/javascript;base64,'+Buffer.from(policy).toString('base64'));
assert.equal(secureAdminRequest(new Request('http://shop.example/admin')),false);
assert.equal(secureAdminRequest(new Request('https://shop.example/admin')),true);
assert.equal(secureAdminRequest(new Request('http://127.0.0.1:5757/admin')),true);
assert.equal(secureAdminRequest(new Request('http://localhost.evil.example/admin')),false);
assert.equal(secureAdminRequest(new Request('http://localhost/admin',{headers:{Host:'shop.example'}})),false,'Internal loopback URLs cannot bypass remote HTTPS');

const database=await openLocalDatabase(path.resolve('.local-desktop-data','web-admin-'+randomUUID()),process.cwd(),{port:55448});
const variantMediaRoot=path.join(database.dataRoot,'variant-image-fixtures'),variantPhotos=await writeVariantImageFixtures(variantMediaRoot);
const sql=postgres(database.url,{max:1,prepare:false});
const origin='http://127.0.0.1:5767',password='Fixture-Web-Password-04!',setupToken=randomBytes(48).toString('base64url');
// Inventory/receipt/finance regression belongs to the trusted desktop runtime.
// test-web-local-stock.mjs independently verifies that the web cannot do this.
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','5767'],{windowsHide:true,stdio:'ignore',env:{...process.env,DATABASE_URL:database.url,BIRKASSA_LOCAL:'1',BIRKASSA_ADMIN_SETUP_TOKEN:setupToken,BIRKASSA_DATA_DIR:database.dataRoot,BIRKASSA_PUBLIC_MEDIA_DIR:variantMediaRoot,NODE_ENV:'production'}});
let session='';
async function request(url,{method='GET',body,auth=true,headers={}}={}){
 const response=await fetch(origin+url,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(auth&&session?{Cookie:'birkassa_session='+session}:{}),...headers},body:body?JSON.stringify(body):undefined});
 const cookie=response.headers.getSetCookie().find(value=>value.startsWith('birkassa_session='));if(cookie)session=cookie.split(';')[0].split('=')[1];
 const raw=await response.text();return {status:response.status,data:raw&&response.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw,headers:response.headers};
}
try{
 let ready=false;for(let n=0;n<90;n++){try{if((await request('/api/auth')).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}assert.ok(ready,'Web server starts');
 const remoteStatus=await new Promise((resolve,reject)=>{const call=http.get(origin+'/api/auth',{headers:{Host:'shop.example'}},response=>{response.resume();resolve(response.statusCode);});call.on('error',reject);});
 assert.equal(remoteStatus,426,'Remote HTTP is not a loopback preview');
 const [admin]=await sql.unsafe("select id,branch_id from users where role='admin' limit 1");
 const privatePaths=['/api/products','/api/dashboard','/api/finance','/api/orders','/api/warehouses','/api/reports','/api/employees','/api/settings','/api/audit','/api/system?view=backups','/api/store-admin/commerce','/api/locations','/api/admin/smtp','/api/store-admin/chat?view=summary'];
 for(const url of privatePaths)assert.equal((await request(url,{auth:false})).status,401,'No anonymous access: '+url);
 assert.equal((await request('/api/store-admin/upload',{method:'POST',auth:false,body:{}})).status,401,'Anonymous callers cannot upload variant photos');
 assert.equal((await request('/api/products',{auth:false,headers:{'x-birkassa-user-id':admin.id,'x-birkassa-role':'admin'}})).status,401,'Cannot forge identity headers');
 await verifyStaffPortalPolicy();
 for(const url of [staffPortalPath('/store'),staffPortalPath('/online')]){const denied=await request(url,{auth:false});assert.equal(denied.status,307);assert.equal(new URL(denied.headers.get('location'),origin).pathname,STAFF_PORTAL_PATH);}
 const salt=randomBytes(16).toString('hex');await sql.unsafe('update users set pin_hash=$1 where id=$2',[salt+':'+scryptSync('246810',salt,64).toString('hex'),admin.id]);
 const enrollment={action:'setup-password',userId:admin.id,pin:'246810',password,confirmPassword:password};
 assert.equal((await request('/api/auth',{method:'POST',body:{...enrollment,pin:'000000'}})).status,401,'Wrong existing PIN cannot enroll a local administrator');
 assert.equal((await request('/api/auth',{method:'POST',body:enrollment})).status,200,'Local enrollment requires the current PIN and a strong password');
 const login=()=>request('/api/auth',{method:'POST',body:{action:'login',userId:admin.id,password}});
 const signed=await login();assert.equal(signed.status,200);assert.equal(signed.data.local,true);assert.match(signed.headers.get('set-cookie'),/HttpOnly/);assert.match(signed.headers.get('set-cookie'),/SameSite=Strict/i);
 for(const url of privatePaths){const allowed=await request(url);assert.equal(allowed.status,200,url+': '+JSON.stringify(allowed.data));assert.match(allowed.headers.get('cache-control'),/no-store/);}
 assert.equal((await request(staffPortalPath('/store'))).status,200);
 const created=await request('/api/store-admin/commerce',{method:'POST',body:{action:'product',name:'Veb mangal',sku:'WEB-SECURE-01',category:'Manqallar',unit:'ədəd',sale_price:60,cost_price:21,description:'Test',specifications:'Dəmir',discount_price:null,is_active:true,barcode:''}});assert.equal(created.status,200,JSON.stringify(created.data));
 const [product]=await sql.unsafe("select id from products where sku='WEB-SECURE-01'");
 assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:{action:'option',product_id:product.id,label:'60 sm qara',size:'60 sm',color:'Qara',kind:'Dəmir',price:65,cost_price:23,attributes:{'Qalınlıq':'2 mm'},position:0,is_active:true}})).status,200);
 assert.equal((await request('/api/stock/receipts',{method:'POST',body:{productId:product.id,quantity:5,unitCost:21}})).status,201);
 assert.equal((await request('/api/shifts',{method:'POST',body:{action:'open',openingCash:0}})).status,201);
 const [option]=await sql.unsafe('select id from product_options where product_id=$1',[product.id]);
 const sale=await request('/api/sales',{method:'POST',body:{paymentMethod:'cash',buyerName:'Veb alıcı',items:[{productId:product.id,optionId:option.id,quantity:1}]}});assert.equal(sale.status,201,JSON.stringify(sale.data));assert.equal(sale.data.total,65);assert.equal(sale.data.receipt.buyerName,'Veb alıcı');assert.ok(sale.data.receiptNo);assert.equal(sale.data.receipt.items[0].optionLabel,'60 sm qara · Qalınlıq: 2 mm');
 const products=await request('/api/products');assert.equal(products.data.find(row=>row.id===product.id).stock,4);
 const editor=await request('/api/store-admin/commerce');assert.equal(editor.data.canManageProducts,true);assert.equal(Number(editor.data.products.find(row=>row.id===product.id).cost_price),21);
 const catalogue=await request('/api/catalog',{auth:false});assert.equal(catalogue.status,200);const publicProduct=catalogue.data.products.find(row=>row.id===product.id);assert.ok(publicProduct);for(const key of ['stock','cost','cost_price','barcode','password_hash','min_stock'])assert.ok(!(key in publicProduct),'Public catalogue omits '+key);
 // New-product variants commit atomically, including merchant-defined fields.
 const varianted=await request('/api/store-admin/commerce',{method:'POST',body:{action:'product',name:'Ölçülü mangal',sku:'VARIANT-NEW-01',category:'Manqallar',unit:'ədəd',sale_price:100,cost_price:30,description:'',specifications:'',discount_price:80,is_active:true,options:[{label:'30 sm',size:'30 sm',color:'Qara',kind:'Dəmir',price:50,is_active:true,position:0,attributes:{'Qalınlıq':'2 mm','Ayaq':'Sökülən'}},{label:'40 sm',size:'40 sm',color:'Qara',kind:'Dəmir',price:null,is_active:true,position:1,attributes:{'Qalınlıq':'3 mm'}}]}});assert.equal(varianted.status,200,JSON.stringify(varianted.data));
 const [variantProduct]=await sql.unsafe("select id from products where sku='VARIANT-NEW-01'");
 const variantCatalogue=(await request('/api/catalog',{auth:false})).data.products.find(p=>p.id===variantProduct.id);assert.equal(variantCatalogue.options.length,2);assert.equal(variantCatalogue.options[0].attributes['Qalınlıq'],'2 mm');assert.ok(!('cost_price' in variantCatalogue.options[0]));assert.equal(variantCatalogue.price,50);assert.equal(variantCatalogue.originalPrice,50,'A cheaper size is not a fake discount');assert.equal(variantCatalogue.basePrice,80,'Inherited option price must not use the cheapest variant');
 await verifySeoHttp(origin,variantProduct.id);
 // The main POS product dialogs and the web CMS must save the same optional choices atomically.
 const panelOption=(label,size,color,price)=>({label,size,color,kind:'',price,cost_price:20,position:0,is_active:true,attributes:{}});
 const panelBody={name:'Panel seçimli məhsul',sku:'PANEL-CHOICES-QA',category:'Manqallar',salePrice:100,costPrice:30,minStock:2,barcode:'',options:[panelOption('30 sm · Qara','30 sm','Qara',55),panelOption('40 sm · Qırmızı','40 sm','Qırmızı',85)]};
 const panelCreated=await request('/api/products',{method:'POST',body:panelBody});assert.equal(panelCreated.status,201,JSON.stringify(panelCreated.data));const panelId=panelCreated.data.id;
 let panelEditor=(await request('/api/products')).data.find(p=>p.id===panelId);assert.equal(panelEditor.editableOptions.length,2);assert.equal(Number(panelEditor.editableOptions[0].cost_price),20);assert.ok(!('cost_price' in panelEditor.options[0]));
 const remaining={...panelEditor.editableOptions[1],price:90,cost_price:25};
 const changedPanel=await request('/api/products',{method:'PATCH',body:{...panelBody,productId:panelId,options:[remaining]}});assert.equal(changedPanel.status,200,JSON.stringify(changedPanel.data));
 const removedChoice=await sql.unsafe('select is_active from product_options where product_id=$1 and label=$2',[panelId,'30 sm · Qara']);assert.equal(removedChoice[0].is_active,false,'Removed choices are archived, not deleted');
 let panelPublic=(await request('/api/catalog',{auth:false})).data.products.find(p=>p.id===panelId);assert.equal(panelPublic.options.length,1);assert.equal(panelPublic.options[0].price,90);
 const cmsPanel={action:'product',id:panelId,name:panelBody.name,sku:panelBody.sku,category:panelBody.category,unit:'ədəd',sale_price:100,cost_price:30,description:'',specifications:'',discount_price:null,is_active:true,barcode:'',options:[{...remaining,price:95}]};
 assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:cmsPanel})).status,200,'Existing CMS product saves all choices together');
 assert.equal((await request('/api/products')).data.find(p=>p.id===panelId).options[0].price,95);
 const crossed=await request('/api/products',{method:'PATCH',body:{...panelBody,productId:panelId,name:'Must roll back',options:[{...remaining,id:option.id}]}});assert.equal(crossed.status,400,'Cannot steal another product choice');assert.equal((await sql.unsafe('select name from products where id=$1',[panelId]))[0].name,panelBody.name);
 assert.equal((await request('/api/products',{method:'POST',body:{...panelBody,sku:'BAD-PANEL-CHOICE',options:[{...remaining,id:option.id}]}})).status,400);assert.equal((await sql.unsafe("select id from products where sku='BAD-PANEL-CHOICE'")).length,0,'Invalid choices roll back product creation');
 assert.equal((await request('/api/products',{method:'PATCH',body:{...panelBody,productId:panelId,options:[]}})).status,200,'All choice switches can be turned off');
 panelPublic=(await request('/api/catalog',{auth:false})).data.products.find(p=>p.id===panelId);assert.equal(panelPublic.options.length,0);assert.equal(panelPublic.price,100);
 assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:{action:'delete-product',id:panelId,confirm:'SİL'}})).status,200);assert.ok(!(await request('/api/products')).data.some(p=>p.id===panelId));assert.equal((await sql.unsafe('select count(*)::int n from product_options where product_id=$1',[panelId]))[0].n,2);
 const duplicate=await request('/api/store-admin/commerce',{method:'POST',body:{action:'product',name:'Duplicate',sku:'VARIANT-BAD-01',category:'',unit:'ədəd',sale_price:100,cost_price:30,description:'',specifications:'',discount_price:null,is_active:true,options:[0,1].map(position=>({label:'Eyni',size:'',color:'',kind:'',price:null,is_active:true,position,attributes:{}}))}});assert.equal(duplicate.status,400);assert.equal((await sql.unsafe("select id from products where sku='VARIANT-BAD-01'")).length,0,'Invalid variants roll back the whole product');
 const adminSession=session;
 const branchCreated=await request('/api/locations',{method:'POST',body:{action:'branch',name:'İkinci mağaza',address:'Test ünvan'}});assert.equal(branchCreated.status,200);const branchId=branchCreated.data.id;
 const warehouseCreated=await request('/api/locations',{method:'POST',body:{action:'warehouse',branchId,name:'İkinci mağaza anbarı',code:'TEST-STORE-02'}});assert.equal(warehouseCreated.status,200);const warehouseId=warehouseCreated.data.id;
 const cashierCreated=await request('/api/locations',{method:'POST',body:{action:'cashier',fullName:'İkinci mağaza kassiri',branchId,warehouseId,password,salary:500}});assert.equal(cashierCreated.status,200,JSON.stringify(cashierCreated.data));const cashierId=cashierCreated.data.id;
 const [originalWarehouse]=await sql.unsafe('select id from warehouses where branch_id=$1 limit 1',[admin.branch_id]);
 assert.equal((await request('/api/locations',{method:'POST',body:{action:'assign',userId:cashierId,branchId,warehouseId:originalWarehouse.id}})).status,409,'Warehouse must belong to the assigned store');
 await sql.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by) values($1,$2,'receipt',7,21,$3)",[product.id,warehouseId,admin.id]);
 const cashierLogin=await request('/api/auth',{method:'POST',body:{action:'login',userId:cashierId,password}});assert.equal(cashierLogin.status,200,JSON.stringify(cashierLogin.data));assert.deepEqual(cashierLogin.data.user.permissions,['Satış / POS']);
 for(const endpoint of ['/api/finance','/api/locations','/api/store-admin/commerce','/api/employees','/api/admin/smtp','/api/store-admin/chat?summary=1'])assert.equal((await request(endpoint)).status,403,'Cashier is not an administrator: '+endpoint);
 assert.equal((await request('/api/store-admin/upload',{method:'POST',body:{}})).status,403,'A cashier cannot upload variant photos');
 const cashierProducts=(await request('/api/products')).data;assert.equal(cashierProducts.find(p=>p.id===product.id).stock,7);assert.equal(cashierProducts.find(p=>p.id===product.id).cost,0);assert.deepEqual(cashierProducts.find(p=>p.id===product.id).priceHistory,[]);assert.ok(!('editableOptions' in cashierProducts.find(p=>p.id===product.id)),'Cashier never receives private editable option costs');
 const cashierDashboard=(await request('/api/dashboard')).data;assert.equal(cashierDashboard.branchName,'İkinci mağaza');assert.deepEqual(cashierDashboard.recent,[]);
 assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:{action:'delete-product',id:product.id,confirm:'SİL'}})).status,403);
 assert.equal((await request('/api/shifts',{method:'POST',body:{action:'open',openingCash:0}})).status,201);
 const cashierSale=await request('/api/sales',{method:'POST',body:{paymentMethod:'card',items:[{productId:product.id,optionId:option.id,quantity:1}]}});assert.equal(cashierSale.status,201,JSON.stringify(cashierSale.data));assert.equal(cashierSale.data.receipt.store.branch,'İkinci mağaza');assert.equal(cashierSale.data.receipt.cashier,'İkinci mağaza kassiri');
 session=adminSession;
 assert.equal((await request('/api/locations',{method:'POST',body:{action:'assign',userId:cashierId,branchId:admin.branch_id,warehouseId:originalWarehouse.id}})).status,409,'An open shift prevents reassignment');
 assert.equal(Number((await sql.unsafe('select sum(quantity) n from stock_movements where product_id=$1 and warehouse_id=$2',[product.id,originalWarehouse.id]))[0].n),4,'Second-store sale must not consume the first-store stock');
 assert.equal(Number((await sql.unsafe('select sum(quantity) n from stock_movements where product_id=$1 and warehouse_id=$2',[product.id,warehouseId]))[0].n),6);
 assert.equal((await request('/api/employees',{method:'PATCH',body:{employeeId:cashierId,salary:600}})).status,200);
 let finance=(await request('/api/finance')).data;assert.equal(finance.metrics.revenue,130);assert.equal(finance.metrics.costOfGoods,46);assert.equal(finance.metrics.netProfit,84);assert.equal(finance.metrics.payroll,0,'Planned salary is not an expense');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const expense={action:'transaction',type:'expense',category:'Kommunal',description:'İşıq pulu',payee:'Elektrik xidməti',amount:10,branchId,occurredAt:date,requestKey:randomUUID()};assert.equal((await request('/api/finance',{method:'POST',body:expense})).status,201);assert.equal((await request('/api/finance',{method:'POST',body:expense})).data.replayed,true);
 const payroll={action:'payroll',employeeId:cashierId,wagePeriod:date.slice(0,7),amount:300,account:'bank',occurredAt:date,requestKey:randomUUID()};assert.equal((await request('/api/finance',{method:'POST',body:payroll})).status,201);assert.equal((await request('/api/finance',{method:'POST',body:payroll})).data.replayed,true);assert.equal((await request('/api/finance',{method:'POST',body:{...payroll,amount:301}})).status,409);
 await sql.unsafe('update products set cost_price=29 where id=$1',[product.id]);
 finance=(await request('/api/finance')).data;assert.equal(finance.metrics.costOfGoods,46,'Historical cost does not change with current purchase price');assert.equal(finance.metrics.expenses,310);assert.equal(finance.metrics.payroll,300);assert.equal(finance.metrics.netProfit,-226);assert.equal(finance.recent.find(r=>r.category==='Kommunal').payee,'Elektrik xidməti');assert.ok(finance.sales.some(s=>s.cashier==='İkinci mağaza kassiri'&&s.warehouse==='İkinci mağaza anbarı'));
 const branchFinance=(await request('/api/finance?branch='+branchId)).data;assert.equal(branchFinance.metrics.revenue,65);assert.equal(branchFinance.metrics.expenses,310);
 const protectedOrder=await request('/api/orders',{method:'POST',body:{customerName:'Silmə yoxlaması',items:[{productId:product.id,optionId:option.id,quantity:1}]}});assert.equal(protectedOrder.status,201,JSON.stringify(protectedOrder.data));
 assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:{action:'delete-product',id:product.id,confirm:'SİL'}})).status,400,'Open order blocks deletion');assert.equal((await sql.unsafe('select deleted_at from products where id=$1',[product.id]))[0].deleted_at,null);
 assert.equal((await request('/api/orders',{method:'POST',body:{action:'status',orderId:protectedOrder.data.orderId,status:'cancelled'}})).status,201);
 // Delivery is paid once, separately from products and the catalogue coupon.
 const deliveryOrder=await request('/api/orders',{method:'POST',body:{customerName:'Çatdırılmalı qaimə',items:[{productId:product.id,optionId:option.id,quantity:1}]}});assert.equal(deliveryOrder.status,201,JSON.stringify(deliveryOrder.data));
 await sql.unsafe("update sales_orders set status='ready',source='catalog',fulfillment='delivery',coupon_discount=5,delivery_fee=8.5,total=68.5 where id=$1",[deliveryOrder.data.orderId]);
 const loadedDelivery=(await request('/api/orders')).data.find(row=>row.id===deliveryOrder.data.orderId);assert.equal(loadedDelivery.deliveryFee,8.5);assert.equal(loadedDelivery.couponDiscount,5);assert.equal(loadedDelivery.total,68.5);
 const deliveryPayment={paymentMethod:'mixed',salesOrderId:deliveryOrder.data.orderId,discount:0,deliveryFee:0,items:[{productId:product.id,optionId:option.id,quantity:1}]};
 assert.equal((await request('/api/sales',{method:'POST',body:{...deliveryPayment,cashAmount:60,cardAmount:0}})).status,400,'Products-only payment cannot omit authoritative delivery charge');
 const paidDelivery=await request('/api/sales',{method:'POST',body:{...deliveryPayment,cashAmount:60,cardAmount:8.5}});assert.equal(paidDelivery.status,201,JSON.stringify(paidDelivery.data));assert.equal(paidDelivery.data.total,68.5);assert.equal(paidDelivery.data.deliveryFee,8.5);assert.equal(paidDelivery.data.receipt.subtotal,65);assert.equal(paidDelivery.data.receipt.discount,5);assert.equal(paidDelivery.data.receipt.deliveryFee,8.5);assert.equal(paidDelivery.data.receipt.items.length,1,'Delivery never becomes a stock/product line');assert.equal(paidDelivery.data.receipt.paymentDetails.reduce((sum,p)=>sum+p.amount,0),68.5);
 assert.equal(Number((await sql.unsafe('select delivery_fee from sales where id=$1',[paidDelivery.data.saleId]))[0].delivery_fee),8.5);
 assert.equal((await request('/api/dashboard')).data.recent.find(row=>row.id===paidDelivery.data.saleId).deliveryFee,8.5,'Historical reprint retains the paid delivery snapshot');
 assert.equal((await request('/api/returns',{method:'POST',body:{saleId:paidDelivery.data.saleId,reason:'Çatdırılma qaiməsi sınaq qaytarma',managerPin:'246810'}})).status,201,'Full returns retain the complete paid total including fee');
 assert.equal(Number((await sql.unsafe("select sum(quantity) n from stock_movements where product_id=$1 and warehouse_id=$2",[product.id,originalWarehouse.id]))[0].n),4,'Only the actual product is returned to stock');
 const deleted=await request('/api/store-admin/commerce',{method:'POST',body:{action:'delete-product',id:product.id,confirm:'SİL'}});assert.equal(deleted.status,200);assert.ok(!(await request('/api/catalog',{auth:false})).data.products.some(p=>p.id===product.id));assert.ok(!(await request('/api/store-admin/commerce')).data.products.some(p=>p.id===product.id));assert.equal(Number((await sql.unsafe('select count(*) n from sale_items where product_id=$1',[product.id]))[0].n),3,'Product removal retains historical receipts');
 assert.equal((await request('/api/shifts',{method:'POST',body:{action:'open',openingCash:0},headers:{Origin:'https://attacker.example'}})).status,403,'Cross-origin write denied');
 assert.equal((await request('/api/shifts',{method:'POST',body:{action:'open',openingCash:0},headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 await verifyStaffPortalHttp({origin,request,sql,admin,adminSession:session,password,inventoryLocal:true,setSession:value=>{session=value;}});
 const tokenHash=createHash('sha256').update(session).digest('hex');await sql.unsafe("update auth_sessions set last_seen_at=now()-interval '11 minutes' where token_hash=$1",[tokenHash]);assert.equal((await request('/api/products')).status,401);assert.equal((await request('/api/auth',{method:'PATCH'})).status,401);await login();
 await sql.unsafe('update users set is_active=false where id=$1',[admin.id]);assert.equal((await request('/api/products')).status,401);assert.equal((await request('/api/auth',{method:'PATCH'})).status,401);await sql.unsafe('update users set is_active=true where id=$1',[admin.id]);
 for(let n=0;n<5;n++)assert.equal((await request('/api/auth',{method:'POST',body:{action:'login',userId:admin.id,password:'wrong-password'}})).status,401);
 assert.equal((await login()).status,429);await sql.unsafe('delete from staff_auth_attempts');await login();
 assert.equal((await request('/api/auth',{method:'DELETE'})).status,200);assert.equal((await request('/api/products')).status,401);
 // Only this freshly-created isolated database receives the browser-proof item.
 // Create it after financial assertions, so no expected revenue/COGS changes.
 assert.equal((await login()).status,200);
 const colorSizeOptions=[['30 sm','Qırmızı',7],['40 sm','Qırmızı',9],['40 sm','Qara',11]].map(([size,color,price],position)=>({label:size+' · '+color,size,color,kind:'',price,cost_price:2,position,is_active:true,attributes:{},image_url:color==='Qırmızı'?variantPhotos.red:variantPhotos.black}));
 const colorSizeBody={name:'Rəng və ölçü sınağı',sku:'COLOR-SIZE-UI-QA',category:'Manqallar',salePrice:7,costPrice:2,minStock:0,barcode:'',options:colorSizeOptions};
 const colorSizeCreated=await request('/api/products',{method:'POST',body:colorSizeBody});assert.equal(colorSizeCreated.status,201,JSON.stringify(colorSizeCreated.data));
 const colorSizeId=colorSizeCreated.data.id;
 await sql.unsafe('update products set image_url=$1 where id=$2',[variantPhotos.main,colorSizeId]);
 assert.equal((await request('/api/stock/receipts',{method:'POST',body:{productId:colorSizeId,quantity:5,unitCost:2}})).status,201);
 assert.ok((await request('/api/products')).data.find(product=>product.id===colorSizeId).stock>=5,'Browser fixture is available for adding to the cart');
 const colorSizeProduct=(await request('/api/catalog',{auth:false})).data.products.find(product=>product.id===colorSizeId);assert.ok(colorSizeProduct);
 assert.deepEqual(colorSizeProduct.options.map(o=>o.image),[variantPhotos.red,variantPhotos.red,variantPhotos.black],'Public images follow actual variant assignments');
 const colorPrivate=(await request('/api/products')).data.find(p=>p.id===colorSizeId);
 const imageOptions=colorPrivate.editableOptions.map(option=>({...option,price:option.price==null?null:Number(option.price),cost_price:option.cost_price==null?null:Number(option.cost_price)}));
 const withoutImages=imageOptions.map(option=>{const copy={...option};delete copy.image_url;return copy;});
 assert.equal((await request('/api/products',{method:'PATCH',body:{...colorSizeBody,productId:colorSizeId,options:withoutImages}})).status,200,'Old clients can edit variants without erasing photos');
 assert.equal((await request('/api/catalog',{auth:false})).data.products.find(p=>p.id===colorSizeId).options[0].image,variantPhotos.red);
 assert.equal((await request('/api/products',{method:'PATCH',body:{...colorSizeBody,productId:colorSizeId,options:imageOptions.map((o,i)=>i===0?{...o,image_url:''}:o)}})).status,200,'Explicit blank clears an assigned photo');
 assert.equal((await request('/api/catalog',{auth:false})).data.products.find(p=>p.id===colorSizeId).options[0].image,'');
 assert.equal((await request('/api/products',{method:'PATCH',body:{...colorSizeBody,productId:colorSizeId,options:imageOptions}})).status,200,'Restore only the isolated fixture photos');
 assert.equal((await request('/api/products',{method:'PATCH',body:{...colorSizeBody,productId:colorSizeId,name:'Must roll back image input',options:[{...imageOptions[0],image_url:'https://127.0.0.1/private'}]}})).status,400);
 assert.equal((await sql.unsafe('select name from products where id=$1',[colorSizeId]))[0].name,colorSizeBody.name,'Unsafe image rejection does not modify the product');
 const photoResponse=await fetch(origin+variantPhotos.red);assert.equal(photoResponse.status,200);assert.match(photoResponse.headers.get('content-type'),/^image\/png/);
 const redPage=await request('/mehsullar/'+colorSizeProduct.code+'-reng-ve-olcu-sinagi/?reng=qirmizi',{auth:false});
 assert.equal(redPage.status,200);assert.ok(redPage.data.includes('class="pd-main-image" src="'+variantPhotos.red+'"'),'Color-only URL selects the color photo in server-rendered HTML');
 console.log('PASS: isolated variant-photo API validation, clear/restore, omitted-photo compatibility, public PNG serving and color-only server image.');
 assert.deepEqual(colorSizeProduct.options.map(({size,color,price,kind,attributes})=>({size,color,price,kind,attributes})),colorSizeOptions.map(({size,color,price,kind,attributes})=>({size,color,price,kind,attributes})),'Only the three real sparse color/size combinations exist');
 await verifySeoHttp(origin,colorSizeId);
 // Discount integration intentionally runs after every finance/role-metric
 // assertion. Only this newly-created isolated DB receives these test sales.
 const discountBody={name:'Endirim sınağı',sku:'DISCOUNT-UI-QA',category:'Endirim sınağı',salePrice:100,costPrice:20,minStock:0,barcode:''};
 const discountCreated=await request('/api/products',{method:'POST',body:{...discountBody,discountPercent:20}});assert.equal(discountCreated.status,201,JSON.stringify(discountCreated.data));
 const discountId=discountCreated.data.id;
 async function assertDiscount(expected){
  const privateProduct=(await request('/api/products')).data.find(item=>item.id===discountId);assert.ok(privateProduct);assert.equal(privateProduct.regularPrice,100);assert.equal(privateProduct.discountPrice,expected===100?null:expected);assert.equal(privateProduct.price,expected,'POS DTO exposes the effective discount price');
  const publicProduct=(await request('/api/catalog',{auth:false})).data.products.find(item=>item.id===discountId);assert.ok(publicProduct);assert.equal(publicProduct.price,expected);assert.equal(publicProduct.originalPrice,100);assert.equal(publicProduct.basePrice,expected);return publicProduct;
 }
 await assertDiscount(80);
 assert.equal((await request('/api/products',{method:'PATCH',body:{...discountBody,productId:discountId,discountPercent:25}})).status,200);await assertDiscount(75);
 const cmsDiscountBody={action:'product',id:discountId,name:discountBody.name,sku:discountBody.sku,category:discountBody.category,unit:'ədəd',sale_price:100,cost_price:20,description:'',specifications:'',is_active:true,barcode:''};
 assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:{...cmsDiscountBody,discount_percent:10}})).status,200);await assertDiscount(90);
 assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:{...cmsDiscountBody,discount_price:87.65}})).status,200);await assertDiscount(87.65);
 assert.equal((await request('/api/products',{method:'PATCH',body:{...discountBody,productId:discountId}})).status,200,'A normal product edit preserves an exact existing discounted amount');await assertDiscount(87.65);
 assert.equal((await request('/api/products',{method:'PATCH',body:{...discountBody,productId:discountId,discountPercent:0}})).status,200);await assertDiscount(100);
 assert.equal((await request('/api/products',{method:'PATCH',body:{...discountBody,productId:discountId,discountPercent:20}})).status,200);await assertDiscount(80);
 const [beforeInvalidDiscount]=await sql.unsafe('select sale_price,discount_price from products where id=$1',[discountId]);
 for(const percent of [-1,100,101,20.001]){
  assert.equal((await request('/api/products',{method:'PATCH',body:{...discountBody,productId:discountId,discountPercent:percent}})).status,400,'Invalid main product percent is rejected: '+percent);
  assert.equal((await request('/api/store-admin/commerce',{method:'POST',body:{...cmsDiscountBody,discount_percent:percent}})).status,400,'Invalid CMS product percent is rejected: '+percent);
  assert.deepEqual((await sql.unsafe('select sale_price,discount_price from products where id=$1',[discountId]))[0],beforeInvalidDiscount,'Rejected discounts cannot change the stored prices');
 }
 assert.equal((await request('/api/stock/receipts',{method:'POST',body:{productId:discountId,quantity:5,unitCost:20}})).status,201);
 const discountPublic=await assertDiscount(80);assert.equal(discountPublic.options.length,0);assert.equal((await request('/api/products')).data.find(item=>item.id===discountId).stock,5);

 // A separate product proves actual server receipt/order prices without
 // consuming the no-options stock-5 homepage proof item above.
 const discountPosBody={name:'Endirim qiymət sınağı',sku:'DISCOUNT-POS-PRICE-QA',category:'İzolə edilmiş sınaq',salePrice:100,costPrice:20,minStock:0,barcode:''};
 const discountPosCreated=await request('/api/products',{method:'POST',body:{...discountPosBody,discountPercent:20}});assert.equal(discountPosCreated.status,201,JSON.stringify(discountPosCreated.data));const discountPosId=discountPosCreated.data.id;
 assert.equal((await request('/api/stock/receipts',{method:'POST',body:{productId:discountPosId,quantity:10,unitCost:20}})).status,201);
 async function discountedSale(optionId,expected,salesOrderId){
  const result=await request('/api/sales',{method:'POST',body:{paymentMethod:'card',discount:0,...(salesOrderId?{salesOrderId}:{}),items:[{productId:discountPosId,...(optionId?{optionId}:{}),quantity:1}]}});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.total,expected);assert.equal(result.data.receipt.subtotal,expected);assert.equal(result.data.receipt.items[0].unitPrice,expected);assert.equal(result.data.receipt.items[0].lineTotal,expected);return result.data;
 }
 async function discountedOrder(optionId,expected){
  const result=await request('/api/orders',{method:'POST',body:{customerName:'İzolə edilmiş endirim qiymət sınağı',items:[{productId:discountPosId,...(optionId?{optionId}:{}),quantity:1}]}});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.total,expected);
  const order=(await request('/api/orders')).data.find(item=>item.id===result.data.orderId);assert.ok(order);assert.equal(order.items[0].unitPrice,expected);assert.equal(order.items[0].lineTotal,expected);return result.data.orderId;
 }
 await discountedSale(undefined,80);
 const baseDiscountOrder=await discountedOrder(undefined,80);
 assert.equal((await request('/api/orders',{method:'POST',body:{action:'status',orderId:baseDiscountOrder,status:'ready'}})).status,201);
 assert.equal((await request('/api/products',{method:'PATCH',body:{...discountPosBody,productId:discountPosId,discountPercent:25}})).status,200);
 await discountedSale(undefined,80,baseDiscountOrder); // Accepted order snapshot wins over the current 75 price.
 const pricingChoices=[{label:'Əsas qiymətlə',size:'30 sm',color:'',kind:'',price:null,cost_price:20,position:0,is_active:true,attributes:{}},{label:'Öz qiyməti ilə',size:'40 sm',color:'',kind:'',price:45,cost_price:20,position:1,is_active:true,attributes:{}}];
 assert.equal((await request('/api/products',{method:'PATCH',body:{...discountPosBody,productId:discountPosId,discountPercent:20,options:pricingChoices}})).status,200);
 const discountPosProduct=(await request('/api/products')).data.find(item=>item.id===discountPosId);assert.equal(discountPosProduct.price,80);
 const inheritedChoice=discountPosProduct.options.find(item=>item.price===null),explicitChoice=discountPosProduct.options.find(item=>item.price===45);assert.ok(inheritedChoice);assert.ok(explicitChoice);
 for(const [choice,expected] of [[inheritedChoice,80],[explicitChoice,45]]){
  await discountedSale(choice.id,expected);
  const orderId=await discountedOrder(choice.id,expected);
  assert.equal((await request('/api/orders',{method:'POST',body:{action:'status',orderId,status:'cancelled'}})).status,201);
 }
 const discountPosPublic=(await request('/api/catalog',{auth:false})).data.products.find(item=>item.id===discountPosId);assert.equal(discountPosPublic.price,45);assert.equal(discountPosPublic.originalPrice,45,'A cheaper explicit option is not advertised as a base-product discount');
 assert.equal((await request('/api/products',{method:'PATCH',body:{action:'deactivate',productId:discountPosId}})).status,200,'Retain test receipts but hide the technical pricing fixture from the preview catalogue');
 assert.equal((await request('/api/products')).data.find(item=>item.id===discountId).stock,5,'Receipt and order pricing tests did not consume the homepage discount fixture');
 console.log('PASS: real isolated product/CMS percent and amount edits, invalid-discount rollback, effective DTO/catalogue pricing, POS/base/inherited/explicit prices and accepted-order snapshots.');
 assert.equal((await request('/api/auth',{method:'DELETE'})).status,200);
 console.log('PASS: optional/custom variants, atomic product creation, variant cost/receipt snapshots, honest discount pricing, two-store cashier stock isolation and permissions, open-shift assignment lock, salary plans/payroll and expense idempotency, net profit with historical COGS, archive deletion preserving receipts, CSRF/HTTPS/session protections and catalogue privacy.');
 if(process.argv.includes('--serve')){
  const [careCustomer]=await sql.unsafe("insert into customers(full_name,phone) values('Müştəri dəstəyi UI sınağı','+994501234567') returning id");
  const careSalt='isolated-care-fixture',careHash=careSalt+':'+scryptSync(password,careSalt,64).toString('hex');
  const [careAccount]=await sql.unsafe("insert into customer_accounts(customer_id,email,password_hash) values($1,'care.ui@example.test',$2) returning id",[careCustomer.id,careHash]);
  const [careTicket]=await sql.unsafe("insert into support_tickets(ticket_no,account_id,subject,kind) values(nextval('support_ticket_seq')::text,$1,'Məhsul seçimi barədə təklif','suggestion') returning id",[careAccount.id]);
  await sql.unsafe("insert into support_ticket_messages(ticket_id,sender,body) values($1,'customer','Salam, məhsulları ölçü və rəngə görə seçmək istəyirəm.')",[careTicket.id]);
  await sql.unsafe("insert into sales_orders(order_no,customer_id,account_id,total,source,fulfillment,created_by) values('UI-CARE-CANCEL',$1,$2,60,'catalog','pickup',$3)",[careCustomer.id,careAccount.id,admin.id]);
  console.log('CUSTOMER CARE UI FIXTURE: isolated cancellation order UI-CARE-CANCEL and one unread/unanswered suggestion; SMTP disabled, no real email.');
  const [uiDelete]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('UI-DELETE-QA','UI silmə sınağı',50,20) returning id");
  const [uiBlocked]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('UI-DELETE-BLOCKED','UI silmə xətası sınağı',50,20) returning id");
  const [uiCustomer]=await sql.unsafe("insert into customers(full_name) values('İzolə edilmiş UI sınağı') returning id");
  const [uiOrder]=await sql.unsafe("insert into sales_orders(order_no,customer_id,total,created_by) values('UI-DELETE-GUARD',$1,50,$2) returning id",[uiCustomer.id,admin.id]);
  await sql.unsafe('insert into sales_order_items(sales_order_id,product_id,quantity,unit_price,line_total) values($1,$2,1,50,50)',[uiOrder.id,uiBlocked.id]);
  console.log('ISOLATED UI PREVIEW: '+origin+'/products/'+variantProduct.id+' | staff: '+origin+STAFF_PORTAL_PATH);
  console.log('COLOR/SIZE UI FIXTURE: '+origin+'/mehsullar/'+colorSizeProduct.code+'-reng-ve-olcu-sinagi/');
  console.log('DISCOUNT UI FIXTURE: '+origin+'/mehsullar/'+discountPublic.code+'-endirim-sinagi/ | 100 → 80 AZN, 20%, stock 5, no options');
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.stdin.once('data',resolve);process.stdin.resume();});process.stdin.pause();
  const [state]=await sql.unsafe('select deleted_at from products where id=$1',[uiDelete.id]);
  if(state.deleted_at){assert.equal((await sql.unsafe("select count(*)::int n from audit_logs where entity_id=$1 and action='commerce.delete-product'",[uiDelete.id]))[0].n,1,'Only one successful deletion');assert.equal((await sql.unsafe('select deleted_at from products where id=$1',[uiBlocked.id]))[0].deleted_at,null);console.log('PASS: browser deletion fixture archived exactly once; rejected product remained untouched.');}
 }
}finally{
 const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,5000))]);await sql.end({timeout:2});await database.close();
}
