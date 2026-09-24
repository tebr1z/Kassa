import {customerAccount} from "@/lib/customer-session";
import {storeDb} from "@/lib/store-db";
export const dynamic="force-dynamic";
export async function GET(){
 const a=await customerAccount();if(!a)return Response.json({error:"Hesabınıza daxil olun"},{status:401});
 const sql=storeDb();try{const orders=await sql.unsafe("select o.order_no,o.status,o.total,o.created_at,o.fulfillment,o.delivery_address,o.delivery_stage,(select json_agg(json_build_object('name',p.name,'quantity',i.quantity)) from sales_order_items i join products p on p.id=i.product_id where i.sales_order_id=o.id) items from sales_orders o where o.account_id=$1 order by o.created_at desc limit 100",[a.id]);return Response.json({orders})}finally{await sql.end()}
}
