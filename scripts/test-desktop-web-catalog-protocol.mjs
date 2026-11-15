import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Pure protocol checks for Linux CI. PostgreSQL, profiles and fetch are never
// consulted; the Windows integration fixture tests the actual merge SQL.
const require=createRequire(import.meta.url),source=await readFile('lib/desktop-web-catalog.ts','utf8');
const loaded={exports:{}},unavailable=()=>{throw Error('Protocol tests must not access storage or network');};
const custom=name=>{
 if(name==='server-only')return {};
 if(name==='@/lib/store-db')return {storeDb:unavailable};
 if(name==='@/lib/desktop-catalog-source')return {readDesktopPublicProducts:unavailable};
 if(name==='@/lib/desktop-catalog-delta')return {};
 if(name==='@/lib/desktop-media')return {imageType:unavailable,cachedMedia:unavailable};
 if(name==='@/lib/product-option-image')return {isProductOptionImage:value=>typeof value==='string'&&(value===''||/^\/api\/(?:catalog|desktop)-media\/[a-f0-9]{64}$/.test(value)||/^https:\/\/res\.cloudinary\.com\/[a-zA-Z0-9_/.:-]+$/.test(value))};
 return require(name);
};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(custom,loaded,loaded.exports);
const {desktopWebCatalogSchema,readDesktopCatalogResponse,mergeDesktopWebGallery,desktopWebCatalogByteLimit}=loaded.exports;
const id='00000000-0000-4000-8000-000000000001',image=letter=>'/api/catalog-media/'+letter.repeat(64),local=letter=>'/api/desktop-media/'+letter.repeat(64);
const option={label:'40 · Qırmızı',size:'40',color:'Qırmızı',kind:'Dəmir',image:'',price:14,position:0,isActive:true,attributes:{thickness:'2 mm'}};
const row={id,sku:'PUBLIC-SKU',name:'Public product',code:'123456',category:'Manqallar',unit:'ədəd',price:12,discountPrice:10,image:image('a'),images:[image('a')],options:[option],isActive:true,description:'Public description',specifications:'Public specifications'};
const valid=value=>desktopWebCatalogSchema.safeParse({protocol:1,catalog:[value]}).success;
assert.ok(valid(row));assert.ok(valid({...row,isActive:false,price:0,discountPrice:null}));
for(const key of ['stock','quantity','cost_price','min_stock','barcode','warehouses','finance','salary','password_hash','pin_hash','auth_sessions','customer_accounts','smtp_password','changedFields','previous']){
 assert.equal(valid({...row,[key]:'PRIVATE'}),false,'Private/unknown product key rejected: '+key);
 assert.equal(valid({...row,options:[{...option,[key]:'PRIVATE'}]}),false,'Private/unknown option key rejected: '+key);
}
for(const invalid of [{...row,image:'file:///private/a.png'},{...row,image:'https://other.invalid/a.png'},{...row,image:local('a')},{...row,price:NaN},{...row,price:0},{...row,discountPrice:20},{...row,options:Array.from({length:101},()=>option)},{...row,images:Array(9).fill(image('a'))},{...row,options:[option,option]}])assert.equal(valid(invalid),false);
assert.equal(desktopWebCatalogSchema.safeParse({protocol:1,catalog:[row,{...row,id:'00000000-0000-4000-8000-000000000002'}]}).success,false,'Duplicate SKU rejected');
assert.equal(desktopWebCatalogSchema.safeParse({protocol:1,catalog:[row],auth_sessions:[]}).success,false,'Unknown envelope keys rejected');
assert.deepEqual(await readDesktopCatalogResponse(new Response(JSON.stringify({protocol:1,catalog:[row]}))),{protocol:1,catalog:[row]});
await assert.rejects(()=>readDesktopCatalogResponse(new Response('{}',{headers:{'content-length':String(desktopWebCatalogByteLimit+1)}})),/çox böyük/);
let cancelled=false;
const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(desktopWebCatalogByteLimit));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
await assert.rejects(()=>readDesktopCatalogResponse(new Response(oversized)),/çox böyük/);assert.equal(cancelled,true,'An oversized streamed response is cancelled');
await assert.rejects(()=>readDesktopCatalogResponse(new Response('{}',{status:401})),/səlahiyyəti/);
await assert.rejects(()=>readDesktopCatalogResponse(new Response('not JSON')));

let result=mergeDesktopWebGallery([image('a')],[image('b')],[image('a')]);assert.deepEqual(result,{next:[image('b')],nextBase:[image('b')],conflict:false});
result=mergeDesktopWebGallery([image('a'),local('c')],[image('b')],[image('a')]);assert.deepEqual(result.next,[image('b'),local('c')]);assert.deepEqual(result.nextBase,[image('b')]);assert.equal(result.conflict,false,'Disjoint remote change and local addition merge without blocking publication');
result=mergeDesktopWebGallery([],[image('a'),image('b')],[image('a')]);assert.deepEqual(result.next,[image('b')]);assert.deepEqual(result.nextBase,[image('a'),image('b')]);assert.equal(result.conflict,false,'Local unacknowledged removals are not resurrected or blocked');
result=mergeDesktopWebGallery([local('a')],[image('a')],[image('a')]);assert.deepEqual(result,{next:[local('a')],nextBase:[local('a')],conflict:false},'Equivalent cached content hashes do not manufacture outgoing edits');
result=mergeDesktopWebGallery([image('b'),image('a')],[image('a'),image('b')],[image('a'),image('b')]);assert.deepEqual(result.next,[image('b'),image('a')]);assert.equal(result.conflict,false,'Local-only reordering is preserved and not blocked');
result=mergeDesktopWebGallery([image('b'),image('a'),image('c')],[image('a'),image('c'),image('b')],[image('a'),image('b'),image('c')]);assert.deepEqual(result.next,[image('b'),image('a'),image('c')]);assert.equal(result.conflict,true,'Incompatible concurrent reordering is reported');
assert.equal(mergeDesktopWebGallery(result.next,[image('a'),image('c'),image('b')],result.nextBase,[image('a'),image('c'),image('b')],true).conflict,true,'A previously reported unresolved conflict is not forgotten on the next unchanged snapshot');
const eight=Array.from({length:8},(_,n)=>image(String(n)));result=mergeDesktopWebGallery([...eight,local('f')],[...eight,image('e')],eight);assert.deepEqual(result.next,[...eight,local('f')]);assert.deepEqual(result.nextBase,eight);assert.equal(result.conflict,true,'Over-cap merged galleries preserve the original field');
const stable=[local('a'),local('b')];assert.deepEqual(mergeDesktopWebGallery(stable,[image('a'),image('b')],stable),{next:stable,nextBase:stable,conflict:false});
assert.ok(source.includes('acknowledged_at is null'),'Pending immutable publication is checked');
assert.ok(source.includes('await tx.savepoint('),'Each product applies inside a savepoint');
assert.ok(source.includes('cost_price,min_stock')&&source.includes('0,0,$9,false'),'Unknown web products are inactive with no guessed costs/stock');
const projection=await readFile('lib/desktop-catalog-source.ts','utf8');
assert.match(projection,/\) as "options"\s+from products p/,'PostgreSQL 13 reserves OPTIONS: quote the public JSON alias instead of relying on PostgreSQL 17 grammar');
assert.ok(!/\) options\s+from products p/.test(projection),'The PostgreSQL 13-incompatible unquoted alias must not return');
for(const column of ['cost_price','min_stock','stock_movements','product_barcodes','auth_sessions','password_hash'])assert.ok(!projection.includes(column),'Public projection must not read private data: '+column);
console.log('PASS: pure public catalog protocol/body caps/private-key rejection, cached image equivalence, dirty gallery add/remove/order conflicts and limits, replay idempotence; storage and network disabled.');
