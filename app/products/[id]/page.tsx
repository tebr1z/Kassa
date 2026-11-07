import {notFound,permanentRedirect} from "next/navigation";
import {productPath,productVariantPath,productOptionFromQuery,productVariantSearchParams,type ProductVariantQuery} from "@/lib/commerce";
import {findProductById} from "@/lib/product-route";

export const dynamic="force-dynamic";

export default async function ProductPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<ProductVariantQuery>}){
 const {id}=await params;
 const product=await findProductById(id);
 if(!product)notFound();
 const selected=productOptionFromQuery(product,productVariantSearchParams(await searchParams));
 permanentRedirect(selected?productVariantPath(product,selected):productPath(product));
}
