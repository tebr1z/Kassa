import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Executes real catalogue, category editor and upload handlers against isolated
// mocks. No live SQL, media writes, external fetch or credentials are accessed.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const compiled=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],file);
 const compiledModule={exports:{}};new Function('require','module','exports',compiled.outputText)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports);return compiledModule.exports;
}
const images=await load('lib/product-option-image.ts'),commerce=await load('lib/commerce.ts');
const hash='a'.repeat(64),cloud='https://res.cloudinary.com/fixture/image/upload/category.png',desktop='/api/desktop-media/'+hash,catalog='/api/catalog-media/'+hash;
const unsupported=['https://untrusted.example/category.png','http://res.cloudinary.com/a.png','https://res.cloudinary.com.evil.example/a.png','https://res.cloudinary.com@evil.example/a.png','https://user@res.cloudinary.com/a.png','https://res.cloudinary.com:8443/a.png','data:image/png;base64,AAAA','javascript:alert(1)','file:///category.png','//res.cloudinary.com/a.png','/api/catalog-media/'+hash+'?file=private',desktop+'/../private',cloud+'\\private',cloud+'\n'];
const categoryImages=[cloud,desktop,catalog,'',...unsupported];
const previousPool=globalThis.catalogPool,previousDatabase=process.env.DATABASE_URL;
process.env.DATABASE_URL='postgres://category-media-fixture.invalid/test';
try{
 for(const local of [false,true]){
  delete globalThis.catalogPool;const mediaReads=[];
  const sql={async unsafe(query){
   if(query.startsWith('select name,kind'))return [{name:'RestaMarket'}];
   if(query.startsWith('select p.id'))return [];
   if(query.startsWith('select id,product_id'))return [];
   if(query.startsWith('select id,name,image_url from product_categories'))return categoryImages.map((image_url,index)=>({id:'cat-'+index,name:'Kateqoriya '+index,image_url}));
   throw Error('Unexpected category fixture query: '+query);
  }};
  const loader=await load('lib/public-catalog.ts',{react:{cache:fn=>fn},postgres:()=>sql,'@/lib/commerce':commerce,'@/lib/product-option-image':images,'@/lib/desktop-media':{mediaUrl:async value=>{mediaReads.push(value);return local&&value===cloud?desktop:value;}}});
  const data=await loader.getPublicCatalog();
  assert.deepEqual(data.categories.slice(0,4).map(row=>row.image),[local?desktop:cloud,desktop,catalog,''],'Cloud, cached EXE media and web-published media all survive before media resolution');
  assert.ok(data.categories.slice(4).every(row=>row.image===''),'Unsupported category media never mounts an external/file/admin URL');
  assert.ok(!mediaReads.some(value=>unsupported.includes(value)),'Untrusted URL never reaches even the media resolver');
 }
}finally{if(previousPool===undefined)delete globalThis.catalogPool;else globalThis.catalogPool=previousPool;if(previousDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousDatabase;}

const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text=node=>node==null||node===false?'':typeof node==='string'||typeof node==='number'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');
const category={id:'11111111-1111-4111-8111-111111111111',name:'Manqallar',isActive:true,imageUrl:desktop,showOnHome:true};
for(const local of [false,true])for(const configured of [false,true]){
 let cursor=0;const react={useState(initial){const index=cursor++;return [index===0?[category]:typeof initial==='function'?initial():initial,()=>{}];},useEffect(){}};
 const {default:Editor}=await load('app/admin/store/category-showcase.tsx',{react}),tree=Editor({local,configured}),file=nodes(tree).find(node=>node.type==='input'&&node.props.type==='file');
 assert.equal(file.props.disabled,!(local||configured),'EXE uploads never need Cloudinary; unconfigured web uploads stay disabled');
 assert.equal(text(tree).includes('Şəkillər bu kompüterdə saxlanılır.'),local);assert.equal(text(tree).includes('əvvəl Cloudinary'),!local&&!configured);
 assert.equal(nodes(tree).find(node=>node.type==='img').props.src,desktop);
}

const originalLocal=process.env.BIRKASSA_LOCAL,originalFetch=globalThis.fetch;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfocAAAAASUVORK5CYII=','base64');
try{
 for(const local of [false,true]){
  process.env.BIRKASSA_LOCAL=local?'1':'0';const statements=[],saved=[],cloudUploads=[];
  const sql={async unsafe(query,values){statements.push([query,values]);
   if(query==='select id from product_categories where id=$1')return [{id:category.id}];
   if(query==='update product_categories set image_url=$1 where id=$2')return [];
   throw Error('Upload changed an unrelated row: '+query);
  },async end(){}};
  globalThis.fetch=async(url,options)=>{cloudUploads.push([url,options]);assert.match(url,/^https:\/\/api\.cloudinary\.com\//);return Response.json({secure_url:cloud});};
  const guard={withAdminSession:handler=>async request=>request.headers.get('cookie')==='fixture-admin'?handler(request):Response.json({error:'Unauthorized'},{status:401})};
  const upload=await load('app/api/store-admin/upload/route.ts',{'@/lib/require-admin':guard,'@/lib/store-db':{storeDb:()=>sql},'@/lib/cloudinary-config':{cloudCredentials:async()=>local?{}:{cloud:'fixture',key:'fixture-key',secret:'fixture-secret'}},'@/lib/catalog-media':{saveImage:async(bytes,localMode)=>{saved.push([bytes,localMode]);return {url:desktop};}},'@/lib/desktop-media':{imageType:()=> 'image/png'},'@/lib/product-option-image':images});
  const form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'category.png');form.set('categoryId',category.id);
  const response=await upload.POST(new Request('https://fixture.example/api/store-admin/upload',{method:'POST',headers:{cookie:'fixture-admin'},body:form}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{url:local?desktop:cloud});
  assert.equal(saved.length,local?1:0);if(local){assert.deepEqual(saved[0][0],png);assert.equal(saved[0][1],true);}assert.equal(cloudUploads.length,local?0:1);
  assert.deepEqual(statements.map(([query])=>query),['select id from product_categories where id=$1','update product_categories set image_url=$1 where id=$2'],'A category upload never modifies products, gallery, logo, SKU, options, prices or stock');
  assert.deepEqual(statements[1][1],[local?desktop:cloud,category.id]);
 }
}finally{globalThis.fetch=originalFetch;if(originalLocal===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=originalLocal;}

// The category endpoint has three explicit legacy-compatible operations. A
// malformed rename-shaped body must never fall through to deactivation.
const categoryDatabase=process.env.DATABASE_URL;
process.env.DATABASE_URL='postgres://category-mutation-fixture.invalid/test';
try{
 let opened=0,queries=[],duplicate=false;
 const state={id:category.id,name:'Manqallar',is_active:true,show_on_home:true,image_url:desktop};
 const sql={async unsafe(query,values=[]){queries.push([query,values]);
  if(query.startsWith('update product_categories set show_on_home=')){if(values[1]!==state.id)return [];state.show_on_home=values[0];return [{id:state.id}];}
  if(query.startsWith('update product_categories set is_active=')){if(values[1]!==state.id)return [];state.is_active=values[0];return [{id:state.id}];}
  if(query.startsWith('insert into product_categories (name)')){if(duplicate)throw Object.assign(Error('fixture duplicate'),{code:'23505'});return [{id:state.id,name:values[0]}];}
  throw Error('Unexpected category mutation: '+query);
 },async end(){}};
 const route=await load('app/api/categories/route.ts',{'@/lib/require-admin':{withAdminSession:handler=>handler},'next/server':{NextResponse:Response},'@/lib/log-error':{logSystemError:async()=>{}},'@/lib/desktop-media':{mediaUrl:async value=>value},postgres:()=>{opened++;return sql;}});
 const post=body=>route.POST(new Request('https://fixture.example/api/categories',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 for(const body of [{id:state.id},{id:state.id,name:'Rename must not deactivate'},{id:state.id,isActive:'false'},{id:state.id,isActive:0},{id:state.id,isActive:null},{id:state.id,showOnHome:'true'},{id:state.id,isActive:true,showOnHome:false},{id:state.id,isActive:true,name:'Ambiguous'},{id:state.id,action:'delete'},{id:'not-uuid',isActive:false},{name:'A'},{name:'a'.repeat(101)},{name:'Manqallar',stock:0},{name:123},[],null]){
  const before=opened;assert.equal((await post(body)).status,400,JSON.stringify(body));assert.equal(opened,before,'Rejected category payload never opens a business SQL connection');assert.deepEqual(state,{id:category.id,name:'Manqallar',is_active:true,show_on_home:true,image_url:desktop});
 }
 for(const value of [false,true]){
  queries=[];assert.equal((await post({id:state.id,isActive:value})).status,200);assert.equal(state.is_active,value);assert.equal(state.show_on_home,true);assert.equal(queries.length,1);assert.match(queries[0][0],/^update product_categories set is_active=/);
 }
 for(const value of [false,true]){
  queries=[];assert.equal((await post({id:state.id,showOnHome:value})).status,200);assert.equal(state.show_on_home,value);assert.equal(state.is_active,true);assert.equal(queries.length,1);assert.match(queries[0][0],/^update product_categories set show_on_home=/);
 }
 const missing='22222222-2222-4222-8222-222222222222';for(const operation of [{id:missing,isActive:false},{id:missing,showOnHome:false}])assert.equal((await post(operation)).status,404);
 const created=await post({name:'  '+ 'a'.repeat(100)+'  '});assert.equal(created.status,201);assert.equal((await created.json()).name,'a'.repeat(100));
 duplicate=true;assert.equal((await post({name:'Manqallar'})).status,409);
 assert.equal(state.image_url,desktop);assert.equal(state.name,'Manqallar','Category mutations do not rename existing rows or alter assigned product names/URLs');
}finally{if(categoryDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=categoryDatabase;}
const page=await readFile('app/admin/store/store-page.tsx','utf8');assert.match(page,/<CategoryShowcase\s+configured=\{data\.configured\}\s+local=\{data\.local===true\}/,'Local capability is passed from authenticated server state');
console.log('PASS: category Cloudinary/web/EXE media allowlist and resolver order, unsupported URLs rejected, trusted local EXE upload without cloud credentials, configured-only web uploads, category-only image writes, explicit typed create/active/home operations, no fallthrough deactivation, 100-character bounds and missing/duplicate handling. No real SQL, media or network used.');
