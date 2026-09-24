import {storeDb} from "@/lib/store-db";
export const dynamic="force-dynamic";
export async function GET(){
 const sql=storeDb();
 try{
  const [brand]=await sql.unsafe("select name,kind,description,logo,phone,address from storefront_config where id=1");
  const products=await sql.unsafe("select p.id,p.name,p.category,p.unit,p.sale_price as price,p.image_url as image,coalesce((select sum(quantity) from stock_movements where product_id=p.id),0)>0 as available from products p where p.is_active=true and coalesce((select sum(quantity) from stock_movements where product_id=p.id),0)>0 order by p.name");
  return Response.json({brand,products:products.map(p=>({...p,price:Number(p.price)}))});
 }catch{return Response.json({error:"Kataloq yüklənmədi. Yenidən cəhd edin."},{status:503})}
 finally{await sql.end()}
}
