import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// The actual receiver helper runs against an in-memory SQL fixture. No real
// database, merchant rows, media files, credentials or network are accessed.
const require=createRequire(import.meta.url),file='lib/desktop-catalog-apply.ts';
const compiled=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
assert.deepEqual((compiled.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[]);
const mod={exports:{}};new Function('require','module','exports',compiled.outputText)(name=>name==='server-only'?{}:require(name),mod,mod.exports);
const {applyPublicProduct}=mod.exports;
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const photo=letter=>'/api/catalog-media/'+letter.repeat(64);
const option=(label,extra={})=>({label,size:'40',color:'Qırmızı',kind:'Dəmir',price:15,position:0,isActive:true,attributes:{Qalınlıq:'2 mm'},image:photo('a'),...extra});
const product=()=>({id,sku:'FIXTURE-OLD',name:'Sınaq manqal',code:'123456',category:'Manqallar',unit:'ədəd',price:10,discountPrice:null,image:photo('a'),images:[photo('a')],options:[option('40 · Qırmızı')],isActive:true,description:'Yerli təsvir',specifications:'Yerli xüsusiyyətlər'});
const patch=(base,fields,changes={})=>({...structuredClone(base),...changes,changedFields:fields,previous:structuredClone(base)});
const webProduct=(base=product(),extra={})=>({id:base.id,sku:base.sku,name:'Veb adı',public_code:base.code,category:'Veb kateqoriya',unit:'qutu',sale_price:31,discount_price:29,cost_price:17.25,min_stock:8,image_url:photo('d'),is_active:true,deleted_at:null,description:'Veb SEO mətni',specifications:'Veb xüsusiyyətlər',...extra});
const webOption=(item,extra={})=>({product_id:id,label:item.label,size:item.size,color:item.color,kind:item.kind,price:item.price,position:item.position,is_active:item.isActive,attributes:structuredClone(item.attributes),image_url:item.image??'',cost_price:7.75,...extra});
function fixture({products=[webProduct()],images=[],options=[]}={}){
 const state={products:structuredClone(products),images:structuredClone(images),options:structuredClone(options),categories:[],queries:[]};let next=0;
 const sql={async unsafe(query,params=[]){
  state.queries.push([query,params]);
  if(query.startsWith('select id,sku,deleted_at from products'))return state.products.filter(row=>row.id===params[0]||row.sku===params[1]||(params[2]!==null&&row.sku===params[2])).map(row=>({id:row.id,sku:row.sku,deleted_at:row.deleted_at}));
  if(query.startsWith('select sku,name,public_code code'))return state.products.filter(row=>row.id===params[0]).map(row=>({sku:row.sku,name:row.name,code:row.public_code,category:row.category??'',unit:row.unit,price:row.sale_price,discountPrice:row.discount_price,image:row.image_url??'',isActive:row.is_active,description:row.description??'',specifications:row.specifications??''}));
  if(query.startsWith('select label,size,color,kind,price,position'))return state.options.filter(row=>row.product_id===params[0]).map(row=>({label:row.label,size:row.size,color:row.color,kind:row.kind,price:row.price,position:row.position,isActive:row.is_active,attributes:structuredClone(row.attributes),image:row.image_url??''}));
  if(query.startsWith('update products set ')){
   const match=query.match(/^update products set (.+) where id=\$(\d+)$/);assert.ok(match);const row=state.products.find(item=>item.id===params[Number(match[2])-1]);assert.ok(row);
   for(const assignment of match[1].split(',')){const [column,number]=assignment.split('=$');assert.ok(!['cost_price','min_stock','stock','barcode'].includes(column));row[column]=params[Number(number)-1];}return [];
  }
  if(query.startsWith('insert into products(')){
   const [productId,sku,name,code,category,unit,price,discount,image,active,description,specifications]=params;
   assert.ok(!state.products.some(row=>row.id===productId||row.sku===sku));
   state.products.push({id:productId,sku,name,public_code:code,category,unit,sale_price:price,discount_price:discount,cost_price:0,min_stock:0,image_url:image,is_active:active,deleted_at:null,description,specifications});return [{id:productId}];
  }
  if(query.startsWith('insert into product_categories')){state.categories.push(params[0]);return [];}
  if(query.startsWith('select id,image_url,position from product_images'))return state.images.filter(row=>row.product_id===params[0]).sort((a,b)=>a.position-b.position).map(row=>({...row}));
  if(query==='delete from product_images where product_id=$1'){state.images=state.images.filter(row=>row.product_id!==params[0]);return [];}
  if(query==='delete from product_images where product_id=$1 and id=$2'){state.images=state.images.filter(row=>row.product_id!==params[0]||row.id!==params[1]);return [];}
  if(query.startsWith('update product_images set position=')){const row=state.images.find(row=>row.product_id===params[1]&&row.id===params[2]);assert.ok(row);row.position=params[0];return [];}
  if(query.startsWith('insert into product_images')){state.images.push({id:'new-image-'+next++,product_id:params[0],image_url:params[1],position:params[2]});return [];}
  if(query.startsWith('update product_options set is_active=false')){for(const row of state.options)if(row.product_id===params[0]&&(params.length===1||row.label===params[1]))row.is_active=false;return [];}
  if(query.startsWith('insert into product_options')){
   const [productId,label,size,color,kind,price,position,active,attributes,image]=params;
   const incoming={product_id:productId,label,size,color,kind,price,position,is_active:active,attributes:JSON.parse(attributes),image_url:image};
   const row=state.options.find(row=>row.product_id===productId&&row.label===label);
   if(!row)state.options.push({...incoming,cost_price:null});
   else for(const assignment of query.split(' do update set ')[1].split(',')){const [column,excluded]=assignment.split('=excluded.');assert.equal(column,excluded);assert.notEqual(column,'cost_price');row[column]=structuredClone(incoming[column]);}
   return [];
  }
  throw new Error('Unexpected in-memory fixture query: '+query);
 }};
 return {sql,state};
}
const gallery=urls=>urls.map((url,index)=>({id:'photo-'+index,product_id:id,image_url:url,position:index}));
const publicRows=state=>state.images.filter(row=>row.product_id===id).sort((a,b)=>a.position-b.position).map(row=>row.image_url);

// A size/price edit must not clear a newer web color/photo, a web-only choice,
// a different untouched baseline option, private option cost or product SEO.
{
 const base=product();base.options=[option('40 · Qırmızı'),option('Silinəcək',{position:1}),option('Dəyişməyən',{position:2})];
 const local=patch(base,['options'],{options:[{...base.options[0],size:'50',price:18},option('Yeni seçim',{color:'Yaşıl',image:photo('c'),position:1}),base.options[2]]});
 const f=fixture({images:gallery([photo('d')]),options:[webOption(base.options[0],{color:'Veb mavi',image_url:photo('d')}),webOption(base.options[1]),webOption(base.options[2],{image_url:photo('e')}),webOption(option('Yalnız veb'),{cost_price:9.5})]});
 const before=structuredClone(f.state.products);assert.equal(await applyPublicProduct(f.sql,local),id);assert.deepEqual(f.state.products,before);assert.deepEqual(publicRows(f.state),[photo('d')]);
 const first=f.state.options.find(row=>row.label==='40 · Qırmızı');assert.equal(first.size,'50');assert.equal(first.price,18);assert.equal(first.color,'Veb mavi');assert.equal(first.image_url,photo('d'));assert.equal(first.cost_price,7.75);
 assert.equal(f.state.options.find(row=>row.label==='Silinəcək').is_active,false);assert.equal(f.state.options.find(row=>row.label==='Dəyişməyən').image_url,photo('e'));assert.equal(f.state.options.find(row=>row.label==='Yalnız veb').is_active,true);assert.equal(f.state.options.find(row=>row.label==='Yalnız veb').cost_price,9.5);assert.equal(f.state.options.find(row=>row.label==='Yeni seçim').image_url,photo('c'));assert.equal(f.state.options.find(row=>row.label==='Yeni seçim').cost_price,null);
}
// A locally changed option photo is applied explicitly, without rewriting its
// other newer web fields or touching that option's private cost.
{
 const base=product(),f=fixture({options:[webOption(base.options[0],{size:'Veb 70',color:'Veb yaşıl'})]});
 await applyPublicProduct(f.sql,patch(base,['options'],{options:[{...base.options[0],image:photo('c')}]}));
 const saved=f.state.options[0];assert.equal(saved.image_url,photo('c'));assert.equal(saved.size,'Veb 70');assert.equal(saved.color,'Veb yaşıl');assert.equal(saved.cost_price,7.75);
}
// A new local label cannot overwrite a different, previously web-only choice.
{
 const base=product(),label='Əvvəl yalnız vebdə olan seçim';
 const existing=webOption(option(label),{image_url:photo('e'),cost_price:9.25});
 const f=fixture({options:[webOption(base.options[0]),existing]});
 const incoming=option(label,{size:'60',image:''});
 const before=structuredClone(f.state.options);
 assert.equal(await applyPublicProduct(f.sql,patch(base,['options'],{options:[...base.options,incoming]})),undefined);
 const saved=f.state.options.find(row=>row.label===label);
 assert.equal(saved.size,'40');assert.equal(saved.image_url,photo('e'));assert.equal(saved.cost_price,9.25);assert.deepEqual(f.state.options,before,'Colliding choices remain wholly unchanged until reviewed');
}
// Only explicit local gallery removals disappear; web-only images and IDs
// survive. A baseline photo removed on the web is not resurrected by additions.
for(const webImages of [[photo('a'),photo('b'),photo('d')],[photo('a'),photo('d')]]){
 const base=product();base.images=[photo('a'),photo('b')];const f=fixture({images:gallery(webImages)}),surviving=f.state.images.filter(row=>row.image_url!==photo('a')).map(row=>row.id);
 await applyPublicProduct(f.sql,patch(base,['images'],{images:[photo('b'),photo('c')]}));
 assert.deepEqual(publicRows(f.state),[...webImages.filter(url=>url!==photo('a')),photo('c')]);for(const oldId of surviving)assert.ok(f.state.images.some(row=>row.id===oldId));assert.equal(f.state.products[0].image_url,photo('d'));
}
{
 const base=product(),f=fixture({images:gallery(Array.from({length:8},(_,i)=>'/api/catalog-media/'+String(i).repeat(64)))});
 await assert.rejects(applyPublicProduct(f.sql,patch(base,['images'],{images:[photo('a'),photo('c')]})),/8-dən çox/);assert.equal(f.state.images.length,8);assert.ok(!f.state.queries.some(([query])=>query.startsWith('delete from product_images')||query.startsWith('insert into product_images')));
}
// Stable IDs support SKU changes, including an older SKU-matched different-ID
// import. Only the selected scalar field changes and private data is retained.
for(const webId of [id,other]){
 const base=product(),f=fixture({products:[webProduct(base,{id:webId})],images:gallery([photo('d')])});
 const before=structuredClone(f.state.products[0]);assert.equal(await applyPublicProduct(f.sql,patch(base,['sku'],{sku:'FIXTURE-NEW'})),webId);assert.deepEqual(f.state.products[0],{...before,sku:'FIXTURE-NEW'});assert.equal(f.state.categories.length,0);assert.deepEqual(publicRows(f.state),[photo('d')]);
}
{
 const base=product(),f=fixture({products:[webProduct(base),webProduct(base,{id:other,sku:'COLLISION'})]});const before=structuredClone(f.state.products);
 await assert.rejects(applyPublicProduct(f.sql,patch(base,['sku'],{sku:'COLLISION'})),/toqquşur/);assert.deepEqual(f.state.products,before);assert.equal(f.state.queries.length,1);
}
{
 const base=product(),f=fixture({products:[webProduct(base,{id:other})]});const before=structuredClone(f.state.products);
 await assert.rejects(applyPublicProduct(f.sql,{...base,changedFields:['name'],previous:null}),/artıq mövcuddur/);assert.deepEqual(f.state.products,before);assert.equal(f.state.queries.length,1,'A genuinely new local product cannot take over an unrelated web SKU');
}
// Missing/deleted web products cannot return through a stale desktop edit.
for(const products of [[],[webProduct(product(),{deleted_at:'2026-01-01'})]]){
 const f=fixture({products,images:gallery([photo('d')]),options:[webOption(product().options[0])]});const before=structuredClone(f.state);
 assert.equal(await applyPublicProduct(f.sql,patch(product(),['name','image','images','options'],{name:'Yeni ad'})),undefined);assert.deepEqual(f.state.products,before.products);assert.deepEqual(f.state.images,before.images);assert.deepEqual(f.state.options,before.options);assert.equal(f.state.queries.length,1);
}
{
 const base=product(),f=fixture({products:[]});assert.equal(await applyPublicProduct(f.sql,{...base,changedFields:['name','image','images','options'],previous:null}),id);assert.equal(f.state.products[0].name,base.name);assert.equal(f.state.products[0].cost_price,0);assert.equal(f.state.products[0].min_stock,0);assert.deepEqual(publicRows(f.state),base.images);assert.equal(f.state.options.length,1);assert.deepEqual(f.state.categories,[base.category]);
}
// Legacy callers retain full public replacement behavior without acquiring
// authority over private product or option costs.
{
 const base=product(),f=fixture({images:gallery([photo('d')]),options:[webOption(base.options[0]),webOption(option('Yalnız veb'))]});
 await applyPublicProduct(f.sql,base);assert.equal(f.state.products[0].name,base.name);assert.equal(f.state.products[0].description,base.description);assert.equal(f.state.products[0].cost_price,17.25);assert.equal(f.state.products[0].min_stock,8);assert.deepEqual(publicRows(f.state),base.images);assert.equal(f.state.options.find(row=>row.label==='Yalnız veb').is_active,false);assert.equal(f.state.options.find(row=>row.label===base.options[0].label).cost_price,7.75);
}
{
 const f=fixture();await assert.rejects(applyPublicProduct(f.sql,{...product(),changedFields:['cost_price'],previous:product()}),/sahəsi düzgün deyil/);assert.equal(f.state.queries.length,0);
}
console.log('PASS: masked public scalars, stable-ID/SKU rename and collision refusal, removed/deleted product protection, three-way gallery merges/IDs/limits, selective option fields/additions/removals, web-only metadata preservation, legacy compatibility and unchanged private costs. In-memory SQL only.');
