export function sellingPrice(product:{sale_price:unknown;discount_price?:unknown}) {
 const regular=Number(product.sale_price), discount=Number(product.discount_price);
 return discount>0&&discount<regular?discount:regular;
}
export function catalogPricing(product:{sale_price:unknown;discount_price?:unknown},options:{price?:string|number|null}[]=[]){
 const basePrice=sellingPrice(product),baseOriginalPrice=Number(product.sale_price);
 const cheapest=options.length?[...options].sort((a,b)=>Number(a.price??basePrice)-Number(b.price??basePrice))[0]:null;
 return {price:Number(cheapest?.price??basePrice),originalPrice:cheapest?.price!=null?Number(cheapest.price):baseOriginalPrice,basePrice,baseOriginalPrice};
}
export function couponDiscount(subtotal:number,percent:number,maxDiscount?:number|null){
 const amount=Math.round(subtotal*percent)/100;
 if(maxDiscount==null||!(maxDiscount>0))return amount;
 return Math.min(amount,Number(maxDiscount.toFixed(2)));
}
export type ProductOption={id:string;label:string;size:string;color:string;kind:string;price:number|null;attributes?:Record<string,string>};
export type CatalogProduct={id:string;code?:string;name:string;category:string;unit:string;price:number;originalPrice:number;basePrice?:number;baseOriginalPrice?:number;image:string;images?:string[];available:boolean;description:string;specifications:string;options:ProductOption[]};
export const catalogTextLower=(value:string)=>value.replace(/I/g,'ı').replace(/İ/g,'i').toLowerCase();
const catalogAlphabet='abcçdeəfgğhxıijkqlmnoöprsştuüvyz';
// Explicit Azerbaijani ordering avoids SSR/browser ICU fallback differences.
export function compareCatalogNames(left:string,right:string){
 const a=[...catalogTextLower(left.normalize('NFC'))],b=[...catalogTextLower(right.normalize('NFC'))];
 const weight=(letter:string)=>{const index=catalogAlphabet.indexOf(letter);return index<0?letter.codePointAt(0)!:256+index;};
 for(let index=0;index<Math.min(a.length,b.length);index++){const difference=weight(a[index])-weight(b[index]);if(difference)return difference;}
 if(a.length!==b.length)return a.length-b.length;
 return left<right?-1:left>right?1:0;
}
const slugLetters:Record<string,string>={ə:"e",Ə:"E",ı:"i",İ:"I",ö:"o",Ö:"O",ü:"u",Ü:"U",ş:"s",Ş:"S",ç:"c",Ç:"C",ğ:"g",Ğ:"G"};
export function productSlug(name:string){
 const folded=[...name].map(ch=>slugLetters[ch]??ch).join("");
 return folded.replace(/[^0-9A-Za-z]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase()||"mehsul";
}
export function productPath(product:{id:string;name:string;code?:string}){
 return product.code&&/^\d{6}$/.test(product.code)?`/mehsullar/${product.code}-${productSlug(product.name)}/`:`/mehsullar/${product.id}`;
}
export type ProductVariantQuery=Record<string,string|string[]|undefined>;
export const productVariantKeys=['olcu','reng','nov','secim','variant'] as const;
type VariantProduct={id:string;name:string;code?:string;options:ProductOption[]};
type VariantSearch={get:(name:string)=>string|null;getAll:(name:string)=>string[]};
export function productVariantSearchParams(query:ProductVariantQuery){
 const result=new URLSearchParams();
 for(const key of productVariantKeys){const value=query[key];for(const entry of Array.isArray(value)?value:value===undefined?[]:[value])result.append(key,entry);}
 return result;
}
export function productVariantSlug(value:string){
 const folded=[...value].map(ch=>slugLetters[ch]??ch).join('').normalize('NFKD').replace(/\p{M}/gu,'');
 return folded.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');
}
// A single concise label replaces the old label + repeated size/colour details.
export function productOptionLabel(option:ProductOption){
 const parts=[option.label.trim()].filter(Boolean);
 const normalized=(value:string)=>foldSearch(value).replace(/(\d)\s+(sm|cm|mm|ml|kg|qr|q|l)\b/g,'$1$2');
 for(const value of [option.size,option.color,option.kind,...Object.entries(option.attributes||{}).map(([key,value])=>`${key}: ${value}`)]){
  if(value?.trim()&&!(` ${normalized(parts.join(' '))} `).includes(` ${normalized(value)} `))parts.push(value.trim());
 }
 return parts.join(' · ');
}
function variantDimensions(option:ProductOption){
 const query=new URLSearchParams();
 for(const [key,value] of [['olcu',option.size],['reng',option.color],['nov',option.kind]])if(value?.trim()&&productVariantSlug(value))query.set(key,productVariantSlug(value));
 return query;
}
function variantToken(product:VariantProduct,option:ProductOption){
 const label=productVariantSlug(productOptionLabel(option))||'secim';
 return product.options.some(other=>other.id!==option.id&&(productVariantSlug(productOptionLabel(other))||'secim')===label)?label+'-'+productVariantSlug(option.id):label;
}
export function productVariantPath(product:VariantProduct,option:ProductOption){
 const query=variantDimensions(option),dimensions=query.toString();
 // Missing/unrepresentable fields can make this URL a prefix of another
 // option's dimensions. Disambiguate every option matching the emitted params,
 // not only options whose complete dimension maps happen to be identical.
 const ambiguous=product.options.filter(other=>{const candidate=variantDimensions(other);return [...query].every(([key,value])=>candidate.get(key)===value);}).length>1;
 if(!dimensions||ambiguous||Object.keys(option.attributes||{}).length)query.set('secim',variantToken(product,option));
 return productPath(product)+'?'+query.toString();
}
export function productOptionFromQuery(product:VariantProduct,query:VariantSearch){
 if(productVariantKeys.some(key=>query.getAll(key).length>1))return undefined;
 const readable=['olcu','reng','nov','secim'].filter(key=>query.get(key)!==null);
 if(!readable.length){const id=query.get('variant');return product.options.find(option=>option.id===id);}
 const candidates=product.options.filter(option=>readable.every(key=>{
  const expected=key==='secim'?variantToken(product,option):variantDimensions(option).get(key);
  return Boolean(expected)&&productVariantSlug(query.get(key)||'')===expected;
 }));
 const selected=candidates.length===1?candidates[0]:undefined;
 return selected&&(!query.get('variant')||query.get('variant')===selected.id)?selected:undefined;
}
export function productModel(name:string){
 const cleaned=name.replace(/\s{2,}/g," ").trim();
 const model=cleaned.replace(/\s+\d+(?:[.,]\d+)?\s*(?:sm|mm|ml|l|q|qr|kg)\b.*$/i,"").replace(/-\d+\s*(?:sm|mm)?$/i,"").replace(/\s+\d+-lük$/i,"").trim();
 return model||cleaned;
}
const searchFold:Record<string,string>={ə:"e",ı:"i",ö:"o",ü:"u",ş:"s",ç:"c",ğ:"g",q:"g",â:"a",î:"i",û:"u"};
export function foldSearch(value:string){
 return [...catalogTextLower(value.normalize("NFKC"))].map(ch=>searchFold[ch]||ch).join("").replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();
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
export function labelMatches(label:string,query:string){
 const needle=foldSearch(query);
 if(!needle)return true;
 const hay=foldSearch(label);
 if(hay.includes(needle))return true;
 const words=hay.split(" ").filter(Boolean);
 return needle.split(" ").filter(Boolean).every(token=>words.some(word=>tokenNear(token,word)));
}
export function relatedProducts(product:CatalogProduct,products:CatalogProduct[]){
 const words=new Set(catalogTextLower(product.name).split(/\s+/).filter(w=>w.length>2));
 const score=(p:CatalogProduct)=>(p.category&&p.category===product.category?10:0)+catalogTextLower(p.name).split(/\s+/).filter(w=>words.has(w)).length*3+1/(1+Math.abs(p.price-product.price));
 return products.filter(p=>p.id!==product.id&&p.available).sort((a,b)=>score(b)-score(a)||compareCatalogNames(a.name,b.name)).slice(0,4);
}
export type HeroSlide={id:string;productId:string|null;heading:string;badge:string;description:string};
