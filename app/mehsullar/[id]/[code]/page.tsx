import {notFound,permanentRedirect} from 'next/navigation';
import Storefront from '../../../storefront';
import {getPublicCatalog} from '@/lib/public-catalog';
import {findProductByCode} from '@/lib/product-route';
import {productPath,productSlug} from '@/lib/commerce';
import {jsonLd,productMetadata,productStructuredData} from '@/lib/seo';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;code:string}>;searchParams:Promise<{variant?:string|string[]}>};
export async function generateMetadata({params}:Props){
 const product=await findProductByCode((await params).code);
 if(!product)notFound();
 return productMetadata(product);
}
export default async function ProductPage({params,searchParams}:Props){
 const {id,code}=await params;
 const product=await findProductByCode(code);
 if(!product)notFound();
 const variant=(await searchParams).variant;
 const selected=typeof variant==='string'&&product.options.some(o=>o.id===variant)?variant:undefined;
 if(id!==productSlug(product.name))permanentRedirect(productPath(product)+(selected?'?variant='+encodeURIComponent(selected):''));
 const catalog=await getPublicCatalog();
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(productStructuredData(product))}}/><Storefront productId={code} initialCatalog={catalog} initialOptionId={selected}/></>;
}
