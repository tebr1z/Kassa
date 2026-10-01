export function sellingPrice(product:{sale_price:unknown;discount_price?:unknown}) {
 const regular=Number(product.sale_price), discount=Number(product.discount_price);
 return discount>0&&discount<regular?discount:regular;
}
export function couponDiscount(subtotal:number,percent:number){return Math.round(subtotal*percent)/100;}
export type CatalogProduct={id:string;name:string;category:string;unit:string;price:number;originalPrice:number;image:string;available:boolean;description:string;specifications:string};
export function relatedProducts(product:CatalogProduct,products:CatalogProduct[]){
 const words=new Set(product.name.toLocaleLowerCase("az").split(/\s+/).filter(w=>w.length>2));
 const score=(p:CatalogProduct)=>(p.category&&p.category===product.category?10:0)+p.name.toLocaleLowerCase("az").split(/\s+/).filter(w=>words.has(w)).length*3+1/(1+Math.abs(p.price-product.price));
 return products.filter(p=>p.id!==product.id&&p.available).sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name)).slice(0,4);
}
export type HeroSlide={id:string;productId:string|null;heading:string;badge:string;description:string};
