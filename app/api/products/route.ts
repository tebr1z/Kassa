import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";
import { salesWarehouseSql } from "@/lib/warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
}

export async function GET(request: Request) {
  const sql = connection();
  try {
    const rows = await sql.unsafe(`
      select p.id, p.name, p.sku, p.category, p.sale_price, p.cost_price,
             p.min_stock, coalesce(b.barcode, '') as barcode,coalesce(bc.barcodes,'[]'::jsonb) barcodes,coalesce(ph.history,'[]'::jsonb) price_history,
             coalesce(sum(sm.quantity), 0) as stock,
             coalesce(max(wl.code), 'Təyin edilməyib') as location
      from products p
      left join product_barcodes b on b.product_id = p.id and b.is_primary = true
      left join lateral (select jsonb_agg(jsonb_build_object('id',pb.id,'barcode',pb.barcode,'isPrimary',pb.is_primary) order by pb.is_primary desc,pb.barcode) barcodes from product_barcodes pb where pb.product_id=p.id) bc on true
      left join lateral (select jsonb_agg(jsonb_build_object('oldSalePrice',h.old_sale_price,'newSalePrice',h.new_sale_price,'oldCostPrice',h.old_cost_price,'newCostPrice',h.new_cost_price,'changedAt',h.changed_at) order by h.changed_at desc) history from (select * from product_price_history where product_id=p.id order by changed_at desc limit 8) h) ph on true
      left join stock_movements sm on sm.product_id = p.id and sm.warehouse_id = (select id from (${salesWarehouseSql(request.headers.get("x-birkassa-user-id") || "")}) sales_warehouse)
      left join warehouse_locations wl on wl.id = sm.location_id
      where p.is_active = true
      group by p.id, b.barcode,bc.barcodes,ph.history
      order by p.name
    `);
    return NextResponse.json(rows.map((row) => ({
      id: row.id,
      name: row.name,
      barcode: row.barcode,
      sku: row.sku,
      category: row.category ?? "Kateqoriyasız",
      location: row.location,
      stock: Number(row.stock),
      min: Number(row.min_stock),
      price: Number(row.sale_price),
      cost: Number(row.cost_price),
      barcodes: row.barcodes,
      priceHistory: row.price_history.map((item:any)=>({...item,oldSalePrice:Number(item.oldSalePrice),newSalePrice:Number(item.newSalePrice),oldCostPrice:Number(item.oldCostPrice),newCostPrice:Number(item.newCostPrice)})),
    })));
  } catch (error) {
    console.error("products.get", error);void logSystemError("products.get", error);
    return NextResponse.json({ error: "Məhsullar yüklənmədi" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export async function PATCH(request:Request){const sql=connection();try{const body=await request.json() as {action?:string;productId?:string;name?:string;sku?:string;category?:string;salePrice?:number|string;costPrice?:number|string;minStock?:number|string;additionalBarcode?:string};const userId=request.headers.get("x-birkassa-user-id");if(!body.productId||!userId)return NextResponse.json({error:"Məhsul və ya istifadəçi tapılmadı"},{status:400});const productId=body.productId;const result=await sql.begin(async tx=>{const [product]=await tx.unsafe("select * from products where id=$1 for update",[productId]);if(!product)throw Object.assign(new Error("Məhsul tapılmadı"),{statusCode:404});if(body.action==='deactivate'){await tx.unsafe("update products set is_active=false where id=$1",[product.id]);await tx.unsafe("insert into audit_logs (user_id,action,entity_type,entity_id,before_json,after_json) values ($1,'product.deactivated','product',$2,$3,$4)",[userId,product.id,JSON.stringify({isActive:true}),JSON.stringify({isActive:false})]);return{id:product.id,isActive:false}}const salePrice=Number(body.salePrice),costPrice=Number(body.costPrice),minStock=Number(body.minStock||0),name=String(body.name||'').trim(),sku=String(body.sku||'').trim();if(name.length<2||!sku||!Number.isFinite(salePrice)||salePrice<=0||!Number.isFinite(costPrice)||costPrice<0||!Number.isFinite(minStock)||minStock<0)throw Object.assign(new Error("Məhsul məlumatlarını düzgün yazın"),{statusCode:400});if(salePrice!==Number(product.sale_price)||costPrice!==Number(product.cost_price))await tx.unsafe("insert into product_price_history (product_id,old_sale_price,new_sale_price,old_cost_price,new_cost_price,changed_by) values ($1,$2,$3,$4,$5,$6)",[product.id,product.sale_price,salePrice,product.cost_price,costPrice,userId]);await tx.unsafe("update products set name=$1,sku=$2,category=$3,sale_price=$4,cost_price=$5,min_stock=$6 where id=$7",[name,sku,body.category||null,salePrice,costPrice,minStock,product.id]);const extra=String(body.additionalBarcode||'').trim();if(extra)await tx.unsafe("insert into product_barcodes (product_id,barcode,is_primary) values ($1,$2,false)",[product.id,extra]);await tx.unsafe("insert into audit_logs (user_id,action,entity_type,entity_id,before_json,after_json) values ($1,'product.updated','product',$2,$3,$4)",[userId,product.id,JSON.stringify({name:product.name,salePrice:Number(product.sale_price),costPrice:Number(product.cost_price)}),JSON.stringify({name,salePrice,costPrice,additionalBarcode:extra||null})]);return{id:product.id,name,salePrice,costPrice}});return NextResponse.json(result)}catch(error:any){console.error("products.patch",error);void logSystemError("products.patch", error);const duplicate=error?.code==='23505';return NextResponse.json({error:duplicate?"SKU və ya barkod artıq mövcuddur":error?.message||"Məhsul yenilənmədi"},{status:duplicate?409:error?.statusCode||500})}finally{await sql.end({timeout:2})}}

export async function POST(request: Request) {
  const sql = connection();
  try {
    const body = await request.json() as {
      name?: string; sku?: string; barcode?: string; category?: string;
      salePrice?: number | string; costPrice?: number | string; minStock?: number | string;
    };
    const { name, sku, barcode, category, salePrice, costPrice, minStock = 0 } = body;
    if (!name || !sku || !barcode || Number(salePrice) <= 0 || Number(costPrice) < 0) {
      return NextResponse.json({ error: "Məhsul məlumatları natamamdır" }, { status: 400 });
    }
    const result = await sql.begin(async (tx) => {
      const [product] = await tx.unsafe(
        `insert into products (sku, name, category, sale_price, cost_price, min_stock)
         values ($1, $2, $3, $4, $5, $6)
         returning id, sku, name`,
        [String(sku).trim(), String(name).trim(), category || null, Number(salePrice), Number(costPrice), Number(minStock)],
      );
      await tx.unsafe(
        `insert into product_barcodes (product_id, barcode, is_primary) values ($1, $2, true)`,
        [product.id, String(barcode).trim()],
      );
      return product;
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("products.post", error);void logSystemError("products.post", error);
    const duplicate = error?.code === "23505";
    return NextResponse.json({ error: duplicate ? "SKU və ya barkod artıq mövcuddur" : "Məhsul saxlanmadı" }, { status: duplicate ? 409 : 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
