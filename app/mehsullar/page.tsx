import Storefront from '../storefront';
import {getPublicCatalog} from '@/lib/public-catalog';
import {absoluteUrl,jsonLd,productDescription,publicMetadata} from '@/lib/seo';
import {productPath} from '@/lib/commerce';
export const dynamic='force-dynamic';
export const metadata=publicMetadata('Məhsullar — restoran və mətbəx ləvazimatları','RestaMarket məhsul kataloqu: restoran, mətbəx və manqal ləvazimatları. Kateqoriya və ölçü üzrə seçim edin, qiymətləri müqayisə edin.','/mehsullar');
export default async function ProductsPage(){
 const catalog=await getPublicCatalog();
 const list={'@context':'https://schema.org','@type':'CollectionPage',name:'RestaMarket məhsulları',url:absoluteUrl('/mehsullar'),mainEntity:{'@type':'ItemList',numberOfItems:catalog.products.length,itemListElement:catalog.products.map((p,index)=>({'@type':'ListItem',position:index+1,url:absoluteUrl(productPath(p)),name:p.name,description:productDescription(p)}))}};
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(list)}}/><Storefront initialCatalog={catalog} catalogPage/></>;
}
