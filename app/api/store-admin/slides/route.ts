import {storeDb} from "@/lib/store-db";
import {z} from "zod";
export const dynamic="force-dynamic";

const schema=z.object({revision:z.number().int().nonnegative(),slides:z.array(z.object({
 id:z.string().uuid(),productId:z.string().uuid().nullable(),heading:z.string().trim().max(100),
 badge:z.string().trim().max(50),description:z.string().trim().max(350),active:z.boolean(),
})).max(30).refine(slides=>new Set(slides.map(s=>s.id)).size===slides.length&&slides.every(s=>s.productId||s.heading))});

export async function GET(){
 const sql=storeDb();
 try{
  const [config]=await sql.unsafe("select slides_revision from storefront_config where id=1");
  const slides=await sql.unsafe('select id,product_id as "productId",heading,badge,description,is_active as active from storefront_slides order by position,id');
  const products=await sql.unsafe("select p.id,p.name,p.image_url as image,p.is_active as active,coalesce((select sum(quantity) from stock_movements where product_id=p.id),0)>0 as available from products p order by p.name");
  return Response.json({revision:config.slides_revision,slides,products});
 }catch{return Response.json({error:"Slaydlar yüklənmədi."},{status:503});}finally{await sql.end();}
}

export async function PUT(request:Request){
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Slaydları yoxlayın. Kampaniya slaydında başlıq yazın. Maksimum 30 slayd."},{status:400});
 const sql=storeDb();
 try{
  const result=await sql.begin(async tx=>{
   const [config]=await tx.unsafe("select slides_revision from storefront_config where id=1 for update");
   if(config.slides_revision!==parsed.data.revision)return null;
   for(const s of parsed.data.slides){
    if(s.productId){const [p]=await tx.unsafe("select id from products where id=$1",[s.productId]);if(!p)throw new Error("unknown-product");}
   }
   await tx.unsafe("delete from storefront_slides");
   for(const [position,s] of parsed.data.slides.entries())await tx.unsafe("insert into storefront_slides(id,product_id,heading,badge,description,is_active,position) values($1,$2,$3,$4,$5,$6,$7)",[s.id,s.productId,s.heading,s.badge,s.description,s.active,position]);
   const [updated]=await tx.unsafe("update storefront_config set slides_revision=slides_revision+1 where id=1 returning slides_revision");
   await tx.unsafe("insert into audit_logs(user_id,action,entity_type,after_json) values($1,'storefront.slides_updated','storefront',$2)",[request.headers.get("x-birkassa-user-id"),JSON.stringify(parsed.data.slides)]);
   return updated.slides_revision;
  });
  if(result===null)return Response.json({error:"Başqa pəncərədə dəyişiklik edilib. Yeniləyib təkrar redaktə edin."},{status:409});
  return Response.json({revision:result});
 }catch{return Response.json({error:"Slaydlar saxlanmadı. Seçilmiş məhsulları yoxlayın."},{status:400});}finally{await sql.end();}
}
