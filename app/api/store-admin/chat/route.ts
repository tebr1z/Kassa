import {storeDb} from "@/lib/store-db";
import {z} from "zod";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const ticketId=new URL(request.url).searchParams.get("ticket")||"";
 const sql=storeDb();try{
  if(ticketId){
   if(!/^[0-9a-f-]{36}$/i.test(ticketId))return Response.json({error:"Bilet düzgün deyil."},{status:400});
   const [ticket]=await sql.unsafe(`select t.*,coalesce(t.guest_name,c.full_name) as "name",coalesce(a.email,'') as email,coalesce(t.guest_phone,c.phone) as phone from support_tickets t left join customer_accounts a on a.id=t.account_id left join customers c on c.id=a.customer_id where t.id=$1`,[ticketId]);
   if(!ticket)return Response.json({error:"Bilet tapılmadı."},{status:404});
   const messages=await sql.unsafe("select id,sender,body,edited_at,created_at from support_ticket_messages where ticket_id=$1 order by created_at",[ticketId]);
   return Response.json({ticket,messages});
  }
  const tickets=await sql.unsafe(`select t.id,t.ticket_no,t.account_id,t.subject,t.kind,t.status,t.updated_at,coalesce(t.guest_name,c.full_name) as "name",coalesce(a.email,'') as email,coalesce(t.guest_phone,c.phone) as phone,(select body from support_ticket_messages m where m.ticket_id=t.id order by m.created_at desc limit 1) last_body from support_tickets t left join customer_accounts a on a.id=t.account_id left join customers c on c.id=a.customer_id order by t.updated_at desc limit 200`);
  return Response.json({tickets});
 }catch{return Response.json({error:"Biletlər yüklənmədi."},{status:503});}finally{await sql.end();}
}
const reply=z.object({action:z.literal("reply"),ticketId:z.string().uuid(),message:z.string().trim().min(1).max(2000)});
const status=z.object({action:z.literal("status"),ticketId:z.string().uuid(),status:z.enum(["open","answered","closed"])});
const edit=z.object({action:z.literal("edit"),messageId:z.string().uuid(),message:z.string().trim().min(1).max(2000)});
export async function POST(request:Request){
 const parsed=z.discriminatedUnion("action",[reply,status,edit]).safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Cavabı düzgün yazın."},{status:400});
 const b=parsed.data,sql=storeDb(),staff=request.headers.get("x-birkassa-user-id");
 try{await sql.begin(async tx=>{
  if(b.action==="edit"){
   const [message]=await tx.unsafe("select id,ticket_id from support_ticket_messages where id=$1 and sender='staff' and id=(select id from support_ticket_messages x where x.ticket_id=support_ticket_messages.ticket_id order by created_at desc limit 1) for update",[b.messageId]);
   if(!message)throw new Error("Yalnız son mağaza cavabı düzəldilə bilər.");
   await tx.unsafe("update support_ticket_messages set body=$1,edited_at=now() where id=$2",[b.message,message.id]);
   await tx.unsafe("update support_tickets set updated_at=now() where id=$1",[message.ticket_id]);
   return;
  }
  const [ticket]=await tx.unsafe("select id,status from support_tickets where id=$1 for update",[b.ticketId]);
  if(!ticket)throw new Error("Bilet tapılmadı.");
  if(b.action==="status"){await tx.unsafe("update support_tickets set status=$1,updated_at=now() where id=$2",[b.status,ticket.id]);return;}
  if(ticket.status==="closed")throw new Error("Bağlı biletə cavab yazmaq üçün əvvəl onu açın.");
  await tx.unsafe("insert into support_ticket_messages(ticket_id,sender,body,staff_user_id) values($1,'staff',$2,$3)",[ticket.id,b.message,staff]);
  await tx.unsafe("update support_tickets set status='answered',updated_at=now() where id=$1",[ticket.id]);
 });return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Bilet yenilənmədi."},{status:400});}finally{await sql.end();}
}
