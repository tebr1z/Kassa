import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
export const dynamic="force-dynamic";
const create=z.object({action:z.literal("create"),subject:z.string().trim().min(3).max(120),kind:z.enum(["problem","suggestion","order"]),message:z.string().trim().min(10).max(2000)});
const reply=z.object({action:z.literal("reply"),ticketId:z.string().uuid(),message:z.string().trim().min(2).max(2000)});
const edit=z.object({action:z.literal("edit"),messageId:z.string().uuid(),message:z.string().trim().min(2).max(2000)});
const subject=z.object({action:z.literal("subject"),ticketId:z.string().uuid(),subject:z.string().trim().min(3).max(120)});
const schema=z.discriminatedUnion("action",[create,reply,edit,subject]);
async function tickets(sql:ReturnType<typeof storeDb>,accountId:string){
 return sql.unsafe("select t.id,t.ticket_no,t.subject,t.kind,t.status,t.created_at,t.updated_at,coalesce(json_agg(json_build_object('id',m.id,'sender',m.sender,'body',m.body,'edited_at',m.edited_at,'created_at',m.created_at) order by m.created_at) filter (where m.id is not null),'[]'::json) messages from support_tickets t left join support_ticket_messages m on m.ticket_id=t.id where t.account_id=$1 group by t.id order by t.updated_at desc limit 50",[accountId]);
}
export async function GET(){
 const account=await customerAccount();if(!account)return Response.json({error:"Hesaba daxil olun."},{status:401});
 const sql=storeDb();try{return Response.json({tickets:await tickets(sql,account.id)});}catch{return Response.json({error:"Biletlər yüklənmədi."},{status:503});}finally{await sql.end();}
}
export async function POST(request:Request){
 const account=await customerAccount();if(!account)return Response.json({error:"Bilet üçün hesabınıza daxil olun."},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Mövzu və mesajı düzgün yazın."},{status:400});
 const b=parsed.data,sql=storeDb();
 try{await sql.begin(async tx=>{
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[account.id]);
  if(b.action==="create"){
   const [recent]=await tx.unsafe("select count(*)::int n from support_tickets where account_id=$1 and created_at>now()-interval '1 hour'",[account.id]);
   if(recent.n>=8)throw new Error("Bir saatda maksimum 8 bilet açıla bilər.");
   const [seq]=await tx.unsafe("select nextval('support_ticket_seq')::text as ticket_no");
   const [ticket]=await tx.unsafe("insert into support_tickets(ticket_no,account_id,subject,kind) values($1,$2,$3,$4) returning id",[seq.ticket_no,account.id,b.subject,b.kind]);
   await tx.unsafe("insert into support_ticket_messages(ticket_id,sender,body) values($1,'customer',$2)",[ticket.id,b.message]);
   return;
  }
  if(b.action==="edit"){
   const [message]=await tx.unsafe("select m.id,m.ticket_id from support_ticket_messages m join support_tickets t on t.id=m.ticket_id where m.id=$1 and t.account_id=$2 and m.sender='customer' and t.status<>'closed' and m.id=(select id from support_ticket_messages where ticket_id=m.ticket_id order by created_at desc limit 1) for update",[b.messageId,account.id]);
   if(!message)throw new Error("Bu mesaj artıq düzəldilə bilməz. Mağaza cavab veribsə və ya bilet bağlanıbsa, yeni mesaj yazın.");
   await tx.unsafe("update support_ticket_messages set body=$1,edited_at=now() where id=$2",[b.message,message.id]);
   await tx.unsafe("update support_tickets set updated_at=now() where id=$1",[message.ticket_id]);
   return;
  }
  const [row]=await tx.unsafe("select * from support_tickets where id=$1 and account_id=$2 for update",[b.ticketId,account.id]);
  if(!row)throw new Error("Bilet tapılmadı.");
  if(b.action==="subject"){
   const [staff]=await tx.unsafe("select 1 from support_ticket_messages where ticket_id=$1 and sender='staff' limit 1",[row.id]);
   if(row.status==="closed"||staff)throw new Error("Mövzu yalnız mağaza cavab verməmiş açıq biletdə dəyişir.");
   await tx.unsafe("update support_tickets set subject=$1,updated_at=now() where id=$2",[b.subject,row.id]);
   return;
  }
  if(row.status==="closed")throw new Error("Bağlı biletə mesaj yazılmır. Yeni bilet açın.");
  await tx.unsafe("insert into support_ticket_messages(ticket_id,sender,body) values($1,'customer',$2)",[row.id,b.message]);
  await tx.unsafe("update support_tickets set status='open',updated_at=now() where id=$1",[row.id]);
 });return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Bilet saxlanmadı."},{status:400});}finally{await sql.end();}
}
