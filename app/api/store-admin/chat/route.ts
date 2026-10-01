import {storeDb} from "@/lib/store-db";
import {z} from "zod";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const accountId=new URL(request.url).searchParams.get("account")||"";
 const sql=storeDb();try{
  if(accountId){
   if(!/^[0-9a-f-]{36}$/i.test(accountId))return Response.json({error:"Hesab düzgün deyil."},{status:400});
   const messages=await sql.unsafe("select id,sender,body,created_at from customer_chat_messages where account_id=$1 order by created_at asc limit 200",[accountId]);
   await sql.unsafe("update customer_chat_messages set seen=true where account_id=$1 and sender='customer' and seen=false",[accountId]);
   return Response.json({messages});
  }
  const threads=await sql.unsafe("select a.id account_id,c.full_name name,a.email,c.phone,(select body from customer_chat_messages m where m.account_id=a.id order by created_at desc limit 1) last_body,(select created_at from customer_chat_messages m where m.account_id=a.id order by created_at desc limit 1) last_at,(select count(*)::int from customer_chat_messages m where m.account_id=a.id and m.sender='customer' and m.seen=false) unread from customer_accounts a join customers c on c.id=a.customer_id where exists (select 1 from customer_chat_messages m where m.account_id=a.id) order by last_at desc limit 100");
  return Response.json({threads});
 }catch{return Response.json({error:"Yazışmalar yüklənmədi."},{status:503});}finally{await sql.end();}
}
const reply=z.object({accountId:z.string().uuid(),message:z.string().trim().min(1).max(2000)});
export async function POST(request:Request){
 const parsed=reply.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Cavab 1–2000 simvol olmalıdır."},{status:400});
 const sql=storeDb();try{await sql.begin(async tx=>{
  const [account]=await tx.unsafe("select id from customer_accounts where id=$1",[parsed.data.accountId]);
  if(!account)throw new Error("Müştəri hesabı tapılmadı.");
  await tx.unsafe("insert into customer_chat_messages(account_id,sender,body,staff_user_id,seen) values($1,'staff',$2,$3,true)",[parsed.data.accountId,parsed.data.message,request.headers.get("x-birkassa-user-id")]);
  await tx.unsafe("update customer_chat_messages set seen=true where account_id=$1 and sender='customer' and seen=false",[parsed.data.accountId]);
 });return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Cavab göndərilmədi."},{status:400});}finally{await sql.end();}
}
