import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
export const dynamic="force-dynamic";
const schema=z.object({message:z.string().trim().min(2).max(2000)});
export async function GET(){
 const account=await customerAccount();if(!account)return Response.json({error:"Hesaba daxil olun."},{status:401});
 const sql=storeDb();try{const messages=await sql.unsafe("select id,sender,body,created_at from customer_chat_messages where account_id=$1 order by created_at asc limit 200",[account.id]);return Response.json({messages});}catch{return Response.json({error:"Yazışma yüklənmədi."},{status:503});}finally{await sql.end();}
}
export async function POST(request:Request){
 const account=await customerAccount();if(!account)return Response.json({error:"Mesaj göndərmək üçün hesabınıza daxil olun."},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Mesaj 2–2000 simvol olmalıdır."},{status:400});
 const sql=storeDb();try{await sql.begin(async tx=>{
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[account.id]);
  const [recent]=await tx.unsafe("select count(*)::int n from customer_chat_messages where account_id=$1 and sender='customer' and created_at>now()-interval '1 hour'",[account.id]);
  if(recent.n>=20)throw new Error("Bir saatda maksimum 20 mesaj göndərilə bilər.");
  await tx.unsafe("insert into customer_chat_messages(account_id,sender,body) values($1,'customer',$2)",[account.id,parsed.data.message]);
 });return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Mesaj göndərilmədi."},{status:400});}finally{await sql.end();}
}
