import {notFound,permanentRedirect} from 'next/navigation';
import {productVariantSearchParams,type ProductVariantQuery} from '@/lib/commerce';
import {canonicalVariantSelectionPath} from '@/lib/variant-selection';
import {findProductByCode} from '@/lib/product-route';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;code:string}>;searchParams:Promise<ProductVariantQuery>};
export default async function LegacyProductPage({params,searchParams}:Props){
 const product=await findProductByCode((await params).code);
 if(!product)notFound();
 permanentRedirect(canonicalVariantSelectionPath(product,productVariantSearchParams(await searchParams)));
}
