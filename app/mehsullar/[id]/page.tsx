import {notFound,permanentRedirect} from 'next/navigation';
import {headers} from 'next/headers';
import Storefront from '@/app/storefront';
import {getPublicCatalog} from '@/lib/public-catalog';
import {productPath,productVariantSearchParams,type ProductVariantQuery} from '@/lib/commerce';
import {variantSelection} from '@/lib/variant-selection';
import {findProductForPath} from '@/lib/product-route';
import {jsonLd,productMetadata,productStructuredData} from '@/lib/seo';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string}>;searchParams:Promise<ProductVariantQuery>};
export async function generateMetadata({params}:Props){
 const product=await findProductForPath((await params).id);
 if(!product)notFound();
 return productMetadata(product);
}
export default async function ProductIdPage({params,searchParams}:Props){
 const {id}=await params;
 const product=await findProductForPath(id);
 if(!product||!product.code)notFound();
 const selection=variantSelection(product,productVariantSearchParams(await searchParams));
 const canonical=productPath(product);
 if((await headers()).get('x-restamarket-product-pathname')!==canonical)permanentRedirect(selection.path);
 const catalog=await getPublicCatalog();
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(productStructuredData(product))}}/><Storefront productId={product.code} initialCatalog={catalog} initialOptionId={selection.selectedOption?.id}/></>;
}
