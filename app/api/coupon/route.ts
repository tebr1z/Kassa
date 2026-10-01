import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {sellingPrice,couponDiscount} from "@/lib/commerce";
import {z} from "zod";
export async function POST(request:Request){
 if(!await customerAccount())return Response.json({error:"Əvvəlcə hesabınıza daxil olun."},{status:401});
 const b=z.object({code:z.string().trim().toUpperCase().min(3).max(30),items:z.array(z.object({id:z.string().uuid(),quantity:z.number().int().min(1).max(100)})).min(1).max(50)}).safeParse(await request.json().catch(()=>null));
 if(!b.success)return Response.json({error:"Kupon və səbəti yoxlayın."},{status:400});
 const sql=storeDb();try{
 const [coupon]=await sql.unsafe("select * from commerce_coupons where code=$1 and is_active=true and expires_at>now()",[b.data.code]);
 let subtotal=0;
 for(const item of b.data.items){const [p]=await sql.unsafe("select sale_price,discount_price from products where id=$1 and is_active=true",[item.id]);if(!p)throw new Error("Səbətdəki məhsul artıq aktiv deyil.");subtotal+=sellingPrice({sale_price:p.sale_price,discount_price:p.discount_price})*item.quantity;}
 subtotal=Number(subtotal.toFixed(2));
 if(!coupon||coupon.used>=coupon.usage_limit)throw new Error("Kupon etibarsızdır və ya limiti bitib.");
 if(subtotal<Number(coupon.minimum))throw new Error("Minimum sifariş: "+Number(coupon.minimum).toFixed(2)+" ₼");
 const discount=couponDiscount(subtotal,Number(coupon.percent),coupon.max_discount==null?null:Number(coupon.max_discount));
 return Response.json({code:coupon.code,discount,total:Number((subtotal-discount).toFixed(2))});
 }catch(e){return Response.json({error:e instanceof Error&&!("code" in e)?e.message:"Kupon yoxlanmadı."},{status:400});}finally{await sql.end();}
}
