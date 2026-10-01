import {storeDb} from "@/lib/store-db";
import {z} from "zod";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const sql=storeDb();try{
 const rows=await sql.unsafe("select o.id,o.order_no,o.status,o.fulfillment,o.delivery_address,o.delivery_stage,o.total,o.coupon_code,o.coupon_discount,o.note,o.created_at,c.full_name,c.phone,(select json_agg(json_build_object('name',p.name,'quantity',i.quantity)) from sales_order_items i join products p on p.id=i.product_id where i.sales_order_id=o.id) items from sales_orders o join customers c on c.id=o.customer_id where o.source='catalog' order by o.created_at desc limit 200");
 return Response.json({rows,canCancel:request.headers.get('x-birkassa-role')!=='online_assistant'});
 }finally{await sql.end()}
}
export async function PATCH(request:Request){
 const b=z.object({id:z.string().uuid(),status:z.enum(['preparing','ready','dispatched','delivered','completed','cancelled'])}).safeParse(await request.json().catch(()=>null));
 if(!b.success)return Response.json({error:'Yanlış sorğu'},{status:400});
 if(b.data.status==='cancelled'&&request.headers.get('x-birkassa-role')==='online_assistant')return Response.json({error:'Ləğv üçün menecer səlahiyyəti lazımdır'},{status:403});
 const sql=storeDb();try{const ok=await sql.begin(async tx=>{
 const [row]=await tx.unsafe("select id,status,fulfillment,delivery_stage from sales_orders where id=$1 and source='catalog' for update",[b.data.id]);
 if(!row)return false;
 if(b.data.status==='completed'){if(row.status!=='ready')return false;}
 else if(b.data.status==='cancelled'){
  if(!['pending','ready','completed'].includes(row.status))return false;
  const [sale]=await tx.unsafe("select id from sales where sales_order_id=$1 and status='completed' limit 1",[row.id]);
  if(sale)throw new Error('Bu sifariş kassada ödənilib. Ləğv üçün çekdən qaytarın.');
 }else{
  if(!['pending','ready'].includes(row.status))return false;
  const transitions:Record<string,string[]>={received:['preparing'],preparing:['ready'],ready:row.fulfillment==='delivery'?['dispatched']:[],dispatched:['delivered']};
  if(!transitions[row.delivery_stage]?.includes(b.data.status))return false;
 }
 await tx.unsafe("update sales_orders set status=case when $1='cancelled' then 'cancelled' when $1='completed' then 'completed' when $1 in ('ready','dispatched','delivered') then 'ready' else status end,delivery_stage=case when $1 in ('cancelled','completed') then delivery_stage else $1 end,updated_at=now() where id=$2",[b.data.status,row.id]);
 await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,before_json,after_json) values($1,'order.online_updated','sales_order',$2,$3,$4)",[request.headers.get('x-birkassa-user-id'),row.id,JSON.stringify({status:row.status}),JSON.stringify({status:b.data.status})]);return true});
 return Response.json(ok?{ok:true}:{error:'Sifariş artıq bağlanıb'},{status:ok?200:409});
 }catch(e){const message=e instanceof Error?e.message:"";if(message.startsWith("Bu sifariş"))return Response.json({error:message},{status:409});throw e;}finally{await sql.end()}
}
