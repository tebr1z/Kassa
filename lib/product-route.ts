import "server-only";
import {cache} from "react";
import {getPublicCatalog} from './public-catalog';
export const findProductByCode=cache(async(code:string)=>
 /^\d{6}$/.test(code)?(await getPublicCatalog()).products.find(p=>p.code===code)||null:null,
);
export const findProductById=cache(async(id:string)=>
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ?(await getPublicCatalog()).products.find(p=>p.id===id)||null:null,
);
