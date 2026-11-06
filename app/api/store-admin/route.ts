import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from "@/lib/store-db";
import {cloudCredentials,credentialsPath} from "@/lib/cloudinary-config";
import {parseNotifyPhones,vexiraPath,vexiraSettings} from "@/lib/vexira";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {mediaUrl} from "@/lib/desktop-media";
export const dynamic="force-dynamic";
async function handleGET(){
 const sql=storeDb();try{const [brand]=await sql.unsafe("select * from storefront_config where id=1");const products=await sql.unsafe("select p.id,p.name,p.image_url,p.category,coalesce((select json_agg(json_build_object('id',pi.id,'url',pi.image_url) order by pi.position,pi.id) from product_images pi where pi.product_id=p.id),'[]'::json) images from products p where p.is_active=true order by p.name");for(const product of products){product.image_url=await mediaUrl(product.image_url);for(const image of product.images)image.url=await mediaUrl(image.url);}if(brand)brand.logo=await mediaUrl(brand.logo);const c=await cloudCredentials();const vexira=await vexiraSettings();return Response.json({local:process.env.BIRKASSA_LOCAL==="1",brand,products,cloud:c.cloud,key:c.key,configured:!!c.secret,vexiraConfigured:!!vexira.key,vexiraPhones:vexira.phones.join("\n")})}finally{await sql.end()}
}
const whatsappNumber=z.string().trim().max(40)
 .regex(/^\+?[0-9\s()-]*$/, "WhatsApp nömrəsini ölkə kodu ilə daxil edin")
 .refine(value=>value===""||/[0-9]/.test(value), "WhatsApp nömrəsini ölkə kodu ilə daxil edin")
 .transform(value=>value.replace(/[+\s()-]/g, "").replace(/^00/, ""))
 .refine(value=>/^(?:[1-9][0-9]{7,14})?$/.test(value), "WhatsApp nömrəsini ölkə kodu ilə daxil edin");
const schema=z.object({name:z.string().trim().min(2).max(100),kind:z.enum(["market","restaurant"]),description:z.string().max(500),about:z.string().trim().max(6000).optional(),phone:z.string().max(30),address:z.string().max(300),whatsapp:whatsappNumber.default(""),featured_product_id:z.string().uuid().or(z.literal("")).optional().transform(value=>value||null),cloud:z.string().regex(/^[a-z0-9_-]*$/).max(100),key:z.string().max(100),secret:z.string().max(200),vexiraKey:z.string().trim().max(200).default(""),vexiraPhones:z.string().max(400).default("")});
async function handlePOST(request:Request){
 const b=schema.safeParse(await request.json().catch(()=>null));if(!b.success)return Response.json({error:b.error.issues.some(issue=>issue.path[0]==="whatsapp")?"WhatsApp nömrəsini ölkə kodu ilə daxil edin (məsələn, +994 50 123 45 67).":"Məlumatları düzgün doldurun"},{status:400});
 const sql=storeDb();try{const d=b.data;const phones=parseNotifyPhones(d.vexiraPhones);if("error" in phones)return Response.json({error:phones.error},{status:400});if(d.vexiraKey&&d.vexiraKey.length<12)return Response.json({error:"Vexira API açarını tam yazın."},{status:400});const old=await cloudCredentials();if(d.secret||d.cloud||d.key){if(!d.cloud||!d.key||(!d.secret&&!old.secret))return Response.json({error:"Cloud name, API key və API secret daxil edin"},{status:400});if(d.cloud!==old.cloud&&!d.secret)return Response.json({error:"Yeni hesab üçün API secret daxil edin"},{status:400});await mkdir(path.dirname(credentialsPath),{recursive:true});await writeFile(credentialsPath,JSON.stringify({cloud:d.cloud,key:d.key,secret:d.secret||old.secret}),{mode:0o600})}
 const current=await vexiraSettings();await mkdir(path.dirname(vexiraPath),{recursive:true});await writeFile(vexiraPath,JSON.stringify({key:d.vexiraKey||current.key,phones:phones.phones}),{mode:0o600});
 if(d.featured_product_id){const [product]=await sql.unsafe("select id from products where id=$1 and is_active=true",[d.featured_product_id]);if(!product)return Response.json({error:"Seçilmiş məhsul tapılmadı."},{status:400});}
 await sql.unsafe("update storefront_config set name=$1,kind=$2,description=$3,phone=$4,address=$5,whatsapp=$6,about=coalesce($7,about),featured_product_id=$8 where id=1",[d.name,d.kind,d.description,d.phone,d.address,d.whatsapp,d.about??null,d.featured_product_id]);return Response.json({ok:true});
 }catch{return Response.json({error:"Tənzimləmələr saxlanmadı"},{status:500})}finally{await sql.end()}
}

export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
