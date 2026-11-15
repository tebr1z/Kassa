import {createHash} from 'node:crypto';

// Deliberately shared by the sender and its strict HTTP schema. Neither an ID
// nor any inventory, purchasing, staff or accounting field is editable here.
export const publicProductFields=[
 'sku','name','code','category','unit','price','discountPrice','image','images',
 'options','isActive','description','specifications',
] as const;
export type PublicProductField=typeof publicProductFields[number];

export type DesktopPublicOption={
 label:string;size:string;color:string;kind:string;image:string;
 price:number|null;position:number;isActive:boolean;attributes:Record<string,string>;
};
export type DesktopPublicProduct={
 id:string;sku:string;name:string;code:string;category:string;unit:string;
 price:number;discountPrice:number|null;image:string;images:string[];
 options:DesktopPublicOption[];isActive:boolean;description:string;specifications:string;
};
export type DesktopCatalogBaseline={version:1;products:Record<string,DesktopPublicProduct>};
export type DesktopCatalogChange=DesktopPublicProduct&{
 changedFields:PublicProductField[];
 previous:DesktopPublicProduct|null;
};
type Raw=Record<string,unknown>;

const object=(value:unknown):Raw=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Raw:{};
const string=(value:unknown)=>value==null?'':String(value);
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const nullableNumber=(value:unknown)=>value==null?null:Number(value);
function attributes(value:unknown):Record<string,string>{
 return Object.fromEntries(Object.entries(object(value)).filter((entry):entry is [string,string]=>typeof entry[1]==='string').sort(([a],[b])=>compare(a,b)));
}

/** Project raw database/editor rows without ever spreading private columns. */
export function normalizeDesktopPublicProduct(value:unknown):DesktopPublicProduct{
 const row=object(value);
 const options=(Array.isArray(row.options)?row.options:[]).map(value=>{
  const option=object(value);
  return {
   label:string(option.label),size:string(option.size),color:string(option.color),kind:string(option.kind),
   image:string(option.image??option.image_url),price:nullableNumber(option.price),
   position:Number(option.position??0),isActive:Boolean(option.isActive??option.is_active??true),
   attributes:attributes(option.attributes),
  };
 }).sort((a,b)=>a.position-b.position||compare(a.label,b.label));
 return {
  id:string(row.id),sku:string(row.sku),name:string(row.name),code:string(row.code??row.public_code),
  category:string(row.category),unit:string(row.unit),price:Number(row.price??row.sale_price??row.salePrice??0),
  discountPrice:nullableNumber(row.discountPrice??row.discount_price),
  image:string(row.image??row.image_url),images:(Array.isArray(row.images)?row.images:[]).filter((url):url is string=>typeof url==='string'),
  options,isActive:row.deleted_at!=null?false:Boolean(row.isActive??row.is_active??true),
  description:string(row.description),specifications:string(row.specifications),
 };
}

/** Each store has an independent baseline; changing store cannot reuse it. */
export function desktopCatalogBaselineKey(url:string){
 return 'desktop_catalog_baseline:'+createHash('sha256').update(new URL(url).origin).digest('hex');
}

function indexProducts(rows:readonly unknown[]){
 const products:Record<string,DesktopPublicProduct>=Object.create(null);
 const skus=new Set<string>();
 for(const value of rows){
  const row=normalizeDesktopPublicProduct(value);
  if(!row.id||Object.hasOwn(products,row.id))throw new Error('Kataloqda məhsul identifikatoru düzgün deyil.');
  if(skus.has(row.sku))throw new Error('Kataloqda təkrar məhsul kodu var.');
  products[row.id]=row;skus.add(row.sku);
 }
 return products;
}

/** Initial pairing is a local bookmark, not permission to republish old rows. */
export function seedDesktopCatalogBaseline(rows:readonly unknown[]):DesktopCatalogBaseline{
 return {version:1,products:indexProducts(rows)};
}

// JSON object key order must not turn attribute reordering into an edit. Array
// order remains significant for image galleries and explicitly ordered choices.
function comparable(value:unknown):unknown{
 if(Array.isArray(value))return value.map(comparable);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>compare(a,b)).map(([key,item])=>[key,comparable(item)]));
 return value;
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(comparable(a))===JSON.stringify(comparable(b));

export function validateDesktopChangedFields(value:unknown):PublicProductField[]{
 if(!Array.isArray(value)||!value.length||value.some(field=>typeof field!=='string'||!(publicProductFields as readonly string[]).includes(field))||new Set(value).size!==value.length)throw new Error('Kataloq dəyişiklik sahələri düzgün deyil.');
 return [...value] as PublicProductField[];
}

/** The previous row is public-only and lets the server merge galleries/options. */
export function buildDesktopCatalogChanges(current:readonly unknown[],baseline:DesktopCatalogBaseline):{catalog:DesktopCatalogChange[]}{
 if(baseline?.version!==1||!baseline.products)throw new Error('Kataloq bağlantısını yenidən yoxlayın.');
 const now=indexProducts(current),catalog:DesktopCatalogChange[]=[];
 for(const row of Object.values(now)){
  const saved=Object.hasOwn(baseline.products,row.id)?baseline.products[row.id]:null;
  const previous=saved?normalizeDesktopPublicProduct(saved):null;
  const changedFields=previous?publicProductFields.filter(field=>!equal(row[field],previous[field])):[...publicProductFields];
  if(changedFields.length)catalog.push({...row,changedFields,previous});
 }
 // A physically absent row is archived publicly, never deleted. Keep it in the
 // baseline so another poll cannot recreate it or repeatedly resend a tombstone.
 for(const [id,saved]of Object.entries(baseline.products)){
  if(Object.hasOwn(now,id))continue;
  const previous=normalizeDesktopPublicProduct(saved);
  if(previous.isActive)catalog.push({...previous,isActive:false,changedFields:['isActive'],previous});
 }
 return {catalog};
}

/**
 * Acknowledge exactly the immutable RAW rows saved with the queued request.
 * Never pass today's database rows or the image-URL-transformed HTTP payload:
 * either would hide mutations made while a request was in flight.
 */
export function mergeDesktopCatalogBaseline(baseline:DesktopCatalogBaseline,queuedCatalog:readonly DesktopCatalogChange[]):DesktopCatalogBaseline{
 if(baseline?.version!==1||!baseline.products)throw new Error('Kataloq bağlantısını yenidən yoxlayın.');
 const products=indexProducts(Object.values(baseline.products));
 for(const item of queuedCatalog){
  const fields=validateDesktopChangedFields(item.changedFields),row=normalizeDesktopPublicProduct(item);
  const saved=Object.hasOwn(products,row.id)?products[row.id]:null;
  if(!saved){products[row.id]=row;continue;}
  const merged:Raw={...saved};
  for(const field of fields)merged[field]=row[field];
  products[row.id]=normalizeDesktopPublicProduct(merged);
 }
 return {version:1,products};
}
