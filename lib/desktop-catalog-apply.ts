import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import type postgres from 'postgres';
import type {z} from 'zod';
import type {publicProduct} from './desktop-bridge';

type Sql=Pick<ReturnType<typeof postgres>,'unsafe'>;
type Product=z.infer<typeof publicProduct>;
const scalarColumns={sku:'sku',name:'name',code:'public_code',category:'category',unit:'unit',price:'sale_price',discountPrice:'discount_price',image:'image_url',isActive:'is_active',description:'description',specifications:'specifications'} as const;
type ScalarField=keyof typeof scalarColumns;
const optionColumns={size:'size',color:'color',kind:'kind',price:'price',position:'position',isActive:'is_active',attributes:'attributes',image:'image_url'} as const;
type OptionField=keyof typeof optionColumns;
type Option=Product['options'][number];
type Parameter=string|number|boolean|null;

function equalField(field:string,left:unknown,right:unknown){
 // PostgreSQL numeric columns are returned as decimal strings by default.
 if(field==='price'||field==='discountPrice')return left==null||right==null?left===right:Number(left)===Number(right);
 return isDeepStrictEqual(left,right);
}
const changedOptionFields=(item:Option,before:Option|undefined)=>(Object.keys(optionColumns) as OptionField[]).filter(field=>item[field]!==undefined&&(!before||!equalField(field,item[field],before[field])));

/** Lock and compare all touched fields before performing ANY product writes. */
async function concurrentEdit(tx:Sql,id:string,product:Product,fields:Set<string>){
 const [current]=await tx.unsafe(`select sku,name,public_code code,coalesce(category,'') category,unit,
  sale_price price,discount_price as "discountPrice",coalesce(image_url,'') image,is_active as "isActive",
  coalesce(description,'') description,coalesce(specifications,'') specifications from products where id=$1 for update`,[id]);
 if(!current)return true;
 const previous=product.previous;
 for(const field of Object.keys(scalarColumns) as ScalarField[]){
  if(!fields.has(field)||product[field]===undefined)continue;
  if(equalField(field,current[field],product[field]))continue; // Safe replay.
  if(!previous||!equalField(field,current[field],previous[field]))return true;
 }
 if(!fields.has('options'))return false;
 const rows=await tx.unsafe(`select label,size,color,kind,price,position,is_active as "isActive",attributes,
  coalesce(image_url,'') image from product_options where product_id=$1 for update`,[id]);
 const web=new Map(rows.map(row=>[String(row.label),row]));
 const before=new Map((previous?.options||[]).map(row=>[row.label,row]));
 const incoming=new Map<string,Option>();
 for(const item of product.options){if(incoming.has(item.label))throw new Error('Təkrar məhsul seçimi.');incoming.set(item.label,item);}
 for(const [label,old]of before){
  if(incoming.has(label))continue;
  const existing=web.get(label);
  // An already absent/inactive choice has already reached the desired state.
  if(existing&&existing.isActive!==false&&(Object.keys(optionColumns) as OptionField[]).some(field=>!equalField(field,existing[field],old[field])))return true;
 }
 for(const item of product.options){
  const old=before.get(item.label),existing=web.get(item.label),changed=changedOptionFields(item,old);
  if(!old){
   // A new local label cannot take ownership of a different web-only choice.
   // Exact equality is an idempotent replay; private cost is never compared.
   if(existing&&(Object.keys(optionColumns) as OptionField[]).some(field=>!equalField(field,existing[field],item[field]??(field==='image'?'' : item[field]))))return true;
  }else if(changed.length){
   if(!existing)return true; // Never recreate a choice removed on the website.
   if(changed.some(field=>!equalField(field,existing[field],old[field])&&!equalField(field,existing[field],item[field])))return true;
  }
 }
 return false;
}

// The caller validates the public-only DTO, locks the publication stream and
// owns the transaction. No SQL here reads or updates inventory/cost/finance.
export async function applyPublicProduct(tx:Sql,product:Product):Promise<string|undefined>{
 const incremental=product.changedFields!==undefined;
 const fields=new Set<string>(product.changedFields??[...Object.keys(scalarColumns),'images','options']);
 for(const field of fields)if(!Object.hasOwn(scalarColumns,field)&&field!=='images'&&field!=='options')throw new Error('Kataloq dəyişiklik sahəsi düzgün deyil.');
 const candidates=await tx.unsafe('select id,sku,deleted_at from products where id=$1 or sku=$2 or ($3::text is not null and sku=$3) for update',[product.id,product.sku,product.previous?.sku??null]);
 const stable=candidates.find(row=>row.id===product.id);
 if(stable?.deleted_at)return undefined;
 if(new Set(candidates.map(row=>String(row.id))).size>1)throw new Error('Məhsulun SKU kodu başqa veb məhsulla toqquşur. Kodu yoxlayın.');
 const existing=stable??candidates[0];
 if(existing?.deleted_at)return undefined;
 if(incremental&&product.previous===null&&existing&&existing.id!==product.id)throw new Error('Yeni məhsulun SKU kodu vebdə artıq mövcuddur. Başqa kod seçin.');
 // A product removed on the web after pairing must never be recreated by an
 // unrelated desktop edit. A genuinely new local product has previous:null.
 if(incremental&&product.previous&&!existing)return undefined;
 if(incremental&&existing&&await concurrentEdit(tx,String(existing.id),product,fields))return undefined;
 let id:string;
 const values:Record<ScalarField,Parameter|undefined>={sku:product.sku,name:product.name,code:product.code,category:product.category,unit:product.unit,price:product.price,discountPrice:product.discountPrice,image:product.image,isActive:product.isActive,description:product.description,specifications:product.specifications};
 if(existing){
  id=String(existing.id);
  const changed=(Object.keys(scalarColumns) as ScalarField[]).filter(field=>fields.has(field)&&values[field]!==undefined);
  if(changed.length){
   const params=changed.map(field=>values[field] as Parameter);params.push(id);
   await tx.unsafe('update products set '+changed.map((field,index)=>scalarColumns[field]+'=$'+(index+1)).join(',')+' where id=$'+params.length,params);
  }
 }else{
  const [inserted]=await tx.unsafe('insert into products(id,sku,name,public_code,category,unit,sale_price,discount_price,cost_price,min_stock,image_url,is_active,description,specifications) values($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11,$12) returning id',[product.id,product.sku,product.name,product.code,product.category,product.unit,product.price,product.discountPrice,product.image,product.isActive,product.description??'',product.specifications??'']);
  id=String(inserted.id);
 }
 if(product.category&&(!existing||fields.has('category')))await tx.unsafe('insert into product_categories(name) values($1) on conflict(name) do nothing',[product.category]);
 if(fields.has('images'))await applyImages(tx,id,product,incremental&&!!existing);
 if(fields.has('options'))await applyOptions(tx,id,product,incremental&&!!existing);
 return id;
}

async function applyImages(tx:Sql,id:string,product:Product,merge:boolean){
 const current=[...new Set(product.images.filter(Boolean))];
 if(!merge){
  await tx.unsafe('delete from product_images where product_id=$1',[id]);
  for(const [position,url]of current.entries())await tx.unsafe('insert into product_images(product_id,image_url,position) values($1,$2,$3)',[id,url,position]);
  return;
 }
 const rows=await tx.unsafe('select id,image_url,position from product_images where product_id=$1 order by position,id for update',[id]);
 const baseline=product.previous?.images??[];
 const removed=new Set(baseline.filter(url=>!current.includes(url)));
 const keep=rows.filter(row=>!removed.has(String(row.image_url)));
 const added=current.filter(url=>!baseline.includes(url));
 const merged=[...new Set([...keep.map(row=>String(row.image_url)),...added])];
 if(merged.length>8)throw new Error('Vebdəki əlavə şəkillərlə birlikdə məhsulda 8-dən çox şəkil alınır. Şəkilləri yoxlayın.');
 // Keep IDs of surviving web photos; only explicit local removals disappear.
 for(const row of rows)if(removed.has(String(row.image_url)))await tx.unsafe('delete from product_images where product_id=$1 and id=$2',[id,row.id]);
 for(const [position,url]of merged.entries()){
  const existing=keep.find(row=>row.image_url===url);
  if(existing){if(Number(existing.position)!==position)await tx.unsafe('update product_images set position=$1 where product_id=$2 and id=$3',[position,id,existing.id]);}
  else await tx.unsafe('insert into product_images(product_id,image_url,position) values($1,$2,$3)',[id,url,position]);
 }
}

async function applyOptions(tx:Sql,id:string,product:Product,merge:boolean){
 const labels=new Set<string>();
 for(const item of product.options){if(labels.has(item.label))throw new Error('Təkrar məhsul seçimi.');labels.add(item.label);}
 const previous=new Map((product.previous?.options??[]).map(item=>[item.label,item]));
 if(!merge)await tx.unsafe('update product_options set is_active=false where product_id=$1',[id]);
 else for(const label of previous.keys())if(!labels.has(label))await tx.unsafe('update product_options set is_active=false where product_id=$1 and label=$2',[id,label]);
 for(const item of product.options){
  const before=merge?previous.get(item.label):undefined;
  const changed=(Object.keys(optionColumns) as OptionField[]).filter(field=>item[field]!==undefined&&(!before||!isDeepStrictEqual(item[field],before[field]))&&!(merge&&!before&&field==='image'&&!item.image));
  if(!changed.length)continue;
  await upsertOption(tx,id,item,changed);
 }
}

async function upsertOption(tx:Sql,id:string,item:Option,changed:OptionField[]){
 // The complete INSERT supports new local choices. On conflict, only the local
 // fields actually changed since the pairing baseline replace web values.
 const assignments=changed.map(field=>optionColumns[field]+'=excluded.'+optionColumns[field]);
 await tx.unsafe('insert into product_options(product_id,label,size,color,kind,price,position,is_active,attributes,image_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,$10) on conflict(product_id,label) do update set '+assignments.join(','),[id,item.label,item.size,item.color,item.kind,item.price,item.position,item.isActive,JSON.stringify(item.attributes),item.image??'']);
}
