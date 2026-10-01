import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
export async function POST(request:Request){
 const account=await customerAccount();if(!account)return Response.json({error:"Mesaj göndərmək üçün hesabınıza daxil olun."},{status:401});
 const parsed=z.object({message:z.string().trim().min(10).max(2000)}).safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Mesaj 10–2000 simvol olmalıdır."},{status:400});
 const sql=storeDb();try{await sql.begin(async tx=>{
 await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[account.id]);
 const [recent]=await tx.unsafe("select count(*)::int n from contact_messages where account_id=$1 and created_at>now()-interval '1 hour'",[account.id]);
 if(recent.n>=5)throw new Error("Bir saatda maksimum 5 mesaj göndərilə bilər.");
 await tx.unsafe("insert into contact_messages(account_id,name,message) values($1,$2,$3)",[account.id,account.full_name,parsed.data.message]);
 });return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Mesaj göndərilmədi."},{status:400});}finally{await sql.end();}
}
