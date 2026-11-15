import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Deterministic GET -> concurrent website edit -> POST/replay interleavings.
// Execute the real receiver against strict memory SQL: no DB, files or network.
const require=createRequire(import.meta.url),source=await readFile('lib/desktop-catalog-apply.ts','utf8');
const loaded={exports:{}};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(name=>name==='server-only'?{}:require(name),loaded,loaded.exports);
const {applyPublicProduct}=loaded.exports;
const option=(label='40 Red',values={})=>({label,size:'40',color:'Red',kind:'Steel',price:15,position:0,isActive:true,attributes:{thickness:'2 mm'},image:'',...values});
const base={id:'11111111-1111-4111-8111-111111111111',sku:'RACE-OLD',name:'Initial name',code:'123456',category:'Fixture',unit:'piece',price:10,discountPrice:null,image:'',images:[],options:[option()],isActive:true,description:'Initial text',specifications:''};
const patch=(fields,values={})=>({...structuredClone(base),...values,changedFields:fields,previous:structuredClone(base)});
const columns={sku:'sku',name:'name',public_code:'code',category:'category',unit:'unit',sale_price:'price',discount_price:'discountPrice',image_url:'image',is_active:'isActive',description:'description',specifications:'specifications'};
const optionColumns={label:'label',size:'size',color:'color',kind:'kind',price:'price',position:'position',is_active:'isActive',attributes:'attributes',image_url:'image'};
function fixture(product={},options=base.options){
 const state={product:{...structuredClone(base),...structuredClone(product)},options:structuredClone(options),writes:[],reads:[]};
 const tx={async unsafe(query,params=[]){
  if(query.startsWith('select')){
   state.reads.push(query);assert.match(query,/for update/,'Every comparison row is locked until the publication transaction ends');assert.doesNotMatch(query,/cost_price|stock|barcode|finance/);
   if(query.startsWith('select id,sku,deleted_at from products'))return [{id:base.id,sku:state.product.sku,deleted_at:null}];
   if(query.startsWith('select sku,name,public_code code'))return [structuredClone(state.product)];
   if(query.startsWith('select label,size,color,kind,price,position'))return structuredClone(state.options);
   throw Error('Unexpected guard read: '+query);
  }
  state.writes.push(query);
  if(query.startsWith('update products set ')){
   const assignments=/^update products set (.+) where id=/.exec(query)[1];
   for(const part of assignments.split(',')){const [column,index]=part.split('=$');assert.ok(Object.hasOwn(columns,column));state.product[columns[column]]=params[Number(index)-1];}return [];
  }
  if(query.startsWith('insert into product_categories'))return [];
  if(query.startsWith('update product_options set is_active=false')){for(const row of state.options)if(params.length===1||row.label===params[1])row.isActive=false;return [];}
  if(query.startsWith('insert into product_options')){
   const values={label:params[1],size:params[2],color:params[3],kind:params[4],price:params[5],position:params[6],isActive:params[7],attributes:JSON.parse(params[8]),image:params[9]};
   const existing=state.options.find(row=>row.label===values.label);if(!existing)state.options.push(values);
   else for(const part of query.split(' do update set ')[1].split(',')){const column=part.split('=')[0];assert.ok(Object.hasOwn(optionColumns,column));existing[optionColumns[column]]=structuredClone(values[optionColumns[column]]);}return [];
  }
  if(query.startsWith('delete from product_images'))return [];
  throw Error('Unexpected write: '+query);
 }};
 return {state,tx};
}
async function blocked(f,change){
 const before=JSON.stringify({product:f.state.product,options:f.state.options}),input=JSON.stringify(change);
 assert.equal(await applyPublicProduct(f.tx,change),undefined);assert.deepEqual(f.state.writes,[],'Preflight conflict is detected before ANY scalar/category/gallery/option writes');
 assert.equal(JSON.stringify({product:f.state.product,options:f.state.options}),before);assert.equal(JSON.stringify(change),input);
}
// Fresh web reads cannot authorize overwriting an edit made after that read.
await blocked(fixture({price:'15.00'}),patch(['price'],{price:12}));
await blocked(fixture({sku:'WEB-RENAMED'}),patch(['sku'],{sku:'LOCAL-RENAMED'}));
await blocked(fixture({description:'Concurrent web SEO'}),patch(['description','name'],{description:'Local SEO',name:'Local name'}));
// Immutable queued payloads replay with the old previous value. A later web
// price is never replaced just because the earlier local publish once applied.
const queued=patch(['price'],{price:12});
await blocked(fixture({price:'19.00'}),queued);
{
 const f=fixture({price:'12.00'});assert.equal(await applyPublicProduct(f.tx,queued),base.id,'Same intended value is a safe idempotent replay');assert.equal(Number(f.state.product.price),12);
}
{
 const f=fixture({name:'Web-only name',price:'10.00'});assert.equal(await applyPublicProduct(f.tx,queued),base.id);assert.equal(f.state.product.price,12);assert.equal(f.state.product.name,'Web-only name','Untouched web fields are preserved');
}
// Option conflict preflight must happen before an otherwise valid name update.
await blocked(fixture({},[option(undefined,{price:'19.00'})]),patch(['name','options'],{name:'Local name',options:[option(undefined,{price:18})]}));
await blocked(fixture({},[option(undefined,{color:'Concurrent blue'})]),patch(['options'],{options:[]}));
await blocked(fixture({},[]),patch(['options'],{options:[option(undefined,{price:18})]}));
await blocked(fixture({},[option(),option('New local',{size:'60'})]),patch(['options'],{options:[option(),option('New local',{size:'50'})]}));
{
 const f=fixture({},[option(undefined,{color:'Web blue',price:'15.00'})]);
 assert.equal(await applyPublicProduct(f.tx,patch(['options'],{options:[option(undefined,{price:18})]})),base.id);
 assert.equal(f.state.options[0].price,18);assert.equal(f.state.options[0].color,'Web blue','Disjoint option edits still merge');
}
{
 const f=fixture({},[option(undefined,{price:'18.00'})]);assert.equal(await applyPublicProduct(f.tx,patch(['options'],{options:[option(undefined,{price:18})]})),base.id,'Same intended option value is a safe replay');
}
{
 const f=fixture({},[option(undefined,{isActive:false,color:'Already removed'})]);assert.equal(await applyPublicProduct(f.tx,patch(['options'],{options:[]})),base.id,'Already inactive removal is idempotent');assert.equal(f.state.options[0].isActive,false);
}
{
 const incoming=option('Same new label'),f=fixture({},[option(),incoming]);assert.equal(await applyPublicProduct(f.tx,patch(['options'],{options:[option(),incoming]})),base.id,'An exactly equal new choice may replay safely');
}
{
 const f=fixture({price:17,name:'Web name'});assert.equal(await applyPublicProduct(f.tx,{...structuredClone(base),options:[]}),base.id);assert.equal(f.state.product.price,10);assert.equal(f.state.product.name,base.name,'Legacy full replacement behavior remains compatible');
}
console.log('PASS: receiver optimistic scalar/option guards reject GET-to-POST races and immutable queued replays before writes; intended-value replays/disjoint edits/legacy replacement remain compatible. No DB or network.');
