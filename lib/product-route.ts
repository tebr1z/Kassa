import "server-only";
import {cache} from "react";
import {getPublicCatalog} from './public-catalog';
import {productSlug} from './commerce';
export const findProductByCode=cache(async(code:string)=>
 /^\d{6}$/.test(code)?(await getPublicCatalog()).products.find(p=>p.code===code)||null:null,
);
export const findProductById=cache(async(id:string)=>
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ?(await getPublicCatalog()).products.find(p=>p.id===id)||null:null,
);
export const findProductBySlug=cache(async(slug:string)=>{
 if(slug.length>250||!/^[\p{L}\p{N}-]+$/u.test(slug))return null;
 // Accept old hand-written 30sm links as well as the canonical 30-sm spelling.
 const normalize=(value:string)=>value.toLowerCase().replace(/(\d)-(sm|cm|mm|ml|kg|qr|q|l)\b/g,'$1$2');
 const matches=(await getPublicCatalog()).products.filter(product=>normalize(productSlug(product.name))===normalize(slug));
 return matches.length===1?matches[0]:null;
});
