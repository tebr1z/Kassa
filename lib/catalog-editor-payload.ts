import {serializeVariants,type EditableVariant} from './variant-draft';

// Whitelist the public catalogue fields instead of forwarding a loaded row or
// native form wholesale. Web requests never manufacture private inventory data.
export function catalogEditorPayload(fields:Record<string,unknown>,{local=false,id,options}:{local?:boolean;id?:string;options?:EditableVariant[]}={}){
 return {
  action:'product',...(id?{id}:{}),
  name:String(fields.name||''),sku:String(fields.sku||''),category:String(fields.category||''),unit:String(fields.unit||'ədəd'),
  sale_price:Number(fields.sale_price),description:String(fields.description||''),specifications:String(fields.specifications||''),
  ...(Object.hasOwn(fields,'discount_percent')?{discount_percent:Number(fields.discount_percent)}:{discount_price:fields.discount_price?Number(fields.discount_price):null}),
  is_active:fields.is_active===true||fields.is_active==='on',
  ...(local?{cost_price:Number(fields.cost_price),barcode:String(fields.barcode||'')}:{}),
  ...(options?{options:serializeVariants(options,{includeCosts:local})}:{}),
 };
}
