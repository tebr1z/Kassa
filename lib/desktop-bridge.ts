import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import type postgres from 'postgres';
import {feedKeyName,isDesktop,matchesKey,readSyncConfig} from '@/lib/desktop-sync';
import {cachedMedia} from '@/lib/desktop-media';
import {storeDb} from '@/lib/store-db';
import {isProductOptionImage} from '@/lib/product-option-image';
import {publicProductFields,desktopCatalogBaselineKey,seedDesktopCatalogBaseline,buildDesktopCatalogChanges,mergeDesktopCatalogBaseline} from '@/lib/desktop-catalog-delta';
import type {DesktopCatalogBaseline,DesktopCatalogChange,DesktopPublicProduct} from '@/lib/desktop-catalog-delta';
import {readDesktopPublicProducts} from '@/lib/desktop-catalog-source';
import {applyPublicProduct} from '@/lib/desktop-catalog-apply';

export const syncKeyName='desktop_catalog_key_hash';
type Sql=ReturnType<typeof postgres>;
export async function desktopAuthorization(sql:Sql,key:string,write=false){
 const full=/^bk_catalog_[a-f0-9]{64}$/.test(key);
 if(!full&&(write||!/^bk_orders_[a-f0-9]{64}$/.test(key)))return null;
 const [saved]=await sql.unsafe("select s.value,u.id user_id from system_settings s left join users u on u.id=s.updated_by and u.role='admin' and u.is_active=true where s.key=$1",[full?syncKeyName:feedKeyName]);
 if(!saved||!matchesKey(key,saved.value)||(write&&!saved.user_id))return null;
 return {userId:saved.user_id as string};
}
const price=z.coerce.number().finite().min(0).max(99999999999.99);
const picture=z.string().max(2048).refine(value=>isProductOptionImage(value)&&!value.startsWith('/api/desktop-media/'));
const option=z.object({label:z.string().min(1).max(120),size:z.string().max(80),color:z.string().max(80),kind:z.string().max(80),image:picture.optional(),price:price.nullable(),position:z.number().int(),isActive:z.boolean(),attributes:z.record(z.string().max(60),z.string().max(120)).default({})}).strict();
const publicProductBase=z.object({
 id:z.string().uuid(),sku:z.string().min(1).max(100),name:z.string().min(1).max(200),code:z.string().regex(/^\d{6}$/),category:z.string().max(100),unit:z.string().max(30),
 price,discountPrice:price.nullable(),image:picture,images:z.array(picture).max(8),options:z.array(option).max(100),isActive:z.boolean(),
 description:z.string().max(5000).optional(),specifications:z.string().max(3000).optional()
}).strict();
export const publicProduct=publicProductBase.extend({
 changedFields:z.array(z.enum(publicProductFields)).min(1).max(publicProductFields.length).optional(),
 previous:publicProductBase.nullable().optional()
}).strict().superRefine((row,context)=>{
 if(!(row.price>0&&(row.discountPrice===null||(row.discountPrice>0&&row.discountPrice<row.price))))context.addIssue({code:z.ZodIssueCode.custom,path:['price'],message:'Invalid price'});
 if(row.changedFields&&(row.previous===undefined||(row.previous&&row.previous.id!==row.id)))context.addIssue({code:z.ZodIssueCode.custom,path:['previous'],message:'Publication baseline required'});
});
export const syncBatch=z.object({
 protocol:z.literal(2),id:z.string().uuid(),clientId:z.string().uuid(),revision:z.string().regex(/^[1-9]\d{0,17}$/),
 catalog:z.array(publicProduct).max(10000),
 statuses:z.array(z.object({id:z.string().uuid(),status:z.enum(['pending','ready','completed','cancelled']),deliveryStage:z.enum(['received','preparing','ready','dispatched','delivered']),updatedAt:z.string().max(100)}).strict()).max(500)
}).strict();
export type SyncBatch=z.infer<typeof syncBatch>;

// This protocol deliberately has no warehouse, quantity, barcode, cost or finance
// fields. Web administration has its own private inventory; this connection
// only publishes public catalogue data and must preserve private web values.
export async function applyDesktopBatch(sql:Sql,batch:SyncBatch,actor:{userId:string}){
 return sql.begin(async tx=>{
  await tx.unsafe("select pg_advisory_xact_lock(hashtext('birkassa.catalog-publication'))");
  const state=await tx.unsafe("select key,value from system_settings where key in ('desktop_catalog_device','desktop_catalog_revision')");
  const device=state.find(row=>row.key==='desktop_catalog_device')?.value;
  if(device&&device!==batch.clientId)throw new Error('Bu açar başqa kompüterə bağlanıb. Yeni açar yaradın.');
  const revision=state.find(row=>row.key==='desktop_catalog_revision')?.value||'0';
  if(BigInt(batch.revision)<=BigInt(revision))return {acknowledged:batch.id,stale:true,conflicts:[]};
  const seen=new Set<string>();
  const catalogConflicts:{id:string;reason:string}[]=[];
  for(const product of batch.catalog){
   if(seen.has(product.sku))throw new Error('Təkrar məhsul kodu.');seen.add(product.sku);
   if(!await applyPublicProduct(tx,product)&&product.changedFields?.some(field=>field!=='isActive'))catalogConflicts.push({id:product.id,reason:'“'+product.name.slice(0,100)+'” vebdə silinib və ya tapılmadı. Yenidən yayımlama üçün məhsulu yoxlayın.'});
  }
  const conflicts:{id:string;status:string;reason:string}[]=[];
  const stages=['received','preparing','ready','dispatched','delivered'];
  for(const item of batch.statuses){
   const [order]=await tx.unsafe("select id,status,fulfillment,delivery_stage,updated_at::text updated_at from sales_orders where id=$1 and source='catalog' for update",[item.id]);
   if(order?.status===item.status&&order.delivery_stage===item.deliveryStage)continue;
   if(!order||order.status==='cancelled'||(order.status==='completed'&&item.status!=='completed')||order.updated_at!==item.updatedAt||stages.indexOf(item.deliveryStage)<stages.indexOf(order.delivery_stage)||(order.fulfillment==='pickup'&&item.deliveryStage==='dispatched')){
    conflicts.push({id:item.id,status:order?.status||'missing',reason:'Sifariş vebdə dəyişib; yoxlayın.'});continue;
   }
   await tx.unsafe('update sales_orders set status=$1,delivery_stage=$2,updated_at=now() where id=$3',[item.status,item.deliveryStage,item.id]);
   await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'desktop.status_published','sales_order',$2,$3)",[actor.userId,item.id,JSON.stringify({status:item.status,deliveryStage:item.deliveryStage})]);
  }
  for(const [key,value]of [['desktop_catalog_device',batch.clientId],['desktop_catalog_revision',batch.revision],['catalog_only_protocol','2']])await tx.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[key,value]);
  return {acknowledged:batch.id,stale:false,published:batch.catalog.length-catalogConflicts.length,conflicts,catalogConflicts};
 });
}
async function publishImage(url:string,config:{url:string;key:string}){
 if(!url.startsWith('/api/desktop-media/'))return url;
 const cacheKey=url.slice('/api/desktop-media/'.length);if(!/^[a-f0-9]{64}$/.test(cacheKey))throw new Error('Şəkil düzgün deyil.');
 const image=await cachedMedia(cacheKey);if(!image)throw new Error('Yayımlanacaq lokal şəkil tapılmadı.');
 // Older offline photos are keyed by their Cloudinary URL, while freshly
 // uploaded photos are keyed by bytes. The web endpoint always verifies bytes.
 const hash=createHash('sha256').update(image.body).digest('hex');
 const exists=await fetch(config.url+'/api/catalog-media/'+hash,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});await exists.body?.cancel();
 if(exists.status===404){const response=await fetch(config.url+'/api/desktop-image',{method:'POST',headers:{Authorization:'Bearer '+config.key,'X-Image-Hash':hash,'Content-Type':image.type},body:new Uint8Array(image.body),redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Məhsul şəkli vebə göndərilmədi ('+response.status+').');}
 else if(!exists.ok)throw new Error('Vebdə məhsul şəkli yoxlanmadı ('+exists.status+'). Yenidən cəhd edin.');
 return '/api/catalog-media/'+hash;
}
export async function pushDesktopChanges(){
 if(!isDesktop())return;
 const config=await readSyncConfig();if(!config||!config.key.startsWith('bk_catalog_'))return;
 const sql=storeDb();
 try{
  const baselineKey=desktopCatalogBaselineKey(config.url);
  const [bookmark]=await sql.unsafe('select value from system_settings where key=$1',[baselineKey]);
  let baseline:DesktopCatalogBaseline;
  if(!bookmark){
   // Upgrade/first-pair safety: never blindly republish an old desktop snapshot.
   const rows=await readDesktopPublicProducts(sql);
   await sql.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do nothing',[baselineKey,JSON.stringify(seedDesktopCatalogBaseline(rows))]);
   return;
  }else baseline=JSON.parse(bookmark.value) as DesktopCatalogBaseline;
  const [queued]=await sql.unsafe('select id,revision,payload from desktop_sync_outbox where store_url=$1 and acknowledged_at is null order by revision limit 1',[config.url]);
  let batch:SyncBatch;
  let localCatalog:DesktopCatalogChange[];
  if(queued){
   const {localCatalog:rawCatalog,...wire}=queued.payload;
   if(!Array.isArray(rawCatalog))throw new Error('Köhnə kataloq göndərməsi var. Mövcud veb məhsullarını qorumaq üçün bağlantını yoxlayın.');
   localCatalog=rawCatalog;
   batch=syncBatch.parse({...wire,id:queued.id,revision:String(queued.revision)});
  }
  else{
   const snapshot=await sql.begin(async tx=>{
    await tx.unsafe('set transaction isolation level repeatable read read only');
    const rows=await readDesktopPublicProducts(tx);
    const statuses=await tx.unsafe(`select i.remote_id id,o.status,o.delivery_stage as "deliveryStage",i.payload->>'updated_at' as "updatedAt" from desktop_order_inbox i join sales_orders o on o.id=i.local_order_id where i.store_url=$1 and (o.status<>i.payload->>'status' or o.delivery_stage<>i.payload->>'delivery_stage') and i.payload->>'status'<>'cancelled' order by i.id limit 500`,[config.url]);
    return {rows,statuses};
   });
   localCatalog=buildDesktopCatalogChanges(snapshot.rows,baseline).catalog;
   const imagesByUrl=new Map<string,Promise<string>>();
   const imageUrl=(url:string)=>{let saved=imagesByUrl.get(url);if(!saved){saved=publishImage(url,config);imagesByUrl.set(url,saved);}return saved;};
   async function publishProduct(row:DesktopPublicProduct){
    const images=await Promise.all(row.images.map(imageUrl));
    const options=await Promise.all(row.options.map(async option=>({...option,image:await imageUrl(option.image||'')})));
    return {...row,image:await imageUrl(row.image),images,options};
   }
   const catalog=[];
   for(const row of localCatalog){
    const published=await publishProduct(row);
    const parsed=publicProduct.safeParse({...published,changedFields:row.changedFields,previous:row.previous?await publishProduct(row.previous):null});
    if(!parsed.success){
     const fields:Record<string,string>={id:'məhsul identifikatoru',sku:'SKU',name:'ad',code:'6 rəqəmli kataloq kodu',category:'kateqoriya',unit:'ölçü vahidi',price:'satış qiyməti',discountPrice:'endirim qiyməti',image:'əsas şəkil',images:'şəkillər',options:'ölçü, rəng və digər seçimlər',isActive:'aktivlik',description:'təsvir',specifications:'xüsusiyyətlər'};
     const problems=[...new Set(parsed.error.issues.map(issue=>fields[String(issue.path[0])]||'qiymət və endirim'))].join(', ');
     const identity=(value:unknown)=>String(value||'—').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,100);
     throw new Error('“'+identity(row.name)+'” (SKU: '+identity(row.sku)+') yayımlanmadı. '+problems+' məlumatını məhsul redaktəsində yoxlayın.');
    }
    catalog.push(parsed.data);
   }
   const payload={protocol:2,catalog,statuses:snapshot.statuses};
   const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
   const [last]=await sql.unsafe("select value from system_settings where key='desktop_catalog_digest'");if(last?.value===digest)return;
   batch=await sql.begin(async tx=>{
    await tx.unsafe("select pg_advisory_xact_lock(hashtext('birkassa.desktop-outbox'))");
    await tx.unsafe("insert into system_settings(key,value) values('desktop_sync_client_id',$1) on conflict(key) do nothing",[randomUUID()]);
    const [client]=await tx.unsafe("select value from system_settings where key='desktop_sync_client_id'");
    const [entry]=await tx.unsafe('insert into desktop_sync_outbox(store_url,payload) values($1,$2::text::jsonb) returning id,revision',[config.url,JSON.stringify({...payload,clientId:client.value,localCatalog})]);
    return syncBatch.parse({...payload,clientId:client.value,id:entry.id,revision:String(entry.revision)});
   });
  }
  const response=await fetch(config.url+'/api/desktop-bridge',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify(batch),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Kataloq və sifariş statusları göndərilmədi ('+response.status+'). Bağlantını yoxlayın.');
  const reply=z.object({acknowledged:z.string().uuid(),stale:z.boolean(),conflicts:z.array(z.object({id:z.string(),status:z.string(),reason:z.string()})),catalogConflicts:z.array(z.object({id:z.string(),reason:z.string()})).default([])}).parse(await response.json());
  if(reply.acknowledged!==batch.id)throw new Error('Yayımlama təsdiqi uyğun deyil.');
  await sql.begin(async tx=>{
   if(!reply.stale){
    const [latest]=await tx.unsafe('select value from system_settings where key=$1 for update',[baselineKey]);
    baseline=latest?JSON.parse(latest.value):baseline;
    const rejected=new Set(reply.catalogConflicts.map(item=>item.id));
    await tx.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[baselineKey,JSON.stringify(mergeDesktopCatalogBaseline(baseline,localCatalog.filter(item=>!rejected.has(item.id))))]);
   }
   await tx.unsafe('update desktop_sync_outbox set acknowledged_at=now() where id=$1',[batch.id]);
   await tx.unsafe("delete from desktop_sync_outbox where acknowledged_at<now()-interval '7 days'");
   const digest=createHash('sha256').update(JSON.stringify({protocol:2,catalog:batch.catalog,statuses:batch.statuses})).digest('hex');
   const lastError=reply.catalogConflicts.map(item=>item.reason).join(' ').slice(0,1000)||(reply.conflicts.length?`${reply.conflicts.length} sifariş statusu ziddiyyəti var. Veb sifarişlərini yoxlayın.`:'');
   for(const [key,value]of [['desktop_catalog_digest',reply.stale||reply.catalogConflicts.length?'':digest],['desktop_sync_last_success',new Date().toISOString()],['desktop_sync_last_error',lastError]])await tx.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[key,value]);
  });
 }catch(error){await sql.unsafe("insert into system_settings(key,value) values('desktop_sync_last_error',$1) on conflict(key) do update set value=excluded.value",[error instanceof Error?error.message:'Kataloq göndərilmədi.']);throw error;}
 finally{await sql.end();}
}
