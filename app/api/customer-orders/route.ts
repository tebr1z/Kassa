import {optionSnapshot} from "@/lib/product-options";
import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
import {sellingPrice,couponDiscount} from "@/lib/commerce";
import {notifyCatalogOrder,vexiraSettings,whatsappPhone} from "@/lib/vexira";
import {deliverySettings,sameOriginMutation} from '@/lib/delivery-server';
import {isCustomerPhone} from '@/lib/customer-contact';
export const dynamic="force-dynamic";
const schema=z.object({requestKey:z.string().uuid(),expectedTotal:z.number().finite().min(0).optional(),deliveryQuoteId:z.string().uuid().nullable().optional(),coupon:z.string().trim().toUpperCase().max(30).default(""),fulfillment:z.enum(["pickup","delivery"]),address:z.string().max(500),name:z.string().trim().min(2).max(100),phone:z.string().trim().refine(isCustomerPhone),note:z.string().max(1000),items:z.array(z.object({id:z.string().uuid(),optionId:z.string().uuid().nullable().optional(),quantity:z.number().int().min(1).max(100)})).min(1).max(50)});
function checkoutRejection(message:string){return Object.assign(new Error(message),{statusCode:400});}
export async function POST(request:Request){
 if(!sameOriginMutation(request))return Response.json({error:'Başqa saytdan göndərilən sorğu qəbul edilmir.'},{status:403});
 if(Number(request.headers.get("content-length")||0)>20000)return Response.json({error:"Sorğu çox böyükdür"},{status:413});
 const account=await customerAccount();if(!account)return Response.json({error:"Sifariş üçün hesabınıza daxil olun."},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success){const fields=[...new Set(parsed.error.issues.map(issue=>String(issue.path[0]||'request')))];return Response.json({error:fields.length===1&&fields[0]==='phone'?'Əlaqə telefonunu düzgün yazın.':'Ad, telefon və məhsulları düzgün daxil edin.',code:'INVALID_CHECKOUT',fields},{status:400});}
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
  if(existing)return {created:false as const,order_no:existing.order_no};
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[account.id]);
  const [recent]=await tx.unsafe("select count(*)::int n from sales_orders o where o.source='catalog' and o.account_id=$1 and o.created_at>now()-interval '10 minutes'",[account.id]);
  if(recent.n>=3)throw checkoutRejection("Bir neçə dəqiqə sonra yenidən cəhd edin.");
  const grouped=new Map<string,number>();for(const item of b.items)grouped.set(item.id+":"+(item.optionId||""),(grouped.get(item.id+":"+(item.optionId||""))||0)+item.quantity);
  const lines=[];
  for(const [key,quantity] of [...grouped].sort()){
   const [id,optionValue]=key.split(":");const optionId=optionValue||null;
   const [p]=await tx.unsafe("select id,name,sale_price,discount_price from products where id=$1 and is_active=true for share",[id]);
   if(!p)throw checkoutRejection("Məhsul artıq mövcud deyil.");
   if(quantity>100)throw checkoutRejection("Seçilmiş miqdar üçün mövcudluq təsdiqlənmədi. Səbəti yeniləyin.");
   const [option]=optionId?await tx.unsafe("select id,label,price,attributes from product_options where id=$1 and product_id=$2 and is_active=true",[optionId,id]):[];
   const [options]=await tx.unsafe("select count(*) n from product_options where product_id=$1 and is_active=true",[id]);
   if((optionId&&!option)||(Number(options.n)>0&&!option))throw checkoutRejection("Məhsulun ölçü, rəng və ya növünü seçin.");
   const totalQuantity=b.items.filter(item=>item.id===id).reduce((n,item)=>n+item.quantity,0);if(totalQuantity>100)throw checkoutRejection("Bir məhsul üçün maksimum 100 ədəd sifariş verə bilərsiniz.");
   const price=option?.price!=null?Number(option.price):sellingPrice({sale_price:p.sale_price,discount_price:p.discount_price});
   lines.push({id,optionId,optionLabel:option?optionSnapshot({label:String(option.label),attributes:option.attributes}):"",name:String(p.name)+(option?" · "+optionSnapshot({label:String(option.label),attributes:option.attributes}):""),quantity,price,total:Math.round(quantity*price*100)/100});
  }
  const subtotal=Number(lines.reduce((s,l)=>s+l.total,0).toFixed(2));let discount=0;
  if(b.coupon){
   const [coupon]=await tx.unsafe("select * from commerce_coupons where code=$1 and is_active=true and expires_at>now() for update",[b.coupon]);
   if(!coupon||coupon.used>=coupon.usage_limit||subtotal<Number(coupon.minimum))throw checkoutRejection("Kupon etibarsızdır, limiti bitib və ya minimum məbləğ ödənmir.");
   discount=couponDiscount(subtotal,Number(coupon.percent),coupon.max_discount==null?null:Number(coupon.max_discount));
   await tx.unsafe("update commerce_coupons set used=used+1 where id=$1",[coupon.id]);
  }
  let deliveryFee=0,distanceMeters:number|null=null,deliveryLat:number|null=null,deliveryLng:number|null=null,deliveryPricing='manual';
  if(b.fulfillment==='delivery'){
   await tx.unsafe('select id from delivery_settings where id=1 for share');
   const settings=await deliverySettings(tx);
   if(Number((subtotal-discount).toFixed(2))<settings.minimumOrder)throw checkoutRejection('Çatdırılma üçün minimum sifariş məbləği ödənmir.');
   if(settings.mode==='distance'){
    const [quote]=b.deliveryQuoteId?await tx.unsafe('select * from delivery_quotes where id=$1 and account_id=$2 and expires_at>now() and settings_revision=$3 for share',[b.deliveryQuoteId,account.id,settings.revision]):[];
    if(!quote||quote.address!==b.address.trim())throw checkoutRejection('Çatdırılma hesablaması köhnəlib. Ünvanı yenidən hesablayın.');
    deliveryFee=Number(quote.fee);distanceMeters=Number(quote.distance_meters);deliveryLat=Number(quote.lat);deliveryLng=Number(quote.lng);deliveryPricing='distance';
   }else if(b.deliveryQuoteId)throw checkoutRejection('Çatdırılma şərtləri dəyişib. Səbəti yeniləyin.');
  }
  const finalTotal=Number((subtotal-discount+deliveryFee).toFixed(2));
  if(b.expectedTotal!==undefined&&Math.abs(b.expectedTotal-finalTotal)>0.009)throw checkoutRejection("Qiymət yenilənib. Səbəti yeniləyib kuponu təkrar tətbiq edin.");
  const c={id:account.customer_id};
  const [seq]=await tx.unsafe("select nextval('catalog_order_seq')::text as order_no");
  const [o]=await tx.unsafe("insert into sales_orders(order_no,customer_id,total,note,source,request_key,account_id,fulfillment,delivery_address,coupon_code,coupon_discount,customer_name_snapshot,customer_phone_snapshot,delivery_fee,distance_meters,delivery_lat,delivery_lng,delivery_pricing) values($1,$2,$3,$4,'catalog',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id,order_no",[seq.order_no,c.id,finalTotal,b.note,b.requestKey,account.id,b.fulfillment,b.fulfillment==='delivery'?b.address.trim():'',b.coupon||null,discount,b.name,b.phone,deliveryFee,distanceMeters,deliveryLat,deliveryLng,deliveryPricing]);
  for(const l of lines)await tx.unsafe("insert into sales_order_items(sales_order_id,product_id,option_id,option_snapshot,quantity,unit_price,line_total,product_name_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8)",[o.id,l.id,l.optionId,l.optionLabel||null,l.quantity,l.price,l.total,String(l.name).replace(l.optionLabel?" · "+l.optionLabel:"","")]);
  await tx.unsafe("insert into audit_logs(action,entity_type,entity_id,after_json) values('order.catalog_created','sales_order',$1,$2)",[o.id,JSON.stringify({orderNo:o.order_no})]);
  return {created:true as const,order_no:o.order_no,total:finalTotal,name:b.name,phone:b.phone,fulfillment:b.fulfillment,address:b.address,lines:lines.map(line=>({name:line.name,quantity:line.quantity}))};
 });
 if(result.created){const settings=await vexiraSettings();let storePhones=settings.phones;if(!storePhones.length){const [brand]=await sql.unsafe("select whatsapp from storefront_config where id=1");const fallback=whatsappPhone(String(brand?.whatsapp||""));storePhones=fallback?[fallback]:[];}await notifyCatalogOrder({orderNo:result.order_no,total:result.total,name:result.name,phone:result.phone,fulfillment:result.fulfillment,address:result.address,lines:result.lines,storePhones}).catch(()=>{});}
 return Response.json({order_no:result.order_no},{status:201});
 }catch(e){const rejected=e instanceof Error&&"statusCode" in e&&e.statusCode===400;return Response.json({error:rejected?e.message:"Nəticəni təsdiqləmək mümkün olmadı. Eyni sifarişi yenidən yoxlayın."},{status:rejected?400:503})}
 finally{await sql.end()}
}
