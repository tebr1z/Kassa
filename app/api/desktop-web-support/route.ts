import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {isDesktop,readSyncConfig} from '@/lib/desktop-sync';
import {supportTicketSnapshot,supportMessageSnapshot} from '@/lib/desktop-support-contract';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function handleGET(request:Request){
 if(!isDesktop())return Response.json({error:'Not available'},{status:404});
 const config=await readSyncConfig(),id=new URL(request.url).searchParams.get('ticket');
 if(id&&!z.string().uuid().safeParse(id).success)return Response.json({error:'Bilet düzgün deyil.'},{status:400});
 const sql=storeDb();
 try{
  const saved=await sql.unsafe("select key,value from system_settings where key in ('desktop_support_last_success','desktop_support_last_error')");
  const common={configured:!!config?.key.startsWith('bk_catalog_'),lastSync:saved.find(row=>row.key==='desktop_support_last_success')?.value||'',lastError:saved.find(row=>row.key==='desktop_support_last_error')?.value||''};
  if(id){
   const [row]=await sql.unsafe('select payload,message_version from desktop_support_inbox where store_url=$1 and remote_id=$2',[config?.url||'',id]);
   if(!row)return Response.json({error:'Bilet tapılmadı.'},{status:404});
   const messages=await sql.unsafe("select payload from desktop_support_messages where store_url=$1 and ticket_id=$2 order by (payload->>'createdAt')::timestamptz desc,remote_id desc limit 5000",[config?.url||'',id]);
   const ticket=supportTicketSnapshot.parse(row.payload);
   return Response.json({...common,ticket,messages:messages.reverse().map(row=>supportMessageSnapshot.parse(row.payload)),complete:row.message_version===ticket.messageVersion,truncated:ticket.messageCount>5000});
  }
  const [attention]=await sql.unsafe("select count(*)::int total,count(*) filter(where (payload->>'unread')::boolean)::int unread,count(*) filter(where (payload->>'unanswered')::boolean)::int unanswered from desktop_support_inbox where store_url=$1",[config?.url||'']);
  if(new URL(request.url).searchParams.get('summary')==='1')return Response.json({...common,attention});
  const rows=await sql.unsafe("select payload from desktop_support_inbox where store_url=$1 order by (payload->>'unread')::boolean desc,(payload->>'unanswered')::boolean desc,(payload->>'updatedAt')::timestamptz desc,remote_id limit 500",[config?.url||'']);
  return Response.json({...common,tickets:rows.map(row=>supportTicketSnapshot.parse(row.payload)),attention});
 }finally{await sql.end({timeout:2});}
}
// Viewing this local mirror never acknowledges a web ticket or sends email.
export const GET=withAdminSession(handleGET);
