import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type postgres from 'postgres';
import {storeDb} from '@/lib/store-db';
import {readDesktopPublicProducts} from '@/lib/desktop-catalog-source';
import {desktopCatalogBaselineKey,normalizeDesktopPublicProduct,publicProductFields} from '@/lib/desktop-catalog-delta';
import type {DesktopCatalogBaseline,DesktopPublicProduct,DesktopPublicOption} from '@/lib/desktop-catalog-delta';
import {isProductOptionImage} from '@/lib/product-option-image';
import {imageType,cachedMedia} from '@/lib/desktop-media';

export const desktopWebCatalogByteLimit=32*1024*1024;
const price=z.number().finite().min(0).max(99999999999.99);
const picture=z.string().max(2048).refine(value=>isProductOptionImage(value)&&!value.startsWith('/api/desktop-media/'));
const option=z.object({label:z.string().min(1).max(120),size:z.string().max(80),color:z.string().max(80),kind:z.string().max(80),image:picture,price:price.nullable(),position:z.number().int().min(-100000).max(100000),isActive:z.boolean(),attributes:z.record(z.string().min(1).max(60),z.string().max(120)).refine(value=>Object.keys(value).length<=30)}).strict();
const product=z.object({id:z.string().uuid(),sku:z.string().min(1).max(100),name:z.string().min(1).max(200),code:z.string().regex(/^\d{6}$/),category:z.string().max(100),unit:z.string().max(30),price,discountPrice:price.nullable(),image:picture,images:z.array(picture).max(8),options:z.array(option).max(100),isActive:z.boolean(),description:z.string().max(5000),specifications:z.string().max(3000)}).strict().superRefine((row,context)=>{
 if(row.isActive&&row.price<=0)context.addIssue({code:z.ZodIssueCode.custom,path:['price'],message:'Invalid active product price'});
 if(row.discountPrice!==null&&!(row.discountPrice>0&&row.discountPrice<row.price))context.addIssue({code:z.ZodIssueCode.custom,path:['discountPrice'],message:'Invalid discount'});
 if(new Set(row.options.map(item=>item.label)).size!==row.options.length)context.addIssue({code:z.ZodIssueCode.custom,path:['options'],message:'Duplicate option label'});
});
export const desktopWebCatalogSchema=z.object({protocol:z.literal(1),catalog:z.array(product).max(10000)}).strict().superRefine((batch,context)=>{
 for(const field of ['id','sku','code'] as const)if(new Set(batch.catalog.map(row=>row[field])).size!==batch.catalog.length)context.addIssue({code:z.ZodIssueCode.custom,path:['catalog'],message:'Duplicate catalogue '+field});
});
type Sql=ReturnType<typeof postgres>;
type FieldConflict={id:string;sku:string;fields:string[];reason:string};
type MirrorRow={remote_id:string;local_product_id:string;remote_payload:DesktopPublicProduct;review_required:boolean;conflicts:string[]};
const columns={sku:'sku',name:'name',code:'public_code',category:'category',unit:'unit',price:'sale_price',discountPrice:'discount_price',image:'image_url',isActive:'is_active',description:'description',specifications:'specifications'} as const;
const optionColumns={size:'size',color:'color',kind:'kind',image:'image_url',price:'price',position:'position',isActive:'is_active',attributes:'attributes'} as const;
type OptionField=keyof typeof optionColumns;
const clone=<T,>(value:T):T=>structuredClone(value);
const sortJson=(value:unknown):unknown=>Array.isArray(value)?value.map(sortJson):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,sortJson(item)])):value;
const equal=(a:unknown,b:unknown)=>isDeepStrictEqual(sortJson(a),sortJson(b));
const safeName=(value:string)=>value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,100);
const statusKey='desktop_web_catalog_status';
const imageId=(value:string)=>/^\/api\/(?:catalog|desktop)-media\/([a-f0-9]{64})$/.exec(value)?.[1]||value;
const imageEqual=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'?imageId(a)===imageId(b):equal(a,b);
const galleryEqual=(a:readonly string[],b:readonly string[])=>equal(a.map(imageId),b.map(imageId));
const optionEqual=(a:unknown,b:unknown,key:OptionField)=>key==='image'?imageEqual(a,b):equal(a,b);
function baseline(value:unknown):DesktopCatalogBaseline{
 const row=value as DesktopCatalogBaseline;
 if(row?.version!==1||!row.products||typeof row.products!=='object'||Array.isArray(row.products))throw Error('Kataloq bağlantısının ilkin vəziyyəti tapılmadı.');
 return {version:1,products:Object.fromEntries(Object.entries(row.products).map(([id,item])=>[id,normalizeDesktopPublicProduct(item)]))};
}
async function setting(tx:Pick<Sql,'unsafe'>,key:string,value:unknown){await tx.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[key,JSON.stringify(value)]);}

/** Validate before allocating a complete response; never follow a redirect. */
export async function readDesktopCatalogResponse(response:Response){
 if(!response.ok||!response.body)throw Error(response.status===401?'Kataloq bağlantısının səlahiyyəti yoxlanmadı.':'Veb kataloqu alınmadı.');
 const declared=response.headers.get('content-length');
 if(declared&&(!/^\d+$/.test(declared)||Number(declared)>desktopWebCatalogByteLimit)){await response.body.cancel();throw Error('Veb kataloqu çox böyükdür.');}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>desktopWebCatalogByteLimit)throw Error('Veb kataloqu çox böyükdür.');parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return desktopWebCatalogSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))));
}

// Incoming store-relative photos are fetched only from the paired HTTPS origin,
// with the content hash verified. A desktop-media URL is valid both offline and
// in the existing outgoing publisher; absolute store URLs are never persisted.
async function localPictures(rows:DesktopPublicProduct[],origin:string){
 const store=new URL(origin);if(store.protocol!=='https:'||store.origin!==origin||store.username||store.password)throw Error('Kataloq ünvanı düzgün deyil.');
 const pending=new Map<string,Promise<string>>();let downloads=0;
 async function local(url:string):Promise<string>{
  if(!url||url.startsWith('https://res.cloudinary.com/'))return url;
  const match=/^\/api\/catalog-media\/([a-f0-9]{64})$/.exec(url);if(!match)throw Error('Veb şəkli düzgün deyil.');
  const hash=match[1];let result=pending.get(hash);if(result)return result;
  result=(async()=>{
   const existing=await cachedMedia(hash);
   if(existing&&existing.body.length<=8*1024*1024&&createHash('sha256').update(existing.body).digest('hex')===hash&&imageType(existing.body)===existing.type)return '/api/desktop-media/'+hash;
   if(++downloads>64)throw Error('Şəkillər hissə-hissə endirilir. Növbəti sinxronizasiyanı gözləyin.');
   const target=new URL(url,store);if(target.origin!==origin||target.pathname!==url)throw Error('Veb şəkil ünvanı düzgün deyil.');
   const response=await fetch(target,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok||!response.body||Number(response.headers.get('content-length'))>8*1024*1024){await response.body?.cancel();throw Error('Veb şəkli endirilmədi.');}
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8*1024*1024)throw Error('Veb şəkli çox böyükdür.');parts.push(value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const body=Buffer.concat(parts);if(createHash('sha256').update(body).digest('hex')!==hash)throw Error('Veb şəklinin bütövlüyü uyğun gəlmədi.');
   const type=imageType(body),root=path.join(process.env.BIRKASSA_DATA_DIR||process.cwd(),'media'),temporary=path.join(root,hash+'.'+randomUUID()+'.tmp');
   await mkdir(root,{recursive:true});
   try{await writeFile(temporary,body,{mode:0o600,flag:'wx'});await rename(temporary,path.join(root,hash+'.bin'));await writeFile(temporary,JSON.stringify({type,url:target.href,size:bytes}),{mode:0o600,flag:'wx'});await rename(temporary,path.join(root,hash+'.json'));}
   finally{await unlink(temporary).catch(()=>{});}
   return '/api/desktop-media/'+hash;
  })();pending.set(hash,result);return result;
 }
 const prepared:DesktopPublicProduct[]=[],errors:FieldConflict[]=[];
 for(const row of rows){try{prepared.push({...row,image:await local(row.image),images:await Promise.all(row.images.map(local)),options:await Promise.all(row.options.map(async item=>({...item,image:await local(item.image)})))});}catch{errors.push({id:row.id,sku:row.sku,fields:['image'],reason:'Məhsul şəkilləri endirilmədi; yerli məlumatlar dəyişdirilməyib.'});}}
 return {prepared,errors};
}

/** Three-way gallery membership preserves unsent additions/removals and IDs. */
export function mergeDesktopWebGallery(current:string[],remote:string[],before:string[],previous:string[]=before,blocked=false){
 const desired=new Map(current.map(url=>[imageId(url),url])),accepted=new Map(before.map(url=>[imageId(url),url]));let conflict=false;
 const old=new Set(before.map(imageId)),local=new Set(current.map(imageId)),prior=new Set(previous.map(imageId)),incoming=new Map(remote.map(url=>[imageId(url),url]));
 for(const id of new Set([...old,...local,...prior,...incoming.keys()])){
  const b=old.has(id),l=local.has(id),r=incoming.has(id);
  if(l===r||l===b){if(r){const url=desired.get(id)||incoming.get(id)!;desired.set(id,url);accepted.set(id,url);}else{desired.delete(id);accepted.delete(id);}}
  else if(r!==prior.has(id)&&r!==b)conflict=true;
 }
 const arrange=(items:Map<string,string>,order:string[])=>[...new Set([...order.map(imageId),...items.keys()])].filter(id=>items.has(id)).map(id=>items.get(id)!);
 const reordered=(a:string[],b:string[])=>{const both=new Set(a.map(imageId).filter(id=>b.some(url=>imageId(url)===id)));return !equal(a.map(imageId).filter(id=>both.has(id)),b.map(imageId).filter(id=>both.has(id)));};
 const localOrderDirty=reordered(current,before),remoteOrderDirty=reordered(remote,previous)&&reordered(remote,before);
 const orderConflict=localOrderDirty&&remoteOrderDirty&&reordered(current,remote);
 if(orderConflict)conflict=true;
 const next=arrange(desired,localOrderDirty?current:remote),nextBase=arrange(accepted,localOrderDirty&&!remoteOrderDirty||orderConflict?before:remote);
 if(next.length>8)return {next:current,nextBase:before,conflict:true};
 if(blocked&&!galleryEqual(next,nextBase)&&!galleryEqual(next,remote))conflict=true;
 return {next,nextBase,conflict};
}

async function applyGallery(tx:Pick<Sql,'unsafe'>,id:string,next:string[]){
 const rows=await tx.unsafe('select id,image_url,position from product_images where product_id=$1 order by position,id for update',[id]);
 const keep=new Set(next.map(imageId));
 for(const row of rows)if(!keep.has(imageId(String(row.image_url))))await tx.unsafe('delete from product_images where product_id=$1 and id=$2',[id,row.id]);
 for(const [position,url]of next.entries()){
  const found=rows.find(row=>imageEqual(String(row.image_url),url));
  if(found){if(found.image_url!==url||Number(found.position)!==position)await tx.unsafe('update product_images set image_url=$1,position=$2 where product_id=$3 and id=$4',[url,position,id,found.id]);}
  else await tx.unsafe('insert into product_images(product_id,image_url,position) values($1,$2,$3)',[id,url,position]);
 }
}

async function applyOptions(tx:Pick<Sql,'unsafe'>,id:string,current:DesktopPublicOption[],remote:DesktopPublicOption[],before:DesktopPublicOption[],previous:DesktopPublicOption[],blocked=false){
 const next=clone(current),nextBase=clone(before),issues=new Set<string>();let changed=false;
 const byLabel=(rows:DesktopPublicOption[],label:string)=>rows.find(item=>item.label===label);
 const accepted=(item:DesktopPublicOption)=>{let result=byLabel(nextBase,item.label);if(!result){result=clone(item);nextBase.push(result);}return result;};
 for(const item of remote){
  let local=byLabel(next,item.label);const base=byLabel(before,item.label),prior=byLabel(previous,item.label);
  if(!local){
   if(base){issues.add('options');continue;}
   if(next.length>=100){issues.add('options');continue;}
   local=clone(item);next.push(local);accepted(local);changed=true;
   await tx.unsafe('insert into product_options(product_id,label,size,color,kind,image_url,price,position,is_active,attributes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::jsonb)',[id,item.label,item.size,item.color,item.kind,item.image,item.price,item.position,item.isActive,JSON.stringify(item.attributes)]);
   continue;
  }
  // A plain-label collision with unrelated custom attributes is not identity.
  const priorItem=prior||base;
  if(!equal(local.attributes,item.attributes)&&(!prior&&(!base||equal(local.attributes,base.attributes)||!equal(item.attributes,base.attributes))||blocked&&base&&equal(local.attributes,base.attributes)&&prior&&!equal(local.attributes,prior.attributes))){issues.add('options');continue;}
  if(!base){if(equal(local,item))accepted(local);else if(!prior||!equal(item,prior))issues.add('options');continue;}
  const updates:OptionField[]=[],baseItem=byLabel(nextBase,item.label)!;
  for(const field of Object.keys(optionColumns) as OptionField[]){
   if(optionEqual(local[field],item[field],field)||optionEqual(local[field],base[field],field)){
    if(!optionEqual(local[field],item[field],field)){(local as unknown as Record<string,unknown>)[field]=clone(item[field]);updates.push(field);}
    (baseItem as unknown as Record<string,unknown>)[field]=clone(local[field]);
   }else if(blocked||(!priorItem||!optionEqual(item[field],priorItem[field],field))&&!optionEqual(item[field],base[field],field))issues.add('options');
  }
  if(updates.length){const values=updates.map(field=>field==='attributes'?JSON.stringify(local[field]):local[field]) as (string|number|boolean|null)[];values.push(id,local.label);await tx.unsafe('update product_options set '+updates.map((field,index)=>optionColumns[field]+'=$'+(index+1)+(field==='attributes'?'::text::jsonb':'')).join(',')+' where product_id=$'+(values.length-1)+' and label=$'+values.length,values);changed=true;}
 }
 // Absence only removes an option that was previously paired with the web;
 // first connection never archives unrelated local-only choices.
 const labels=new Set(remote.map(item=>item.label));
 for(const prior of previous){if(labels.has(prior.label))continue;const local=byLabel(next,prior.label),base=byLabel(before,prior.label);if(!local||!base)continue;if(local.isActive===base.isActive){if(local.isActive){local.isActive=false;await tx.unsafe('update product_options set is_active=false where product_id=$1 and label=$2',[id,local.label]);changed=true;}accepted(local).isActive=false;}else issues.add('options');}
 return {next,nextBase,conflict:issues.size>0,changed};
}

/** The caller has parsed a public-only DTO. Every product has its own savepoint. */
export async function applyDesktopWebCatalog(sql:Sql,origin:string,remoteRows:DesktopPublicProduct[],preparationErrors:FieldConflict[]=[]){
 return sql.begin(async tx=>{
  await tx.unsafe("select pg_advisory_xact_lock(hashtext('birkassa.desktop-outbox'))");
  const [queued]=await tx.unsafe('select count(*)::int n from desktop_sync_outbox where store_url=$1 and acknowledged_at is null',[origin]);
  if(Number(queued.n)){await setting(tx,statusKey,{storeUrl:origin,lastSuccess:null,changed:0,conflicts:0,pending:true,reviewRequired:0,errors:[]});return {changed:0,conflicts:0};}
  // Local editors cannot change a field between its dirty check and commit.
  await tx.unsafe('lock table products,product_images,product_options in share row exclusive mode');
  const key=desktopCatalogBaselineKey(origin),[bookmark]=await tx.unsafe('select value from system_settings where key=$1 for update',[key]);
  if(!bookmark)throw Error('Kataloq bağlantısının ilkin vəziyyəti tapılmadı.');
  const outgoing=baseline(JSON.parse(bookmark.value));
  const localRows=await readDesktopPublicProducts(tx),localById=new Map(localRows.map(row=>[row.id,row]));
  const deleted=new Set((await tx.unsafe('select id from products where deleted_at is not null')).map(row=>String(row.id)));
  const mappings=await tx.unsafe<MirrorRow[]>('select remote_id,local_product_id,remote_payload,review_required,conflicts from desktop_web_catalog_map where store_url=$1 for update',[origin]);
  async function hold(remoteId:string,snapshot:DesktopPublicProduct|undefined,localId?:string){
   const existing=mappings.find(item=>item.remote_id===remoteId),id=existing?.local_product_id||localId;
   if(!id||mappings.some(item=>item.remote_id!==remoteId&&item.local_product_id===id))return;
   const conflicts=['identity',...publicProductFields];
   try{await tx.savepoint(async sp=>{
    if(existing)await sp.unsafe('update desktop_web_catalog_map set conflicts=$1::text::jsonb,updated_at=now() where store_url=$2 and remote_id=$3',[JSON.stringify(conflicts),origin,remoteId]);
    else if(snapshot)await sp.unsafe('insert into desktop_web_catalog_map(store_url,remote_id,local_product_id,remote_payload,conflicts) values($1,$2,$3,$4::text::jsonb,$5::text::jsonb)',[origin,remoteId,id,JSON.stringify(snapshot),JSON.stringify(conflicts)]);
   });if(existing)existing.conflicts=conflicts;else if(snapshot)mappings.push({remote_id:remoteId,local_product_id:id,remote_payload:snapshot,review_required:false,conflicts});}
   catch{/* A conflicting identity is never force-mapped just to record an error. */}
  }
  const errors:FieldConflict[]=[...preparationErrors];let changed=0;
  for(const error of preparationErrors){const stable=localById.get(error.id);await hold(error.id,stable,stable?.id);}
  for(const remote of remoteRows){
   let committed:{row:DesktopPublicProduct;nextBase:DesktopPublicProduct;issues:string[];review:boolean;changed:boolean}|undefined;
   let quarantineId:string|undefined;
   try{await tx.savepoint(async sp=>{
    const mapping=mappings.find(item=>item.remote_id===remote.id),stable=localById.get(remote.id),mapped=mapping?localById.get(mapping.local_product_id):undefined,skuMatches=localRows.filter(item=>item.sku===remote.sku);
    quarantineId=stable?.id||mapped?.id;
    if((stable&&mapped&&stable.id!==mapped.id)||skuMatches.length>1)throw Error('Məhsulun yerli identifikatoru uyğun gəlmir.');
    const local=stable||mapped||skuMatches[0];
    if(local&&skuMatches.some(item=>item.id!==local.id))throw Error('SKU başqa yerli məhsulla toqquşur.');
    if(local&&mappings.some(item=>item.remote_id!==remote.id&&item.local_product_id===local.id))throw Error('Yerli məhsul artıq başqa veb məhsula bağlanıb.');
    if(localRows.some(item=>item.code===remote.code&&item.id!==local?.id))throw Error('Kataloq kodu başqa yerli məhsulla toqquşur.');
    if(local&&deleted.has(local.id))throw Error('Yerli silinmiş məhsul vebdən bərpa edilmir.');
    if(!local){
     // Unknown costs/stock are not guessed. A manager must review and activate
     // this local row before it can participate in a checkout.
     const created={...clone(remote),isActive:false};
     await sp.unsafe('insert into products(id,sku,name,public_code,category,unit,sale_price,discount_price,cost_price,min_stock,image_url,is_active,description,specifications) values($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,false,$10,$11)',[created.id,created.sku,created.name,created.code,created.category,created.unit,created.price,created.discountPrice,created.image,created.description,created.specifications]);
     await applyGallery(sp,created.id,created.images);await applyOptions(sp,created.id,[],created.options,[],[]);
     if(created.category)await sp.unsafe('insert into product_categories(name) values($1) on conflict(name) do nothing',[created.category]);
     committed={row:created,nextBase:clone(created),issues:['review'],review:true,changed:true};
    }else{
     const base=outgoing.products[local.id];if(!base)throw Error('Yerli məhsulda göndərilməmiş dəyişikliklər var.');
     const row=clone(local),nextBase=clone(base),issues=new Set<string>(),updates:(keyof typeof columns)[]=[];
     const review=!!mapping?.review_required&&!row.isActive;
     const previous=mapping?.remote_payload||base;
     for(const field of Object.keys(columns) as (keyof typeof columns)[]){
      if(field==='isActive'&&review){nextBase.isActive=false;continue;}
      const compare=field==='image'?imageEqual:equal;
      if(compare(row[field],remote[field])||compare(row[field],base[field])){
       if(!compare(row[field],remote[field])){(row as unknown as Record<string,unknown>)[field]=clone(remote[field]);updates.push(field);}
       (nextBase as unknown as Record<string,unknown>)[field]=clone(row[field]);
      }else if(mapping?.conflicts.includes(field)||!compare(remote[field],previous[field])&&!compare(remote[field],base[field]))issues.add(field);
     }
     if(updates.length){const values=updates.map(field=>row[field]) as (string|number|boolean|null)[];values.push(row.id);await sp.unsafe('update products set '+updates.map((field,index)=>columns[field]+'=$'+(index+1)).join(',')+' where id=$'+values.length,values);}
     const gallery=mergeDesktopWebGallery(row.images,remote.images,base.images,previous.images,mapping?.conflicts.includes('images'));if(gallery.conflict)issues.add('images');if(!galleryEqual(row.images,gallery.next))await applyGallery(sp,row.id,gallery.next);row.images=gallery.next;nextBase.images=gallery.nextBase;
     const options=await applyOptions(sp,row.id,row.options,remote.options,base.options,mapping?.remote_payload.options||[],mapping?.conflicts.includes('options'));if(options.conflict)issues.add('options');row.options=options.next;nextBase.options=options.nextBase;
     if(updates.includes('category')&&row.category)await sp.unsafe('insert into product_categories(name) values($1) on conflict(name) do nothing',[row.category]);
     if(review)issues.add('review');
     committed={row:normalizeDesktopPublicProduct(row),nextBase:normalizeDesktopPublicProduct(nextBase),issues:[...issues],review,changed:updates.length>0||!galleryEqual(local.images,row.images)||options.changed};
    }
    await sp.unsafe('insert into desktop_web_catalog_map(store_url,remote_id,local_product_id,remote_payload,review_required,conflicts) values($1,$2,$3,$4::text::jsonb,$5,$6::text::jsonb) on conflict(store_url,remote_id) do update set local_product_id=excluded.local_product_id,remote_payload=excluded.remote_payload,review_required=excluded.review_required,conflicts=excluded.conflicts,updated_at=now()',[origin,remote.id,committed.row.id,JSON.stringify(remote),committed.review,JSON.stringify(committed.issues)]);
   });
   if(committed){outgoing.products[committed.row.id]=committed.nextBase;localById.set(committed.row.id,committed.row);const index=localRows.findIndex(row=>row.id===committed!.row.id);if(index<0)localRows.push(committed.row);else localRows[index]=committed.row;if(committed.changed)changed++;if(committed.issues.length)errors.push({id:remote.id,sku:remote.sku,fields:committed.issues,reason:committed.review?'Yeni veb məhsulu yerli aktivləşdirmə və alış qiyməti üçün yoxlanmalıdır.':'Yerli dəyişikliklər saxlanılıb; bu sahələri yoxlayın.'});}
   }catch(error){await hold(remote.id,remote,quarantineId);const messages=['Məhsulun yerli identifikatoru uyğun gəlmir.','SKU başqa yerli məhsulla toqquşur.','Yerli məhsul artıq başqa veb məhsula bağlanıb.','Kataloq kodu başqa yerli məhsulla toqquşur.','Yerli silinmiş məhsul vebdən bərpa edilmir.','Yerli məhsulda göndərilməmiş dəyişikliklər var.'];errors.push({id:remote.id,sku:remote.sku,fields:['identity'],reason:error instanceof Error&&messages.includes(error.message)?error.message:'Məhsul köçürülmədi; yerli məlumatlar dəyişdirilməyib.'});}
  }
  await setting(tx,key,outgoing);
  const [review]=await tx.unsafe('select count(*)::int n from desktop_web_catalog_map where store_url=$1 and review_required=true',[origin]);
  await setting(tx,statusKey,{storeUrl:origin,lastSuccess:new Date().toISOString(),changed,conflicts:errors.length,pending:false,reviewRequired:Number(review.n),errors:errors.slice(0,50).map(item=>({...item,sku:safeName(item.sku)}))});
  return {changed,conflicts:errors.length};
 });
}

let running:Promise<{changed:number;conflicts:number}>|null=null;
export function syncDesktopWebCatalog():Promise<{changed:number;conflicts:number}>{
 if(running)return running;
 running=(async()=>{
  // Delay this import: desktop-sync's orchestrator also imports this module.
  const {isDesktop,readSyncConfig}=await import('@/lib/desktop-sync');
  if(!isDesktop())return {changed:0,conflicts:0};
  const config=await readSyncConfig();if(!config||!/^bk_catalog_[a-f0-9]{64}$/.test(config.key))return {changed:0,conflicts:0};
  const sql=storeDb();
  try{
   const [queued]=await sql.unsafe('select count(*)::int n from desktop_sync_outbox where store_url=$1 and acknowledged_at is null',[config.url]);
   if(Number(queued.n)){await setting(sql,statusKey,{storeUrl:config.url,lastSuccess:null,changed:0,conflicts:0,pending:true,reviewRequired:0,errors:[]});return {changed:0,conflicts:0};}
   const response=await fetch(config.url+'/api/desktop-catalog-feed',{headers:{Authorization:'Bearer '+config.key},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
   const data=await readDesktopCatalogResponse(response),pictures=await localPictures(data.catalog,config.url);
   const current=await readSyncConfig();if(current?.url!==config.url||current?.key!==config.key)throw Error('Kataloq bağlantısı dəyişib. Yenidən yoxlayın.');
   return await applyDesktopWebCatalog(sql,config.url,pictures.prepared,pictures.errors);
  }catch(error){await setting(sql,statusKey,{storeUrl:config.url,lastSuccess:null,changed:0,conflicts:1,pending:false,errors:[{reason:'Veb kataloqu yenilənmədi. Yerli məlumatlar saxlanılıb.'}]});throw error;}
  finally{await sql.end({timeout:2});}
 })().finally(()=>{running=null;});
 return running;
}
