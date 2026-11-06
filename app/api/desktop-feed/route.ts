import {storeDb} from "@/lib/store-db";
import {isDesktop} from "@/lib/desktop-sync";
import {desktopAuthorization} from "@/lib/desktop-bridge";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request) {
  if(isDesktop())return Response.json({error:"Not available"},{status:404});
  const key=request.headers.get("authorization")?.replace(/^Bearer /,"")||"";
  const sql=storeDb();
  try {
    if(!await desktopAuthorization(sql,key))return Response.json({error:"Unauthorized"},{status:401});
    let after="1970-01-01T00:00:00.000Z",id="00000000-0000-0000-0000-000000000000";
    const cursor=new URL(request.url).searchParams.get("after");
    if(cursor) {
      try {
        const parsed=JSON.parse(Buffer.from(cursor,"base64url").toString());
        // Preserve PostgreSQL microseconds: millisecond rounding can skip rows.
        if(typeof parsed.time!=="string" || !Number.isFinite(Date.parse(parsed.time)) || !/^[0-9a-f-]{36}$/i.test(parsed.id))throw new Error();
        after=parsed.time;id=parsed.id;
      } catch { return Response.json({error:"Invalid cursor"},{status:400}); }
    }
    const rows=await sql.unsafe(`select o.id,o.order_no,o.status,o.fulfillment,o.delivery_address,o.delivery_stage,
      o.total,o.coupon_discount,o.note,o.created_at,o.updated_at::text updated_at,coalesce(o.customer_name_snapshot,c.full_name) full_name,coalesce(o.customer_phone_snapshot,c.phone) phone,
      (select json_agg(json_build_object('sku',p.sku,'name',coalesce(i.product_name_snapshot,p.name),'option_snapshot',i.option_snapshot,
      'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total) order by i.id)
      from sales_order_items i join products p on p.id=i.product_id where i.sales_order_id=o.id) items
      from sales_orders o join customers c on c.id=o.customer_id
      where o.source='catalog' and (o.updated_at,o.id)>($1::text::timestamptz,$2::uuid)
      order by o.updated_at,o.id limit 100`,[after,id]);
    const last=rows.at(-1);
    const next=last?Buffer.from(JSON.stringify({time:last.updated_at,id:last.id})).toString("base64url"):null;
    return Response.json({rows,next},{headers:{"Cache-Control":"no-store"}});
  } finally {await sql.end();}
}
