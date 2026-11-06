import {notFound,permanentRedirect} from "next/navigation";
import {productPath} from "@/lib/commerce";
import {findProductById} from "@/lib/product-route";

export const dynamic="force-dynamic";

export default async function ProductPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const product=await findProductById(id);
 if(!product)notFound();
 permanentRedirect(productPath(product));
}
