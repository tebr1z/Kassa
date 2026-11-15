import {storeDb} from '@/lib/store-db';
import {isDesktop} from '@/lib/desktop-sync';
import {desktopAuthorization} from '@/lib/desktop-bridge';
import {supportTicketPage,supportMessagePage} from '@/lib/desktop-support-contract';
import {z} from 'zod';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const emptyId='00000000-0000-0000-0000-000000000000';
const versionSql='select md5(coalesce(string_agg(md5(id::text||sender||body||coalesce(edited_at::text,\'\')),\'\' order by id),\'\')) as "version" from support_ticket_messages where ticket_id=$1';
export async function GET(request:Request){
 if(isDesktop())return Response.json({error:'Not available'},{status:404});
 const params=new URL(request.url).searchParams,kind=params.get('kind')||'tickets',after=params.get('after')||'';
 if(!['tickets','messages'].includes(kind))return Response.json({error:'Invalid request'},{status:400});
 const sql=storeDb();
 try{
  // Reading customer correspondence requires the full, active-admin pairing,
  // never the narrower legacy orders-only key. No staff/browser headers trusted.
  const key=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  if(!await desktopAuthorization(sql,key,true))return Response.json({error:'Unauthorized'},{status:401});
  const data=await sql.begin('isolation level repeatable read read only',async tx=>{
   if(kind==='tickets'){
    if(after&&!z.string().uuid().safeParse(after).success)return null;
    const tickets=await tx.unsafe(`select t.id,t.ticket_no as "ticketNo",t.subject,t.kind,t.status,
     coalesce(t.guest_name,c.full_name,'') as "name",coalesce(a.email,'') as "email",coalesce(t.guest_phone,c.phone,'') as "phone",
     (t.customer_revision>t.staff_read_revision) as "unread",(t.status<>'closed' and coalesce(latest.sender='customer',false)) as "unanswered",
     t.updated_at::text as "updatedAt",coalesce(latest.body,'') as "lastBody",v.version as "messageVersion",v.n as "messageCount"
     from support_tickets as t left join customer_accounts as a on a.id=t.account_id left join customers as c on c.id=a.customer_id
     left join lateral(select sender,body from support_ticket_messages where ticket_id=t.id order by created_at desc,id desc limit 1) as latest on true
     left join lateral(select count(*)::int as "n",md5(coalesce(string_agg(md5(id::text||sender||body||coalesce(edited_at::text,'')),'' order by id),'')) as "version" from support_ticket_messages where ticket_id=t.id) as v on true
     where t.id>$1::uuid order by t.id limit 50`,[after||emptyId]);
    return supportTicketPage.parse({tickets,next:tickets.length===50?tickets.at(-1)!.id:null});
   }
   const ticket=params.get('ticket');if(!z.string().uuid().safeParse(ticket).success)return null;
   let time='1970-01-01T00:00:00.000Z',id=emptyId;
   if(after){try{const cursor=JSON.parse(Buffer.from(after,'base64url').toString());if(typeof cursor.time!=='string'||!Number.isFinite(Date.parse(cursor.time))||!z.string().uuid().safeParse(cursor.id).success)return null;time=cursor.time;id=cursor.id;}catch{return null;}}
   const [found]=await tx.unsafe('select id from support_tickets where id=$1',[ticket]);if(!found)return null;
   const messages=await tx.unsafe(`select id,sender,body,created_at::text as "createdAt",edited_at::text as "editedAt" from support_ticket_messages where ticket_id=$1 and (created_at,id)>($2::text::timestamptz,$3::uuid) order by created_at,id limit 100`,[ticket,time,id]);
   const [v]=await tx.unsafe(versionSql,[ticket]);const last=messages.at(-1);
   return supportMessagePage.parse({messages,next:messages.length===100&&last?Buffer.from(JSON.stringify({time:last.createdAt,id:last.id})).toString('base64url'):null,messageVersion:v.version});
  });
  return data?Response.json(data,{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}):Response.json({error:'Invalid request'},{status:400});
 }finally{await sql.end({timeout:2});}
}
