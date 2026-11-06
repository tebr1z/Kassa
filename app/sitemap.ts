import type {MetadataRoute} from 'next';
import {getPublicCatalog} from '@/lib/public-catalog';
import {productPath} from '@/lib/commerce';
import {absoluteUrl} from '@/lib/seo';
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 if(process.env.BIRKASSA_LOCAL==='1')return [];
 const {products,categories}=await getPublicCatalog();
 return [{url:absoluteUrl('/')},{url:absoluteUrl('/mehsullar')},...categories.filter(c=>products.some(p=>p.category===c.name)).map(c=>({url:absoluteUrl('/categories/'+c.id),images:c.image?[absoluteUrl(c.image)]:[]})),...products.filter(p=>p.code).map(p=>({url:absoluteUrl(productPath(p)),images:(p.images?.length?p.images:[p.image]).filter(Boolean).map(absoluteUrl)}))];
}
