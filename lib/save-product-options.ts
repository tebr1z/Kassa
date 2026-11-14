import 'server-only';
import type {TransactionSql} from 'postgres';
import type {ProductOptionInput} from './product-option-input';
// Caller must hold the parent product row lock. Both product forms use this transaction.
export async function saveProductOptions(tx:TransactionSql,productId:string,options:ProductOptionInput[]){
 const existing=await tx.unsafe('select id,label,image_url from product_options where product_id=$1 for update',[productId]);
 for(const option of options)if(option.id&&!existing.some(row=>row.id===option.id))throw Error('Seçim bu məhsula aid deyil.');
 const kept=new Set(options.filter(o=>o.is_active).map(o=>o.id||existing.find(row=>row.label===o.label)?.id));
 const pending=await tx.unsafe("select i.option_id from sales_order_items i join sales_orders o on o.id=i.sales_order_id where i.product_id=$1 and i.option_id is not null and o.status in ('pending','ready')",[productId]);
 if(pending.some(row=>!kept.has(row.option_id)))throw Error('Açıq sifarişdə olan seçimi silmək olmaz. Əvvəl sifarişi tamamlayın və ya ləğv edin.');
 // Omitted choices are archived, never physically deleted: historical receipts keep their IDs.
 await tx.unsafe('update product_options set is_active=false where product_id=$1',[productId]);
 for(const [position,option] of options.entries()){
  const saved=existing.find(row=>option.id?row.id===option.id:row.label===option.label),id=saved?.id;
  const image=option.image_url===undefined?String(saved?.image_url||''):option.image_url;
  const values=[productId,option.label,option.size,option.color,option.kind,option.price,position,option.is_active,JSON.stringify(option.attributes),option.cost_price,image];
  if(id)await tx.unsafe('update product_options set label=$2,size=$3,color=$4,kind=$5,price=$6,position=$7,is_active=$8,attributes=$9::text::jsonb,cost_price=$10,image_url=$11 where product_id=$1 and id=$12',[...values,id]);
  else await tx.unsafe('insert into product_options(product_id,label,size,color,kind,price,position,is_active,attributes,cost_price,image_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,$10,$11)',values);
 }
}
