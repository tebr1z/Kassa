import type {Metadata} from 'next';
import {productPath,productVariantPath,productOptionLabel,type CatalogProduct} from './commerce';
import type {PublicCatalog} from './catalog-types';

export function siteUrl(){
 const value=process.env.SITE_URL||'https://restamarket.az';
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!url.hostname.includes('.')||/^[\d.]+$/.test(url.hostname)||/\.(?:local|localhost|test|invalid)$/.test(url.hostname))throw new Error('SITE_URL must be a public HTTPS origin');
 return url.origin;
}
export const absoluteUrl=(path:string)=>new URL(path,siteUrl()).href;
export function canIndex(host:string|null){
 return process.env.BIRKASSA_LOCAL!=='1'&&process.env.SEO_INDEXING!=='0'&&host?.toLowerCase()===new URL(siteUrl()).host;
}
export const privateRobots={index:false,follow:false,noarchive:true} as const;
export function descriptionText(value:string,max=165){
 const text=value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 if(text.length<=max)return text;
 const end=text.slice(0,max-1),space=end.lastIndexOf(' ');
 return end.slice(0,space>max*0.65?space:end.length)+'…';
}
export function productDescription(product:CatalogProduct){
 return descriptionText(product.description||`${product.name}${product.category?' — '+product.category:''}. Qiymət: ${product.price.toFixed(2)} AZN${product.options.length?' və müxtəlif seçimlər':''}. RestaMarket kataloqunda baxın və onlayn sifariş edin.`);
}
export function publicMetadata(title:string,description:string,path:string,images:string[]=[]):Metadata{
 const pictures=images.filter(Boolean).map(url=>({url:absoluteUrl(url),alt:title}));
 return {title,description,alternates:{canonical:absoluteUrl(path)},openGraph:{title:title+' | RestaMarket',description,url:absoluteUrl(path),siteName:'RestaMarket',locale:'az_AZ',type:'website',images:pictures},twitter:{card:pictures.length?'summary_large_image':'summary',title:title+' | RestaMarket',description,images:pictures.map(p=>p.url)}};
}
export function productMetadata(product:CatalogProduct):Metadata{
 return publicMetadata(`${product.name} — qiymət və sifariş`,productDescription(product),productPath(product),product.images?.length?product.images:[product.image]);
}
// Escaping '<' prevents an administrator-entered description from closing a script tag.
export const jsonLd=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export function productStructuredData(product:CatalogProduct){
 const url=absoluteUrl(productPath(product));
 const description=product.description||productDescription(product);
 const image=(product.images?.length?product.images:[product.image]).filter(Boolean).map(absoluteUrl);
 const common={name:product.name,description,image,category:product.category||undefined};
 const offer=(price:number,target:string)=>({'@type':'Offer',url:target,price:price.toFixed(2),priceCurrency:'AZN',seller:{'@type':'Organization','@id':absoluteUrl('/#organization'),name:'RestaMarket'}});
 const properties=(attributes:Record<string,string>)=>Object.entries(attributes).filter(([,value])=>value).map(([name,value])=>({'@type':'PropertyValue',name,value}));
 const variesBy=[...(product.options.some(o=>o.size)?['https://schema.org/size']:[]),...(product.options.some(o=>o.color)?['https://schema.org/color']:[])];
 // Custom merchant fields remain additionalProperty; Google only supports specific variesBy axes.
 // No made-up ratings, stock quantities, GTINs, shipping or return promises.
 const productNode=product.options.length?{
  '@type':'ProductGroup','@id':url+'#product',...common,url,productGroupID:product.code||product.id,
  variesBy:variesBy.length?variesBy:undefined,
  hasVariant:product.options.map(option=>{
   const target=absoluteUrl(productVariantPath(product,option));
   const label=productOptionLabel(option);
   return {'@type':'Product','@id':target+'#product',name:product.name+' — '+label,description:description+' '+label,image,url:target,sku:(product.code||product.id)+'-'+option.id,size:option.size||undefined,color:option.color||undefined,additionalProperty:properties({...option.attributes,...(option.kind?{'Növ':option.kind}:{})}),offers:offer(option.price??product.basePrice??product.price,target)};
  }),
 }:{'@type':'Product','@id':url+'#product',...common,url,sku:product.code||product.id,offers:offer(product.price,url)};
 return {'@context':'https://schema.org','@graph':[productNode,{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Ana səhifə',item:absoluteUrl('/')},{'@type':'ListItem',position:2,name:'Məhsullar',item:absoluteUrl('/mehsullar')},{'@type':'ListItem',position:3,name:product.name,item:url}]}]};
}
export function organizationStructuredData(catalog:PublicCatalog){
 const brand=catalog.brand;
 return {'@context':'https://schema.org','@graph':[{'@type':'Organization','@id':absoluteUrl('/#organization'),name:'RestaMarket',url:absoluteUrl('/'),logo:absoluteUrl(brand?.logo||'/restamarket-apple.png'),telephone:brand?.phone||undefined,address:brand?.address||undefined},{'@type':'WebSite','@id':absoluteUrl('/#website'),name:'RestaMarket',url:absoluteUrl('/'),inLanguage:'az',publisher:{'@id':absoluteUrl('/#organization')}}]};
}
