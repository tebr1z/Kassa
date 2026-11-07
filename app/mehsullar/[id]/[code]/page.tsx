import {notFound,permanentRedirect} from 'next/navigation';
import {findProductByCode} from '@/lib/product-route';
import {productPath,productVariantPath,productOptionFromQuery,productVariantSearchParams,type ProductVariantQuery} from '@/lib/commerce';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;code:string}>;searchParams:Promise<ProductVariantQuery>};
export default async function ProductPage({params,searchParams}:Props){
 const {code}=await params;
 const product=await findProductByCode(code);
 if(!product)notFound();
 const selected=productOptionFromQuery(product,productVariantSearchParams(await searchParams));
 permanentRedirect(selected?productVariantPath(product,selected):productPath(product));
}
