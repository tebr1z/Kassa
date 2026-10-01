import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
export async function POST(request:Request){
 const account=await customerAccount();if(!account)return Response.json({error:"Mesaj göndərmək üçün hesabınıza daxil olun."},{status:401});
 const parsed=z.object({message:z.string().trim().min(10).max(2000),subject:z.string().trim().min(3).max(120).optional()}).safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Mövzu və mesajı düzgün yazın."},{status:400});
 const sql=storeDb();try{await sql.begin(async tx=>{
 await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[account.id]);
  const [recent]=await tx.unsafe("select count(*)::int n from support_tickets where account_id=$1 and created_at>now()-interval '1 hour'",[account.id]);
  if(recent.n>=8)throw new Error("Bir saatda maksimum 8 bilet açıla bilər.");
  const [seq]=await tx.unsafe("select nextval('support_ticket_seq')::text as ticket_no");
  const [ticket]=await tx.unsafe("insert into support_tickets(ticket_no,account_id,subject,kind) values($1,$2,$3,'problem') returning id,ticket_no",[seq.ticket_no,account.id,parsed.data.subject||"Saytdan müraciət"]);
  await tx.unsafe("insert into support_ticket_messages(ticket_id,sender,body) values($1,'customer',$2)",[ticket.id,parsed.data.message]);
 });return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Bilet açılmadı."},{status:400});}finally{await sql.end();}
}
