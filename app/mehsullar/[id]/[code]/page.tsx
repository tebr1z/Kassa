import {notFound,permanentRedirect} from 'next/navigation';
import Storefront from '../../../storefront';
import {getPublicCatalog} from '@/lib/public-catalog';
import {findProductByCode} from '@/lib/product-route';
import {productPath,productSlug,productVariantPath,productOptionFromQuery,productVariantSearchParams,type ProductVariantQuery} from '@/lib/commerce';
import {jsonLd,productMetadata,productStructuredData} from '@/lib/seo';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;code:string}>;searchParams:Promise<ProductVariantQuery>};
export async function generateMetadata({params}:Props){
 const product=await findProductByCode((await params).code);
 if(!product)notFound();
 return productMetadata(product);
}
export default async function ProductPage({params,searchParams}:Props){
 const {id,code}=await params;
 const product=await findProductByCode(code);
 if(!product)notFound();
 const selected=productOptionFromQuery(product,productVariantSearchParams(await searchParams));
 if(id!==productSlug(product.name))permanentRedirect(selected?productVariantPath(product,selected):productPath(product));
 const catalog=await getPublicCatalog();
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(productStructuredData(product))}}/><Storefront productId={code} initialCatalog={catalog} initialOptionId={selected?.id}/></>;
}
