import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
async function load(path,mocks={}){
  const code=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const compiledModule={exports:{}};new Function('require','module','exports',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports);return compiledModule.exports;
}
const discounts=await load('lib/product-discount.ts'),commerce=await load('lib/commerce.ts');
const {resolveProductDiscount,priceFromDiscountPercent,hasProductDiscount,productDiscountPercent,productDiscountLabel}=discounts;
assert.equal(priceFromDiscountPercent(100,20),80);assert.equal(priceFromDiscountPercent('19.99','15'),16.99);assert.equal(priceFromDiscountPercent(12.34,33.33),8.23);
assert.equal(priceFromDiscountPercent(99.99,99.99),0.01);assert.equal(priceFromDiscountPercent(100,0),null);
for(const percent of [-1,100,100.01,NaN,Infinity,'','abc',false,0.001])assert.throws(()=>priceFromDiscountPercent(100,percent),'Invalid percent: '+percent);
for(const price of [0,0.001,100.001,1000000.01,NaN,Infinity])assert.throws(()=>priceFromDiscountPercent(price,10),'Invalid base: '+price);
assert.throws(()=>priceFromDiscountPercent(0.01,10),'A rounded cent cannot invent a saving');
assert.throws(()=>priceFromDiscountPercent(0.01,99.99),'A discount cannot round the final price to zero');
assert.equal(resolveProductDiscount(123.45,{discountPrice:100}),100,'Arbitrary existing prices are not changed by rounded inferred percent');
assert.equal(resolveProductDiscount(100,{},80),80,'Older clients omit fields without erasing the existing discount');
assert.equal(resolveProductDiscount(70,{},80),null,'A preserved discount cannot exceed a newly reduced regular price');
assert.equal(resolveProductDiscount(100,{discountPrice:null},80),null);assert.equal(resolveProductDiscount(100,{discountPrice:''},80),null);
assert.equal(resolveProductDiscount(100,{discountPrice:80,discountPercent:20}),80);
assert.throws(()=>resolveProductDiscount(100,{discountPrice:81,discountPercent:20}));
for(const price of [0,100,120,-5,80.001,'bad',Infinity])assert.throws(()=>resolveProductDiscount(100,{discountPrice:price}));
assert.equal(productDiscountPercent(2,3),33.33);assert.equal(productDiscountLabel(80,100,value=>value.toFixed(2)),'−20%');
assert.equal(productDiscountLabel(99.75,100,value=>value.toFixed(2).replace('.',',')),'−0,25%');
assert.equal(productDiscountLabel(999999.99,1000000,value=>value.toFixed(2)),'','Tiny true savings are labelled as a discount, never -0%');
assert.ok(!hasProductDiscount(50,50));assert.ok(!hasProductDiscount(-1,100));assert.ok(!hasProductDiscount(NaN,100));
const cheaper=commerce.catalogPricing({sale_price:100,discount_price:80},[{price:50},{price:null}]);assert.equal(cheaper.price,50);assert.equal(cheaper.originalPrice,50);assert.ok(!hasProductDiscount(cheaper.price,cheaper.originalPrice),'A cheaper explicit size is not a fake discount');
const inherited=commerce.catalogPricing({sale_price:100,discount_price:80},[{price:null}]);assert.equal(inherited.price,80);assert.equal(inherited.originalPrice,100);

const t=value=>value,language={useTranslations:()=>({t,languageAmount:value=>value.toFixed(2)})};
const {default:Price}=await load('app/product-price.tsx',{'@/lib/language':language,'@/lib/product-discount':discounts,'./product-price.css':{}});
const renderPrice=(price,originalPrice)=>renderToStaticMarkup(createElement(Price,{price,originalPrice,compact:true}));
const priceHtml=renderPrice(80,100);assert.match(priceHtml,/<del[^>]*>100\.00 ₼<\/del>/);assert.ok(priceHtml.includes('Endirimli qiymət'));assert.ok(priceHtml.includes('−20%'));
assert.ok(!renderPrice(50,50).includes('<del'));assert.ok(!renderPrice(999999.99,1000000).includes('−0%'));
const {default:Editor}=await load('app/admin/product-discount-editor.tsx',{'@/lib/language':language,'@/lib/product-discount':discounts,'./product-discount-editor.css':{}});
const editor=renderToStaticMarkup(createElement(Editor,{salePriceName:'salePrice',discountPriceName:'discountPrice',discountPercentName:'discountPercent',initialSalePrice:123.45,initialDiscountPrice:100}));
assert.match(editor,/<input[^>]*name="discountPrice"[^>]*value="100\.00"/);assert.doesNotMatch(editor,/<input[^>]*name="discountPercent"/,'Existing amount mode is authoritative until a percentage is actually edited');
const freshEditor=renderToStaticMarkup(createElement(Editor,{salePriceName:'salePrice',discountPriceName:'discountPrice',discountPercentName:'discountPercent'}));assert.match(freshEditor,/<input[^>]*type="hidden"[^>]*name="discountPrice"[^>]*value=""/);

// Exercise the real product and CMS API handlers with an isolated SQL adapter.
// No database, local server, business stock or customer record is touched.
const uuid='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
let row,mutations=0;
const reset=()=>{row={id:uuid,name:'Discount fixture',sku:'DISCOUNT-UNIT',category:'Test',sale_price:100,discount_price:null,cost_price:20,min_stock:0,stock:4,barcode:'',barcodes:[],price_history:[],options:[],location:'Test'};mutations=0;};reset();
const sql={end:async()=>{},begin:async fn=>fn(sql),unsafe:async(query,args=[])=>{
  if(query.includes('select * from products where id='))return [{...row}];
  if(query.includes('select p.id, p.name, p.sku'))return [{...row}];
  if(query.startsWith('select product_id,id,label'))return [];
  if(query.startsWith('insert into products(sku')){mutations++;Object.assign(row,{sku:args[0],name:args[1],category:args[2],sale_price:args[3],cost_price:args[4],min_stock:args[5],discount_price:args[6]});return [{id:uuid,sku:row.sku,name:row.name}];}
  if(query.startsWith('update products set name=$1,sku=$2,category=$3,sale_price=')){mutations++;Object.assign(row,{name:args[0],sku:args[1],category:args[2],sale_price:args[3],cost_price:args[4],min_stock:args[5],discount_price:args[6]});return [];}
  if(query.startsWith('update products set name=$1,sku=$2,category=$3,unit=')){mutations++;Object.assign(row,{name:args[0],sku:args[1],category:args[2],sale_price:args[4],cost_price:args[5],discount_price:args[8]});return [];}
  if(query.startsWith('insert into products(name,sku')){mutations++;Object.assign(row,{name:args[0],sku:args[1],category:args[2],sale_price:args[4],cost_price:args[5],discount_price:args[8]});return [{id:uuid}];}
  if(query.includes('insert into audit_logs')||query.includes('insert into product_price_history'))return [];
  throw Error('Unexpected fixture SQL: '+query);
}};
const optionInput=await load('lib/product-option-input.ts');
const common={'@/lib/require-admin':{withAdminSession:fn=>fn},'@/lib/barcode':{ensurePrimaryBarcodes:async()=>{},savePrimaryBarcode:async()=>{}},'@/lib/product-option-input':optionInput,'@/lib/save-product-options':{saveProductOptions:async()=>{}},'@/lib/commerce':commerce,'@/lib/product-discount':discounts};
const oldDatabase=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://isolated.invalid/test';
try{
  const api=await load('app/api/products/route.ts',{...common,'next/server':{NextResponse:Response},'@/lib/log-error':{logSystemError:async()=>{}},'@/lib/warehouse':{salesWarehouseSql:()=>''},postgres:()=>sql});
  const request=(method,body)=>new Request('http://fixture.invalid/api/products',{method,headers:{'Content-Type':'application/json','x-birkassa-user-id':user,'x-birkassa-role':'admin'},...(body?{body:JSON.stringify(body)}:{})});
  const base={name:'Discount fixture',sku:'DISCOUNT-UNIT',category:'Test',salePrice:100,costPrice:20,minStock:0,barcode:''};
  let response=await api.POST(request('POST',{...base,discountPercent:20}));assert.equal(response.status,201);assert.equal(row.discount_price,80);
  response=await api.GET(request('GET'));let dto=(await response.json())[0];assert.equal(dto.price,80);assert.equal(dto.regularPrice,100);assert.equal(dto.discountPrice,80);
  response=await api.PATCH(request('PATCH',{...base,productId:uuid,name:'Renamed without erasing discount'}));assert.equal(response.status,200);assert.equal(row.discount_price,80);
  response=await api.PATCH(request('PATCH',{...base,productId:uuid,discountPercent:25}));assert.equal(response.status,200);assert.equal(row.discount_price,75);
  response=await api.PATCH(request('PATCH',{...base,productId:uuid,discountPrice:null}));assert.equal(response.status,200);assert.equal(row.discount_price,null);
  for(const invalid of [{discountPercent:100},{discountPercent:-1},{discountPercent:20.001},{discountPrice:100},{discountPrice:80,discountPercent:10},{salePrice:100.001,discountPercent:10}]){const before=mutations;response=await api.POST(request('POST',{...base,...invalid}));assert.equal(response.status,400,JSON.stringify(invalid));assert.equal(mutations,before,'Invalid discount cannot reach a product write');}
  const cms=await load('app/api/store-admin/commerce/route.ts',{...common,'@/lib/store-db':{storeDb:()=>sql},'@/lib/desktop-media':{mediaUrl:async value=>value}});
  const cmsBase={action:'product',id:uuid,name:'CMS discount',sku:'CMS-DISCOUNT',category:'Test',unit:'ədəd',sale_price:100,cost_price:20,description:'',specifications:'',is_active:true,barcode:''};
  response=await cms.POST(request('POST',{...cmsBase,discount_price:76.54}));assert.equal(response.status,200);assert.equal(row.discount_price,76.54,'Legacy CMS discount amount remains supported exactly');
  response=await cms.POST(request('POST',{...cmsBase,discount_percent:12.5}));assert.equal(response.status,200);assert.equal(row.discount_price,87.5,'CMS percentage is server calculated');
  response=await cms.POST(request('POST',{...cmsBase}));assert.equal(response.status,200);assert.equal(row.discount_price,87.5,'Omitted CMS discount fields preserve existing price');
  for(const invalid of [{discount_percent:100},{discount_percent:-1},{discount_price:100},{discount_price:75,discount_percent:10}]){const before=mutations;response=await cms.POST(request('POST',{...cmsBase,...invalid}));assert.equal(response.status,400);assert.equal(mutations,before);}
}finally{if(oldDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDatabase;}

for(const [path,marker] of [['app/api/sales/route.ts','const price = orderLine?'],['app/api/orders/route.ts','const price=option?.price!=null?']]){
  const source=await readFile(path,'utf8'),start=source.indexOf(marker);assert.ok(start>=0,path);const expression=source.slice(start,source.indexOf(';',start)+1);
  assert.ok(expression.includes('sellingPrice('));const price=new Function('product','option','orderLine','sellingPrice',expression+'return price;');
  const product={sale_price:100,discount_price:80};assert.equal(price(product,null,null,commerce.sellingPrice),80);assert.equal(price(product,{price:null},null,commerce.sellingPrice),80);assert.equal(price(product,{price:45},null,commerce.sellingPrice),45,'Explicit option price remains final');
  if(path.includes('/sales/'))assert.equal(price(product,{price:45},{unit_price:92},commerce.sellingPrice),92,'Previously accepted order snapshot is not repriced');
}
const dashboard=await readFile('app/admin/staff-dashboard.tsx','utf8');assert.equal((dashboard.match(/<ProductDiscountEditor\b/g)||[]).length,2,'Main new and edit forms both expose discounts');assert.ok(dashboard.includes('initialSalePrice={editing.regularPrice??editing.price}'));
assert.ok((await readFile('app/admin/store/commerce-manager.tsx','utf8')).includes('discountPercentName="discount_percent"'));
const {productDiscountTranslations}=await load('lib/product-discount-translations.ts');for(const row of productDiscountTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>value.trim()));}
console.log('PASS: cent-safe percentage/amount validation, exact legacy preservation, real product/CMS handler writes+DTO, POS/order snapshot and variant-price semantics, main/CMS editors, truthful SSR discount display and five-language strings.');
