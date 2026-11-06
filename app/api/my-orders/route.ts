import {customerAccount} from "@/lib/customer-session";
import {storeDb} from "@/lib/store-db";
export const dynamic="force-dynamic";
export async function GET(){
 const a=await customerAccount();if(!a)return Response.json({error:"Hesabınıza daxil olun"},{status:401});
 const sql=storeDb();try{
  const orders=await sql.unsafe("select o.order_no,o.status,o.total,o.coupon_code,o.coupon_discount,o.created_at,o.fulfillment,o.delivery_address,o.delivery_stage,(select json_agg(json_build_object('name',coalesce(i.product_name_snapshot,p.name)||case when i.option_snapshot is not null then ' · '||i.option_snapshot else '' end,'quantity',i.quantity,'unitPrice',i.unit_price,'lineTotal',i.line_total) order by i.id) from sales_order_items i left join products p on p.id=i.product_id where i.sales_order_id=o.id) items from sales_orders o where o.account_id=$1 order by o.created_at desc,o.id desc limit 100",[a.id]);
  const [stats]=await sql.unsafe("select count(*)::int total,count(*) filter(where status<>'cancelled' and delivery_stage<>'delivered')::int active,count(*) filter(where status<>'cancelled' and delivery_stage='delivered')::int completed from sales_orders where account_id=$1",[a.id]);
  return Response.json({orders,stats},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){console.error('my-orders.get',(error as {code?:string}).code);return Response.json({error:'Sifarişlər yüklənmədi'},{status:503});}finally{await sql.end()}
}
