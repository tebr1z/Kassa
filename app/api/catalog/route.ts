import {storeDb} from "@/lib/store-db";
import {sellingPrice} from "@/lib/commerce";
export const dynamic="force-dynamic";
export async function GET(){
 const sql=storeDb();
 try{
  const [brand]=await sql.unsafe("select name,kind,description,about,logo,phone,address,whatsapp from storefront_config where id=1");
  const products=await sql.unsafe("select p.id,p.name,p.category,p.unit,p.sale_price,p.discount_price,p.description,p.specifications,p.image_url as image,coalesce((select sum(quantity) from stock_movements where product_id=p.id),0)>0 as available from products p where p.is_active=true and coalesce((select sum(quantity) from stock_movements where product_id=p.id),0)>0 order by p.name");
  // Explicit public DTO: never serialize stock, cost, SKU, locations or raw rows.
  const publicProducts=products.map(p=>({id:p.id,name:p.name,category:p.category||"",unit:p.unit,
   price:sellingPrice({sale_price:p.sale_price,discount_price:p.discount_price}),originalPrice:Number(p.sale_price),
   image:p.image||"",available:true,description:p.description||"",specifications:p.specifications||""}));
  const slides=await sql.unsafe('select id,product_id as "productId",heading,badge,description from storefront_slides where is_active=true order by position,id');
  const visible=new Set(publicProducts.map(p=>p.id));
  return Response.json({brand,products:publicProducts,slides:slides.filter(s=>!s.productId||visible.has(s.productId))},{headers:{"Cache-Control":"no-store"}});
 }catch{return Response.json({error:"Kataloq yüklənmədi. Yenidən cəhd edin."},{status:503})}
 finally{await sql.end()}
}
