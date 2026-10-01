import {randomInt} from "node:crypto";
import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
import {sellingPrice,couponDiscount} from "@/lib/commerce";
const orderAlphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function shortOrderNo(){let code="";for(let i=0;i<6;i++)code+=orderAlphabet[randomInt(orderAlphabet.length)];return "S-"+code;}
export const dynamic="force-dynamic";
const schema=z.object({requestKey:z.string().uuid(),expectedTotal:z.number().min(0).optional(),coupon:z.string().trim().toUpperCase().max(30).default(""),fulfillment:z.enum(["pickup","delivery"]),address:z.string().max(500),name:z.string().trim().min(2).max(100),phone:z.string().trim().regex(/^[+0-9 ()-]{7,25}$/),note:z.string().max(1000),items:z.array(z.object({id:z.string().uuid(),quantity:z.number().int().min(1).max(100)})).min(1).max(50)});
function checkoutRejection(message:string){return Object.assign(new Error(message),{statusCode:400});}
export async function POST(request:Request){
 if(Number(request.headers.get("content-length")||0)>20000)return Response.json({error:"Sorğu çox böyükdür"},{status:413});
 const account=await customerAccount();if(!account)return Response.json({error:"Sifariş üçün hesabınıza daxil olun."},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Ad, telefon və məhsulları düzgün daxil edin."},{status:400});
 const b=parsed.data;if(b.fulfillment==="delivery"&&b.address.trim().length<10)return Response.json({error:"Çatdırılma ünvanını tam yazın."},{status:400});const sql=storeDb();
 try{
 // Count failed attempts too; do not roll this back with rejected orders.
 const [previous]=await sql.unsafe("select order_no from sales_orders where request_key=$1 and account_id=$2",[b.requestKey,account.id]);
 if(previous)return Response.json({order_no:previous.order_no},{status:201});
 const [limit]=await sql.unsafe("insert into customer_order_attempts(account_id) values($1) on conflict(account_id) do update set attempts=case when customer_order_attempts.window_start<now()-interval '10 minutes' then 1 else customer_order_attempts.attempts+1 end,window_start=case when customer_order_attempts.window_start<now()-interval '10 minutes' then now() else customer_order_attempts.window_start end returning attempts",[account.id]);
 if(limit.attempts>12)return Response.json({error:"Çox sayda cəhd edildi. 10 dəqiqə sonra yenidən yoxlayın."},{status:429,headers:{"Retry-After":"600"}});
 const result=await sql.begin(async tx=>{
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[b.requestKey]);
  const [existing]=await tx.unsafe("select order_no from sales_orders where request_key=$1 and account_id=$2",[b.requestKey,account.id]);
  if(existing)return existing;
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[account.id]);
  const [recent]=await tx.unsafe("select count(*)::int n from sales_orders o where o.source='catalog' and o.account_id=$1 and o.created_at>now()-interval '10 minutes'",[account.id]);
  if(recent.n>=3)throw checkoutRejection("Bir neçə dəqiqə sonra yenidən cəhd edin.");
  const grouped=new Map<string,number>();for(const item of b.items)grouped.set(item.id,(grouped.get(item.id)||0)+item.quantity);
  const lines=[];
  for(const [id,quantity] of [...grouped].sort()){
   const [p]=await tx.unsafe("select id,sale_price,discount_price from products where id=$1 and is_active=true for share",[id]);
   if(!p)throw checkoutRejection("Məhsul artıq mövcud deyil.");
   const [stock]=await tx.unsafe("select coalesce(sum(quantity),0) n from stock_movements where product_id=$1",[id]);
   if(quantity>100||Number(stock.n)<quantity)throw checkoutRejection("Seçilmiş miqdar üçün mövcudluq təsdiqlənmədi. Səbəti yeniləyin.");
   lines.push({id,quantity,price:sellingPrice({sale_price:p.sale_price,discount_price:p.discount_price}),total:Math.round(quantity*sellingPrice({sale_price:p.sale_price,discount_price:p.discount_price})*100)/100});
  }
  const subtotal=Number(lines.reduce((s,l)=>s+l.total,0).toFixed(2));let discount=0;
  if(b.coupon){
   const [coupon]=await tx.unsafe("select * from commerce_coupons where code=$1 and is_active=true and expires_at>now() for update",[b.coupon]);
   if(!coupon||coupon.used>=coupon.usage_limit||subtotal<Number(coupon.minimum))throw checkoutRejection("Kupon etibarsızdır, limiti bitib və ya minimum məbləğ ödənmir.");
   discount=couponDiscount(subtotal,Number(coupon.percent));
   await tx.unsafe("update commerce_coupons set used=used+1 where id=$1",[coupon.id]);
  }
  if(b.expectedTotal!==undefined&&Math.abs(b.expectedTotal-Number((subtotal-discount).toFixed(2)))>0.009)throw checkoutRejection("Qiymət yenilənib. Səbəti yeniləyib kuponu təkrar tətbiq edin.");
  const c={id:account.customer_id};
  let o:{id:string;order_no:string}|undefined;
  for(let attempt=0;attempt<8&&!o;attempt++){
   const orderNo=shortOrderNo();
   try{const [row]=await tx.savepoint(sp=>sp.unsafe("insert into sales_orders(order_no,customer_id,total,note,source,request_key,account_id,fulfillment,delivery_address,coupon_code,coupon_discount) values($1,$2,$3,$4,'catalog',$5,$6,$7,$8,$9,$10) returning id,order_no",[orderNo,c.id,Number((subtotal-discount).toFixed(2)),b.note,b.requestKey,account.id,b.fulfillment,b.address,b.coupon||null,discount]));o=row;}
   catch(error){if(!(error instanceof Error)||!("code" in error)||error.code!=="23505")throw error;}
  }
  if(!o)throw checkoutRejection("Sifariş nömrəsi yaradıla bilmədi. Yenidən cəhd edin.");
  for(const l of lines)await tx.unsafe("insert into sales_order_items(sales_order_id,product_id,quantity,unit_price,line_total) values($1,$2,$3,$4,$5)",[o.id,l.id,l.quantity,l.price,l.total]);
  await tx.unsafe("insert into audit_logs(action,entity_type,entity_id,after_json) values('order.catalog_created','sales_order',$1,$2)",[o.id,JSON.stringify({orderNo:o.order_no})]);
  return {order_no:o.order_no};
 });
 return Response.json(result,{status:201});
 }catch(e){const rejected=e instanceof Error&&"statusCode" in e&&e.statusCode===400;return Response.json({error:rejected?e.message:"Nəticəni təsdiqləmək mümkün olmadı. Eyni sifarişi yenidən yoxlayın."},{status:rejected?400:503})}
 finally{await sql.end()}
}
