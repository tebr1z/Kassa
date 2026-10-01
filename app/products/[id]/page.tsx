import Storefront from "../../storefront";
export default async function ProductPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 return <Storefront productId={id}/>;
}
