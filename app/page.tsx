import Storefront from "./storefront";
import {getPublicCatalog} from '@/lib/public-catalog';
import {jsonLd,organizationStructuredData,publicMetadata} from '@/lib/seo';
export const dynamic='force-dynamic';
export const metadata=publicMetadata('Restoran və mətbəx ləvazimatları','Restoran və mətbəx ləvazimatları RestaMarket-də. Məhsulları, ölçüləri və qiymətləri müqayisə edin, onlayn sifariş edin.','/');
export default async function Page(){
 const catalog=await getPublicCatalog();
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(organizationStructuredData(catalog))}}/><Storefront initialCatalog={catalog}/></>;
}
