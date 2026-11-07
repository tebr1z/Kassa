import {notFound,permanentRedirect} from 'next/navigation';
import {findProductByCode} from '@/lib/product-route';
import {productVariantSearchParams,type ProductVariantQuery} from '@/lib/commerce';
import {canonicalVariantSelectionPath} from '@/lib/variant-selection';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;code:string}>;searchParams:Promise<ProductVariantQuery>};
export default async function ProductPage({params,searchParams}:Props){
 const {code}=await params;
 const product=await findProductByCode(code);
 if(!product)notFound();
 permanentRedirect(canonicalVariantSelectionPath(product,productVariantSearchParams(await searchParams)));
}
