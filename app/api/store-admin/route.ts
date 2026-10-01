import {storeDb} from "@/lib/store-db";
import {cloudCredentials,credentialsPath} from "@/lib/cloudinary-config";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
export const dynamic="force-dynamic";
export async function GET(){
 const sql=storeDb();try{const [brand]=await sql.unsafe("select * from storefront_config where id=1");const products=await sql.unsafe("select p.id,p.name,p.image_url,p.category,coalesce((select sum(quantity) from stock_movements where product_id=p.id),0) stock from products p where p.is_active=true order by p.name");const c=await cloudCredentials();return Response.json({brand,products,cloud:c.cloud,key:c.key,configured:!!c.secret})}finally{await sql.end()}
}
const whatsappNumber=z.string().trim().max(40)
 .regex(/^\+?[0-9\s()-]*$/, "WhatsApp nömrəsini ölkə kodu ilə daxil edin")
 .refine(value=>value===""||/[0-9]/.test(value), "WhatsApp nömrəsini ölkə kodu ilə daxil edin")
 .transform(value=>value.replace(/[+\s()-]/g, "").replace(/^00/, ""))
 .refine(value=>/^(?:[1-9][0-9]{7,14})?$/.test(value), "WhatsApp nömrəsini ölkə kodu ilə daxil edin");
const schema=z.object({name:z.string().trim().min(2).max(100),kind:z.enum(["market","restaurant"]),description:z.string().max(500),about:z.string().trim().max(6000).optional(),phone:z.string().max(30),address:z.string().max(300),whatsapp:whatsappNumber.default(""),cloud:z.string().regex(/^[a-z0-9_-]*$/).max(100),key:z.string().max(100),secret:z.string().max(200)});
export async function POST(request:Request){
 const b=schema.safeParse(await request.json().catch(()=>null));if(!b.success)return Response.json({error:b.error.issues.some(issue=>issue.path[0]==="whatsapp")?"WhatsApp nömrəsini ölkə kodu ilə daxil edin (məsələn, +994 50 123 45 67).":"Məlumatları düzgün doldurun"},{status:400});
 const sql=storeDb();try{const d=b.data;const old=await cloudCredentials();if(d.secret||d.cloud||d.key){if(!d.cloud||!d.key||(!d.secret&&!old.secret))return Response.json({error:"Cloud name, API key və API secret daxil edin"},{status:400});if(d.cloud!==old.cloud&&!d.secret)return Response.json({error:"Yeni hesab üçün API secret daxil edin"},{status:400});await mkdir(path.dirname(credentialsPath),{recursive:true});await writeFile(credentialsPath,JSON.stringify({cloud:d.cloud,key:d.key,secret:d.secret||old.secret}),{mode:0o600})}
 await sql.unsafe("update storefront_config set name=$1,kind=$2,description=$3,phone=$4,address=$5,whatsapp=$6,about=coalesce($7,about) where id=1",[d.name,d.kind,d.description,d.phone,d.address,d.whatsapp,d.about??null]);return Response.json({ok:true});
 }catch{return Response.json({error:"Tənzimləmələr saxlanmadı"},{status:500})}finally{await sql.end()}
}
