import {storeDb} from "@/lib/store-db";
import {cloudCredentials,credentialsPath} from "@/lib/cloudinary-config";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
export const dynamic="force-dynamic";
export async function GET(){
 const sql=storeDb();try{const [brand]=await sql.unsafe("select * from storefront_config where id=1");const products=await sql.unsafe("select p.id,p.name,p.image_url,p.category,coalesce((select sum(quantity) from stock_movements where product_id=p.id),0) stock from products p where p.is_active=true order by p.name");const c=await cloudCredentials();return Response.json({brand,products,cloud:c.cloud,key:c.key,configured:!!c.secret})}finally{await sql.end()}
}
const schema=z.object({name:z.string().trim().min(2).max(100),kind:z.enum(["market","restaurant"]),description:z.string().max(500),phone:z.string().max(30),address:z.string().max(300),cloud:z.string().regex(/^[a-z0-9_-]*$/).max(100),key:z.string().max(100),secret:z.string().max(200)});
export async function POST(request:Request){
 const b=schema.safeParse(await request.json().catch(()=>null));if(!b.success)return Response.json({error:"Məlumatları düzgün doldurun"},{status:400});
 const sql=storeDb();try{const d=b.data;const old=await cloudCredentials();if(d.secret||d.cloud||d.key){if(!d.cloud||!d.key||(!d.secret&&!old.secret))return Response.json({error:"Cloud name, API key və API secret daxil edin"},{status:400});if(d.cloud!==old.cloud&&!d.secret)return Response.json({error:"Yeni hesab üçün API secret daxil edin"},{status:400});await mkdir(path.dirname(credentialsPath),{recursive:true});await writeFile(credentialsPath,JSON.stringify({cloud:d.cloud,key:d.key,secret:d.secret||old.secret}),{mode:0o600})}
 await sql.unsafe("update storefront_config set name=$1,kind=$2,description=$3,phone=$4,address=$5 where id=1",[d.name,d.kind,d.description,d.phone,d.address]);return Response.json({ok:true});
 }catch{return Response.json({error:"Tənzimləmələr saxlanmadı"},{status:500})}finally{await sql.end()}
}
