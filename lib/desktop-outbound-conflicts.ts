import type {DesktopCatalogChange,PublicProductField} from './desktop-catalog-delta';

// Type-only imports keep this policy usable without the sender, database or
// crypto runtime. The exhaustive record makes new public fields a compile error
// until their outbound conflict handling is deliberately included here.
const publicFields={
 sku:true,name:true,code:true,category:true,unit:true,price:true,
 discountPrice:true,image:true,images:true,options:true,isActive:true,
 description:true,specifications:true,
} satisfies Record<PublicProductField,true>;
type Hold=Set<PublicProductField>|null;
const publicField=(value:unknown):value is PublicProductField=>typeof value==='string'&&Object.hasOwn(publicFields,value);

function holdFor(value:unknown,emptyMeansAll:boolean):Hold{
 if(!Array.isArray(value)||(emptyMeansAll&&!value.length)||value.some(field=>!publicField(field)))return null;
 return new Set(value as PublicProductField[]);
}
function addHold(index:Map<string,Hold>,id:unknown,hold:Hold){
 if(typeof id!=='string'||!id)return;
 if(!index.has(id)){index.set(id,hold===null?null:new Set(hold));return;}
 const previous=index.get(id);
 if(previous==null||hold===null){index.set(id,null);return;}
 for(const field of hold)previous.add(field);
}

/**
 * Prevent a locally retained web conflict from being republished as a local
 * edit. Apply only before creating a new outbox entry, never to queued payloads.
 * A null hold means all public fields; [] mappings explicitly mean no conflict.
 * Unknown metadata must not accidentally permit an archive/SKU overwrite.
 * Inputs are already projected public DTOs: snapshot and field values remain
 * byte-for-byte untouched, including references used by baseline acknowledgement.
 */
export function filterDesktopOutboundChanges(
 changes:DesktopCatalogChange[],
 mappings:{local_product_id:string;conflicts:unknown}[],
 errors:{id?:string;sku?:string;fields?:string[]}[]=[],
):DesktopCatalogChange[]{
 const products=new Map<string,Hold>(),errorIds=new Map<string,Hold>(),errorSkus=new Map<string,Hold>();
 for(const row of mappings)addHold(products,row.local_product_id,holdFor(row.conflicts,false));
 for(const row of errors){
  const hold=holdFor(row.fields,true);
  addHold(errorIds,row.id,hold);addHold(errorSkus,row.sku,hold);
 }
 const result:DesktopCatalogChange[]=[];
 for(const change of changes){
  const holds:Hold[]=[];
  for(const [index,id] of [[products,change.id],[errorIds,change.id],[errorSkus,change.sku],[errorSkus,change.previous?.sku]] as const){
   if(typeof id==='string'&&index.has(id))holds.push(index.get(id)??null);
  }
  if(holds.includes(null))continue;
  const changedFields=change.changedFields.filter(field=>publicField(field)&&!holds.some(hold=>hold===null||hold.has(field)));
  if(changedFields.length)result.push({...change,changedFields});
 }
 return result;
}
