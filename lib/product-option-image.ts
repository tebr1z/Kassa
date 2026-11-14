import {z} from 'zod';

// Variant photos are never arbitrary network/file URLs. Validation performs no fetch.
export function isProductOptionImage(value:unknown):value is string{
 if(typeof value!=='string')return false;
 if(value==='')return true;
 if(value.length>2048||/[\s\\\u0000-\u001f\u007f]/.test(value))return false;
 if(/^\/api\/(?:catalog|desktop)-media\/[a-f0-9]{64}$/.test(value))return true;
 if(!value.startsWith('https://res.cloudinary.com/'))return false;
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='res.cloudinary.com'&&!url.username&&!url.password&&!url.port;}catch{return false;}
}
export const productOptionImageInput=z.string().max(2048).refine(isProductOptionImage,'Seçim şəkli düzgün deyil.');
