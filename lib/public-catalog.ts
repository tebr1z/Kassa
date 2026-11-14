import "server-only";
import {cache} from "react";
import postgres from "postgres";
import type {PublicCatalog} from "@/lib/catalog-types";
import {catalogPricing} from "@/lib/commerce";
import {mediaUrl} from "@/lib/desktop-media";
import {isProductOptionImage} from '@/lib/product-option-image';
const poolState=globalThis as {catalogPool?: ReturnType<typeof postgres>};
function catalogDb(){
 if(!process.env.DATABASE_URL) throw new Error("Database unavailable");
 if(!poolState.catalogPool) poolState.catalogPool=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10,idle_timeout:60});
 return poolState.catalogPool;
}
function transient(error:unknown){
 const code=String((error as {code?:string}).code||"");
 const message=String((error as {message?:string}).message||"");
 return ["ECONNRESET","ETIMEDOUT","ECONNREFUSED","57P01","08006","08001","08004","53300"].includes(code)||/ECONNRESET|Connection terminated|timeout/i.test(message);
}
async function query(text:string){
 let last:unknown;
 for(let attempt=0;attempt<3;attempt++){
  try{return await catalogDb().unsafe(text);}
  catch(error){
   last=error;
   if(!transient(error)||attempt===2) throw error;
   const broken=poolState.catalogPool;
   poolState.catalogPool=undefined;
   void broken?.end({timeout:1}).catch(()=>{});
   await new Promise(resolve=>setTimeout(resolve,attempt===0?200:500));
  }
 }
 throw last;
}
async function loadPublicCatalog():Promise<PublicCatalog>{
  const [brand]=await query("select name,kind,description,about,logo,phone,address,whatsapp,featured_product_id as \"featuredProductId\" from storefront_config where id=1");
  const productSql="select p.id,p.public_code as code,p.name,p.category,p.unit,p.sale_price,p.discount_price,p.description,p.specifications,p.image_url as image,coalesce(imgs.images,'[]'::json) images,coalesce(opts.options,'[]'::json) as \"options\" from products p left join lateral (select json_agg(pi.image_url order by pi.position,pi.id) images from product_images pi where pi.product_id=p.id) imgs on true left join lateral (select json_agg(json_build_object('id',po.id,'label',po.label,'size',po.size,'color',po.color,'kind',po.kind,'image',po.image_url,'attributes',po.attributes,'price',po.price) order by po.position,po.created_at) as \"options\" from product_options po where po.product_id=p.id and po.is_active=true) opts on true where p.is_active=true order by p.name";
  const legacySql="select p.id,p.name,p.category,p.unit,p.sale_price,p.discount_price,p.description,p.specifications,p.image_url as image,'[]'::json images,'[]'::json as \"options\" from products p where p.is_active=true order by p.name";
  let products;
  try{products=await query(productSql);}catch(error){if(!["42P01","42703"].includes(String((error as {code?:string}).code||"")))throw error;products=await query(legacySql);}
  // Explicit public DTO: never serialize stock, cost, SKU, locations or raw rows.
  const publicProducts=products.map(p=>{
   const images=[...new Set([p.image,...(Array.isArray(p.images)?p.images:[])].map(item=>String(item||"").trim()).filter(item=>(item.startsWith("https://")||/^\/api\/(?:catalog|desktop)-media\/[a-f0-9]{64}$/.test(item))))];
   const pricing=catalogPricing({sale_price:p.sale_price,discount_price:p.discount_price},Array.isArray(p.options)?p.options:[]);
   return {id:p.id,code:String(p.code||""),name:p.name,category:p.category||"",unit:p.unit,
   ...pricing,
   image:images[0]||"",images,available:true,description:p.description||"",specifications:p.specifications||"",options:(Array.isArray(p.options)?p.options:[]).map((option:{id:string;label:string;size?:string;color?:string;kind?:string;image?:string;attributes?:Record<string,string>;price?:string|null})=>({id:option.id,label:option.label,size:option.size||"",color:option.color||"",kind:option.kind||"",image:isProductOptionImage(option.image)?option.image:'',attributes:option.attributes||{},price:option.price==null?null:Number(option.price)}))};
  });
  const slides=await query('select id,product_id as "productId",heading,badge,description from storefront_slides where is_active=true order by position,id');
  let categories:{id:string;name:string;image:string}[]=[];
  try{
   const categoryRows=await query("select id,name,image_url from product_categories where is_active=true and show_on_home=true order by name");
   categories=categoryRows.map(row=>({id:row.id,name:row.name,image:String(row.image_url||"").startsWith("https://res.cloudinary.com/")?row.image_url:""}));
  }catch(error){if((error as {code?:string}).code!=="42703")throw error;}
  const visible=new Set(publicProducts.map(p=>p.id));
  for(const product of publicProducts){product.image=await mediaUrl(product.image);product.images=await Promise.all(product.images.map(mediaUrl));for(const option of product.options)option.image=await mediaUrl(option.image);}
  for(const category of categories)category.image=await mediaUrl(category.image);
  if(brand)brand.logo=await mediaUrl(brand.logo);
  return {
   brand:brand?{name:String(brand.name||''),kind:String(brand.kind||''),description:String(brand.description||''),about:String(brand.about||''),logo:String(brand.logo||''),phone:String(brand.phone||''),address:String(brand.address||''),whatsapp:String(brand.whatsapp||''),featuredProductId:brand.featuredProductId?String(brand.featuredProductId):null}:null,
   products:publicProducts,
   slides:slides.filter(s=>!s.productId||visible.has(s.productId)).map(s=>({id:String(s.id),productId:s.productId?String(s.productId):null,heading:String(s.heading||''),badge:String(s.badge||''),description:String(s.description||'')})),categories,
  };
}

// Request-scoped memoization: never cache prices or shop data across requests.
export const getPublicCatalog=cache(loadPublicCatalog);

