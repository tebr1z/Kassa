import {withAdminSession} from '@/lib/require-admin';
import {z} from "zod";
import {storeDb} from "@/lib/store-db";
import {isDesktop,readSyncConfig,remoteOrderSchema,syncOrders,isDeliveryUpgradeError,desktopDeliveryUpgradeMessage} from "@/lib/desktop-sync";
import {desktopImportError,importDesktopOrder} from '@/lib/desktop-order-import';
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handleGET() {
  if(!isDesktop())return Response.json({local:false,rows:[]});
  const config=await readSyncConfig();
  const sql=storeDb();
  try {
    const rows=await sql.unsafe(`select i.id,i.remote_id,i.store_url,i.payload,i.received_at,i.local_order_id,i.import_error,i.sync_conflict,i.imported_at,
      o.status local_status,o.delivery_stage local_stage,o.cancellation_reason local_cancellation_reason,
      exists(select 1 from sales s where s.sales_order_id=o.id and s.status='completed') local_paid,
      case when o.id is null then null else json_build_object('id',o.id,'order_no',o.order_no,'status',o.status,'source',o.source,
       'customerId',o.customer_id,'customer_name',coalesce(o.customer_name_snapshot,c.full_name),'phone',coalesce(o.customer_phone_snapshot,c.phone),
       'total',o.total,'deliveryFee',o.delivery_fee,'couponDiscount',o.coupon_discount,'created_at',o.created_at,
       'items',(select coalesce(json_agg(json_build_object('productId',li.product_id,'optionId',li.option_id,'optionLabel',li.option_snapshot,
        'name',coalesce(li.product_name_snapshot,p.name),'quantity',li.quantity,'unitPrice',li.unit_price,'lineTotal',li.line_total) order by li.id),'[]'::json)
        from sales_order_items li join products p on p.id=li.product_id where li.sales_order_id=o.id)) end local_order
      from desktop_order_inbox i left join sales_orders o on o.id=i.local_order_id left join customers c on c.id=o.customer_id
      where i.store_url=$1 order by (i.import_error<>'' or i.sync_conflict<>'' or coalesce(o.status,i.payload->>'status') in ('pending','ready')) desc,i.received_at desc limit 500`,[config?.url||'']);
    // A malformed feed row stays available for diagnosis without crashing the
    // whole inbox renderer or pretending it is safe to accept/payment-enable.
    return Response.json({local:true,rows:rows.map(row=>{
      const parsed=remoteOrderSchema.safeParse(row.payload);
      if(parsed.success)return {...row,payload:parsed.data};
      const raw=row.payload&&typeof row.payload==='object'?row.payload:{};
      const text=(value:unknown,fallback:string,max=150)=>typeof value==='string'?value.slice(0,max):fallback;
      return {...row,invalid_payload:true,payload:{id:row.remote_id,order_no:text(raw.order_no,'Yoxlanmalı veb sifarişi'),
        status:['pending','ready','completed','cancelled'].includes(raw.status)?raw.status:'pending',
        fulfillment:raw.fulfillment==='delivery'?'delivery':'pickup',delivery_address:text(raw.delivery_address,''),delivery_stage:'received',
        total:0,coupon_discount:0,delivery_fee:0,distance_meters:null,delivery_lat:null,delivery_lng:null,delivery_pricing:'manual',
        cancellation_reason:null,cancelled_at:null,note:null,full_name:text(raw.full_name,'Məlumatları yoxlayın'),phone:null,
        created_at:row.received_at,updated_at:row.received_at,items:[]}};
    })});
  } finally {await sql.end();}
}
async function handlePOST(request:Request) {
  if(!isDesktop())return Response.json({error:"Not available"},{status:404});
  const body=await request.json().catch(()=>null);
  if(z.object({action:z.literal("sync")}).safeParse(body).success) {
    try {return Response.json(await syncOrders());}
    catch(error) {return Response.json({error:isDeliveryUpgradeError(error)?desktopDeliveryUpgradeMessage:"Sifarişlər yenilənmədi. Bağlantını yoxlayın; yerli məlumatlar saxlanılıb."},{status:isDeliveryUpgradeError(error)?409:502});}
  }
  // A changed pairing cannot operate on another store's historical inbox.
  const target=z.object({id:z.string().uuid()}).safeParse(body);
  if(target.success){const config=await readSyncConfig(),sql=storeDb();try{const [row]=await sql.unsafe('select store_url from desktop_order_inbox where id=$1',[target.data.id]);if(!row||!config||row.store_url!==config.url)return Response.json({error:'Sifariş cari veb bağlantısına aid deyil.'},{status:404});}finally{await sql.end();}}
  const stage=z.object({action:z.literal('delivery-stage'),id:z.string().uuid(),stage:z.enum(['preparing','ready','dispatched','delivered'])}).safeParse(body);
  if(stage.success){
    const sql=storeDb();try{
      await sql.begin(async tx=>{
        const [order]=await tx.unsafe('select o.id,o.status,o.fulfillment,o.delivery_stage,i.sync_conflict from desktop_order_inbox i join sales_orders o on o.id=i.local_order_id where i.id=$1 for update of o',[stage.data.id]);
        if(!order||order.status==='cancelled')throw new Error('Sifariş bağlıdır.');
        if(order.sync_conflict)throw new Error('Sifarişdə ziddiyyət var. Baş rəhbər yoxlamalıdır.');
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
      try{return await tx.savepoint(sp=>importDesktopOrder(sp,parsed.data.id,request.headers.get('x-birkassa-user-id')));}
      catch(error){const message=desktopImportError(error);await tx.unsafe('update desktop_order_inbox set import_error=$1 where id=$2',[message,parsed.data.id]);return {error:message};}
    });
    return Response.json(result,{status:'error' in result?409:200});
  } catch(error) {return Response.json({error:error instanceof Error?error.message:"Sifariş köçürülmədi."},{status:409});}
  finally {await sql.end();}
}

export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
