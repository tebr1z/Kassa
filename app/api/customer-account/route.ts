import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {createHash,randomBytes,scryptSync,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {customerAccount,customerCookie} from "@/lib/customer-session";
import {storeDb} from "@/lib/store-db";
export const dynamic="force-dynamic";
export async function GET(){const a=await customerAccount();return NextResponse.json({user:a?{id:a.id,name:a.full_name,email:a.email,phone:a.phone}:null})}
export async function POST(request:Request){
 const b=z.object({action:z.enum(["register","login"]),email:z.string().email().max(200).transform(s=>s.trim().toLowerCase()),password:z.string().min(8).max(128),name:z.string().trim().min(2).max(100).optional(),phone:z.string().regex(/^[+0-9 ()-]{7,25}$/).optional()}).safeParse(await request.json().catch(()=>null));
 if(!b.success)return NextResponse.json({error:"E-poçt və ən azı 8 simvolluq şifrə daxil edin."},{status:400});
 const d=b.data,sql=storeDb();try{
 const [limit]=await sql.unsafe("insert into customer_auth_attempts(email,attempts) values($1,1) on conflict(email) do update set attempts=case when customer_auth_attempts.window_start<now()-interval '15 minutes' then 1 else customer_auth_attempts.attempts+1 end,window_start=case when customer_auth_attempts.window_start<now()-interval '15 minutes' then now() else customer_auth_attempts.window_start end returning attempts",[d.email]);
 if(limit.attempts>10)return NextResponse.json({error:"15 dəqiqə sonra yenidən cəhd edin."},{status:429});
 let accountId:string;
 if(d.action==="register"){
 if(!d.name||!d.phone)return NextResponse.json({error:"Ad və telefon tələb olunur."},{status:400});
 const name=d.name,phone=d.phone,salt=randomBytes(16).toString("hex"),hash=salt+":"+scryptSync(d.password,salt,64).toString("hex");
 accountId=await sql.begin(async tx=>{const [c]=await tx.unsafe("insert into customers(full_name,phone) values($1,$2) returning id",[name,phone]);const [a]=await tx.unsafe("insert into customer_accounts(customer_id,email,password_hash) values($1,$2,$3) returning id",[c.id,d.email,hash]);return a.id});
 }else{
 const [a]=await sql.unsafe("select id,password_hash from customer_accounts where email=$1",[d.email]);
 const [salt,hash]=(a?.password_hash||"dummy:"+ "00".repeat(64)).split(":");const derived=scryptSync(d.password,salt,64),expected=Buffer.from(hash,"hex");
 if(!a||expected.length!==derived.length||!timingSafeEqual(expected,derived))return NextResponse.json({error:"E-poçt və ya şifrə yanlışdır."},{status:401});
 accountId=a.id;
 }
 const token=randomBytes(32).toString("hex"),expires=new Date(Date.now()+7*86400000);
 await sql.unsafe("insert into customer_sessions(token_hash,account_id,expires_at) values($1,$2,$3)",[createHash("sha256").update(token).digest("hex"),accountId,expires]);
 const r=NextResponse.json({ok:true});r.cookies.set(customerCookie,token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",expires});return r;
 }catch{return NextResponse.json({error:"Hesab yaradıla bilmədi. E-poçt artıq istifadə edilirsə giriş edin."},{status:400})}finally{await sql.end()}
}
export async function DELETE(){
 const token=(await cookies()).get(customerCookie)?.value;const sql=storeDb();try{if(token)await sql.unsafe("delete from customer_sessions where token_hash=$1",[createHash("sha256").update(token).digest("hex")]);const r=NextResponse.json({ok:true});r.cookies.set(customerCookie,"",{path:"/",expires:new Date(0)});return r}finally{await sql.end()}
}
