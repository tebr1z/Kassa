import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server.js';
import ts from 'typescript';

// Pure, offline regression: actual guard/proxy/handlers with a query-recording
// fake database. No production server, database, files or credentials are used.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const compiled=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
const previousLocal=process.env.BIRKASSA_LOCAL,previousDb=process.env.DATABASE_URL;
process.env.DATABASE_URL='postgres://fixture.invalid/never-connected';delete process.env.BIRKASSA_LOCAL;
try{
 const inventory=await load('lib/inventory-mode.ts'),roles=await load('lib/staff-access.ts'),security=await load('lib/admin-security.ts'),portal=await load('lib/staff-portal.ts');
 const blocked=['/api/products','/api/warehouses','/api/stock/receipts','/api/stock/adjustments','/api/stock/transfers','/api/inventory-counts','/api/purchase-orders','/api/suppliers','/api/sales','/api/shifts','/api/orders','/api/pos-options','/api/returns','/api/finance','/api/reports','/api/dashboard','/api/audit','/api/system'];
 for(const path of blocked)assert.equal(inventory.inventoryPathRequiresLocal(path),true,path);
 for(const path of ['/api/store-admin/commerce','/api/online-orders','/api/customer-orders','/api/catalog','/api/desktop-bridge','/api/desktop-feed','/api/employees','/api/settings','/api/locations'])assert.equal(inventory.inventoryPathRequiresLocal(path),false,path);
 for(const value of [undefined,'','true','0','01','yes']){if(value===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=value;assert.equal(inventory.isLocalInventory(),false);}
 process.env.BIRKASSA_LOCAL='1';assert.equal(inventory.isLocalInventory(),true);delete process.env.BIRKASSA_LOCAL;
 let authenticated=true,role='admin',queryCount=0,handlerCalls=0;
 const authSql={async unsafe(){queryCount++;return authenticated?[{id:'fixture-admin',role,authentication_method:'password',active:true}]:[];},async end(){}};
 const guard=await load('lib/require-admin.ts',{'@/lib/store-db':{storeDb:()=>authSql},'@/lib/admin-security':security,'@/lib/staff-access':roles,'@/lib/inventory-mode':inventory});
 const guarded=guard.withAdminSession(()=>{handlerCalls++;return Response.json({local:inventory.isLocalInventory()});});
 const request=(path,method='GET',auth=true)=>new Request('https://fixture.example'+path,{method,headers:{host:'fixture.example',origin:'https://fixture.example',...(auth?{cookie:'birkassa_session=fixture'}:{}),'x-birkassa-role':'admin','x-birkassa-user-id':'spoofed','x-birkassa-local':'1','birkassa_local':'1'}});
 for(const path of blocked)for(const method of ['GET','HEAD','POST','PATCH','DELETE']){
  const response=await guarded(request(path,method));assert.equal(response.status,403,path+' '+method);assert.equal((await response.json()).code,'INVENTORY_LOCAL_ONLY');assert.match(response.headers.get('cache-control'),/no-store/);
 }
 assert.equal(handlerCalls,0,'No stock/business handler executes in the web process');
 assert.equal((await guarded(request('/api/products','GET',false))).status,401,'Authentication comes first');
 authenticated=false;assert.equal((await guarded(request('/api/products'))).status,401);authenticated=true;
 role='online_assistant';const denied=await guarded(request('/api/products'));assert.equal(denied.status,403);assert.ok(!(await denied.json()).code,'Role authorization comes before local-inventory capability');role='admin';
 process.env.BIRKASSA_LOCAL='1';assert.equal((await guarded(request('/api/products'))).status,200);assert.equal(handlerCalls,1,'Local EXE keeps existing business handlers');delete process.env.BIRKASSA_LOCAL;
 const proxy=await load('proxy.ts',{'./lib/log-error':{logSystemError:async()=>{}},postgres:()=>authSql,'./lib/admin-security':security,'./lib/staff-access':roles,'./lib/staff-portal':portal,'./lib/inventory-mode':inventory});
 for(const path of blocked){const response=await proxy.proxy(new NextRequest(request(path)));assert.equal(response.status,403,path);assert.equal((await response.json()).code,'INVENTORY_LOCAL_ONLY');}
 assert.equal((await proxy.proxy(new NextRequest(request('/api/products','GET',false)))).status,401);
 process.env.BIRKASSA_LOCAL='1';assert.equal((await proxy.proxy(new NextRequest(request('/api/products')))).status,200);delete process.env.BIRKASSA_LOCAL;
 const optionImage=await load('lib/product-option-image.ts'),optionInput=await load('lib/product-option-input.ts',{'./product-option-image':optionImage}),discount=await load('lib/product-discount.ts');
 const productId=randomUUID(),optionId=randomUUID(),cloud='https://res.cloudinary.com/fixture/red.png';
 let queries=[],savedOptions=null,ensured=0,barcodes=0;
 const sql={async unsafe(query,values=[]){queries.push([query,values]);
  if(query.startsWith('select p.id,p.name,p.sku'))return [{id:productId,name:'Manqal',sku:'WEB',sale_price:'10',discount_price:null,is_active:true,image_url:cloud,options:[{id:optionId,label:'40 · Qırmızı',size:'40',color:'Qırmızı',kind:'',image_url:cloud,price:'11',position:0,is_active:true,attributes:{}}]}];
  if(query.startsWith('select p.*'))return [{id:productId,name:'Manqal',sku:'WEB',sale_price:'10',cost_price:'PRIVATE-COST',stock:'PRIVATE-STOCK',min_stock:99,is_active:true,image_url:cloud,options:[{id:optionId,label:'40 · Qırmızı',cost_price:9,image_url:cloud}]}];
  if(query.startsWith('select id,sale_price,discount_price from products'))return [{id:productId,sale_price:'10',discount_price:null}];
  if(query.startsWith('select * from products'))return [{id:productId,sale_price:'10',discount_price:null,cost_price:'6'}];
  if(query.startsWith('select id from products'))return [{id:productId}];
  if(query.startsWith('insert into products'))return [{id:productId}];
  if(query.startsWith('update product_options')||query.startsWith('insert into product_options'))return [{id:optionId}];
  if(query.startsWith('select slides_revision'))return [{slides_revision:0}];
  if(query.startsWith('select p.id,p.name,p.image_url'))return [{id:productId,name:'Manqal',image:cloud,active:true,available:true}];
  if(query.startsWith('select id,name,address'))return [{id:'branch',name:'Mağaza',address:''}];
  if(query.includes('select u.id,u.full_name,u.role'))return [{id:'fixture-admin',full_name:'Rəhbər',role:'admin',is_active:true,branch_id:'branch',has_pin:false,has_password:true,branch_name:'Mağaza'}];
  return [];
 },async begin(callback){return callback(this);},async end(){}};
 // Identity already tested above: isolate the real commerce handler's SQL/data
 // contract here. Its exported production route still uses the actual guard.
 const passGuard={withAdminSession:fn=>fn},db={storeDb:()=>sql},media={mediaUrl:async value=>String(value||'')};
 const commerce=await load('app/api/store-admin/commerce/route.ts',{'@/lib/require-admin':passGuard,'@/lib/store-db':db,'@/lib/barcode':{ensurePrimaryBarcodes:async()=>{ensured++;},savePrimaryBarcode:async()=>{barcodes++;}},'@/lib/desktop-media':media,'@/lib/product-option-input':optionInput,'@/lib/save-product-options':{saveProductOptions:async(_tx,_id,options,config)=>{savedOptions={options,config};}},'@/lib/product-discount':discount,'@/lib/inventory-mode':inventory});
 let response=await commerce.GET();const webDto=await response.json();assert.equal(webDto.local,false);assert.equal(webDto.canManageProducts,true);assert.equal(ensured,0);
 for(const key of ['stock','cost_price','min_stock','barcode'])assert.equal(key in webDto.products[0],false,key);assert.equal('cost_price' in webDto.products[0].options[0],false);
 assert.ok(!queries.some(([query])=>/stock_movements|cost_price|min_stock|product_barcodes|select p\.\*/.test(query)),'Web CMS never even queries legacy inventory values');
 const body={action:'product',id:productId,name:'Manqal',sku:'WEB',category:'',unit:'ədəd',sale_price:12,cost_price:98765,stock:123456,min_stock:888,barcode:'SECRET-BARCODE',description:'',specifications:'',discount_price:null,is_active:true,options:[{id:optionId,label:'40 · Qırmızı',size:'40',color:'Qırmızı',kind:'',price:11,cost_price:99999,is_active:true,image_url:cloud,attributes:{}}]};
 const post=body=>new Request('https://fixture.example/api/store-admin/commerce',{method:'POST',headers:{'content-type':'application/json','x-birkassa-user-id':'fixture-admin'},body:JSON.stringify(body)});
 queries=[];response=await commerce.POST(post(body));assert.equal(response.status,200,await response.text());
 assert.equal(savedOptions.config.preserveCost,true);assert.equal(savedOptions.options[0].cost_price,null);assert.equal(barcodes,0);
 assert.ok(!queries.some(([query])=>/product_price_history|cost_price|stock_movements|min_stock|product_barcodes|select \* from products/.test(query)),'Web edit does not read/update private columns or snapshot old cost');
 const audit=JSON.parse(queries.find(([query])=>query.startsWith('insert into audit_logs'))[1][3]);assert.equal('cost_price' in audit,false);assert.equal('barcode' in audit,false);assert.equal('cost_price' in audit.options[0],false);
 queries=[];response=await commerce.POST(post({...body,id:undefined}));assert.equal(response.status,200);assert.equal(queries.find(([query])=>query.startsWith('insert into products'))[1][5],0,'New web rows use only schema-required zero cost, never incoming private value');
 queries=[];response=await commerce.POST(post({...body.options[0],action:'option',product_id:productId}));assert.equal(response.status,200);assert.ok(!queries.find(([query])=>query.startsWith('update product_options'))[0].includes('cost_price'),'Standalone option edit preserves private cost');assert.ok(!JSON.stringify(queries).includes('99999'));
 process.env.BIRKASSA_LOCAL='1';queries=[];const localDto=await (await commerce.GET()).json();assert.equal(localDto.local,true);assert.equal(localDto.products[0].cost_price,'PRIVATE-COST');assert.equal(localDto.products[0].stock,'PRIVATE-STOCK');assert.equal(ensured,1);
 queries=[];assert.equal((await commerce.POST(post(body))).status,200);assert.equal(savedOptions.config.preserveCost,false);assert.equal(savedOptions.options[0].cost_price,99999);assert.equal(barcodes,1);assert.ok(queries.some(([query])=>query.includes('product_price_history')));delete process.env.BIRKASSA_LOCAL;
 const safeImports={'@/lib/require-admin':passGuard,'@/lib/store-db':db,'@/lib/inventory-mode':inventory};
 const slides=await load('app/api/store-admin/slides/route.ts',safeImports);queries=[];assert.equal((await slides.GET()).status,200);assert.ok(!queries.some(([query])=>query.includes('stock_movements')),'Slide availability is public activity, not legacy stock');
 const settings=await load('app/api/settings/route.ts',{'@/lib/require-admin':passGuard,'@/lib/staff-password':{strongPassword:()=>true,staffPasswordHash:async()=>''},'@/lib/log-error':{logSystemError:async()=>{}},postgres:()=>sql,'@/lib/inventory-mode':inventory});
 queries=[];const settingsDto=await (await settings.GET()).json();assert.deepEqual(settingsDto.warehouses,[]);assert.deepEqual(settingsDto.locations,[]);assert.equal(settingsDto.rules,null);assert.ok(!queries.some(([query])=>/warehouses|warehouse_locations|system_settings|cash_registers/.test(query)));
 for(const action of ['location','warehouse','register','sales_warehouse','rules']){queries=[];const response=await settings.POST(post({action}));assert.equal(response.status,403);assert.equal(queries.length,0,'Blocked settings action runs no business SQL');}
 const locations=await load('app/api/locations/route.ts',{...safeImports,'@/lib/staff-access':roles,'@/lib/staff-password':{strongPassword:()=>true,staffPasswordHash:async()=>''}});
 queries=[];const locationsDto=await (await locations.GET()).json();assert.deepEqual(locationsDto.warehouses,[]);assert.ok(!JSON.stringify(locationsDto).includes('sales_warehouse'));assert.ok(!queries.some(([query])=>/warehouses|sales_warehouse/.test(query)));
 for(const action of ['warehouse','assign','cashier']){queries=[];assert.equal((await locations.POST(post({action}))).status,403);assert.equal(queries.length,0,'Blocked location action runs no business SQL');}
 assert.ok(queryCount>0);
 console.log('PASS: trusted-process-only inventory capability; authentication and RBAC first; both Proxy and direct route wrapper block web stock/POS/finance/dump/audit without executing business handlers; web catalog and HR remain; CMS DTOs omit stock/cost and web edits preserve private columns; local forms retain costs; settings/locations are partitioned and slides never derive web availability from stock.');
}finally{
 if(previousLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=previousLocal;
 if(previousDb===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousDb;
}
