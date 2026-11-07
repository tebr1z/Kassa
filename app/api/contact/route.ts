import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
import {isCustomerPhone,normalizeCustomerPhone,customerPhoneError} from '@/lib/customer-contact';

const body=z.object({name:z.string().trim().min(2).max(80),phone:z.string().trim().max(32).refine(isCustomerPhone).transform(value=>normalizeCustomerPhone(value)!),message:z.string().trim().min(5).max(2000)});
export async function POST(request:Request){
 const parsed=body.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:parsed.error.issues.some(issue=>issue.path[0]==='phone')?customerPhoneError(''):"Ad, nömrə və mesajı düzgün yazın."},{status:400});
 const phone=parsed.data.phone;
 const account=await customerAccount();
 const sql=storeDb();
 try{await sql.begin(async tx=>{
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[phone]);
  const [recent]=await tx.unsafe("select count(*)::int n from support_tickets where guest_phone=$1 and created_at>now()-interval '1 hour'",[phone]);
  if(recent.n>=5)throw new Error("Bu nömrədən qısa müddətdə çox mesaj gəldi. Bir az sonra yenidən yazın.");
  const [seq]=await tx.unsafe("select nextval('support_ticket_seq')::text as ticket_no");
  const [ticket]=await tx.unsafe("insert into support_tickets(ticket_no,account_id,subject,kind,guest_name,guest_phone) values($1,$2,'Saytdan müraciət','problem',$3,$4) returning id",[seq.ticket_no,account?.id??null,parsed.data.name,phone]);
  await tx.unsafe("insert into support_ticket_messages(ticket_id,sender,body) values($1,'customer',$2)",[ticket.id,parsed.data.message]);
 });return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Mesaj göndərilmədi."},{status:400});}finally{await sql.end();}
}
