import {notFound,permanentRedirect} from 'next/navigation';
import {productPath} from '@/lib/commerce';
import {findProductByCode} from '@/lib/product-route';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;code:string}>;searchParams:Promise<{variant?:string|string[]}>};
export default async function LegacyProductPage({params,searchParams}:Props){
 const product=await findProductByCode((await params).code);
 if(!product)notFound();
 const variant=(await searchParams).variant;
 const selected=typeof variant==='string'&&product.options.some(o=>o.id===variant)?variant:undefined;
 permanentRedirect(productPath(product)+(selected?'?variant='+encodeURIComponent(selected):''));
}
