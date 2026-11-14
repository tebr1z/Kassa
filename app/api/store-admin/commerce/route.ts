import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from "@/lib/store-db";
import {ensurePrimaryBarcodes,savePrimaryBarcode} from "@/lib/barcode";
import {z} from "zod";
import {mediaUrl} from "@/lib/desktop-media";
import {productOptionInput as optionFields,productOptionList} from '@/lib/product-option-input';
import {saveProductOptions} from '@/lib/save-product-options';
import {resolveProductDiscount} from '@/lib/product-discount';
import {isLocalInventory} from '@/lib/inventory-mode';
export const dynamic="force-dynamic";
async function handleGET(){
 const sql=storeDb();try{
 const local=isLocalInventory();
 if(local)await ensurePrimaryBarcodes(sql);
 const products=await sql.unsafe(local?"select p.*,coalesce((select sum(quantity) from stock_movements sm where sm.product_id=p.id),0) stock,coalesce((select b.barcode from product_barcodes b where b.product_id=p.id and b.is_primary limit 1),'') barcode,coalesce((select json_agg(json_build_object('id',o.id,'label',o.label,'size',o.size,'color',o.color,'kind',o.kind,'image_url',o.image_url,'cost_price',o.cost_price,'attributes',o.attributes,'price',o.price,'position',o.position,'is_active',o.is_active) order by o.position,o.created_at) from product_options o where o.product_id=p.id),'[]'::json) as \"options\" from products p where p.deleted_at is null order by p.name":"select p.id,p.name,p.sku,p.public_code,p.category,p.unit,p.sale_price,p.discount_price,p.description,p.specifications,p.is_active,p.image_url,coalesce((select json_agg(json_build_object('id',o.id,'label',o.label,'size',o.size,'color',o.color,'kind',o.kind,'image_url',o.image_url,'attributes',o.attributes,'price',o.price,'position',o.position,'is_active',o.is_active) order by o.position,o.created_at) from product_options o where o.product_id=p.id),'[]'::json) as \"options\" from products p where p.deleted_at is null order by p.name");
 const coupons=await sql.unsafe("select * from commerce_coupons order by expires_at desc");
 const messages=await sql.unsafe("select m.*,a.email,c.phone from contact_messages m join customer_accounts a on a.id=m.account_id join customers c on c.id=a.customer_id order by m.created_at desc limit 200");
 for(const product of products){product.image_url=await mediaUrl(product.image_url);for(const option of product.options)option.image_url=await mediaUrl(option.image_url);}
 return Response.json({local,inventoryLocalOnly:true,canManageProducts:true,products,coupons,messages});
 }catch{return Response.json({error:"Məlumatlar yüklənmədi."},{status:503});}finally{await sql.end();}
}
const product=z.object({action:z.literal("product"),id:z.string().uuid().optional(),name:z.string().trim().min(2).max(200),sku:z.string().trim().min(1).max(100),category:z.string().trim().max(100),unit:z.string().trim().min(1).max(30),sale_price:z.number().finite().positive().max(1000000),cost_price:z.number().finite().min(0).max(1000000).optional(),description:z.string().max(5000),specifications:z.string().max(3000),discount_price:z.number().finite().positive().nullable().optional(),discount_percent:z.number().finite().optional(),is_active:z.boolean(),barcode:z.string().trim().max(64).optional().default(""),options:productOptionList.optional()});
const option=optionFields.extend({action:z.literal('option'),id:z.string().uuid().optional(),product_id:z.string().uuid()});
const coupon=z.object({action:z.literal("coupon"),id:z.string().uuid().optional(),code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),percent:z.number().int().min(1).max(90),minimum:z.number().min(0).max(1000000),max_discount:z.number().positive().max(1000000).nullable(),expires_at:z.string().datetime(),usage_limit:z.number().int().min(1).max(1000000),is_active:z.boolean()});
const schema=z.union([product,option,coupon,z.object({action:z.literal("read"),id:z.string().uuid()}),z.object({action:z.literal('delete-product'),id:z.string().uuid(),confirm:z.literal('SİL')})]);
async function handlePOST(request:Request){
 const local=isLocalInventory(),raw=await request.json().catch(()=>null);
 // Older clients may still include inventory fields. Never retain their values
 // in a web row, a price-history entry or an audit payload.
 if(!local&&raw&&typeof raw==='object'){
  const body=raw as Record<string,unknown>;
  for(const key of ['cost_price','min_stock','stock','barcode'])delete body[key];
  if(Array.isArray(body.options))for(const option of body.options)if(option&&typeof option==='object')delete (option as Record<string,unknown>).cost_price;
 }
 const parsed=schema.safeParse(raw);if(!parsed.success||(local&&parsed.data.action==='product'&&parsed.data.cost_price===undefined))return Response.json({error:"Məlumatları yoxlayın. Endirim qiyməti əsas qiymətdən aşağı olmalıdır."},{status:400});
 const b=parsed.data;const sql=storeDb();try{
 await sql.begin(async tx=>{
 let entityId="";
 if(b.action==="product"){
 const discountFields={discountPrice:b.discount_price,discountPercent:b.discount_percent};
 if(b.id){
 const [old]=await tx.unsafe(local?"select * from products where id=$1 and deleted_at is null for update":"select id,sale_price,discount_price from products where id=$1 and deleted_at is null for update",[b.id]);if(!old)throw new Error("Məhsul tapılmadı.");
 const discountPrice=resolveProductDiscount(b.sale_price,discountFields,old.discount_price);
 const values=[b.name,b.sku,b.category,b.unit,b.sale_price,b.description,b.specifications,discountPrice,b.is_active];
 if(local)await tx.unsafe("update products set name=$1,sku=$2,category=$3,unit=$4,sale_price=$5,cost_price=$6,description=$7,specifications=$8,discount_price=$9,is_active=$10 where id=$11",[b.name,b.sku,b.category,b.unit,b.sale_price,b.cost_price??0,b.description,b.specifications,discountPrice,b.is_active,b.id]);
 else await tx.unsafe("update products set name=$1,sku=$2,category=$3,unit=$4,sale_price=$5,description=$6,specifications=$7,discount_price=$8,is_active=$9 where id=$10",[...values,b.id]);entityId=b.id;
 if(local&&(Number(old.sale_price)!==b.sale_price||Number(old.cost_price)!==b.cost_price))await tx.unsafe("insert into product_price_history(product_id,old_sale_price,new_sale_price,old_cost_price,new_cost_price,changed_by) values($1,$2,$3,$4,$5,$6)",[b.id,old.sale_price,b.sale_price,old.cost_price,b.cost_price,request.headers.get("x-birkassa-user-id")]);
 }else{const discountPrice=resolveProductDiscount(b.sale_price,discountFields);const values=[b.name,b.sku,b.category,b.unit,b.sale_price,local?b.cost_price??0:0,b.description,b.specifications,discountPrice,b.is_active];const [row]=await tx.unsafe("insert into products(name,sku,category,unit,sale_price,cost_price,description,specifications,discount_price,is_active) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",values);entityId=row.id;}
 if(local)await savePrimaryBarcode(tx,entityId,b.barcode);
 if(b.options!==undefined)await saveProductOptions(tx,entityId,b.options,{preserveCost:!local});
 }else if(b.action==="option"){
 const [parent]=await tx.unsafe('select id from products where id=$1 and deleted_at is null for update',[b.product_id]);if(!parent)throw new Error('Məhsul tapılmadı.');
 const values=[b.product_id,b.label,b.size,b.color,b.kind,b.price,b.position,b.is_active,JSON.stringify(b.attributes)];
 const rows=b.id?(local?await tx.unsafe("update product_options set label=$2,size=$3,color=$4,kind=$5,price=$6,position=$7,is_active=$8,attributes=$9::text::jsonb,cost_price=$10,image_url=coalesce($11,image_url) where id=$12 and product_id=$1 returning id",[...values,b.cost_price,b.image_url??null,b.id]):await tx.unsafe("update product_options set label=$2,size=$3,color=$4,kind=$5,price=$6,position=$7,is_active=$8,attributes=$9::text::jsonb,image_url=coalesce($10,image_url) where id=$11 and product_id=$1 returning id",[...values,b.image_url??null,b.id])):await tx.unsafe("insert into product_options(product_id,label,size,color,kind,price,position,is_active,attributes,cost_price,image_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,$10,$11) returning id",[...values,local?b.cost_price:null,b.image_url??'']);
 if(!rows[0])throw new Error("Seçim tapılmadı.");entityId=rows[0].id;
 }else if(b.action==='delete-product'){
 const [parent]=await tx.unsafe('select id,name from products where id=$1 and deleted_at is null for update',[b.id]);if(!parent)throw new Error('Məhsul tapılmadı.');
 const [open]=await tx.unsafe("select i.id from sales_order_items i join sales_orders o on o.id=i.sales_order_id where i.product_id=$1 and o.status in ('pending','ready') limit 1",[b.id]);if(open)throw new Error('Məhsul açıq sifarişdədir. Əvvəl sifarişi tamamlayın və ya ləğv edin.');
 await tx.unsafe('update products set is_active=false,deleted_at=now() where id=$1',[b.id]);entityId=b.id;
 }else if(b.action==="coupon"){
 const values=[b.code,b.percent,b.minimum,b.max_discount,b.expires_at,b.usage_limit,b.is_active];
 const rows=b.id?await tx.unsafe("update commerce_coupons set code=$1,percent=$2,minimum=$3,max_discount=$4,expires_at=$5,usage_limit=$6,is_active=$7 where id=$8 returning id",[...values,b.id]):await tx.unsafe("insert into commerce_coupons(code,percent,minimum,max_discount,expires_at,usage_limit,is_active) values($1,$2,$3,$4,$5,$6,$7) returning id",values);
 if(!rows[0])throw new Error("Kupon tapılmadı.");entityId=rows[0].id;
 }else{await tx.unsafe("update contact_messages set is_read=true where id=$1",[b.id]);entityId=b.id;}
 const audit={...b} as Record<string,unknown>;
 if(!local){delete audit.cost_price;delete audit.barcode;if(Array.isArray(audit.options))audit.options=audit.options.map(option=>{const safe={...option};delete safe.cost_price;return safe;});}
 await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,$2,'commerce',$3,$4)",[request.headers.get("x-birkassa-user-id"),"commerce."+b.action,entityId,JSON.stringify(audit)]);
 });return Response.json({ok:true});
 }catch(e){const duplicate=typeof e==="object"&&e!==null&&"code" in e&&e.code==="23505";return Response.json({error:e instanceof Error&&!("code" in e)?e.message:duplicate?"SKU, barkod və ya seçim adı təkrarlanır.":"Saxlanmadı."},{status:400});}finally{await sql.end();}
}

export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
