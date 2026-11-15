import 'server-only';
import {z} from 'zod';
import {storeDb} from '@/lib/store-db';
import {readSyncConfig,isDesktop,hashKey} from '@/lib/desktop-sync';
import {supportTicketPage,supportMessagePage} from '@/lib/desktop-support-contract';
type Config={url:string;key:string};
async function readPage(config:Config,query:URLSearchParams){
 const response=await fetch(config.url+'/api/desktop-support-feed?'+query,{headers:{Authorization:'Bearer '+config.key},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw Error('Veb dəstək mesajları alınmadı. Bağlantını yoxlayın.');}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>1024*1024)throw Error('Veb dəstək cavabı çox böyükdür.');parts.push(chunk.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
}
export async function syncDesktopWebSupport():Promise<{received:number;updated:number;error?:string}>{
 if(!isDesktop())return {received:0,updated:0};
 const config=await readSyncConfig();if(!config?.key.startsWith('bk_catalog_'))return {received:0,updated:0};
 const sql=storeDb(),scanKey='desktop_support_scan:'+hashKey(config.url),started=Date.now();let received=0,updated=0;
 try{
  const [bookmark]=await sql.unsafe('select value from system_settings where key=$1',[scanKey]);
  let after=bookmark?.value||'';if(after&&!z.string().uuid().safeParse(after).success)after='';
  // Full, bounded round-robin metadata scans also observe web read/unread
  // changes whose existing routes intentionally do not touch updated_at.
  const page=supportTicketPage.parse(await readPage(config,new URLSearchParams({kind:'tickets',...(after?{after}:{})})));
  let completedScan=true,lastCompleted=after;
  for(const ticket of page.tickets){
   if(Date.now()-started>14000){completedScan=false;break;}
   const [saved]=await sql.unsafe('select payload,message_version,message_cursor from desktop_support_inbox where store_url=$1 and remote_id=$2',[config.url,ticket.id]);
   const inserted=await sql.unsafe(`insert into desktop_support_inbox(store_url,remote_id,payload) values($1,$2,$3::text::jsonb) on conflict(store_url,remote_id) do update set payload=excluded.payload,updated_at=now() where desktop_support_inbox.payload is distinct from excluded.payload returning (xmax=0) inserted`,[config.url,ticket.id,JSON.stringify(ticket)]);
   if(inserted[0]?.inserted)received++;else if(inserted.length)updated++;
   if(saved?.message_version!==ticket.messageVersion){
    let cursor=saved?.payload?.messageVersion===ticket.messageVersion?(saved?.message_cursor||''):'',finished=false,consistent=true;
    for(let n=0;n<3&&Date.now()-started<14000;n++){
     const messages=supportMessagePage.parse(await readPage(config,new URLSearchParams({kind:'messages',ticket:ticket.id,...(cursor?{after:cursor}:{})})));
     if(messages.messageVersion!==ticket.messageVersion){consistent=false;break;}
     await sql.begin(async tx=>{
      for(const message of messages.messages)await tx.unsafe(`insert into desktop_support_messages(store_url,remote_id,ticket_id,payload) values($1,$2,$3,$4::text::jsonb) on conflict(store_url,remote_id) do update set payload=excluded.payload where desktop_support_messages.ticket_id=excluded.ticket_id and desktop_support_messages.payload is distinct from excluded.payload`,[config.url,message.id,ticket.id,JSON.stringify(message)]);
      await tx.unsafe('update desktop_support_inbox set message_cursor=$1,message_version=$2 where store_url=$3 and remote_id=$4',[messages.next,messages.next?null:ticket.messageVersion,config.url,ticket.id]);
     });
     cursor=messages.next||'';if(!messages.next){finished=true;break;}
    }
    if(!consistent)await sql.unsafe('update desktop_support_inbox set message_cursor=null,message_version=null where store_url=$1 and remote_id=$2',[config.url,ticket.id]);
    // Resume this ticket next poll, not a partial conversation marked complete.
    if(!finished){completedScan=false;break;}
   }
   lastCompleted=ticket.id;
  }
  await sql.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[scanKey,completedScan?(page.next||''):lastCompleted]);
  for(const [key,value]of [['desktop_support_last_success',new Date().toISOString()],['desktop_support_last_error','']])await sql.unsafe('insert into system_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[key,value]);
  return {received,updated};
 }catch(error){await sql.unsafe("insert into system_settings(key,value) values('desktop_support_last_error',$1) on conflict(key) do update set value=excluded.value",[error instanceof Error?error.message.slice(0,300):'Veb dəstək alınmadı.']);if(received||updated)return {received,updated,error:'Veb dəstək tam yenilənmədi. Saxlanmış yazışmalar qalır.'};throw error;}
 finally{await sql.end({timeout:2});}
}
