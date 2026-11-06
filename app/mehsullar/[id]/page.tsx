import {notFound,permanentRedirect} from 'next/navigation';
import {productPath} from '@/lib/commerce';
import {findProductById} from '@/lib/product-route';
export const dynamic='force-dynamic';
export default async function ProductIdPage({params}:{params:Promise<{id:string}>}){
 const product=await findProductById((await params).id);
 if(!product||!product.code)notFound();
 permanentRedirect(productPath(product));
}
