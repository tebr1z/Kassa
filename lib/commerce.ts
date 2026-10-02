export function sellingPrice(product:{sale_price:unknown;discount_price?:unknown}) {
 const regular=Number(product.sale_price), discount=Number(product.discount_price);
 return discount>0&&discount<regular?discount:regular;
}
export function couponDiscount(subtotal:number,percent:number,maxDiscount?:number|null){
 const amount=Math.round(subtotal*percent)/100;
 if(maxDiscount==null||!(maxDiscount>0))return amount;
 return Math.min(amount,Number(maxDiscount.toFixed(2)));
}
export type CatalogProduct={id:string;name:string;category:string;unit:string;price:number;originalPrice:number;image:string;available:boolean;description:string;specifications:string};
export function productModel(name:string){
 const cleaned=name.replace(/\s{2,}/g," ").trim();
 const model=cleaned.replace(/\s+\d+(?:[.,]\d+)?\s*(?:sm|mm|ml|l|q|qr|kg)\b.*$/i,"").replace(/-\d+\s*(?:sm|mm)?$/i,"").replace(/\s+\d+-lük$/i,"").trim();
 return model||cleaned;
}
const searchFold:Record<string,string>={ə:"e",ı:"i",ö:"o",ü:"u",ş:"s",ç:"c",ğ:"g",q:"g",â:"a",î:"i",û:"u"};
export function foldSearch(value:string){
 return [...value.toLocaleLowerCase("az")].map(ch=>searchFold[ch]||ch).join("").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function editDistance(a:string,b:string){
 if(a===b)return 0;
 if(Math.abs(a.length-b.length)>2)return 3;
 const row=Array.from({length:b.length+1},(_,index)=>index);
 for(let i=1;i<=a.length;i++){
  let previous=row[0];
  row[0]=i;
  let best=row[0];
  for(let j=1;j<=b.length;j++){
   const current=row[j];
   row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));
   previous=current;
   if(row[j]<best)best=row[j];
  }
  if(best>2)return 3;
 }
 return row[b.length];
}
function tokenNear(query:string,word:string){
 if(word===query||word.startsWith(query)||(query.length>2&&word.includes(query)))return true;
 if(query.length<3||word.length<3)return false;
 const limit=query.length>=4?2:1;
 return editDistance(query,word)<=limit||(word.length>query.length&&editDistance(query,word.slice(0,query.length+1))<=limit);
}
export function productSearchScore(product:{name:string;category?:string},query:string){
 const needle=foldSearch(query);
 if(!needle)return 0;
 const name=foldSearch(product.name);
 const model=foldSearch(productModel(product.name));
 const category=foldSearch(product.category||"");
 const hay=`${name} ${model} ${category}`;
 if(hay.includes(needle))return 120-Math.min(40,hay.indexOf(needle));
 const tokens=needle.split(" ").filter(Boolean);
 const words=hay.split(" ").filter(word=>word.length>0);
 let score=0;
 for(const token of tokens){
  if(/^\d+$/.test(token)){
   if(!words.some(word=>word.includes(token)))return 0;
   score+=24;
   continue;
  }
  if(!words.some(word=>tokenNear(token,word)))return 0;
  score+=words.some(word=>word===token||word.startsWith(token))?36:16;
 }
 return score;
}
export function relatedProducts(product:CatalogProduct,products:CatalogProduct[]){
 const words=new Set(product.name.toLocaleLowerCase("az").split(/\s+/).filter(w=>w.length>2));
 const score=(p:CatalogProduct)=>(p.category&&p.category===product.category?10:0)+p.name.toLocaleLowerCase("az").split(/\s+/).filter(w=>words.has(w)).length*3+1/(1+Math.abs(p.price-product.price));
 return products.filter(p=>p.id!==product.id&&p.available).sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name)).slice(0,4);
}
export type HeroSlide={id:string;productId:string|null;heading:string;badge:string;description:string};
