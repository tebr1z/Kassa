import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// No database, browser or external provider is contacted. All HTTP requests are
// native Request objects passed directly to the real transpiled route handlers.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const source=await readFile(path,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);
 return loaded.exports;
}
const delivery=await load('lib/delivery.ts');
const customerContact=await load('lib/customer-contact.ts');
const country=await load('lib/azerbaijan-location.ts');
const openRouting=await load('lib/open-routing.ts',{'./azerbaijan-location':country});
const deliveryServer=await load('lib/delivery-server.ts',{'./open-routing':openRouting});
const adminSecurity=await load('lib/admin-security.ts');
const staffAccess=await load('lib/staff-access.ts');
const inventory=await load('lib/inventory-mode.ts');
const accountId='10000000-0000-4000-8000-000000000001';
const userId='20000000-0000-4000-8000-000000000001';
const quoteId='30000000-0000-4000-8000-000000000001';
const productId='40000000-0000-4000-8000-000000000001';
const requestKey='50000000-0000-4000-8000-000000000001';
let fixture;
const baseRow=()=>({id:1,mode:'distance',minimum_order:'0',minimum_fee:'3.00',price_per_km:'1.25',free_distance_km:'0',free_order_from:null,origin_address:'Bakı, mərkəz ünvanı 1',origin_lat:40.4093,origin_lng:49.8671,browser_key:'fake-browser-key',server_key:'fake-server-key',revision:7});
const freeRow=()=>({...baseRow(),minimum_fee:'0',price_per_km:'1',free_distance_km:'2',free_order_from:'30'});
const routingBody=(distance=4321)=>({code:'Ok',routes:[{distance}],waypoints:[{distance:0},{distance:0}]});
function reset(overrides={}){
 fixture={row:baseRow(),account:{id:accountId,customer_id:userId},session:{id:userId,role:'admin'},sqlCalls:[],ended:0,providerCalls:[],providerResponse:routingBody(),providerStatus:200,limitGlobal:1,limitAccount:1,orderAttempts:1,recentOrders:0,quotes:[],audit:[],product:{id:productId,name:'Manqal',sale_price:'20.00',discount_price:'15.00'},coupon:null,orderRows:[],orderItems:[],notified:0,orderLookups:0,...overrides};
 return fixture;
}
function database(){
 return {
  async unsafe(query,params=[]){
   fixture.sqlCalls.push({query,params});
   if(query.includes('from auth_sessions'))return fixture.session?[fixture.session]:[];
   if(query.startsWith('select * from delivery_settings'))return fixture.row?[{...fixture.row}]:[];
   if(query.startsWith('select id from delivery_settings'))return [{id:1}];
   if(query.startsWith('update delivery_settings')){
    const [mode,minimum_order,minimum_fee,price_per_km,origin_address,origin_lat,origin_lng,free_distance_km,free_order_from]=params;
    fixture.row={...fixture.row,mode,minimum_order,minimum_fee,price_per_km,origin_address,origin_lat,origin_lng,free_distance_km,free_order_from,revision:fixture.row.revision+1};return [];
   }
   if(query.includes('insert into audit_logs')){fixture.audit.push(params.map(value=>{try{return JSON.parse(value);}catch{return value;}}));return [];}
   if(query.includes('insert into delivery_quote_limits'))return [{attempts:params[0]==='global'?fixture.limitGlobal:fixture.limitAccount}];
   if(query.startsWith('insert into delivery_quotes')){fixture.quotes.push(params);return [{id:quoteId,expires_at:new Date(Date.now()+600000).toISOString()}];}
   if(query.startsWith('delete from delivery_quotes'))return [];
   if(query.startsWith('select order_no from sales_orders')){fixture.orderLookups++;return fixture.priorOrder||fixture.racingOrder&&fixture.orderLookups>1?[{order_no:fixture.priorOrder||fixture.racingOrder}]:[];}
   if(query.startsWith('insert into customer_order_attempts'))return [{attempts:fixture.orderAttempts}];
   if(query.includes('pg_advisory_xact_lock'))return [];
   if(query.startsWith('select count(*)::int n from sales_orders'))return [{n:fixture.recentOrders}];
   if(query.startsWith('select id,name,sale_price,discount_price from products'))return fixture.product?[{...fixture.product}]:[];
   if(query.startsWith('select count(*) n from product_options'))return [{n:0}];
   if(query.startsWith('select * from commerce_coupons'))return fixture.coupon?[fixture.coupon]:[];
   if(query.startsWith('update commerce_coupons'))return [];
   if(query.startsWith('select * from delivery_quotes')){
    const q=fixture.existingQuote;
    return q&&params[0]===q.id&&params[1]===q.account_id&&params[2]===q.settings_revision&&Date.parse(q.expires_at)>Date.now()?[q]:[];
   }
   if(query.includes("nextval('catalog_order_seq')"))return [{order_no:'TEST-001'}];
   if(query.startsWith('insert into sales_orders')){fixture.orderRows.push(params);return [{id:userId,order_no:'TEST-001'}];}
   if(query.startsWith('insert into sales_order_items')){fixture.orderItems.push(params);return [];}
   throw new Error('Unexpected mocked SQL: '+query);
  },
  async begin(callback){const saved={orderRows:[...fixture.orderRows],orderItems:[...fixture.orderItems],audit:[...fixture.audit]};try{return await callback(this);}catch(error){Object.assign(fixture,saved);throw error;}},
  async end(){fixture.ended++;},
 };
}
const dbMock={storeDb:database};
const customerMock={customerAccount:async()=>fixture.account};
const adminGuard=await load('lib/require-admin.ts',{'@/lib/store-db':dbMock,'@/lib/admin-security':adminSecurity,'@/lib/staff-access':staffAccess,'@/lib/inventory-mode':inventory});
const admin=await load('app/api/admin/delivery/route.ts',{'@/lib/require-admin':adminGuard,'@/lib/store-db':dbMock,'@/lib/delivery-server':deliveryServer,'@/lib/open-routing':openRouting,'@/lib/azerbaijan-location':country});
const quote=await load('app/api/delivery-quote/route.ts',{'@/lib/store-db':dbMock,'@/lib/customer-session':customerMock,'@/lib/delivery-server':deliveryServer,'@/lib/delivery':delivery,'@/lib/open-routing':openRouting,'@/lib/azerbaijan-location':country,'@/lib/customer-contact':customerContact});
const publicRoute=await load('app/api/delivery-settings/route.ts',{'@/lib/store-db':dbMock,'@/lib/delivery-server':deliveryServer});
const orders=await load('app/api/customer-orders/route.ts',{
 '@/lib/customer-contact':customerContact,
 '@/lib/delivery':delivery,
 '@/lib/store-db':dbMock,'@/lib/customer-session':customerMock,'@/lib/delivery-server':deliveryServer,
 '@/lib/product-options':{optionSnapshot:option=>option.label},
 '@/lib/commerce':{sellingPrice:product=>Number(product.discount_price||product.sale_price),couponDiscount:(subtotal,percent,max)=>Math.min(Math.round(subtotal*percent)/100,max??Infinity)},
 '@/lib/vexira':{vexiraSettings:async()=>({phones:['test-store-phone']}),whatsappPhone:value=>value,notifyCatalogOrder:async()=>{fixture.notified++;}},
});
const previousFetch=globalThis.fetch,previousEnv=Object.fromEntries(['GOOGLE_MAPS_SERVER_KEY','OPEN_ROUTING_URL'].map(name=>[name,process.env[name]]));
process.env.OPEN_ROUTING_URL='http://127.0.0.1:5099';
process.env.GOOGLE_MAPS_SERVER_KEY='unused-legacy-google-secret';
globalThis.fetch=async(url,options)=>{
 fixture.providerCalls.push({url,options});
 if(fixture.providerError)throw new Error('Mock provider failure');
 return Response.json(fixture.providerResponse,{status:fixture.providerStatus});
};
const nativeRequest=(path,body,extra={})=>new Request('https://shop.example'+path,{method:body===undefined?'GET':'POST',headers:{host:'shop.example',origin:'https://shop.example',cookie:'birkassa_session=test-session','content-type':'application/json',...extra.headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='headers'))});
const quoteRequest=(body={address:'Bakı, müştəri ünvanı 25',lat:40.4,lng:49.8},extra={})=>nativeRequest('/api/delivery-quote',body,extra);
const adminBody=(changes={})=>({mode:'manual',minimumOrder:15,minimumFee:0,pricePerKm:1,freeDistanceKm:2,freeOrderFrom:30,originAddress:'Bakı, Nizami küçəsi 10',originLat:40,originLng:49,...changes});
const orderBody=(changes={})=>({requestKey,expectedTotal:20.41,deliveryQuoteId:quoteId,coupon:'',fulfillment:'delivery',address:'Bakı, müştəri ünvanı 25',name:'Sınaq alıcı',phone:'+994501234567',note:'',items:[{id:productId,quantity:1}],...changes});
const storedQuote=(changes={})=>({id:quoteId,account_id:accountId,address:'Bakı, müştəri ünvanı 25',lat:40.4,lng:49.8,distance_meters:4321,fee:'5.41',settings_revision:7,expires_at:new Date(Date.now()+600000).toISOString(),...changes});

try{
 assert.equal(delivery.deliveryFee(4321,1.25,3),5.41,'Uses exact metres and rounds up to a cent, not a whole km');
 assert.equal(delivery.deliveryFee(100,1.25,3),3,'The minimum fee is a floor');
 assert.equal(delivery.deliveryFee(1000,1.23,0),1.23,'An exact cent must not become the next cent');
 assert.equal(delivery.deliveryFee(1,0.01,0),0.01,'Any positive fractional-cent amount rounds up');
 assert.equal(delivery.deliveryFee(12345,0.8,3),9.88);
 for(const args of [[0,1,0],[-1,1,0],[2000001,1,0],[NaN,1,0],[100,0,0],[100,-1,0],[100,Infinity,0],[100,1,-1],[100,1,NaN]])assert.throws(()=>delivery.deliveryFee(...args));
 const q={id:quoteId,address:'Bakı, tam ünvan',lat:40.4,lng:49.8,expiresAt:'2030-01-01T00:10:00.000Z'};
 const now=Date.parse('2030-01-01T00:00:00.000Z');
 assert.equal(delivery.matchingDeliveryQuote(q,'  Bakı, tam ünvan ',{lat:40.4,lng:49.8},now),true);
 const canonicalAddress='Bakı, Şəki küçəsi 10',formattedAddress='  '+canonicalAddress.normalize('NFD').replace(', ', ',\n  ')+'  ';
 assert.equal(delivery.matchingDeliveryQuote({...q,address:formattedAddress},canonicalAddress,{lat:40.4,lng:49.8},now),true,'Legacy multiline/decomposed quote address matches its NFC/whitespace equivalent');
 assert.equal(delivery.matchingDeliveryQuote({...q,address:canonicalAddress},formattedAddress,{lat:40.4,lng:49.8},now),true,'Current typed address and stored quote use the same normalization');
 for(const [value,address,pin,time]of [[null,q.address,{lat:40.4,lng:49.8},now],[q,'Fərqli ünvan',{lat:40.4,lng:49.8},now],[q,q.address,null,now],[q,q.address,{lat:40.5,lng:49.8},now],[q,q.address,{lat:40.4,lng:49.9},now],[q,q.address,{lat:40.4,lng:49.8},Date.parse(q.expiresAt)]])assert.equal(delivery.matchingDeliveryQuote(value,address,pin,time),false);

 const freeSettings={pricePerKm:1,minimumFee:0,freeDistanceKm:2,freeOrderFrom:30};
 for(const [meters,goods,fee]of [[1,15,0],[2000,29.99,0],[2001,29.99,0.01],[2500,29.99,0.5],[5000,29.99,3],[5000,30,0],[5000,30.01,0],[5000,undefined,3]])assert.equal(delivery.deliveryCharge(freeSettings,meters,goods),fee);
 assert.equal(delivery.deliveryCharge({...freeSettings,minimumFee:3},2000,15),0,'A minimum fee cannot charge for a wholly free distance');
 assert.equal(delivery.deliveryCharge({...freeSettings,minimumFee:3},2001,15),3,'The minimum fee still applies to positive chargeable distance');
 assert.equal(delivery.deliveryCharge({pricePerKm:1.25,minimumFee:3},4321),5.41,'Old configurations default to no free-distance allowance');
 for(const changes of [{pricePerKm:0},{minimumFee:-1},{freeDistanceKm:-1},{freeDistanceKm:10001},{freeDistanceKm:NaN},{freeOrderFrom:-1},{freeOrderFrom:Infinity}])assert.throws(()=>delivery.deliveryCharge({...freeSettings,...changes},5000,15));
 for(const [meters,goods]of [[0,15],[-1,15],[2000001,15],[5000,-1],[5000,NaN]])assert.throws(()=>delivery.deliveryCharge(freeSettings,meters,goods));

 reset();let response=await publicRoute.GET();assert.equal(response.status,200);let data=await response.json();assert.ok(!data.settings.browserKey,'No Google browser key is exposed or required');assert.equal(data.settings.originLat,40.4093);assert.equal('serverKey'in data.settings,false);assert.equal('serverConfigured'in data.settings,false);assert.equal('revision'in data.settings,false);assert.equal(data.settings.routingConfigured,true);assert.equal(data.settings.freeDistanceKm,0);assert.equal(data.settings.freeOrderFrom,null);assert.equal(JSON.stringify(data).includes('fake-'),false);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(fixture.ended,1);
 reset({row:freeRow()});data=await(await publicRoute.GET()).json();assert.equal(data.settings.freeDistanceKm,2);assert.equal(data.settings.freeOrderFrom,30);
 reset({row:{...baseRow(),origin_lat:null,origin_lng:null}});data=await(await publicRoute.GET()).json();assert.equal(data.settings.originLat,null,'Unconfigured coordinates remain null, never accidental 0');assert.equal(data.settings.originLng,null);
 reset({row:null});assert.equal((await publicRoute.GET()).status,503);
 reset();let settings=await deliveryServer.deliverySettings(database());assert.equal(settings.serverKey,'fake-server-key');assert.equal(settings.revision,7);assert.equal('serverKey'in deliveryServer.customerDeliverySettings(settings),false);
 for(const [headers,expected]of [[{},true],[{origin:'https://evil.example'},false],[{'sec-fetch-site':'cross-site'},false],[{origin:'https://shop.example','sec-fetch-site':'same-origin'},true]])assert.equal(deliveryServer.sameOriginMutation(nativeRequest('/api/customer-orders',{}, {headers})),expected);

 reset({session:null});assert.equal((await admin.GET(nativeRequest('/api/admin/delivery'))).status,401);assert.equal(fixture.sqlCalls.length,1);
 reset();assert.equal((await admin.GET(nativeRequest('/api/admin/delivery',undefined,{headers:{cookie:''}}))).status,401);assert.equal(fixture.sqlCalls.length,0);
 reset({session:{id:userId,role:'cashier'}});assert.equal((await admin.GET(nativeRequest('/api/admin/delivery'))).status,403);
 reset();assert.equal((await admin.POST(nativeRequest('/api/admin/delivery',adminBody(),{headers:{origin:'https://evil.example'}}))).status,403);assert.equal(fixture.sqlCalls.length,0,'Cross-origin admin POST is rejected before database access');
 reset();assert.equal((await admin.POST(new Request('http://shop.example/api/admin/delivery',{method:'POST',headers:{host:'shop.example',cookie:'birkassa_session=test'},body:'{}'}))).status,426);
 reset();response=await admin.GET(nativeRequest('/api/admin/delivery'));assert.equal(response.status,200);data=await response.json();assert.equal(data.settings.routingConfigured,true);assert.equal('serverConfigured'in data.settings,false);assert.equal('serverKey'in data.settings,false);assert.equal('revision'in data.settings,false);assert.equal(response.headers.get('cache-control'),'private, no-store');
 for(const invalid of ['{broken',adminBody({minimumFee:-1}),adminBody({pricePerKm:'1'}),adminBody({originLat:''}),adminBody({originLat:91}),adminBody({originLng:181}),adminBody({freeDistanceKm:-1}),adminBody({freeDistanceKm:10001}),adminBody({freeDistanceKm:'2'}),adminBody({freeOrderFrom:-1}),adminBody({freeOrderFrom:'30'})]){reset();assert.equal((await admin.POST(nativeRequest('/api/admin/delivery',invalid))).status,400);assert.equal(fixture.audit.length,0);}
 reset();assert.equal((await admin.POST(nativeRequest('/api/admin/delivery',adminBody(),{headers:{'content-length':'5001'}}))).status,413);
 reset();response=await admin.POST(nativeRequest('/api/admin/delivery',adminBody()));assert.equal(response.status,200);data=await response.json();assert.equal(data.settings.mode,'manual');assert.equal(data.settings.minimumOrder,15);assert.equal(data.settings.freeDistanceKm,2);assert.equal(data.settings.freeOrderFrom,30);assert.equal(fixture.row.free_distance_km,2);assert.equal(fixture.row.free_order_from,30);assert.equal(fixture.row.revision,8);assert.equal(JSON.stringify(fixture.audit).includes('fake-server-key'),false);assert.equal(JSON.stringify(data).includes('fake-server-key'),false);assert.equal(fixture.audit.at(-1)[0],userId,'Audit actor comes from the verified session');
 for(const legacy of [{browserKey:'replacement-browser-secret',serverKey:'replacement-secret'},{clearServerKey:true}]){reset();response=await admin.POST(nativeRequest('/api/admin/delivery',adminBody(legacy)));assert.equal(response.status,200);assert.equal(fixture.row.server_key,'fake-server-key','Retired key controls cannot mutate legacy secrets');assert.equal(fixture.row.browser_key,'fake-browser-key');assert.equal(JSON.stringify(fixture.audit).includes('replacement-secret'),false);assert.equal(JSON.stringify(await response.json()).includes('replacement-secret'),false);}
 for(const invalid of [{originLat:null},{originLng:null},{originAddress:''},{pricePerKm:0},{originLat:0,originLng:0},{originLat:40,originLng:44}]){reset();assert.equal((await admin.POST(nativeRequest('/api/admin/delivery',adminBody({mode:'distance',...invalid})))).status,400);assert.equal(fixture.audit.length,0);}
 reset();response=await admin.POST(nativeRequest('/api/admin/delivery',adminBody({mode:'distance',originLat:39.2,originLng:45.4})));assert.equal(response.status,200,'Azerbaijan bounds include Nakhchivan');
 delete process.env.OPEN_ROUTING_URL;reset();assert.equal((await admin.POST(nativeRequest('/api/admin/delivery',adminBody({mode:'distance'})))).status,400);assert.equal(fixture.audit.length,0);process.env.OPEN_ROUTING_URL='http://127.0.0.1:5099';

 reset({account:null});assert.equal((await quote.POST(quoteRequest())).status,401);assert.equal(fixture.sqlCalls.length,0);
 reset();assert.equal((await quote.POST(quoteRequest(undefined,{headers:{origin:'https://evil.example'}}))).status,403);assert.equal(fixture.providerCalls.length,0);
 reset();assert.equal((await quote.POST(quoteRequest(undefined,{headers:{'sec-fetch-site':'cross-site'}}))).status,403);
 reset();assert.equal((await quote.POST(quoteRequest(undefined,{headers:{'content-length':'3001'}}))).status,413);
 for(const invalid of ['{broken',{address:'a',lat:40,lng:49},{address:'Long enough address',lat:'40',lng:49},{address:'Long enough address',lat:91,lng:49},{address:'Long enough address',lat:40,lng:-181},{address:'Long enough address',lat:null,lng:49},{address:'Bakı, Nizami küçəsi 10',lat:0,lng:0},{address:'test test test',lat:40,lng:49}]){reset();assert.equal((await quote.POST(quoteRequest(invalid))).status,400,JSON.stringify(invalid));assert.equal(fixture.providerCalls.length,0);assert.equal(fixture.sqlCalls.length,0);}
 for(const row of [{mode:'manual'},{origin_lat:null},{origin_lng:null}]){reset({row:{...baseRow(),...row}});assert.equal((await quote.POST(quoteRequest())).status,400);assert.equal(fixture.providerCalls.length,0);assert.equal(fixture.quotes.length,0);}
 delete process.env.OPEN_ROUTING_URL;reset();assert.equal((await quote.POST(quoteRequest())).status,400);assert.equal(fixture.providerCalls.length,0);process.env.OPEN_ROUTING_URL='http://127.0.0.1:5099';
 for(const counts of [{limitGlobal:201},{limitAccount:21}]){reset(counts);response=await quote.POST(quoteRequest());assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'600');assert.equal(fixture.providerCalls.length,0);assert.equal(fixture.quotes.length,0);}
 reset();response=await quote.POST(quoteRequest({address:'  Bakı, müştəri ünvanı 25  ',lat:40.4,lng:49.8}));assert.equal(response.status,200);data=await response.json();assert.equal(data.quote.fee,5.41);assert.equal(data.quote.distanceMeters,4321);assert.equal(data.quote.address,'Bakı, müştəri ünvanı 25');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(fixture.providerCalls.length,1);assert.equal(fixture.ended,1);
 const provider=fixture.providerCalls[0],providerUrl=new URL(provider.url);assert.equal(providerUrl.origin,'http://127.0.0.1:5099');assert.equal(providerUrl.pathname,'/route/v1/driving/49.867100,40.409300;49.800000,40.400000');assert.equal(providerUrl.searchParams.get('overview'),'false');assert.equal(providerUrl.searchParams.get('steps'),'false');assert.equal(providerUrl.searchParams.get('alternatives'),'false');assert.equal(providerUrl.searchParams.get('radiuses'),'1000;1000');assert.equal(provider.options.redirect,'error');assert.equal(provider.options.cache,'no-store');assert.ok(!provider.options.body);assert.ok(!provider.options.headers,'No Google key or other paid-provider headers');assert.ok(provider.options.signal instanceof AbortSignal);assert.equal(fixture.quotes[0][0],accountId);assert.equal(fixture.quotes[0][5],5.41);assert.equal(fixture.quotes[0][6],7);assert.equal(JSON.stringify(data).includes('fake-server-key'),false);
 reset({row:{...baseRow(),server_key:''},providerResponse:routingBody(100)});data=await(await quote.POST(quoteRequest())).json();assert.equal(data.quote.fee,3,'Self-hosted routing does not need a Google key');
 reset({providerResponse:routingBody(5.5)});data=await(await quote.POST(quoteRequest())).json();assert.equal(data.quote.distanceMeters,6,'OSRM fractional metres are rounded up, not rejected or rounded by km');
 for(const failure of [{providerError:true},{providerStatus:403,providerResponse:{error:{message:'secret internal provider detail'}}},{providerStatus:429},{providerResponse:{...routingBody(),routes:[]}},{providerResponse:{}},...[0,-5,'4321',2000001].map(distance=>({providerResponse:routingBody(distance)})),{providerResponse:{...routingBody(),code:'NoRoute'}},{providerResponse:{...routingBody(),waypoints:[]}},{providerResponse:{...routingBody(),waypoints:[{distance:0},{distance:1001}]}},{providerResponse:{...routingBody(),waypoints:[{distance:-1},{distance:0}]}},{providerResponse:{...routingBody(),waypoints:[{},{}]}}]){reset(failure);response=await quote.POST(quoteRequest());assert.equal(response.status,503);assert.equal(fixture.quotes.length,0);assert.equal(fixture.ended,1);assert.equal(JSON.stringify(await response.json()).includes('secret internal'),false);}
 for(const endpoint of ['https://router.project-osrm.org','https://maps.example','http://45.59.70.162:5099','http://127.0.0.1:5099/private','http://user:secret@127.0.0.1:5099']){process.env.OPEN_ROUTING_URL=endpoint;assert.equal(openRouting.openRoutingConfigured(),false);reset();await assert.rejects(openRouting.roadDistance({lat:40.4,lng:49.8},{lat:40.5,lng:49.9}));assert.equal(fixture.providerCalls.length,0);}
 process.env.OPEN_ROUTING_URL='http://127.0.0.1:5099';reset();await assert.rejects(openRouting.roadDistance({lat:0,lng:0},{lat:40.5,lng:49.9}));assert.equal(fixture.providerCalls.length,0);
 reset({row:freeRow(),providerResponse:routingBody(5000)});response=await quote.POST(quoteRequest({address:'Bakı, müştəri ünvanı 25',lat:40.4,lng:49.8,goodsTotal:9999,subtotal:9999,fee:0}));assert.equal(response.status,200);data=await response.json();assert.equal(data.quote.fee,3,'Client basket/fee claims do not make a preliminary quote free');
 reset({row:freeRow(),providerResponse:routingBody(2000)});data=await(await quote.POST(quoteRequest())).json();assert.equal(data.quote.fee,0,'First two km are free even below the free-order threshold');

 reset({existingQuote:storedQuote()});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody()));assert.equal(response.status,201);assert.equal(fixture.orderRows[0][2],20.41);assert.equal(fixture.orderRows[0][12],5.41,'Order persists the server quote fee');assert.equal(fixture.orderRows[0][13],4321);assert.equal(fixture.orderRows[0][16],'distance');assert.equal(fixture.notified,1);
 reset();response=await quote.POST(quoteRequest({address:formattedAddress,lat:40.4,lng:49.8}));assert.equal(response.status,200);data=await response.json();assert.equal(data.quote.address,canonicalAddress);assert.equal(fixture.quotes[0][1],canonicalAddress,'New quotes persist the canonical address, not only outer trim');fixture.existingQuote=storedQuote({address:data.quote.address});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({address:formattedAddress})));assert.equal(response.status,201,'A multiline/NFD input can proceed from quote to order without a false stale-quote error');assert.equal(fixture.orderRows[0][7],canonicalAddress);
 reset({existingQuote:storedQuote({address:formattedAddress})});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({address:canonicalAddress})));assert.equal(response.status,201,'Unexpired legacy quotes remain usable after canonical normalization is introduced');assert.equal(fixture.orderRows[0][7],canonicalAddress);
 for(const existingQuote of [undefined,storedQuote({account_id:userId}),storedQuote({settings_revision:6}),storedQuote({expires_at:new Date(Date.now()-1).toISOString()}),storedQuote({address:'Other address entirely'})]){reset({existingQuote});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody()))).status,400);assert.equal(fixture.orderRows.length,0);}
 reset({existingQuote:storedQuote()});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody({expectedTotal:15})))).status,400,'Expected total cannot silently omit the delivery fee');assert.equal(fixture.orderRows.length,0);
 reset({row:{...baseRow(),minimum_order:'16.00'},existingQuote:storedQuote()});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody()))).status,400,'Delivery minimum is evaluated on discounted goods, not goods + fee');
 reset({row:{...baseRow(),minimum_order:'14.00'},coupon:{id:userId,used:0,usage_limit:10,minimum:'0',percent:10,max_discount:null},existingQuote:storedQuote()});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody({coupon:'TEN',expectedTotal:18.91})))).status,400,'Coupon discount is included before checking the delivery minimum');
 reset({row:{...baseRow(),minimum_order:'1000.00'}});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({fulfillment:'pickup',address:'',deliveryQuoteId:null,expectedTotal:15})));assert.equal(response.status,201,'Store pickup is unaffected by a delivery minimum or absent quote');assert.equal(fixture.orderRows[0][12],0);assert.equal(fixture.orderRows[0][13],null);
 reset({row:{...baseRow(),mode:'manual'}});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({deliveryQuoteId:null,expectedTotal:15})));assert.equal(response.status,201);assert.equal(fixture.orderRows[0][12],0);assert.equal(fixture.orderRows[0][16],'manual','Manual fee is explicitly not represented as a calculated delivery charge');
 reset({row:{...baseRow(),mode:'manual'}});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody()))).status,400,'Changed pricing mode invalidates an old automatic quote');
 // Thresholds use authoritative discounted goods after coupons, never totals,
 // delivery charges, a client subtotal or the preliminary quote's stored fee.
 const pricedProduct=price=>({id:productId,name:'Manqal',sale_price:'100.00',discount_price:String(price)});
 const freeQuote=changes=>storedQuote({distance_meters:5000,fee:'999.99',...changes});
 for(const price of [30,30.01,100]){
  reset({row:freeRow(),product:pricedProduct(price)});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({deliveryQuoteId:null,expectedTotal:price})));assert.equal(response.status,201,'Free eligible order accepts a meaningful manual address without routing');assert.equal(fixture.orderRows[0][2],price);assert.equal(fixture.orderRows[0][12],0);assert.equal(fixture.orderRows[0][13],null);assert.equal(fixture.orderRows[0][16],'distance');assert.equal(fixture.providerCalls.length,0);
 }
 reset({row:freeRow(),product:pricedProduct(29.99)});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({deliveryQuoteId:null,expectedTotal:29.99,goodsTotal:1000,deliveryFee:0})));assert.equal(response.status,400,'29.99 cannot claim free delivery with client-only basket fields');assert.equal(fixture.orderRows.length,0);
 reset({row:freeRow(),product:pricedProduct(29.99),existingQuote:freeQuote({fee:'0'})});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({expectedTotal:32.99,deliveryFee:0})));assert.equal(response.status,201);assert.equal(fixture.orderRows[0][2],32.99);assert.equal(fixture.orderRows[0][12],3,'Server recomputes first-two-km allowance, ignoring forged/stale stored fee');
 reset({row:freeRow(),product:pricedProduct(29.99),existingQuote:freeQuote({fee:'0'})});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody({expectedTotal:29.99,deliveryFee:0})))).status,400);assert.equal(fixture.orderRows.length,0);
 reset({row:freeRow(),product:pricedProduct(15),existingQuote:freeQuote({distance_meters:2000})});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({expectedTotal:15})));assert.equal(response.status,201);assert.equal(fixture.orderRows[0][12],0,'A sub-threshold order inside the free-distance allowance still pays no fee');
 reset({row:freeRow(),product:pricedProduct(30),existingQuote:freeQuote()});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({expectedTotal:30})));assert.equal(response.status,201);assert.equal(fixture.orderRows[0][12],0,'A high preliminary quote cannot override the free-order threshold');
 for(const invalidQuote of [undefined,freeQuote({account_id:userId}),freeQuote({settings_revision:6}),freeQuote({expires_at:new Date(Date.now()-1).toISOString()}),freeQuote({address:'Bakı, fərqli ünvan 20'})]){
  reset({row:freeRow(),product:pricedProduct(30),existingQuote:invalidQuote});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody({expectedTotal:30})))).status,400,'Even a free order must reject a supplied foreign/stale/mismatched quote');assert.equal(fixture.orderRows.length,0);
 }
 const tenPercent={id:userId,used:0,usage_limit:10,minimum:'0',percent:10,max_discount:null};
 reset({row:freeRow(),product:pricedProduct(30),coupon:tenPercent});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({coupon:'TEN',deliveryQuoteId:null,expectedTotal:27})));assert.equal(response.status,400,'A coupon taking goods from30 to27 removes threshold eligibility');assert.equal(fixture.orderRows.length,0);
 reset({row:freeRow(),product:pricedProduct(30),coupon:tenPercent,existingQuote:freeQuote()});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({coupon:'TEN',expectedTotal:30})));assert.equal(response.status,201);assert.equal(fixture.orderRows[0][9],3);assert.equal(fixture.orderRows[0][12],3);assert.equal(fixture.orderRows[0][2],30,'Coupon-discounted goods27 plus recomputed delivery3, not original goods30 plus fee');
 reset({row:freeRow(),product:pricedProduct(31),coupon:{...tenPercent,max_discount:1}});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({coupon:'TEN',deliveryQuoteId:null,expectedTotal:30})));assert.equal(response.status,201,'Capped coupon leaving exactly30 keeps eligibility');assert.equal(fixture.orderRows[0][12],0);
 reset({row:{...freeRow(),minimum_order:'31'},product:pricedProduct(30)});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody({deliveryQuoteId:null,expectedTotal:30})))).status,400,'Free delivery cannot bypass the independent delivery minimum');
 reset({existingQuote:storedQuote({fee:'0.01'})});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody()));assert.equal(response.status,201);assert.equal(fixture.orderRows[0][12],5.41,'Legacy pricing also recomputes rather than trusting quote.fee');

 reset({priorOrder:'RECOVERED-001',orderAttempts:99});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({phone:'0000000',address:'test',expectedTotal:0})));assert.equal(response.status,201);assert.equal((await response.json()).order_no,'RECOVERED-001');assert.equal(fixture.orderRows.length,0);assert.equal(fixture.notified,0);assert.equal(fixture.sqlCalls.some(call=>call.query.startsWith('insert into customer_order_attempts')),false,'Committed attempts recover before newer contact checks or mutation');
 reset({racingOrder:'RACING-001'});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody()));assert.equal(response.status,201);assert.equal((await response.json()).order_no,'RACING-001');assert.equal(fixture.orderRows.length,0);assert.equal(fixture.notified,0,'A concurrently committed request is not inserted or notified twice');
 reset({orderAttempts:13});response=await orders.POST(nativeRequest('/api/customer-orders',orderBody()));assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'600');assert.equal(fixture.orderRows.length,0);
 reset({recentOrders:3});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody()))).status,400);assert.equal(fixture.orderRows.length,0);
 reset({product:null});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody()))).status,400);assert.equal(fixture.orderRows.length,0);
 reset();response=await orders.POST(nativeRequest('/api/customer-orders',orderBody({phone:'0000000',address:'test'})));assert.equal(response.status,400);data=await response.json();assert.deepEqual(data.fields,['phone','address']);assert.equal(fixture.sqlCalls.some(call=>call.query.startsWith('insert into customer_order_attempts')),false,'Invalid new contact does not mutate order/attempt state');
 reset();assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody(),{headers:{origin:'https://evil.example'}}))).status,403);assert.equal(fixture.sqlCalls.length,0);
 reset({account:null});assert.equal((await orders.POST(nativeRequest('/api/customer-orders',orderBody()))).status,401);assert.equal(fixture.sqlCalls.length,0);

 const adminUi=await readFile('app/admin/store/delivery-manager.tsx','utf8');
 assert.ok(adminUi.includes("originLat:hasLat?Number(draft.originLat):null")&&adminUi.includes("originLng:hasLng?Number(draft.originLng):null"),'Empty origin coordinates are sent as null, not Number(empty string)=0');
 assert.ok(adminUi.includes("const hasLat=draft.originLat.trim()!==''")&&adminUi.includes('hasLat!==hasLng'),'UI validates coordinate pairs before numeric conversion');
 const checkout=await readFile('app/cart-sheet.tsx','utf8');
 assert.ok(checkout.includes('onSubmit={event=>event.preventDefault()}'),'Contact form never submits an order');
 assert.ok(checkout.includes('key="final-confirm"')&&checkout.includes('type="button" disabled={busy||couponBusy} onClick={()=>void order()}'),'Only a separately keyed deliberate final review action submits the order');
 assert.ok(checkout.includes('matchingDeliveryQuote(quote,address,pin)'),'Changed address or coordinates invalidate a quote before review and submission');
 assert.ok(checkout.includes('{distanceMode&&settings?.freeOrderFrom!=null&&'),'Manual pricing must not advertise a saved automatic free-delivery threshold');
 const previousTranslations=new Set();
 for(const path of ['lib/language.tsx','lib/storefront-translations.ts','lib/delivery-translations.ts','lib/product-removal-translations.ts']){
  const tree=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true);
  function scan(node){if(ts.isArrayLiteralExpression(node)&&node.elements.length===5&&node.elements.every(ts.isStringLiteral))previousTranslations.add(node.elements[0].text);ts.forEachChild(node,scan);}scan(tree);
 }
 const desktopRows=(await load('lib/desktop-translations.ts')).desktopTranslations;
 for(const row of desktopRows)previousTranslations.add(row[0]);
 const {checkoutTranslations:translationRows,checkoutTurkishOverrides}=await load('lib/checkout-translations.ts'),translated=new Set(previousTranslations);
 for(const row of translationRows){assert.equal(row.length,5);assert.ok(row.every(text=>typeof text==='string'&&text.trim()),'Each checkout key has all five languages: '+row[0]);assert.equal(translated.has(row[0]),false,'New checkout rows must not duplicate an existing key: '+row[0]);translated.add(row[0]);}
 const {googleMapsTranslations}=await load('lib/google-maps-translations.ts');
 for(const row of googleMapsTranslations){assert.equal(row.length,5);assert.ok(row.every(text=>typeof text==='string'&&text.trim()),'Each Google Maps key has all five languages: '+row[0]);assert.equal(translated.has(row[0]),false,'New Google Maps rows must not duplicate an existing key: '+row[0]);translated.add(row[0]);}
 // Existing account and checkout dictionaries already share a few labels.
 // Include those older rows for coverage without retroactively rejecting that
 // unrelated history; newly added provider/contact rows still must be unique.
 const accountTree=ts.createSourceFile('lib/account-ui-translations.ts',await readFile('lib/account-ui-translations.ts','utf8'),ts.ScriptTarget.Latest,true);
 function accountKeys(node){if(ts.isArrayLiteralExpression(node)&&node.elements.length===5&&node.elements.every(ts.isStringLiteral))translated.add(node.elements[0].text);ts.forEachChild(node,accountKeys);}accountKeys(accountTree);
 const openModules=[['lib/open-map-translations.ts','openMapTranslations'],['lib/open-geocoding-translations.ts','openGeocodingTranslations'],['lib/customer-contact-translations.ts','customerContactTranslations'],['lib/open-delivery-translations.ts','openDeliveryTranslations']];
 const languageSource=await readFile('lib/language.tsx','utf8');let openRowCount=0;
 for(const [path,name]of openModules){
  const rows=(await load(path))[name];assert.ok(Array.isArray(rows),name);assert.ok(languageSource.includes("from './"+path.slice(4,-3)+"'")||languageSource.includes('from "./'+path.slice(4,-3)+'"'),'Language provider imports '+name);assert.ok(languageSource.includes('...'+name),'Language provider registers '+name);
  for(const row of rows){assert.equal(row.length,5);assert.ok(row.every(text=>typeof text==='string'&&text.trim()),'Each open map/delivery/contact key has all five languages: '+row[0]);assert.equal(translated.has(row[0]),false,'Open map/delivery/contact rows do not duplicate an existing key: '+row[0]);translated.add(row[0]);openRowCount++;}
 }
 const requiredTranslations=new Set();
 for(const path of ['app/cart-sheet.tsx','app/delivery-location-picker.tsx','app/admin/store/delivery-manager.tsx','app/api/admin/delivery/route.ts','app/api/delivery-quote/route.ts','app/api/customer-orders/route.ts','app/api/places/route.ts','lib/open-geocoding.ts']){
  const tree=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true);
  function textValues(node){if(ts.isStringLiteral(node))requiredTranslations.add(node.text);else if(ts.isConditionalExpression(node)){textValues(node.whenTrue);textValues(node.whenFalse);}else ts.forEachChild(node,textValues);}
  function scan(node){
   if(ts.isCallExpression(node)){
    const name=node.expression.getText(tree);
    if(['t','text.current','setError','setSearchError','setSettingsError','checkoutRejection'].includes(name))for(const arg of node.arguments)textValues(arg);
    if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='json')for(const arg of node.arguments)if(ts.isObjectLiteralExpression(arg))for(const field of arg.properties)if(ts.isPropertyAssignment(field)&&field.name.getText(tree)==='error')textValues(field.initializer);
   }
   if(ts.isNewExpression(node)&&node.expression.getText(tree)==='Error')for(const arg of node.arguments||[])if(ts.isStringLiteral(arg)&&/[^\x00-\x7F]/.test(arg.text))requiredTranslations.add(arg.text);
   ts.forEachChild(node,scan);
  }scan(tree);
 }
 for(const key of requiredTranslations)if(key)assert.ok(translated.has(key),'Missing checkout/server translation: '+key);
 const missingTurkish=desktopRows.filter(row=>requiredTranslations.has(row[0])&&row[3]===row[0]&&(!checkoutTurkishOverrides[row[0]]||checkoutTurkishOverrides[row[0]]===row[0])).map(row=>row[0]);
 assert.deepEqual(missingTurkish,[],'Active checkout/map/admin labels need actual Turkish rather than an old Azerbaijani fallback');
 for(const [key,value]of Object.entries(checkoutTurkishOverrides)){assert.ok(previousTranslations.has(key),'Turkish overrides target existing keys only: '+key);assert.ok(value.trim()&&value!==key);}
 assert.equal(checkoutTurkishOverrides['Ünvan'],'Adres');assert.equal(checkoutTurkishOverrides['Məhsul'],'Ürün');assert.equal(checkoutTurkishOverrides['Səbətdən çıxar'],'Sepetten çıkar');
 console.log(`PASS: ${translationRows.length} checkout, ${googleMapsTranslations.length} legacy map and ${openRowCount} open map/delivery/contact translation keys have AZ/RU/EN/TR/ZH coverage; active cart/map/admin/API literals are translated without duplicate keys.`);
 console.log('PASS: delivery exact-metre/cent/floor/free-km maths, null coordinates, secret-free public/admin settings, real admin auth/HTTPS/CSRF, loopback-only OSRM request/waypoint contract, rate/provider errors, quote ownership/expiry/revision/address, authoritative fee/minimum/coupon/free-threshold/pickup, contact recovery/idempotency and deliberate confirmation; no external requests.');
}finally{
 globalThis.fetch=previousFetch;
 for(const [name,value]of Object.entries(previousEnv))if(value===undefined)delete process.env[name];else process.env[name]=value;
}
