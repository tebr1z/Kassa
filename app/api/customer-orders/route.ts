import {storeDb} from "@/lib/store-db";
import {customerAccount} from "@/lib/customer-session";
import {z} from "zod";
export const dynamic="force-dynamic";
const schema=z.object({requestKey:z.string().uuid(),fulfillment:z.enum(["pickup","delivery"]),address:z.string().max(500),name:z.string().trim().min(2).max(100),phone:z.string().trim().regex(/^[+0-9 ()-]{7,25}$/),note:z.string().max(1000),items:z.array(z.object({id:z.string().uuid(),quantity:z.number().int().min(1).max(100)})).min(1).max(50)});
export async function POST(request:Request){
 if(Number(request.headers.get("content-length")||0)>20000)return Response.json({error:"Sorğu çox böyükdür"},{status:413});
 const account=await customerAccount();if(!account)return Response.json({error:"Sifariş üçün hesabınıza daxil olun."},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return Response.json({error:"Ad, telefon və məhsulları düzgün daxil edin."},{status:400});
 const b=parsed.data;if(b.fulfillment==="delivery"&&b.address.trim().length<10)return Response.json({error:"Çatdırılma ünvanını tam yazın."},{status:400});const sql=storeDb();
 try{
 const result=await sql.begin(async tx=>{
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))",[b.requestKey]);
  const [existing]=await tx.unsafe("select order_no from sales_orders where request_key=$1 and account_id=$2",[b.requestKey,account.id]);
  if(existing)return existing;
  const [recent]=await tx.unsafe("select count(*)::int n from sales_orders o join customers c on c.id=o.customer_id where o.source='catalog' and c.phone=$1 and o.created_at>now()-interval '10 minutes'",[b.phone]);
  if(recent.n>=3)throw new Error("Bir neçə dəqiqə sonra yenidən cəhd edin.");
  const grouped=new Map<string,number>();for(const item of b.items)grouped.set(item.id,(grouped.get(item.id)||0)+item.quantity);
  const lines=[];
  for(const [id,quantity] of [...grouped].sort()){
   const [p]=await tx.unsafe("select id,sale_price from products where id=$1 and is_active=true for share",[id]);
   if(!p)throw new Error("Məhsul artıq mövcud deyil.");
   const [stock]=await tx.unsafe("select coalesce(sum(quantity),0) n from stock_movements where product_id=$1",[id]);
   if(quantity>100||Number(stock.n)<quantity)throw new Error("Seçilmiş məhsulun sayı qalıqdan çoxdur.");
   lines.push({id,quantity,price:Number(p.sale_price),total:Math.round(quantity*Number(p.sale_price)*100)/100});
  }
  const c={id:account.customer_id};
  const orderNo="WEB-"+b.requestKey;
  const [o]=await tx.unsafe("insert into sales_orders(order_no,customer_id,total,note,source,request_key,account_id,fulfillment,delivery_address) values($1,$2,$3,$4,'catalog',$5,$6,$7,$8) returning id,order_no",[orderNo,c.id,lines.reduce((s,l)=>s+l.total,0),b.note,b.requestKey,account.id,b.fulfillment,b.address]);
  for(const l of lines)await tx.unsafe("insert into sales_order_items(sales_order_id,product_id,quantity,unit_price,line_total) values($1,$2,$3,$4,$5)",[o.id,l.id,l.quantity,l.price,l.total]);
  await tx.unsafe("insert into audit_logs(action,entity_type,entity_id,after_json) values('order.catalog_created','sales_order',$1,$2)",[o.id,JSON.stringify({orderNo})]);
  return {order_no:o.order_no};
 });
 return Response.json(result,{status:201});
 }catch(e){return Response.json({error:e instanceof Error&& !("code" in e)?e.message:"Sifariş göndərilmədi."},{status:400})}
 finally{await sql.end()}
}
