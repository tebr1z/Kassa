import {storeDb} from "@/lib/store-db";
import {z} from "zod";
export const dynamic="force-dynamic";
export async function GET(){
 const sql=storeDb();try{
 const products=await sql.unsafe("select p.*,coalesce((select sum(quantity) from stock_movements where product_id=p.id),0) stock from products p order by p.name");
 const coupons=await sql.unsafe("select * from commerce_coupons order by expires_at desc");
 const messages=await sql.unsafe("select m.*,a.email,c.phone from contact_messages m join customer_accounts a on a.id=m.account_id join customers c on c.id=a.customer_id order by m.created_at desc limit 200");
 return Response.json({products,coupons,messages});
 }catch{return Response.json({error:"Məlumatlar yüklənmədi."},{status:503});}finally{await sql.end();}
}
const product=z.object({action:z.literal("product"),id:z.string().uuid().optional(),name:z.string().trim().min(2).max(200),sku:z.string().trim().min(1).max(100),category:z.string().trim().max(100),unit:z.string().trim().min(1).max(30),sale_price:z.number().positive().max(1000000),cost_price:z.number().min(0).max(1000000),description:z.string().max(5000),specifications:z.string().max(3000),discount_price:z.number().positive().nullable(),is_active:z.boolean()}).refine(p=>p.discount_price===null||p.discount_price<p.sale_price);
const coupon=z.object({action:z.literal("coupon"),id:z.string().uuid().optional(),code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),percent:z.number().int().min(1).max(90),minimum:z.number().min(0).max(1000000),expires_at:z.string().datetime(),usage_limit:z.number().int().min(1).max(1000000),is_active:z.boolean()});
const schema=z.union([product,coupon,z.object({action:z.literal("read"),id:z.string().uuid()})]);
export async function POST(request:Request){
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:"Məlumatları yoxlayın. Endirim qiyməti əsas qiymətdən aşağı olmalıdır."},{status:400});
 const b=parsed.data,sql=storeDb();try{
 await sql.begin(async tx=>{
 let entityId="";
 if(b.action==="product"){
 const values=[b.name,b.sku,b.category,b.unit,b.sale_price,b.cost_price,b.description,b.specifications,b.discount_price,b.is_active];
 if(b.id){
 const [old]=await tx.unsafe("select * from products where id=$1 for update",[b.id]);if(!old)throw new Error("Məhsul tapılmadı.");
 await tx.unsafe("update products set name=$1,sku=$2,category=$3,unit=$4,sale_price=$5,cost_price=$6,description=$7,specifications=$8,discount_price=$9,is_active=$10 where id=$11",[...values,b.id]);entityId=b.id;
 if(Number(old.sale_price)!==b.sale_price||Number(old.cost_price)!==b.cost_price)await tx.unsafe("insert into product_price_history(product_id,old_sale_price,new_sale_price,old_cost_price,new_cost_price,changed_by) values($1,$2,$3,$4,$5,$6)",[b.id,old.sale_price,b.sale_price,old.cost_price,b.cost_price,request.headers.get("x-birkassa-user-id")]);
 }else{const [row]=await tx.unsafe("insert into products(name,sku,category,unit,sale_price,cost_price,description,specifications,discount_price,is_active) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",values);entityId=row.id;}
 }else if(b.action==="coupon"){
 const values=[b.code,b.percent,b.minimum,b.expires_at,b.usage_limit,b.is_active];
 const rows=b.id?await tx.unsafe("update commerce_coupons set code=$1,percent=$2,minimum=$3,expires_at=$4,usage_limit=$5,is_active=$6 where id=$7 returning id",[...values,b.id]):await tx.unsafe("insert into commerce_coupons(code,percent,minimum,expires_at,usage_limit,is_active) values($1,$2,$3,$4,$5,$6) returning id",values);
 if(!rows[0])throw new Error("Kupon tapılmadı.");entityId=rows[0].id;
 }else{await tx.unsafe("update contact_messages set is_read=true where id=$1",[b.id]);entityId=b.id;}
 await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,$2,'commerce',$3,$4)",[request.headers.get("x-birkassa-user-id"),"commerce."+b.action,entityId,JSON.stringify(b)]);
 });return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Saxlanmadı. SKU / kupon kodu təkrarlana bilməz."},{status:400});}finally{await sql.end();}
}
