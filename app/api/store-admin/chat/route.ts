import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {notifyCustomerEmail} from '@/lib/smtp-mail';
import {siteUrl} from '@/lib/seo';
import {z} from 'zod';
export const dynamic='force-dynamic';
const ticketIdSchema=z.string().uuid();
const pageSize=50;
const latest=`left join lateral(select m.id,m.sender,m.body from support_ticket_messages m where m.ticket_id=t.id order by m.created_at desc,m.id desc limit 1) latest_message on true`;
const attentionFields=`(t.customer_revision>t.staff_read_revision) as unread,(t.status<>'closed' and coalesce(latest_message.sender='customer',false)) as unanswered`;
const people=`left join customer_accounts a on a.id=t.account_id left join customers c on c.id=a.customer_id`;
const personFields=`coalesce(t.guest_name,c.full_name,'') as "name",coalesce(a.email,'') as email,coalesce(t.guest_phone,c.phone,'') as phone`;
const filterSql=`($1='all' or $1='unread' and t.customer_revision>t.staff_read_revision or $1='unanswered' and t.status<>'closed' and latest_message.sender='customer' or $1='suggestion' and t.kind='suggestion' or $1='closed' and t.status='closed')`;
type Database=Pick<ReturnType<typeof storeDb>,'unsafe'>;
async function attention(sql:Database){
 const [counts]=await sql.unsafe(`select count(*)::int as total,count(*) filter(where t.customer_revision>t.staff_read_revision)::int as unread,count(*) filter(where t.status<>'closed' and latest_message.sender='customer')::int as unanswered from support_tickets t ${latest}`);
 return {total:Number(counts.total),unread:Number(counts.unread),unanswered:Number(counts.unanswered)};
}
async function handleGET(request:Request){
 const params=new URL(request.url).searchParams,ticketId=params.get('ticket');
 if(ticketId&&!ticketIdSchema.safeParse(ticketId).success)return Response.json({error:'Bilet düzgün deyil.'},{status:400});
 const filter=params.get('filter')||'all',page=Number(params.get('page')||1);
 if(!['all','unread','unanswered','suggestion','closed'].includes(filter)||!Number.isSafeInteger(page)||page<1||page>1_000_000)return Response.json({error:'Bilet filtri düzgün deyil.'},{status:400});
 const sql=storeDb();
 try{
  // Listing/detail reads never acknowledge messages. The snapshot ensures the
  // returned revision identifies precisely the customer content displayed.
  const data=await sql.begin('isolation level repeatable read read only',async tx=>{
   if(ticketId){
    const [ticket]=await tx.unsafe(`select t.*,t.customer_revision::text as "customerRevision",${personFields},${attentionFields} from support_tickets t ${people} ${latest} where t.id=$1`,[ticketId]);
    if(!ticket)return null;
    const messages=await tx.unsafe('select id,sender,body,edited_at,created_at from support_ticket_messages where ticket_id=$1 order by created_at,id',[ticketId]);
    return {ticket,messages};
   }
   const counts=await attention(tx);if(params.get('summary')==='1')return {attention:counts};
   const [count]=await tx.unsafe(`select count(*)::int as total from support_tickets t ${latest} where ${filterSql}`,[filter]);
   const total=Number(count.total);
   const tickets=await tx.unsafe(`select t.id,t.ticket_no,t.account_id,t.subject,t.kind,t.status,t.updated_at,t.customer_revision::text as "customerRevision",${personFields},${attentionFields},coalesce(latest_message.body,'') as last_body from support_tickets t ${people} ${latest} where ${filterSql} order by unread desc,unanswered desc,t.updated_at desc,t.id desc limit 50 offset $2`,[filter,(page-1)*pageSize]);
   return {tickets,attention:counts,page,pageSize,total,pages:Math.max(1,Math.ceil(total/pageSize))};
  });
  return data?Response.json(data):Response.json({error:'Bilet tapılmadı.'},{status:404});
 }catch{return Response.json({error:'Biletlər yüklənmədi.'},{status:503});}
 finally{await sql.end({timeout:2}).catch(()=>{});}
}
const reply=z.object({action:z.literal('reply'),ticketId:ticketIdSchema,message:z.string().trim().min(1).max(2000)});
const status=z.object({action:z.literal('status'),ticketId:ticketIdSchema,status:z.enum(['open','answered','closed'])});
const edit=z.object({action:z.literal('edit'),messageId:z.string().uuid(),message:z.string().trim().min(1).max(2000)});
const read=z.object({action:z.literal('read'),ticketId:ticketIdSchema,customerRevision:z.string().regex(/^(?:0|[1-9]\d{0,17})$/u)});
const schema=z.discriminatedUnion('action',[reply,status,edit,read]);
class TicketError extends Error{}
async function handlePOST(request:Request){
 if(Number(request.headers.get('content-length')||0)>10_000)return Response.json({error:'Sorğu çox böyükdür'},{status:413});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>10_000)return Response.json({error:'Sorğu çox böyükdür'},{status:413});
 let body:unknown;try{body=JSON.parse(raw);}catch{body=null;}
 const parsed=schema.safeParse(body);if(!parsed.success)return Response.json({error:'Cavabı düzgün yazın.'},{status:400});
 const b=parsed.data,sql=storeDb(),staff=request.headers.get('x-birkassa-user-id');
 try{
  const notification=await sql.begin(async tx=>{
   if(b.action==='edit'){
    const [found]=await tx.unsafe("select ticket_id from support_ticket_messages where id=$1 and sender='staff'",[b.messageId]);
    if(!found)throw new TicketError('Yalnız son mağaza cavabı düzəldilə bilər.');
    await tx.unsafe('select id from support_tickets where id=$1 for update',[found.ticket_id]);
    const [message]=await tx.unsafe("select id,ticket_id from support_ticket_messages where id=$1 and sender='staff' and id=(select id from support_ticket_messages x where x.ticket_id=support_ticket_messages.ticket_id order by created_at desc,id desc limit 1) for update",[b.messageId]);
    if(!message)throw new TicketError('Yalnız son mağaza cavabı düzəldilə bilər.');
    await tx.unsafe('update support_ticket_messages set body=$1,edited_at=clock_timestamp() where id=$2',[b.message,message.id]);
    await tx.unsafe('update support_tickets set updated_at=clock_timestamp() where id=$1',[message.ticket_id]);
    return null;
   }
   const [ticket]=await tx.unsafe(`select t.id,t.status,t.ticket_no,t.customer_revision::text as "customerRevision",coalesce(a.email,'') as email from support_tickets t left join customer_accounts a on a.id=t.account_id where t.id=$1 for update of t`,[b.ticketId]);
   if(!ticket)throw new TicketError('Bilet tapılmadı.');
   if(b.action==='read'){
    if(BigInt(b.customerRevision)>BigInt(ticket.customerRevision))throw new TicketError('Bilet dəyişib. Yenidən açın.');
    await tx.unsafe('update support_tickets set staff_read_revision=greatest(staff_read_revision,$1::bigint) where id=$2',[b.customerRevision,ticket.id]);
    return null;
   }
   if(b.action==='status'){await tx.unsafe('update support_tickets set status=$1,updated_at=clock_timestamp() where id=$2',[b.status,ticket.id]);return null;}
   if(ticket.status==='closed')throw new TicketError('Bağlı biletə cavab yazmaq üçün əvvəl onu açın.');
   const [message]=await tx.unsafe("insert into support_ticket_messages(ticket_id,sender,body,staff_user_id) values($1,'staff',$2,$3) returning id",[ticket.id,b.message,staff]);
   await tx.unsafe("update support_tickets set status='answered',updated_at=clock_timestamp() where id=$1",[ticket.id]);
   return {id:String(message.id),ticketNo:String(ticket.ticket_no),email:String(ticket.email),message:b.message};
  });
  // Email is best effort only AFTER the reply commits. Recipient and event ID
  // come from stored records, never the browser. Guest tickets remain callable
  // by phone; an absent account email is not replaced by untrusted input.
  if(notification?.email){try{await notifyCustomerEmail({eventKey:'support-reply:'+notification.id,kind:'support_reply',to:notification.email,subject:'RestaMarket — dəstək bileti #'+notification.ticketNo,text:'RestaMarket dəstək bileti #'+notification.ticketNo+'\n\n'+notification.message+'\n\nBileti hesabınızda açın: '+new URL('/account',siteUrl()).href});}catch{/* A committed reply must never become a failed/retryable response due to mail configuration or delivery. */}}
  return Response.json({ok:true});
 }catch(error){return Response.json({error:error instanceof TicketError?error.message:'Bilet yenilənmədi.'},{status:error instanceof TicketError?400:503});}
 finally{await sql.end({timeout:2}).catch(()=>{});}
}
export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
