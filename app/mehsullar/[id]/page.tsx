import {notFound,permanentRedirect} from 'next/navigation';
import {productPath,productVariantPath,productOptionFromQuery,productVariantSearchParams,type ProductVariantQuery} from '@/lib/commerce';
import {findProductById,findProductBySlug} from '@/lib/product-route';
export const dynamic='force-dynamic';
export default async function ProductIdPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<ProductVariantQuery>}){
 const {id}=await params;
 const product=await findProductById(id)||await findProductBySlug(id);
 if(!product||!product.code)notFound();
 const selected=productOptionFromQuery(product,productVariantSearchParams(await searchParams));
 permanentRedirect(selected?productVariantPath(product,selected):productPath(product));
}
