import {notFound,permanentRedirect} from "next/navigation";
import {productVariantSearchParams,type ProductVariantQuery} from "@/lib/commerce";
import {canonicalVariantSelectionPath} from '@/lib/variant-selection';
import {findProductForPath} from "@/lib/product-route";

export const dynamic="force-dynamic";

export default async function ProductPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<ProductVariantQuery>}){
 const {id}=await params;
 const product=await findProductForPath(id);
 if(!product)notFound();
 permanentRedirect(canonicalVariantSelectionPath(product,productVariantSearchParams(await searchParams)));
}
