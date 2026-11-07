import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
const dataRoot=path.resolve('.local-desktop-data','customer-'+randomUUID());
process.env.BIRKASSA_BUNDLED_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
const db=await openLocalDatabase(dataRoot,process.cwd(),{port:55443});
const sql=postgres(db.url,{max:1,prepare:false}),origin='http://127.0.0.1:5764';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','5764'],{windowsHide:true,env:{...process.env,DATABASE_URL:db.url,BIRKASSA_LOCAL:'0',NODE_ENV:'production'},stdio:'ignore'});
let cookie='';
async function request(url,body,method=body?'POST':'GET',auth=true){
 const response=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth&&cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{throw Error(url+' returned non-JSON HTTP '+response.status);}
 return {response,status:response.status,data};
}
try{
 let ready=false;for(let n=0;n<80;n++){try{const r=await request('/api/auth');if(r.status===200&&typeof r.data.authenticated==='boolean'){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}assert.ok(ready);
 assert.equal((await request('/api/customer-account')).data.user,null);
 assert.equal((await request('/api/my-orders')).status,401);
 const email='aysel.ui@example.test',password='Fixture-Customer-123!';
 const registered=await request('/api/customer-account',{action:'register',name:'Aysel Məmmədova',phone:'+994500000001',email,password});assert.equal(registered.status,200,JSON.stringify(registered.data));
 const issued=registered.response.headers.get('set-cookie');assert.match(issued,/HttpOnly/);assert.ok(!/; Secure/i.test(issued),'Loopback preview must retain customer cookies over HTTP');cookie=issued.split(';')[0];
 const account=await request('/api/customer-account');assert.equal(account.data.user.name,'Aysel Məmmədova');assert.equal((await request('/api/my-orders')).data.orders.length,0);
 const [product]=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('CUSTOMER-QA','Manqal',40,20) returning id");
 const [option]=await sql.unsafe("insert into product_options(product_id,label,size,price) values($1,'60 sm · Qara','60 sm',60) returning id",[product.id]);
 const payload={requestKey:randomUUID(),expectedTotal:60,fulfillment:'pickup',address:'',name:'Aysel Məmmədova',phone:'+994500000001',note:'',items:[{id:product.id,optionId:option.id,quantity:1}]};
 const order=await request('/api/customer-orders',payload);assert.equal(order.status,201,JSON.stringify(order.data));
 assert.equal((await request('/api/customer-orders',payload)).data.order_no,order.data.order_no,'Retry must not duplicate the order');
 const orders=await request('/api/my-orders');assert.equal(orders.status,200);assert.equal(orders.data.orders.length,1);assert.equal(orders.data.orders[0].order_no,order.data.order_no);assert.match(orders.data.orders[0].items[0].name,/60 sm/);
 const ownerCookie=cookie;const other=await request('/api/customer-account',{action:'register',name:'Başqa müştəri',phone:'+994500000002',email:'other-'+randomUUID()+'@example.test',password});cookie=other.response.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/my-orders')).data.orders.length,0,'Customers only see their own orders');
 cookie=ownerCookie;await request('/api/customer-account',undefined,'DELETE');assert.equal((await request('/api/my-orders')).status,401,'Logout revokes the database session');
 const login=await request('/api/customer-account',{action:'login',email,password});assert.equal(login.status,200);cookie=login.response.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/my-orders')).data.orders.length,1);
 assert.equal((await request('/api/customer-account',{action:'login',email,password:'incorrect-password'})).status,401);
 const deliverySettings=await request('/api/delivery-settings');assert.equal(deliverySettings.status,200);assert.equal(deliverySettings.data.settings.mode,'manual');assert.ok(!JSON.stringify(deliverySettings.data).includes('serverKey'));
 assert.equal((await request('/api/admin/delivery')).status,401,'A customer cannot read delivery admin settings');
 assert.equal((await request('/api/delivery-quote',{address:'Sınaq ünvanı Bakı',lat:40,lng:49},'POST',false)).status,401);
 await sql.unsafe("update delivery_settings set mode='distance',minimum_order=60,minimum_fee=5,price_per_km=1.2,origin_address='Sınaq mağazası, Bakı şəhəri',origin_lat=40,origin_lng=49,server_key='fixture-secret-never-public',revision=revision+1 where id=1");
 const publicSettings=await request('/api/delivery-settings');assert.ok(!JSON.stringify(publicSettings.data).includes('fixture-secret'),'The server key never reaches the public endpoint');
 const destination='Bakı şəhəri, Sınaq küçəsi 12';
 const [quote]=await sql.unsafe('insert into delivery_quotes(account_id,address,lat,lng,distance_meters,fee,settings_revision) select $1,$2,40.4,49.8,5000,6,revision from delivery_settings returning id',[account.data.user.id,destination]);
 const deliveryPayload={...payload,requestKey:randomUUID(),fulfillment:'delivery',address:destination,expectedTotal:66,deliveryQuoteId:quote.id};
 assert.equal((await request('/api/customer-orders',{...deliveryPayload,deliveryQuoteId:null})).status,400,'Distance delivery requires a server quote');
 assert.equal((await request('/api/customer-orders',{...deliveryPayload,expectedTotal:60,deliveryFee:0})).status,400,'Client cannot remove the server fee');
 assert.equal((await request('/api/customer-orders',{...deliveryPayload,address:destination+' dəyişib'})).status,400,'Changing destination invalidates the quote');
 await sql.unsafe("insert into commerce_coupons(code,percent,minimum,usage_limit,expires_at) values('DELIVERY-MIN',10,0,10,now()+interval '1 day')");
 assert.equal((await request('/api/customer-orders',{...deliveryPayload,coupon:'DELIVERY-MIN',expectedTotal:60})).status,400,'Minimum applies after coupon discount');
 await sql.unsafe("update delivery_quotes set expires_at=now()-interval '1 minute' where id=$1",[quote.id]);
 assert.equal((await request('/api/customer-orders',deliveryPayload)).status,400,'Expired quote is rejected');
 await sql.unsafe("update delivery_quotes set expires_at=now()+interval '10 minutes',settings_revision=settings_revision-1 where id=$1",[quote.id]);
 assert.equal((await request('/api/customer-orders',deliveryPayload)).status,400,'Changed admin tariff invalidates previous quote');
 await sql.unsafe('update delivery_quotes set settings_revision=(select revision from delivery_settings where id=1) where id=$1',[quote.id]);
 const deliveryOrder=await request('/api/customer-orders',deliveryPayload);assert.equal(deliveryOrder.status,201,JSON.stringify(deliveryOrder.data));
 await sql.unsafe("update delivery_quotes set expires_at=now()-interval '1 minute' where id=$1",[quote.id]);
 assert.equal((await request('/api/customer-orders',deliveryPayload)).data.order_no,deliveryOrder.data.order_no,'Committed order remains retryable after quote expires');
 const history=await request('/api/my-orders'),delivered=history.data.orders.find(row=>row.order_no===deliveryOrder.data.order_no);assert.equal(Number(delivered.total),66);assert.equal(Number(delivered.delivery_fee),6);assert.equal(delivered.distance_meters,5000);
 // A separate disposable customer keeps checkout validation/retry checks away
 // from the account and rate limits used by the interactive --serve preview.
 const checkoutReturnCookie=cookie;
 const checkoutCustomer=await request('/api/customer-account',{action:'register',name:'Checkout Contract',phone:'+994500000003',email:'checkout-'+randomUUID()+'@example.test',password});
 assert.equal(checkoutCustomer.status,200,JSON.stringify(checkoutCustomer.data));cookie=checkoutCustomer.response.headers.get('set-cookie').split(';')[0];
 const checkoutAccount=(await request('/api/customer-account')).data.user;
 const decimalProducts=await sql.unsafe("insert into products(sku,name,sale_price,cost_price) values('CHECKOUT-DECIMAL-029','Checkout decimal 0.29',0.29,0.10),('CHECKOUT-DECIMAL-057','Checkout decimal 0.57',0.57,0.10) returning id,sku");
 const firstDecimal=decimalProducts.find(row=>row.sku==='CHECKOUT-DECIMAL-029'),secondDecimal=decimalProducts.find(row=>row.sku==='CHECKOUT-DECIMAL-057');
 await sql.unsafe("insert into commerce_coupons(code,percent,minimum,usage_limit,expires_at) values('CHECKOUT-DECIMAL',10,0,10,now()+interval '1 day')");
 const decimalItems=[{id:firstDecimal.id,quantity:3},{id:secondDecimal.id,quantity:7}];
 const decimalPayload={...payload,requestKey:randomUUID(),coupon:'CHECKOUT-DECIMAL',expectedTotal:4.37,items:decimalItems,name:'  Checkout Contract  ',phone:'+994 (50) 123-45-67'};
 for(const invalidPhone of ['+994501234567abc','+994/50/1234567','+994\u00a0501234567','123456','1234567890123456','+++++++']){
  const rejected=await request('/api/customer-orders',{...decimalPayload,requestKey:randomUUID(),phone:invalidPhone});assert.equal(rejected.status,400,'Invalid phone is rejected before creating an order: '+JSON.stringify(invalidPhone));
 }
 assert.equal((await request('/api/customer-orders',{...decimalPayload,requestKey:randomUUID(),name:' A '})).status,400,'Name is validated after trimming, not only by raw HTML length');
 const [{n:beforeCheckout}]=await sql.unsafe('select count(*)::int n from sales_orders where account_id=$1',[checkoutAccount.id]);assert.equal(beforeCheckout,0,'Contact validation cannot create orders');
 const appliedCoupon=await request('/api/coupon',{code:'CHECKOUT-DECIMAL',items:decimalItems});assert.equal(appliedCoupon.status,200,JSON.stringify(appliedCoupon.data));assert.equal(appliedCoupon.data.discount,0.49);assert.equal(appliedCoupon.data.total,4.37,'Coupon and checkout use the same decimal subtotal');
 const concurrent=await Promise.all([request('/api/customer-orders',decimalPayload),request('/api/customer-orders',decimalPayload)]);
 for(const result of concurrent)assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(concurrent[0].data.order_no,concurrent[1].data.order_no,'Concurrent retries share one committed order number');
 const [decimalOrder]=await sql.unsafe('select id,total,customer_name_snapshot,customer_phone_snapshot from sales_orders where account_id=$1 and request_key=$2',[checkoutAccount.id,decimalPayload.requestKey]);assert.equal(Number(decimalOrder.total),4.37);assert.equal(decimalOrder.customer_name_snapshot,'Checkout Contract');assert.equal(decimalOrder.customer_phone_snapshot,decimalPayload.phone);
 const decimalLines=await sql.unsafe('select line_total from sales_order_items where sales_order_id=$1 order by line_total',[decimalOrder.id]);assert.deepEqual(decimalLines.map(row=>Number(row.line_total)),[0.87,3.99]);
 const [{n:committed}]=await sql.unsafe('select count(*)::int n from sales_orders where account_id=$1 and request_key=$2',[checkoutAccount.id,decimalPayload.requestKey]);assert.equal(committed,1,'Concurrent checkout inserts exactly one database order');
 const [usedCoupon]=await sql.unsafe("select used from commerce_coupons where code='CHECKOUT-DECIMAL'");assert.equal(usedCoupon.used,1,'Idempotent retry consumes the coupon only once');
 const staleOption=await request('/api/customer-orders',{...decimalPayload,requestKey:randomUUID(),coupon:'',expectedTotal:40,items:[{id:product.id,quantity:1}]});assert.equal(staleOption.status,400,'A stale basket without a now-required product choice is not silently charged at base price');
 const stalePrice=await request('/api/customer-orders',{...decimalPayload,requestKey:randomUUID(),coupon:'',expectedTotal:4.35});assert.equal(stalePrice.status,400,'An outdated expected total must be rejected, not accepted with an unconfirmed price');
 await sql.unsafe('update products set sale_price=0.39 where id=$1',[firstDecimal.id]);
 const committedRetry=await request('/api/customer-orders',decimalPayload);assert.equal(committedRetry.status,201,JSON.stringify(committedRetry.data));assert.equal(committedRetry.data.order_no,concurrent[0].data.order_no,'Committed request remains retryable after a catalogue price changes');
 const [stillOnce]=await sql.unsafe("select used from commerce_coupons where code='CHECKOUT-DECIMAL'");assert.equal(stillOnce.used,1);
 await sql.unsafe('update products set is_active=false where id in ($1,$2)',[firstDecimal.id,secondDecimal.id]);cookie=checkoutReturnCookie;
 console.log('PASS: strict phone/name validation, cent-price line and coupon totals, concurrent idempotency, one coupon use, stale option/price rejection and committed retry after price changes. Isolated checkout customer only.');
 // Preview stays in manual mode: no Google calls or billing in the UI fixture.
 await sql.unsafe("update delivery_settings set mode='manual',minimum_order=50,minimum_fee=3,price_per_km=1.2,server_key='',revision=revision+1 where id=1");
 await sql.unsafe("insert into product_options(product_id,label,size,color,price) values($1,'40 · Qırmızı','40','Qırmızı',70),($1,'50 · Yaşıl','50','Yaşıl',80)",[product.id]);
 await sql.unsafe("update customer_order_attempts set attempts=0,window_start=now() where account_id=$1",[account.data.user.id]);
 console.log('PASS: delivery quote required, tampered fee/address, expired/tariff-changed quote, post-coupon minimum, fee history, secret privacy and expiry-safe retry. No Google API calls.');
 console.log('PASS: customer registration/login, loopback cookies, order history, variant snapshots, retry idempotency, account isolation and logout. All data in isolated fixture database.');
 if(process.argv.includes('--serve')){console.log('UI fixture: '+origin+'/account | '+email+' | '+password);await new Promise(resolve=>{process.once('SIGINT',resolve);process.stdin.resume();process.stdin.once('data',resolve);});process.stdin.pause();}
}finally{server.kill();await sql.end({timeout:2});await db.close();}
