import {notFound} from 'next/navigation';
import Storefront from '../../storefront';
import {getPublicCatalog} from '@/lib/public-catalog';
import {absoluteUrl,jsonLd,privateRobots,publicMetadata} from '@/lib/seo';
import {productPath} from '@/lib/commerce';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string}>};
export async function generateMetadata({params}:Props){
 const {id}=await params;
 const {categories,products}=await getPublicCatalog();
 const category=categories.find(c=>c.id===id);
 if(!category)notFound();
 return {...publicMetadata(category.name+' — məhsullar və qiymətlər',category.name+' məhsullarına və qiymətlərinə RestaMarket-də baxın. Seçimləri müqayisə edib onlayn sifariş edin.','/categories/'+id,category.image?[category.image]:[]),...(!products.some(p=>p.category===category.name)?{robots:privateRobots}:{})};
}
export default async function CategoryPage({params}:Props){
 const {id}=await params,catalog=await getPublicCatalog();
 const category=catalog.categories.find(c=>c.id===id);
 if(!category)notFound();
 const list={'@context':'https://schema.org','@type':'CollectionPage',name:category.name,url:absoluteUrl('/categories/'+id),mainEntity:{'@type':'ItemList',itemListElement:catalog.products.filter(p=>p.category===category.name).map((p,index)=>({'@type':'ListItem',position:index+1,name:p.name,url:absoluteUrl(productPath(p))}))}};
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(list)}}/><Storefront categoryId={id} initialCatalog={catalog}/></>;
}
