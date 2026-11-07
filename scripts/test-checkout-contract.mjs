import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// This test executes real validation/pricing/route code with an in-memory SQL
// adapter. It opens no HTTP server, database connection or external service.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const source=await readFile(file,'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};
 new Function('require','module','exports',code)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);
 return loaded.exports;
}
const contact=await load('lib/customer-contact.ts'),commerce=await load('lib/commerce.ts'),delivery=await load('lib/delivery.ts');
const attempts=await load('lib/checkout-attempt.ts',{'./customer-contact':contact,'@/lib/customer-contact':contact});
const browserPhone=new RegExp('^(?:'+contact.customerPhonePattern+')$','v');
const allowedPhones=['0501234567','+994501234567','+994 (50) 123-45-67','00994 50 123 45 67','(012) 345-67-89','0991234567','0601111111','+90 532 123 45 67','+7 916 123 45 67'];
const invalidPhones=['','123456','1234567','1234567890123456','+++++++','+994501234567abc','+994/50/1234567','+994\u00a0501234567','+994\t501234567','٠٥٠١٢٣٤٥٦٧','0500000000','+994990000000','0961234567'];
for(const phone of [...allowedPhones,...allowedPhones.map(value=>' '+value+' ')]){
 assert.equal(contact.isCustomerPhone(phone),true,phone);
 assert.equal(browserPhone.test(phone.trim()),true,'The actual HTML pattern must compile under v and accept normalized API-compatible phones');
}
for(const phone of invalidPhones)assert.equal(contact.isCustomerPhone(phone),false,JSON.stringify(phone));
for(const name of ['AB','  Aysel Məmmədova  ','姓名'])assert.equal(contact.isCustomerName(name),true,name);
for(const name of ['',' ',' A ','a'.repeat(101)])assert.equal(contact.isCustomerName(name),false,name);
assert.equal(contact.checkoutContactError({name:'Aysel Məmmədova',phone:allowedPhones[3]}),'');
assert.notEqual(contact.checkoutContactError({name:' A ',phone:allowedPhones[3]}),'');
assert.notEqual(contact.checkoutContactError({name:'Aysel Məmmədova',phone:invalidPhones[5]}),'');

const accountId='10000000-0000-4000-8000-000000000001',customerId='20000000-0000-4000-8000-000000000001';
const productA='30000000-0000-4000-8000-000000000001',productB='30000000-0000-4000-8000-000000000002';
const optionId='40000000-0000-4000-8000-000000000001',requestKey='50000000-0000-4000-8000-000000000001';
let fixture;
function reset(){fixture={products:new Map([[productA,{id:productA,name:'Decimal 0.29',sale_price:'0.29',discount_price:null}],[productB,{id:productB,name:'Decimal 0.57',sale_price:'0.57',discount_price:null}]]),requiredOptions:0,coupon:null,existing:null,calls:[],orders:[],lines:[],couponUsed:0,notifications:0,settings:null,quote:null};}
function database(){
 return {async unsafe(query,params=[]){
  fixture.calls.push({query,params});
  if(query.startsWith('select order_no from sales_orders'))return fixture.existing&&params[0]===fixture.existing.key&&params[1]===accountId?[{order_no:fixture.existing.number}]:[];
  if(query.startsWith('insert into customer_order_attempts'))return [{attempts:1}];
  if(query.includes('pg_advisory_xact_lock'))return [];
  if(query.startsWith('select count(*)::int n from sales_orders'))return [{n:0}];
  if(query.startsWith('select id,name,sale_price,discount_price from products'))return fixture.products.has(params[0])?[fixture.products.get(params[0])]:[];
  if(query.startsWith('select id,label,price,attributes from product_options'))return [];
  if(query.startsWith('select count(*) n from product_options'))return [{n:fixture.requiredOptions}];
  if(query.startsWith('select * from commerce_coupons'))return fixture.coupon?[fixture.coupon]:[];
  if(query.startsWith('update commerce_coupons')){fixture.couponUsed++;return [];}
  if(query.startsWith('select id from delivery_settings'))return [{id:1}];
  if(query.startsWith('select * from delivery_quotes'))return fixture.quote&&params[0]===fixture.quote.id&&params[1]===accountId&&params[2]===fixture.quote.settings_revision?[fixture.quote]:[];
  if(query.includes("nextval('catalog_order_seq')"))return [{order_no:'TEST-CHECKOUT-001'}];
  if(query.startsWith('insert into sales_orders')){fixture.orders.push(params);fixture.existing={key:params[4],number:'TEST-CHECKOUT-001'};return [{id:customerId,order_no:fixture.existing.number}];}
  if(query.startsWith('insert into sales_order_items')){fixture.lines.push(params);return [];}
  if(query.startsWith('insert into audit_logs'))return [];
  throw Error('Unexpected SQL in checkout contract test: '+query);
 },async begin(callback){return callback(this);},async end(){}};
}
const route=await load('app/api/customer-orders/route.ts',{
 '@/lib/store-db':{storeDb:database},'@/lib/customer-session':{customerAccount:async()=>({id:accountId,customer_id:customerId})},
 '@/lib/product-options':{optionSnapshot:option=>option.label},'@/lib/commerce':commerce,'@/lib/customer-contact':contact,
 '@/lib/delivery':delivery,
 '@/lib/delivery-server':{sameOriginMutation:()=>true,deliverySettings:()=>{assert.ok(fixture.settings,'Pickup must not load delivery settings');return fixture.settings;}},
 '@/lib/vexira':{vexiraSettings:async()=>({phones:['fixture-store']}),whatsappPhone:value=>value,notifyCatalogOrder:async()=>{fixture.notifications++;}},
});
const body=(overrides={})=>({requestKey,expectedTotal:4.86,coupon:'',fulfillment:'pickup',address:'',name:'  Aysel Məmmədova  ',phone:'+994 (50) 123-45-67',note:'',items:[{id:productA,quantity:3},{id:productB,quantity:7}],...overrides});
async function post(payload){const response=await route.POST(new Request('https://shop.example/api/customer-orders',{method:'POST',headers:{'content-type':'application/json',origin:'https://shop.example'},body:JSON.stringify(payload)}));return {status:response.status,data:await response.json()};}
for(const phone of invalidPhones){reset();const result=await post(body({phone}));assert.equal(result.status,400,'Server must reject '+JSON.stringify(phone));assert.equal(result.data.code,'INVALID_CHECKOUT');assert.ok(result.data.fields.includes('phone'));assert.equal(fixture.orders.length,0);assert.ok(fixture.calls.every(call=>call.query.startsWith('select order_no from sales_orders')),'Invalid contact permits only a committed-key read, never rate-limit or order mutations');}
for(const phone of allowedPhones){reset();const result=await post(body({phone}));assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(fixture.orders[0][10],'Aysel Məmmədova');assert.equal(fixture.orders[0][11],contact.normalizeCustomerPhone(phone));}
reset();assert.equal((await post(body({phone:' '+allowedPhones[3]+' '}))).status,201);assert.equal(fixture.orders[0][11],'+994501234567','The API persists a canonical international phone, not formatting or outer whitespace');
reset();assert.equal((await post(body({name:' A '}))).status,400);assert.equal(fixture.calls.length,0);
for(const address of ['sadasdasdas','qwertyqwerty','Test ünvanı 123','123456789','https://example.com']){
 reset();const result=await post(body({fulfillment:'delivery',address}));assert.equal(result.status,400,address);assert.ok(result.data.fields.includes('address'));assert.equal(fixture.orders.length,0);assert.ok(fixture.calls.every(call=>call.query.startsWith('select order_no from sales_orders')),'Invalid new delivery addresses cannot mutate SQL');
}
reset();fixture.existing={key:requestKey,number:'LEGACY-COMMITTED'};
const legacyRetry=await post(body({fulfillment:'delivery',address:'sadasdasdas',phone:'1234567'}));
assert.equal(legacyRetry.status,201,'A committed legacy snapshot remains recoverable under stronger validation');assert.equal(legacyRetry.data.order_no,'LEGACY-COMMITTED');assert.equal(fixture.calls.length,1);assert.equal(fixture.notifications,0);assert.equal(fixture.orders.length,0);

const storageValues=new Map(),storage={getItem:key=>storageValues.get(key)??null,setItem:(key,value)=>storageValues.set(key,value),removeItem:key=>storageValues.delete(key)};
const attempt={version:1,accountId,createdAt:new Date().toISOString(),payload:body(),itemNames:{[productA]:'Decimal product'}};
assert.equal(attempts.saveCheckoutAttempt(attempt,storage),true);
const savedValue=storageValues.get('customer-checkout-attempt:'+accountId);
for(const invalid of [{phone:'+994501234567abc'},{name:' A '}]){
 assert.equal(attempts.saveCheckoutAttempt({...attempt,payload:{...attempt.payload,...invalid}},storage),false,'New invalid contact must not be persisted');
 assert.equal(storageValues.get('customer-checkout-attempt:'+accountId),savedValue,'A rejected save must not overwrite an existing uncertain attempt');
}
const legacy={...attempt,payload:{...attempt.payload,phone:'+994501234567abc'}};
storage.setItem('customer-checkout-attempt:'+accountId,JSON.stringify(legacy));
const recovered=attempts.readCheckoutAttempt(accountId,storage);assert.equal(recovered.status,'pending','Legacy snapshots remain readable even if today\'s contact validator would reject a fresh submission');assert.equal(recovered.attempt.payload.phone,legacy.payload.phone);
for(const status of [401,429,500,503])assert.equal(attempts.isDefinitiveCheckoutRejection(status),false,'Uncertain or unauthenticated failures must keep their request key: '+status);
assert.equal(attempts.isDefinitiveCheckoutRejection(400),true);

// Evaluate the cart's real subtotal expression rather than copying a second
// frontend money formula into this test. Every tested price is a DB-valid cent.
const cartSource=await readFile('app/cart-sheet.tsx','utf8'),tree=ts.createSourceFile('cart-sheet.tsx',cartSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let subtotalExpression;
function findSubtotal(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='subtotal')subtotalExpression=node.initializer?.getText(tree);ts.forEachChild(node,findSubtotal);}findSubtotal(tree);
assert.ok(subtotalExpression,'Cart subtotal initializer must be inspectable');
const clientSubtotal=new Function('lines',...Object.keys(commerce),'return ('+subtotalExpression+');');
for(const lines of [[{linePrice:0.29,quantity:3},{linePrice:0.57,quantity:7}],[{linePrice:19.99,quantity:3},{linePrice:0.01,quantity:7}],[{linePrice:999999.99,quantity:100},{linePrice:0.09,quantity:97}]]){
 const client=clientSubtotal(lines,...Object.values(commerce)),server=Number(lines.reduce((sum,line)=>sum+Math.round(line.linePrice*line.quantity*100)/100,0).toFixed(2));assert.equal(client,server,'Client subtotal must match server-rounded decimal lines');
}
reset();fixture.coupon={id:optionId,code:'DECIMAL',used:0,usage_limit:10,minimum:'0',percent:10,max_discount:null};
const payload=body({coupon:'DECIMAL',expectedTotal:4.37}),created=await post(payload);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(fixture.orders[0][2],4.37);assert.deepEqual(fixture.lines.map(values=>values[6]),[0.87,3.99]);assert.equal(fixture.couponUsed,1);
fixture.products.get(productA).sale_price='5.00';
const retry=await post(payload);assert.equal(retry.status,201);assert.equal(retry.data.order_no,created.data.order_no);assert.equal(fixture.orders.length,1);assert.equal(fixture.couponUsed,1);assert.equal(fixture.notifications,1,'Committed retry does not send a second notification');
reset();fixture.requiredOptions=1;assert.equal((await post(body())).status,400,'Required choices cannot be silently dropped');assert.equal(fixture.orders.length,0);
reset();assert.equal((await post(body({items:[{id:productA,optionId,quantity:3}],expectedTotal:0.87}))).status,400,'Removed choice ID must be rejected');assert.equal(fixture.orders.length,0);
reset();assert.equal((await post(body({expectedTotal:4.85}))).status,400,'Changed prices cannot be silently accepted');assert.equal(fixture.orders.length,0);

// Execute authoritative free-delivery pricing in the actual order handler.
// The quote's stored fee and extra client fields are deliberately untrustworthy.
function deliveryFixture(price,{quote=true,fee='0.00'}={}){
 reset();fixture.products.get(productA).sale_price=String(price);
 fixture.settings={mode:'distance',minimumOrder:0,minimumFee:0,pricePerKm:1,freeDistanceKm:2,freeOrderFrom:30,revision:7};
 if(quote)fixture.quote={id:optionId,address:'Nizami küçəsi',distance_meters:5000,fee,lat:40.4,lng:49.8,settings_revision:7};
 return body({fulfillment:'delivery',address:'Nizami küçəsi',deliveryQuoteId:quote?optionId:null,items:[{id:productA,quantity:1}],expectedTotal:Number(price)+(price>=30?0:3)});
}
let deliveryPayload=deliveryFixture(20);
let deliveryResult=await post({...deliveryPayload,goodsTotal:30,subtotal:30,deliveryFee:0});
assert.equal(deliveryResult.status,201,JSON.stringify(deliveryResult.data));assert.equal(fixture.orders[0][12],3);assert.equal(fixture.orders[0][2],23,'Below-threshold delivery uses server prices and kilometres after the first free 2 km, not forged totals or quote.fee');
deliveryPayload=deliveryFixture(20);
assert.equal((await post({...deliveryPayload,expectedTotal:20,goodsTotal:30,deliveryFee:0})).status,400,'Forging a free total cannot erase the server-owned delivery fee');assert.equal(fixture.orders.length,0);
deliveryPayload=deliveryFixture(30,{quote:false});
deliveryResult=await post(deliveryPayload);assert.equal(deliveryResult.status,201,JSON.stringify(deliveryResult.data));assert.equal(fixture.orders[0][12],0);assert.equal(fixture.orders[0][13],null);assert.equal(fixture.orders[0][16],'distance','The exact free threshold supports a meaningful manual address without a quote or fabricated coordinates');
deliveryPayload=deliveryFixture(29.99,{quote:false});
assert.equal((await post({...deliveryPayload,expectedTotal:29.99,goodsTotal:30})).status,400,'29.99 goods cannot claim the 30 AZN manual-address exemption');assert.equal(fixture.orders.length,0);
deliveryPayload=deliveryFixture(30,{fee:'999.00'});
deliveryResult=await post(deliveryPayload);assert.equal(deliveryResult.status,201,JSON.stringify(deliveryResult.data));assert.equal(fixture.orders[0][12],0,'A valid quote cannot charge a free eligible order its stored pre-threshold fee');
deliveryPayload=deliveryFixture(30,{quote:false});fixture.coupon={id:optionId,code:'BELOW-FREE',used:0,usage_limit:10,minimum:'0',percent:10,max_discount:null};
assert.equal((await post({...deliveryPayload,coupon:'BELOW-FREE',expectedTotal:27})).status,400,'A coupon that reduces goods below 30 restores the required distance quote');assert.equal(fixture.orders.length,0);
deliveryPayload=deliveryFixture(30);fixture.coupon={id:optionId,code:'BELOW-FREE',used:0,usage_limit:10,minimum:'0',percent:10,max_discount:null};
deliveryResult=await post({...deliveryPayload,coupon:'BELOW-FREE',expectedTotal:30});assert.equal(deliveryResult.status,201,JSON.stringify(deliveryResult.data));assert.equal(fixture.orders[0][12],3);assert.equal(fixture.orders[0][2],30,'Below-threshold net goods27 plus delivery3 is recomputed after coupons');
for(const change of [{deliveryQuoteId:customerId},{address:'Başqa küçəsi'}]){
 deliveryPayload=deliveryFixture(30);assert.equal((await post({...deliveryPayload,...change})).status,400,'An explicitly supplied invalid quote is not ignored even when goods qualify for free delivery');assert.equal(fixture.orders.length,0);
}

assert.match(cartSource,/checkoutContactError/,'Review and final submission use shared contact validation');
assert.match(cartSource,/pattern=\{customerPhonePattern\}/,'Browser pattern must use the same maintained contract');
console.log('PASS: real checkout contact/address/API parity, canonical phones, HTML v-pattern, legacy committed retry, decimal/coupon totals, stale choices/prices, duplicate prevention and authoritative 30-AZN/2-km free-delivery boundaries including manual-address and forged-total cases. No server or live data used.');
