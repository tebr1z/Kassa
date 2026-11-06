import {withAdminSession} from '@/lib/require-admin';
import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";
import { salesWarehouseSql } from "@/lib/warehouse";
import { ensurePrimaryBarcodes, savePrimaryBarcode } from "@/lib/barcode";
import {z} from 'zod';
import {productOptionList} from '@/lib/product-option-input';
import {saveProductOptions} from '@/lib/save-product-options';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type PublicOption={id:string;label:string;size:string;color:string;kind:string;attributes:Record<string,string>;price:number|string|null};
type PriceHistory={oldSalePrice:string|number;newSalePrice:string|number;oldCostPrice:string|number;newCostPrice:string|number;changedAt:string};

function connection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
}

async function handleGET(request: Request) {
  const sql = connection();
  try {
    await ensurePrimaryBarcodes(sql);
    const rows = await sql.unsafe(`
      select p.id, p.name, p.sku, p.category, p.sale_price, p.cost_price,
             p.min_stock, coalesce(b.barcode, '') as barcode,coalesce(bc.barcodes,'[]'::jsonb) barcodes,coalesce(ph.history,'[]'::jsonb) price_history,coalesce(po.options,'[]'::jsonb) as "options",
             coalesce(sum(sm.quantity), 0) as stock,
             coalesce(max(wl.code), 'Təyin edilməyib') as location
      from products p
      left join product_barcodes b on b.product_id = p.id and b.is_primary = true
      left join lateral (select jsonb_agg(jsonb_build_object('id',pb.id,'barcode',pb.barcode,'isPrimary',pb.is_primary) order by pb.is_primary desc,pb.barcode) barcodes from product_barcodes pb where pb.product_id=p.id) bc on true
      left join lateral (select jsonb_agg(jsonb_build_object('oldSalePrice',h.old_sale_price,'newSalePrice',h.new_sale_price,'oldCostPrice',h.old_cost_price,'newCostPrice',h.new_cost_price,'changedAt',h.changed_at) order by h.changed_at desc) history from (select * from product_price_history where product_id=p.id order by changed_at desc limit 8) h) ph on true
      left join lateral (select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'size',o.size,'color',o.color,'kind',o.kind,'attributes',o.attributes,'price',o.price) order by o.position,o.created_at) as "options" from product_options o where o.product_id=p.id and o.is_active=true) po on true
      left join stock_movements sm on sm.product_id = p.id and sm.warehouse_id = (select id from (${salesWarehouseSql(request.headers.get("x-birkassa-user-id") || "")}) sales_warehouse)
      left join warehouse_locations wl on wl.id = sm.location_id
      where p.is_active = true
      group by p.id, b.barcode,bc.barcodes,ph.history,po.options
      order by p.name
    `);
    const editable=request.headers.get('x-birkassa-role')==='admin'?await sql.unsafe('select product_id,id,label,size,color,kind,price,cost_price,position,is_active,attributes from product_options order by position,created_at'):[];
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
      cost: request.headers.get("x-birkassa-role")==="cashier"?0:Number(row.cost_price),
      barcodes: row.barcodes,
      options:((row.options||[]) as PublicOption[]).map(option=>({...option,price:option.price==null?null:Number(option.price)})),
      ...(request.headers.get('x-birkassa-role')==='admin'?{editableOptions:editable.filter(o=>o.product_id===row.id).map(o=>({id:o.id,label:o.label,size:o.size,color:o.color,kind:o.kind,price:o.price,cost_price:o.cost_price,position:o.position,is_active:o.is_active,attributes:o.attributes}))}:{}),
      priceHistory: ((request.headers.get("x-birkassa-role")==="cashier"?[]:row.price_history) as PriceHistory[]).map(item=>({...item,oldSalePrice:Number(item.oldSalePrice),newSalePrice:Number(item.newSalePrice),oldCostPrice:Number(item.oldCostPrice),newCostPrice:Number(item.newCostPrice)})),
    })));
  } catch (error) {
    console.error("products.get", error);void logSystemError("products.get", error);
    return NextResponse.json({ error: "Məhsullar yüklənmədi" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const productInput=z.object({
 name:z.string().trim().min(2).max(200),sku:z.string().trim().min(1).max(100),category:z.string().trim().max(100).default(''),
 salePrice:z.coerce.number().finite().positive().max(1000000),costPrice:z.coerce.number().finite().min(0).max(1000000),
 minStock:z.coerce.number().finite().min(0).max(1000000).default(0),barcode:z.string().trim().max(64).default(''),options:productOptionList.optional(),
});
const updateInput=productInput.extend({productId:z.string().uuid(),additionalBarcode:z.string().trim().max(64).default('')});
function productError(error:unknown){
 const value=error as {code?:string;statusCode?:number;message?:string};
 const duplicate=value.code==='23505';
 return NextResponse.json({error:duplicate?'SKU, barkod və ya seçim adı artıq mövcuddur':value.code?'Məhsul saxlanmadı':value.message||'Məhsul saxlanmadı'},{status:duplicate?409:value.statusCode||400});
}
async function handlePATCH(request:Request){
 const raw=await request.json().catch(()=>null);
 const userId=request.headers.get('x-birkassa-user-id');
 if(!userId)return NextResponse.json({error:'Daxil olun.'},{status:401});
 const deactivate=z.object({action:z.literal('deactivate')}).safeParse(raw).success;
 const parsed=deactivate?z.object({productId:z.string().uuid()}).safeParse(raw):updateInput.safeParse(raw);
 if(!parsed.success)return NextResponse.json({error:'Məhsul məlumatlarını və seçimləri düzgün yazın.'},{status:400});
 const sql=connection();
 try{
  const result=await sql.begin(async tx=>{
   const [old]=await tx.unsafe('select * from products where id=$1 and deleted_at is null for update',[parsed.data.productId]);
   if(!old)throw Object.assign(Error('Məhsul tapılmadı.'),{statusCode:404});
   if(deactivate){
    await tx.unsafe('update products set is_active=false where id=$1',[old.id]);
    await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id) values($1,'product.deactivated','product',$2)",[userId,old.id]);
    return {id:old.id,isActive:false};
   }
   const body=updateInput.parse(raw);
   if(body.salePrice!==Number(old.sale_price)||body.costPrice!==Number(old.cost_price))await tx.unsafe('insert into product_price_history(product_id,old_sale_price,new_sale_price,old_cost_price,new_cost_price,changed_by) values($1,$2,$3,$4,$5,$6)',[old.id,old.sale_price,body.salePrice,old.cost_price,body.costPrice,userId]);
   await tx.unsafe('update products set name=$1,sku=$2,category=$3,sale_price=$4,cost_price=$5,min_stock=$6,discount_price=case when discount_price >= $4 then null else discount_price end where id=$7',[body.name,body.sku,body.category||null,body.salePrice,body.costPrice,body.minStock,old.id]);
   await savePrimaryBarcode(tx,old.id,body.barcode);
   if(body.additionalBarcode)await tx.unsafe('insert into product_barcodes(product_id,barcode,is_primary) values($1,$2,false)',[old.id,body.additionalBarcode]);
   if(body.options!==undefined)await saveProductOptions(tx,old.id,body.options);
   await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'product.updated','product',$2,$3)",[userId,old.id,JSON.stringify({name:body.name,salePrice:body.salePrice,costPrice:body.costPrice,optionCount:body.options?.length})]);
   return {id:old.id,name:body.name,salePrice:body.salePrice,costPrice:body.costPrice};
  });
  return NextResponse.json(result);
 }catch(error){return productError(error);}finally{await sql.end({timeout:2});}
}
async function handlePOST(request:Request){
 const parsed=productInput.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Məhsul məlumatlarını və seçimləri düzgün yazın.'},{status:400});
 const body=parsed.data,userId=request.headers.get('x-birkassa-user-id'),sql=connection();
 try{
  const result=await sql.begin(async tx=>{
   const [row]=await tx.unsafe('insert into products(sku,name,category,sale_price,cost_price,min_stock) values($1,$2,$3,$4,$5,$6) returning id,sku,name',[body.sku,body.name,body.category||null,body.salePrice,body.costPrice,body.minStock]);
   await savePrimaryBarcode(tx,row.id,body.barcode);
   if(body.options!==undefined)await saveProductOptions(tx,row.id,body.options);
   await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'product.created','product',$2,$3)",[userId,row.id,JSON.stringify({name:body.name,optionCount:body.options?.length||0})]);
   return row;
  });
  return NextResponse.json(result,{status:201});
 }catch(error){return productError(error);}finally{await sql.end({timeout:2});}
}

export const GET=withAdminSession(handleGET);
export const PATCH=withAdminSession(handlePATCH);
export const POST=withAdminSession(handlePOST);
