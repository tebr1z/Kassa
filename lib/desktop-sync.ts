import "server-only";
import {createHash, timingSafeEqual} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {storeDb} from "@/lib/store-db";
import {pushDesktopChanges} from "@/lib/desktop-bridge";
import {cacheProductMedia} from "@/lib/desktop-media";
import {desktopImportError,desktopOrderInvalidMessage,importDesktopOrder,mergeRemoteDesktopOrder,remoteOrderSchema} from '@/lib/desktop-order-import';
import {syncDesktopWebCatalog} from '@/lib/desktop-web-catalog';
import {syncDesktopWebSupport} from '@/lib/desktop-web-support';
export {remoteOrderSchema,type RemoteOrder} from '@/lib/desktop-order-import';

export const isDesktop = () => process.env.BIRKASSA_LOCAL === "1";
export const feedKeyName = "desktop_order_feed_key_hash";
export const desktopDeliveryUpgradeMessage='Masaüstü tətbiqi yeniləyin. Çatdırılma haqqı olan sifarişlər köhnə kassaya köçürülmür.';
export const isDeliveryUpgradeError=(error:unknown)=>error instanceof Error&&'deliveryUpgrade' in error&&error.deliveryUpgrade===true;
export const hashKey = (key:string) => createHash("sha256").update(key).digest("hex");
export function matchesKey(key:string, hash:string) {
  return /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(hashKey(key), "hex"), Buffer.from(hash, "hex"));
}
const configPath = () => path.join(process.env.BIRKASSA_DATA_DIR || process.cwd(), ".private", "desktop-sync.json");
type Config = {url:string;key:string};
export async function readSyncConfig():Promise<Config|null> {
  try { return JSON.parse(await readFile(configPath(), "utf8")) as Config; }
  catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT")return null;throw error; }
}
export async function writeSyncConfig(config:Config|null) {
  await mkdir(path.dirname(configPath()), {recursive:true});
  const temporary = configPath()+".tmp";
  await writeFile(temporary, JSON.stringify(config), {mode:0o600});
  await rename(temporary, configPath());
}
export function normalizeStoreUrl(value:string) {
  const url = new URL(value);
  if(url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Mağazanın HTTPS ünvanını yazın.");
  }
  return url.origin;
}
// Row validation is isolated below: one malformed historical order must not
// hide every later order or stop the durable feed cursor from progressing.
const pageSchema = z.object({rows:z.array(z.unknown()).max(100), next:z.string().max(1000).nullable()});
const cursorSchema=z.object({time:z.string().min(1).max(80).refine(value=>Number.isFinite(Date.parse(value))),id:z.string().uuid()}).strict();
function cursorParts(cursor:string){return cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));}
function micros(time:string){const fraction=time.match(/\.(\d+)(?=(?:Z|[+-]\d{2}(?::?\d{2})?)$)/)?.[1]||'';return BigInt(Date.parse(time))*BigInt(1000)+BigInt(fraction.padEnd(6,'0').slice(3,6));}
function compareCursor(a:string,b:string){if(!b)return 1;const one=cursorParts(a),two=cursorParts(b),delta=micros(one.time)-micros(two.time);return delta>BigInt(0)?1:delta<BigInt(0)?-1:one.id.localeCompare(two.id);}
function rewindCursor(cursor:string){if(!cursor)return '';const saved=cursorParts(cursor);return Buffer.from(JSON.stringify({time:new Date(Date.parse(saved.time)-300000).toISOString(),id:'00000000-0000-0000-0000-000000000000'})).toString('base64url');}
export async function fetchOrderPage(config:Config, cursor="") {
  const response = await fetch(config.url+"/api/desktop-feed"+(cursor?"?after="+encodeURIComponent(cursor):""), {
    headers:{Authorization:"Bearer "+config.key,'X-Restamarket-Delivery':'1'},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)
  });
  if(response.status===409)throw Object.assign(new Error(desktopDeliveryUpgradeMessage),{deliveryUpgrade:true});
  if(!response.ok)throw new Error(response.status===401?"Bağlantı açarı etibarsızdır.":"Mağaza ilə əlaqə qurulmadı.");
  if(!response.body||Number(response.headers.get('content-length'))>4*1024*1024){await response.body?.cancel().catch(()=>{});throw new Error('Sifariş siyahısı çox böyükdür və ya boşdur.');}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>4*1024*1024)throw new Error('Sifariş siyahısı çox böyükdür.');parts.push(chunk.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const data=pageSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))));if(data.next)cursorParts(data.next);return data;
}
export type DesktopOrderSyncResult={received:number;updated:number;imported:number;unresolved:number;invalid:number;publicationError?:string;orderError?:string;catalogError?:string;supportError?:string;catalogChanged?:number;catalogConflicts?:number;supportReceived?:number;supportUpdated?:number};
const emptyResult=():DesktopOrderSyncResult=>({received:0,updated:0,imported:0,unresolved:0,invalid:0});
let inFlight:Promise<DesktopOrderSyncResult>|null = null;
export function syncOrders() {
  if(inFlight)return inFlight;
  void cacheProductMedia().catch(()=>{});
  // Each channel is independent. Inbound public edits are merged before a new
  // publication is prepared, so simultaneous edits are not silently overwritten.
  inFlight = (async()=>{
    let catalog={changed:0,conflicts:0},catalogError='';
    try{catalog=await syncDesktopWebCatalog();}catch{catalogError='Veb məhsulları yenilənmədi. Yerli dəyişikliklər saxlanılıb.';}
    let result:DesktopOrderSyncResult|undefined,pullError:unknown;
    try{result=await pullOrders();}catch(error){pullError=error;if(error&&typeof error==='object'&&'desktopPartialResult' in error)result=error.desktopPartialResult as DesktopOrderSyncResult;}
    let publicationError:unknown;
    try{await pushDesktopChanges();}catch(error){publicationError=error;}
    // Retry unresolved mappings after the independent catalogue pass. An order
    // already accepted into the inbox is never reported as lost due to push.
    if(result){
      if(publicationError)result.publicationError=publicationError instanceof Error?publicationError.message:'Kataloq göndərilmədi.';
      try{const config=await readSyncConfig();
      if(config){
        // An immutable pending batch may have deferred the first catalogue
        // pass. After acknowledgement, resolve waiting variant mappings too.
        if(result.unresolved>0&&!publicationError){try{const again=await syncDesktopWebCatalog();catalog.changed+=again.changed;catalog.conflicts=again.conflicts;}catch{catalogError='Veb məhsulları yenilənmədi. Yerli dəyişikliklər saxlanılıb.';}}
        const sql=storeDb();try{result.imported+=await retryDesktopOrders(sql,config.url);result.unresolved=await unresolvedCount(sql,config.url);}finally{await sql.end();}
      }}catch(error){
        if(error&&typeof error==='object'&&'desktopRetryImported' in error)result.imported+=Number(error.desktopRetryImported)||0;
        result.orderError='Saxlanmış sifarişlərin təkrar yoxlanması tamamlanmadı. Qəbul edilmiş sifarişlər saxlanılıb.';
      }
    }
    let support:{received:number;updated:number;error?:string}={received:0,updated:0},supportError='';
    try{support=await syncDesktopWebSupport();supportError=support.error||'';}catch{supportError='Veb dəstək mesajları yenilənmədi. Saxlanmış yazışmalar qalır.';}
    if(pullError&&!result?.received&&!result?.updated&&!catalog.changed&&!support.received&&!support.updated)throw pullError;
    const reply=result||emptyResult();
    if(pullError)reply.orderError=isDeliveryUpgradeError(pullError)?desktopDeliveryUpgradeMessage:'Veb sifarişləri tam yenilənmədi. Saxlanmış sifarişlər qalır.';
    if(catalogError)reply.catalogError=catalogError;if(supportError)reply.supportError=supportError;
    reply.catalogChanged=catalog.changed;reply.catalogConflicts=catalog.conflicts;reply.supportReceived=support.received;reply.supportUpdated=support.updated;
    return reply;
  })().finally(()=>{inFlight=null;});
  return inFlight;
}
async function unresolvedCount(sql:Pick<ReturnType<typeof storeDb>,'unsafe'>,url:string){
 const [row]=await sql.unsafe("select count(*) n from desktop_order_inbox where store_url=$1 and (import_error<>'' or sync_conflict<>'' or (local_order_id is null and payload->>'status' in ('pending','ready')))",[url]);return Number(row.n);
}
export async function retryDesktopOrders(sql:ReturnType<typeof storeDb>,url:string){
 const rows=await sql.unsafe("select id from desktop_order_inbox where store_url=$1 and local_order_id is null and payload->>'status' in ('pending','ready') order by updated_at,id limit 500",[url]);
 let imported=0;
 try{for(const row of rows){
  const accepted=await sql.begin(async tx=>{
   try{return (await tx.savepoint(sp=>importDesktopOrder(sp,String(row.id)))).imported;}
   catch(error){await tx.unsafe('update desktop_order_inbox set import_error=$1,updated_at=now() where id=$2',[desktopImportError(error),row.id]);return false;}
  });
  if(accepted)imported++;
 }}catch(error){if(error&&typeof error==='object'&&imported)Object.assign(error,{desktopRetryImported:imported});throw error;}
 return imported;
}
export async function pullOrders() {
  if(!isDesktop())throw new Error("Bu əməliyyat yalnız masaüstü tətbiqdə mümkündür.");
  const config = await readSyncConfig();
  if(!config)return emptyResult();
  const sql = storeDb();
  const result=emptyResult();
  try {
    // Cursor and rows commit together. Replaying a page is safe after a crash.
    const cursorKey = "desktop_cursor:"+hashKey(config.url);
    const rescanKey='desktop_rescan:'+hashKey(config.url);
    const scanKey='desktop_order_scan:'+hashKey(config.url);
    const settings=await sql.unsafe('select key,value from system_settings where key in ($1,$2,$3)',[cursorKey,rescanKey,scanKey]);
    let highwater=settings.find(row=>row.key===cursorKey)?.value||'';
    const lastRescan=Date.parse(settings.find(row=>row.key===rescanKey)?.value||'');
    let checkpoint:{cursor:string;fullRescan:boolean}|null=null;
    try{const saved=settings.find(row=>row.key===scanKey)?.value;if(saved){checkpoint=z.object({cursor:z.string().max(1000),fullRescan:z.boolean()}).parse(JSON.parse(saved));cursorParts(checkpoint.cursor);}}catch{checkpoint=null;}
    const fullRescan=checkpoint?.fullRescan??(!Number.isFinite(lastRescan)||Date.now()-lastRescan>=3600000);
    let cursor=checkpoint?.cursor??(fullRescan?'':rewindCursor(highwater)),finished=false;
    for(let page=0;page<20;page++) {
      const data = await fetchOrderPage(config,cursor);
      if(!data.rows.length){finished=true;break;}
      const pageResult={received:0,updated:0,imported:0,invalid:0};
      let pageHighwater=highwater;
      await sql.begin(async tx=>{
        for(const raw of data.rows) {
          const identity=z.object({id:z.string().uuid()}).safeParse(raw);
          if(!identity.success){pageResult.invalid++;continue;}
          await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",['birkassa.desktop-order:'+config.url+':'+identity.data.id]);
          const [previous]=await tx.unsafe('select id,payload,local_order_id from desktop_order_inbox where store_url=$1 and remote_id=$2 for update',[config.url,identity.data.id]);
          const parsed=remoteOrderSchema.safeParse(raw);
          if(previous&&!parsed.success){pageResult.invalid++;await tx.unsafe('update desktop_order_inbox set import_error=$1,sync_conflict=case when local_order_id is not null then $1 else sync_conflict end where id=$2',[desktopOrderInvalidMessage,previous.id]);continue;}
          if(previous&&parsed.success){
            const before=remoteOrderSchema.safeParse(previous.payload);
            if(before.success&&micros(parsed.data.updated_at)<micros(before.data.updated_at))continue;
          }
          const inserted = await tx.unsafe(`insert into desktop_order_inbox(store_url,remote_id,payload)
            values($1,$2,$3::text::jsonb) on conflict(store_url,remote_id) do nothing returning id`,[config.url,identity.data.id,JSON.stringify(raw)]);
          pageResult.received+=inserted.length;
          const changed=await tx.unsafe(`update desktop_order_inbox set payload=$3::text::jsonb,updated_at=now()
            where store_url=$1 and remote_id=$2 and payload is distinct from $3::text::jsonb returning id`,[config.url,identity.data.id,JSON.stringify(raw)]);
          if(previous)pageResult.updated+=changed.length;
          const inboxId=String(previous?.id||inserted[0]?.id);
          if(!parsed.success){pageResult.invalid++;await tx.unsafe('update desktop_order_inbox set import_error=$1 where id=$2',[desktopOrderInvalidMessage,inboxId]);continue;}
          const order=parsed.data;
          try{
            await tx.savepoint(async sp=>{
              if(previous?.local_order_id){const old=remoteOrderSchema.safeParse(previous.payload);await mergeRemoteDesktopOrder(sp,inboxId,order,old.success?old.data:null);}
              else if(['pending','ready'].includes(order.status)){const imported=await importDesktopOrder(sp,inboxId);if(imported.imported)pageResult.imported++;}
              else await sp.unsafe("update desktop_order_inbox set import_error='' where id=$1",[inboxId]);
            });
          }catch(error){await tx.unsafe('update desktop_order_inbox set import_error=$1,sync_conflict=case when local_order_id is not null then $1 else sync_conflict end where id=$2',[desktopImportError(error),inboxId]);}
        }
        if(data.next&&compareCursor(data.next,highwater)>0){pageHighwater=data.next;await tx.unsafe("insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value",[cursorKey,pageHighwater]);}
        if(data.next)await tx.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[scanKey,JSON.stringify({cursor:data.next,fullRescan})]);
      });
      // Counters describe committed pages only. A failed cursor write/COMMIT
      // rolls back every inbox/import on this page and must not notify success.
      for(const field of ['received','updated','imported','invalid'] as const)result[field]+=pageResult[field];
      highwater=pageHighwater;
      if(!data.next){finished=true;break;}
      if(data.next===cursor)throw new Error('Sifariş axınının davam nöqtəsi dəyişmədi.');
      cursor=data.next;
      if(data.rows.length<100){finished=true;break;}
    }
    result.unresolved=await unresolvedCount(sql,config.url);
    for(const [key,value]of [['desktop_order_last_success',new Date().toISOString()],['desktop_order_last_error',result.invalid?desktopOrderInvalidMessage:'']])
      await sql.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[key,value]);
    if(fullRescan&&finished)await sql.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[rescanKey,new Date().toISOString()]);
    if(finished)await sql.unsafe('delete from system_settings where key=$1',[scanKey]);
    return result;
  }catch(error){
    await sql.unsafe("insert into system_settings(key,value) values('desktop_order_last_error',$1) on conflict(key) do update set value=excluded.value",[isDeliveryUpgradeError(error)?desktopDeliveryUpgradeMessage:'Veb sifarişləri yenilənmədi. Yerli məlumatlar saxlanılıb.']);
    if(error&&typeof error==='object'&&(result.received||result.updated))Object.assign(error,{desktopPartialResult:result});
    throw error;
  } finally { await sql.end(); }
}
