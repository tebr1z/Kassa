import {withAdminSession} from '@/lib/require-admin';
import {z} from "zod";
import {storeDb} from "@/lib/store-db";
import {isDesktop,remoteOrderSchema,syncOrders,isDeliveryUpgradeError,desktopDeliveryUpgradeMessage} from "@/lib/desktop-sync";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handleGET() {
  if(!isDesktop())return Response.json({local:false,rows:[]});
  const sql=storeDb();
  try {
    const rows=await sql.unsafe(`select i.id,i.store_url,i.payload,i.received_at,i.local_order_id,o.status local_status,o.delivery_stage local_stage
      from desktop_order_inbox i left join sales_orders o on o.id=i.local_order_id order by i.received_at desc limit 500`);
    return Response.json({local:true,rows});
  } finally {await sql.end();}
}
async function handlePOST(request:Request) {
  if(!isDesktop())return Response.json({error:"Not available"},{status:404});
  const body=await request.json().catch(()=>null);
  if(z.object({action:z.literal("sync")}).safeParse(body).success) {
    try {return Response.json(await syncOrders());}
    catch(error) {return Response.json({error:isDeliveryUpgradeError(error)?desktopDeliveryUpgradeMessage:"Sifarişlər yenilənmədi. Bağlantını yoxlayın; yerli məlumatlar saxlanılıb."},{status:isDeliveryUpgradeError(error)?409:502});}
  }
  const stage=z.object({action:z.literal('delivery-stage'),id:z.string().uuid(),stage:z.enum(['preparing','ready','dispatched','delivered'])}).safeParse(body);
  if(stage.success){
    const sql=storeDb();try{
      await sql.begin(async tx=>{
        const [order]=await tx.unsafe('select o.id,o.status,o.fulfillment,o.delivery_stage from desktop_order_inbox i join sales_orders o on o.id=i.local_order_id where i.id=$1 for update of o',[stage.data.id]);
        if(!order||order.status==='cancelled')throw new Error('Sifariş bağlıdır.');
        const next:Record<string,string[]>={received:['preparing'],preparing:['ready'],ready:order.fulfillment==='delivery'?['dispatched']:['delivered'],dispatched:['delivered']};
        if(!next[order.delivery_stage]?.includes(stage.data.stage))throw new Error('Çatdırılma mərhələsi uyğun deyil.');
        await tx.unsafe("update sales_orders set delivery_stage=$1,status=case when $1='ready' and status='pending' then 'ready' else status end,updated_at=now() where id=$2",[stage.data.stage,order.id]);
        await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'desktop.delivery_stage','sales_order',$2,$3)",[request.headers.get('x-birkassa-user-id'),order.id,JSON.stringify({stage:stage.data.stage})]);
      });return Response.json({ok:true});
    }catch(error){return Response.json({error:error instanceof Error?error.message:'Saxlanmadı.'},{status:409});}finally{await sql.end();}
  }
  const parsed=z.object({action:z.literal("import"),id:z.string().uuid()}).safeParse(body);
  if(!parsed.success)return Response.json({error:"Invalid request"},{status:400});
  const sql=storeDb();
  try {
    const result=await sql.begin(async tx=>{
      const [inbox]=await tx.unsafe("select * from desktop_order_inbox where id=$1 for update",[parsed.data.id]);
      if(!inbox)throw new Error("Sifariş tapılmadı.");
      if(inbox.local_order_id)return {orderId:inbox.local_order_id};
      const order=remoteOrderSchema.parse(inbox.payload);
      if(!["pending","ready"].includes(order.status))throw new Error("Bağlanmış sifariş kassaya köçürülə bilməz.");
      const lines=[];
      for(const item of order.items) {
        const [product]=await tx.unsafe("select id from products where sku=$1 and is_active=true",[item.sku]);
        if(!product)throw new Error("Yerli məhsul tapılmadı (SKU): "+item.sku);
        let optionId=null;
        const options=await tx.unsafe("select id,label from product_options where product_id=$1 and is_active=true",[product.id]);
        if(item.option_snapshot) {
          const matches=options.filter(option=>option.label===item.option_snapshot);
          if(matches.length!==1)throw new Error("Yerli məhsul seçimini yoxlayın: "+item.sku+" · "+item.option_snapshot);
          optionId=matches[0].id;
        } else if(options.length)throw new Error("Yerli məhsulun seçimlərini yoxlayın: "+item.sku);
        lines.push({...item,productId:product.id,optionId});
      }
      let [customer]=order.phone?await tx.unsafe("select id from customers where phone=$1 limit 1",[order.phone]):[];
      if(!customer)[customer]=await tx.unsafe("insert into customers(full_name,phone) values($1,$2) returning id",[order.full_name,order.phone]);
      const [local]=await tx.unsafe(`insert into sales_orders(order_no,customer_id,status,total,note,created_by,source,
        fulfillment,delivery_address,delivery_stage,coupon_discount,delivery_fee,distance_meters,delivery_lat,delivery_lng,delivery_pricing) values($1,$2,'pending',$3,$4,$5,'catalog',$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        ["WEB-"+inbox.id,customer.id,order.total,[order.order_no,order.note].filter(Boolean).join(" · "),request.headers.get("x-birkassa-user-id"),order.fulfillment,order.delivery_address,order.delivery_stage,order.coupon_discount,order.delivery_fee,order.distance_meters,order.delivery_lat,order.delivery_lng,order.delivery_pricing]);
      for(const item of lines)await tx.unsafe(`insert into sales_order_items(sales_order_id,product_id,option_id,option_snapshot,quantity,unit_price,line_total,product_name_snapshot)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,[local.id,item.productId,item.optionId,item.option_snapshot,item.quantity,item.unit_price,item.line_total,item.name]);
      await tx.unsafe("update desktop_order_inbox set local_order_id=$1 where id=$2",[local.id,inbox.id]);
      await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id) values($1,'desktop.order_imported','sales_order',$2)",[request.headers.get("x-birkassa-user-id"),local.id]);
      return {orderId:local.id};
    });
    return Response.json(result);
  } catch(error) {return Response.json({error:error instanceof Error?error.message:"Sifariş köçürülmədi."},{status:409});}
  finally {await sql.end();}
}

export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
