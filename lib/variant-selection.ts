import {catalogTextLower,productOptionFromQuery,productPath,productVariantKeys,productVariantPath,productVariantSlug,type CatalogProduct,type ProductOption} from './commerce';

type VariantProduct=Pick<CatalogProduct,'id'|'name'|'code'|'options'>;
type Query={get:(key:string)=>string|null;getAll:(key:string)=>string[]};
type DimensionKey='reng'|'olcu'|'nov';
type Dimension={key:DimensionKey;field:'color'|'size'|'kind';label:string};
export type VariantChoice={value:string;label:string;href:string;selected:boolean};
export type VariantGroup={key:DimensionKey;label:string;choices:VariantChoice[];enabled:boolean;selectedValue?:string};
export type VariantSelectionState={groups:VariantGroup[];selectedOption?:ProductOption;remainingOptions:ProductOption[];showRemainingOptions:boolean;candidates:ProductOption[];valid:boolean;path:string};
const dimensions:Dimension[]=[{key:'reng',field:'color',label:'Rəng'},{key:'olcu',field:'size',label:'Ölçü'},{key:'nov',field:'kind',label:'Növ'}];
const slug=(value:string)=>productVariantSlug(value.trim());

// Inconsistent legacy fields and unrepresentable/colliding values retain an
// explicit exact-option fallback. Never infer dimensions from a free-text name.
function groupable(product:VariantProduct,dimension:Dimension){
 const values=new Map<string,string>();
 for(const option of product.options){
  const value=option[dimension.field]?.trim()||'',token=slug(value);
  if(!value||!token)return false;
  const spelling=catalogTextLower(value.normalize('NFC'));
  if(values.has(token)&&values.get(token)!==spelling)return false;
  values.set(token,spelling);
 }
 return product.options.length>0;
}

function paramsFor(values:Partial<Record<DimensionKey,string>>){
 const params=new URLSearchParams();
 // Keep the existing canonical URL order, independently of color-first UI order.
 for(const key of ['olcu','reng','nov'] as const)if(values[key])params.set(key,values[key]!);
 return params;
}
function completeOption(product:VariantProduct,query:Query){
 const option=productOptionFromQuery(product,query);
 if(!option)return undefined;
 if(query.get('variant'))return option; // Validated exact legacy ID, not a guess.
 const canonical=new URL(productVariantPath(product,option),'https://variant.invalid').searchParams;
 return [...canonical].every(([key,value])=>query.get(key)!==null&&slug(query.get(key)||'')===value)?option:undefined;
}
function pathFor(product:VariantProduct,values:Partial<Record<DimensionKey,string>>){
 const params=paramsFor(values),exact=completeOption(product,params);
 return exact?productVariantPath(product,exact):productPath(product)+(params.size?'?'+params.toString():'');
}

export function variantSelection(product:VariantProduct,query:Query):VariantSelectionState{
 const specs=dimensions.filter(dimension=>groupable(product,dimension));
 let valid=!productVariantKeys.some(key=>query.getAll(key).length>1);
 let selectedOption=valid?completeOption(product,query):undefined;
 const supplied=new Map<DimensionKey,string>();
 if(valid){
  for(const dimension of dimensions){
   const raw=query.get(dimension.key);
   if(raw===null)continue;
   const value=slug(raw);
   if(!value||!product.options.some(option=>slug(option[dimension.field]||'')===value)){valid=false;break;}
   supplied.set(dimension.key,value);
  }
  if((query.get('variant')!==null||query.get('secim')!==null)&&!selectedOption)valid=false;
  if(valid&&supplied.size&&!product.options.some(option=>dimensions.every(dimension=>!supplied.has(dimension.key)||slug(option[dimension.field]||'')===supplied.get(dimension.key))))valid=false;
  if(valid&&!selectedOption){
   // Only a valid leading dimension sequence represents a partial UI state.
   let missing=false;
   for(const dimension of specs){if(!supplied.has(dimension.key))missing=true;else if(missing)valid=false;}
   if([...supplied.keys()].some(key=>!specs.some(dimension=>dimension.key===key)))valid=false;
  }
 }
 if(!valid)selectedOption=undefined;
 let candidates=product.options,enabled=true;
 const prefix:Partial<Record<DimensionKey,string>>={};
 const groups:VariantGroup[]=specs.map(dimension=>{
  const selectedValue=valid?(selectedOption?slug(selectedOption[dimension.field]):enabled?supplied.get(dimension.key):undefined):undefined;
  const labels=new Map<string,string>();
  if(enabled)for(const option of candidates){const value=option[dimension.field].trim();if(!labels.has(slug(value)))labels.set(slug(value),value);}
  const choices=[...labels].map(([value,label])=>({value,label,selected:value===selectedValue,href:pathFor(product,{...prefix,[dimension.key]:value})}));
  const group:VariantGroup={key:dimension.key,label:dimension.label,choices,enabled,selectedValue};
  if(selectedValue){prefix[dimension.key]=selectedValue;candidates=candidates.filter(option=>slug(option[dimension.field])===selectedValue);}else enabled=false;
  return group;
 });
 const allChosen=groups.every(group=>Boolean(group.selectedValue));
 return {groups,selectedOption,remainingOptions:candidates,showRemainingOptions:product.options.length>0&&(groups.length===0||(allChosen&&(!selectedOption||candidates.length>1))),candidates,valid,path:selectedOption?productVariantPath(product,selectedOption):valid?pathFor(product,prefix):productPath(product)};
}

// Redirect aliases without losing a valid color-only/size-stage selection.
export function canonicalVariantSelectionPath(product:VariantProduct,query:Query){
 return variantSelection(product,query).path;
}
