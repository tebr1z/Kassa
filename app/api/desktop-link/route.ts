import {withAdminSession} from '@/lib/require-admin';
import {randomBytes} from "node:crypto";
import {z} from "zod";
import {storeDb} from "@/lib/store-db";
import {feedKeyName,fetchOrderPage,hashKey,isDesktop,normalizeStoreUrl,readSyncConfig,writeSyncConfig} from "@/lib/desktop-sync";
import {syncKeyName} from "@/lib/desktop-bridge";
import {cacheProductMedia} from "@/lib/desktop-media";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handleGET() {
  if(isDesktop()) {
    const config=await readSyncConfig();
    const sql=storeDb();
    try {
      const rows=await sql.unsafe("select key,value from system_settings where key in ('desktop_sync_last_success','desktop_sync_last_error','desktop_media_status')");
      const value=(key:string)=>rows.find(row=>row.key===key)?.value||'';
      const [pending]=await sql.unsafe('select count(*) n from desktop_sync_outbox where acknowledged_at is null and store_url=$1',[config?.url||'']);
      return Response.json({local:true,configured:!!config,url:config?.url||"",mode:config?.key.startsWith('bk_catalog_')?'catalog':'orders',lastSync:value('desktop_sync_last_success'),lastError:value('desktop_sync_last_error'),pending:Number(pending.n),media:value('desktop_media_status')?JSON.parse(value('desktop_media_status')):null});
    }finally{await sql.end();}
  }
  const sql=storeDb();
  try {const rows=await sql.unsafe("select key from system_settings where key in ($1,$2)",[feedKeyName,syncKeyName]);return Response.json({local:false,configured:!!rows.length,mode:rows.some(row=>row.key===syncKeyName)?'catalog':'orders'});}
  finally {await sql.end();}
}
async function handlePOST(request:Request) {
  const body=await request.json().catch(()=>null);
  const operation=z.object({action:z.string()}).safeParse(body);
  const action=operation.success?operation.data.action:"";
  if(isDesktop()) {
    if(action==='cache-media'){try{return Response.json(await cacheProductMedia());}catch{return Response.json({error:'Şəkillər endirilmədi.'},{status:502});}}
    if(action==="disconnect"){await writeSyncConfig(null);return Response.json({ok:true});}
    const parsed=z.object({url:z.string().max(2048),key:z.string().regex(/^bk_(?:orders|catalog)_[a-f0-9]{64}$/)}).safeParse(body);
    if(!parsed.success)return Response.json({error:"Ünvan və bağlantı açarını düzgün yazın."},{status:400});
    try {
      const config={url:normalizeStoreUrl(parsed.data.url),key:parsed.data.key};
      await fetchOrderPage(config);
      await writeSyncConfig(config);
      const sql=storeDb();try{await sql.unsafe("delete from system_settings where key='desktop_catalog_digest'");}finally{await sql.end();}
      return Response.json({ok:true});
    } catch {return Response.json({error:"Bağlantı yoxlanmadı. HTTPS ünvanını və açarı yoxlayın."},{status:400});}
  }
  if(!["rotate","rotate-catalog","revoke"].includes(action))return Response.json({error:"Invalid action"},{status:400});
  const sql=storeDb();
  try {
    const key=action==="revoke"?null:(action==='rotate-catalog'?'bk_catalog_':'bk_orders_')+randomBytes(32).toString("hex");
    await sql.begin(async tx=>{
      await tx.unsafe("delete from system_settings where key in ($1,$2,'desktop_catalog_device','desktop_catalog_revision','desktop_sync_key_hash','desktop_sync_device','desktop_sync_revision')",[feedKeyName,syncKeyName]);
      if(key)await tx.unsafe("insert into system_settings(key,value,updated_by) values($1,$2,$3)",[action==='rotate-catalog'?syncKeyName:feedKeyName,hashKey(key),request.headers.get("x-birkassa-user-id")]);
      await tx.unsafe("insert into audit_logs(user_id,action,entity_type) values($1,$2,'desktop_link')",[request.headers.get("x-birkassa-user-id"),key?"desktop.key_rotated":"desktop.key_revoked"]);
    });
    return Response.json({ok:true,key},{headers:{"Cache-Control":"no-store"}});
  } finally {await sql.end();}
}

export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
