import {notFound,permanentRedirect} from 'next/navigation';
import {productPath,productVariantPath,productOptionFromQuery,productVariantSearchParams,type ProductVariantQuery} from '@/lib/commerce';
import {findProductByCode} from '@/lib/product-route';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;code:string}>;searchParams:Promise<ProductVariantQuery>};
export default async function LegacyProductPage({params,searchParams}:Props){
 const product=await findProductByCode((await params).code);
 if(!product)notFound();
 const selected=productOptionFromQuery(product,productVariantSearchParams(await searchParams));
 permanentRedirect(selected?productVariantPath(product,selected):productPath(product));
}
