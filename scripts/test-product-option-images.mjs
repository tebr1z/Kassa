import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';

const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const source=await readFile(file,'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,compiledModule={exports:{}};
 new Function('require','module','exports',code)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports);return compiledModule.exports;
}
const originalLocal=process.env.BIRKASSA_LOCAL;
try{
// This legacy regression exercises EXE inventory/POS editors. Web-only safety is
// covered separately by test-web-inventory-boundary and the real HTTP test.
process.env.BIRKASSA_LOCAL='1';
const inventory=await load('lib/inventory-mode.ts');
const images=await load('lib/product-option-image.ts'),input=await load('lib/product-option-input.ts',{'./product-option-image':images});
const hash='a'.repeat(64),cloud='https://res.cloudinary.com/fixture/image/upload/red.png',local='/api/desktop-media/'+hash,catalog='/api/catalog-media/'+hash;
for(const value of ['',cloud,local,catalog])assert.equal(images.isProductOptionImage(value),true,String(value));
for(const value of [undefined,null,{},123,'http://res.cloudinary.com/a','https://evil.test/a','https://res.cloudinary.com.evil.test/a','https://res.cloudinary.com@evil.test/a','https://user@res.cloudinary.com/a','https://res.cloudinary.com:8443/a','//res.cloudinary.com/a','javascript:alert(1)','data:image/png;base64,AA','file:///a','/api/desktop-media/../a','/api/catalog-media/'+hash+'?x=1',cloud+'\n',cloud+'\\x','https://res.cloudinary.com/a b'])assert.equal(images.isProductOptionImage(value),false,String(value));
const productId=randomUUID(),optionId=randomUUID(),base={id:optionId,label:'40 · Qırmızı',size:'40',color:'Qırmızı',kind:'',price:7,cost_price:3,position:0,is_active:true,attributes:{}};
assert.equal(input.productOptionInput.parse(base).image_url,undefined,'Old clients must not default omitted image to empty');
assert.equal(input.productOptionInput.parse({...base,image_url:''}).image_url,'');
assert.equal(input.productOptionInput.safeParse({...base,image_url:'https://evil.test/a'}).success,false);
const {saveProductOptions}=await load('lib/save-product-options.ts');
let saved={id:optionId,label:base.label,image_url:cloud},writes=[];
const tx={async unsafe(query,values=[]){
 if(query.startsWith('select id,label,image_url'))return [{...saved}];
 if(query.startsWith('select i.option_id'))return [];
 writes.push([query,values]);if(query.startsWith('update product_options set label=')){assert.equal(values[11],optionId);saved={...saved,label:values[1],image_url:values[10]};}return [];
}};
await saveProductOptions(tx,productId,[base]);assert.equal(saved.image_url,cloud,'Bulk edit from older client preserves photo');
await saveProductOptions(tx,productId,[{...base,label:'Yeni ad'}]);assert.equal(saved.image_url,cloud,'Rename with id preserves photo');
await saveProductOptions(tx,productId,[{...base,label:'Yeni ad',image_url:''}]);assert.equal(saved.image_url,'','Explicit remove clears photo');
await saveProductOptions(tx,productId,[{...base,label:'Yeni ad',image_url:local}]);assert.equal(saved.image_url,local);
await assert.rejects(saveProductOptions(tx,productId,[{...base,id:randomUUID()}]),/Seçim/);
const media={mediaUrl:async value=>value===cloud?local:String(value||''),imageType:bytes=>{
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.subarray(0,6).toString()==='GIF89a')return 'image/gif';throw Error('Unsupported');
}};
const barcode={ensurePrimaryBarcodes:async()=>{},savePrimaryBarcode:async()=>{}},discount=await load('lib/product-discount.ts'),commerce=await load('lib/commerce.ts');
const guard={withAdminSession:handler=>async request=>request.headers.get('cookie')==='fixture-admin'?handler(request):Response.json({error:'Daxil olun'},{status:401})};
const request=(body,path='/api/store-admin/commerce')=>new Request('https://fixture.example'+path,{method:body===undefined?'GET':'POST',headers:{cookie:'fixture-admin','content-type':'application/json','x-birkassa-user-id':randomUUID(),'x-birkassa-role':'admin'},...(body===undefined?{}:{body:JSON.stringify(body)})});
let queries=[];
const sql={async unsafe(query,values=[]){queries.push([query,values]);
 if(query.startsWith('select p.*'))return [{id:productId,image_url:cloud,options:[{...base,image_url:cloud}]}];
 if(query.startsWith('select id from products'))return [{id:productId}];
 if(query.startsWith('update product_options set label='))return [{id:optionId}];
 if(query.startsWith('insert into product_options'))return [{id:optionId}];
 return [];
 },async begin(callback){return callback(this);},async end(){}};
const admin=await load('app/api/store-admin/commerce/route.ts',{'@/lib/require-admin':guard,'@/lib/store-db':{storeDb:()=>sql},'@/lib/barcode':barcode,'@/lib/desktop-media':media,'@/lib/product-option-input':input,'@/lib/save-product-options':{saveProductOptions},'@/lib/product-discount':discount,'@/lib/inventory-mode':inventory});
let response=await admin.GET(request());assert.equal(response.status,200);assert.equal((await response.json()).products[0].options[0].image_url,local);
for(const image of [undefined,'',cloud]){
 queries=[];response=await admin.POST(request({...base,action:'option',product_id:productId,...(image===undefined?{}:{image_url:image})}));assert.equal(response.status,200);
 const update=queries.find(([query])=>query.startsWith('update product_options set label='));assert.ok(update[0].includes('image_url=coalesce($11,image_url)'));assert.equal(update[1][10],image??null);assert.equal(update[1][11],optionId);
}
queries=[];assert.equal((await admin.POST(request({...base,action:'option',product_id:productId,image_url:'https://evil.test/a'}))).status,400);assert.equal(queries.length,0);
let uploaded=[];
const previousLocal=process.env.BIRKASSA_LOCAL;process.env.BIRKASSA_LOCAL='1';
try{
 const upload=await load('app/api/store-admin/upload/route.ts',{'@/lib/require-admin':guard,'@/lib/cloudinary-config':{cloudCredentials:async()=>({})},'@/lib/store-db':{storeDb:()=>sql},'@/lib/catalog-media':{saveImage:async bytes=>{uploaded.push(bytes);return {url:local};}},'@/lib/desktop-media':media,'@/lib/product-option-image':images});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfocAAAAASUVORK5CYII=','base64');
 function form(bytes=png,type='image/png',extra={}){const data=new FormData();data.set('file',new Blob([bytes],{type}),'fixture.png');data.set('purpose','variant');for(const [key,value]of Object.entries(extra))data.set(key,value);return data;}
 const send=(data,auth=true)=>upload.POST(new Request('https://fixture.example/api/store-admin/upload',{method:'POST',headers:{...(auth?{cookie:'fixture-admin'}:{})},body:data}));
 queries=[];assert.equal((await send(form(),false)).status,401);assert.equal(uploaded.length,0);
 response=await send(form());assert.equal(response.status,200);assert.deepEqual(await response.json(),{url:local});assert.equal(uploaded.length,1);assert.equal(queries.length,0,'Unattached variant upload never queries or mutates products, gallery, categories or logo');
 assert.equal((await send(form(png,'image/png',{productId}))).status,400);
 assert.equal((await send(form(png,'image/png',{categoryId:randomUUID()}))).status,400);
 assert.equal((await send(form(Buffer.from('<svg/>'),'image/png'))).status,400,'Reject fake MIME');
 assert.equal((await send(form(Buffer.from('GIF89a fixture'),'image/png'))).status,400,'Variants accept only JPEG/PNG/WebP');
 assert.equal((await send(form(Buffer.alloc(4000001),'image/png'))).status,400);
 assert.equal(uploaded.length,1,'Rejected data never reaches storage');
}finally{if(previousLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=previousLocal;}
const productApi=await load('app/api/products/route.ts',{'@/lib/require-admin':guard,'@/lib/log-error':{logSystemError:async()=>{}},postgres:()=>({async unsafe(query){
 if(query.includes('select p.id, p.name'))return [{id:productId,name:'Manqal',options:[{...base,image:cloud}],barcodes:[],price_history:[],sale_price:'9',discount_price:null,cost_price:'3',stock:'1',min_stock:'0'}];
 if(query.startsWith('select product_id,id'))return [{...base,product_id:productId,image_url:cloud}];throw Error(query);
 },async end(){}}),'@/lib/warehouse':{salesWarehouseSql:()=>"select 'fixture'"},'@/lib/barcode':barcode,'@/lib/product-option-input':input,'@/lib/save-product-options':{saveProductOptions},'@/lib/commerce':commerce,'@/lib/product-discount':discount,'@/lib/desktop-media':media});
const previousDb=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://fixture.invalid/test';
try{const data=await (await productApi.GET(request())).json();assert.equal(data[0].options[0].image,local);assert.equal(data[0].editableOptions[0].image_url,local);}finally{if(previousDb===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousDb;}
const bridge=await load('lib/desktop-bridge.ts',{'@/lib/desktop-sync':{},'@/lib/desktop-media':{},'@/lib/store-db':{},'@/lib/product-option-image':images});
const publicProduct={id:productId,sku:'TEST',name:'Manqal',code:'123456',category:'',unit:'ədəd',price:9,discountPrice:null,image:'',images:[],options:[{label:base.label,size:'40',color:'Qırmızı',kind:'',price:7,position:0,isActive:true}],isActive:true};
assert.equal(bridge.publicProduct.safeParse(publicProduct).success,true,'Old desktop payload without image still accepted');
assert.equal(bridge.publicProduct.safeParse({...publicProduct,options:[{...publicProduct.options[0],image:catalog}]}).success,true);
for(const image of [local,'https://evil.test/a','javascript:x'])assert.equal(bridge.publicProduct.safeParse({...publicProduct,options:[{...publicProduct.options[0],image}]}).success,false,'Local media must be published before bridge transfer');
const previousPool=globalThis.catalogPool;delete globalThis.catalogPool;
try{
 const catalogLoader=await load('lib/public-catalog.ts',{react:{cache:fn=>fn},postgres:()=>({async unsafe(query){
 if(query.startsWith('select p.id'))return [{id:productId,code:'123456',name:'Manqal',sale_price:'9',image:'',images:[],options:[{id:optionId,label:base.label,image:cloud,price:'7',cost_price:'3',warehouse:'private'},{id:randomUUID(),label:'50 · Boz',price:'8',image:'https://evil.test/private'}]}];
 return [];
 }}),'@/lib/commerce':commerce,'@/lib/desktop-media':media,'@/lib/product-option-image':images});
 process.env.DATABASE_URL='postgres://fixture.invalid/test';const data=await catalogLoader.getPublicCatalog();
 assert.equal(data.products[0].options[0].image,local);assert.equal(data.products[0].options[1].image,'','Public image DTO refuses unsafe legacy data');
 assert.ok(!JSON.stringify(data).includes('cost_price'));assert.ok(!JSON.stringify(data).includes('warehouse'));assert.ok(!JSON.stringify(data).includes('evil.test'));
}finally{if(previousPool===undefined)delete globalThis.catalogPool;else globalThis.catalogPool=previousPool;if(previousDb===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousDb;}
const migration=await readFile('drizzle/0036_product_option_images.sql','utf8');assert.match(migration,/ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT ''/);
console.log('PASS: variant image safe URL validation, optional-vs-clear compatibility, locked bulk and standalone option edits, admin/POS DTO media mapping, authenticated unattached 4 MB raster upload with no row/logo mutation, desktop public-protocol backward compatibility and additive migration.');
}finally{if(originalLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=originalLocal;}
