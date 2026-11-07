"use client";
import {useTranslations,languageAmount,LanguageSwitcher} from "@/lib/language";
import ProductPrice from "./product-price";
import {hasProductDiscount,productDiscountLabel} from '@/lib/product-discount';
import {optionDetails} from "@/lib/product-options";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from "react";
import {ArrowLeft,ArrowRight,Check,MapPin,Package,Search,ShoppingBag,Store,Truck,UserRound} from "lucide-react";
import {labelMatches,productModel,productPath,productSearchScore,compareCatalogNames,type CatalogProduct,type HeroSlide} from "@/lib/commerce";
import {cartKey,parseCartKey,readCart,saveCart,type CustomerCart} from "@/lib/storefront-cart";
import ProductView from "./product-view";
import HeroSlider from "./hero-slider";
import CartSheet from "./cart-sheet";
import {BrandLogo} from "./brand-logo";
import {ContactBox,WhatsAppButton} from "./commerce-ui";
import "./storefront-v2.css";
import type {PublicCatalog} from '@/lib/catalog-types';

type Brand={name:string;kind:string;description:string;about:string;logo:string;phone:string;address:string;whatsapp:string;featuredProductId:string|null};
type ShowcaseCategory={id:string;name:string;image:string};
export type Customer={id:string;name:string;phone:string;address?:string}|null;
export const money=(value:number)=>languageAmount(value);
function ProductCard({product,inCart,onAdd,onOpen,pinned=false}:{product:CatalogProduct;inCart:number;onAdd:()=>void;onOpen:()=>void;pinned?:boolean}){const {t,languageAmount}=useTranslations();const discounted=hasProductDiscount(product.price,product.originalPrice);
 return <article className={discounted?"sf-product is-discounted":"sf-product"}><Link className="sf-product-image" href={productPath(product)}>{product.image?<img src={product.image} alt={product.name} loading="lazy"/>:<Package size={56}/>}<span className="sf-category-tag">{product.category||t("Digər")}</span>{pinned&&<span className="sf-pin-tag">{t("Seçilmiş")}</span>}{discounted&&<span className="sf-sale-tag"><span>{t("Endirim")}</span><strong>{productDiscountLabel(product.price,product.originalPrice,languageAmount)||t("Sərfəli qiymət")}</strong></span>}</Link><div className="sf-product-copy"><span className="sf-product-meta"><i/> {productModel(product.name)}</span><h3><Link href={productPath(product)}>{product.name}</Link></h3><div className="sf-card-bottom"><ProductPrice price={product.price} originalPrice={product.originalPrice} compact/><button className={inCart?"sf-add is-added":"sf-add"} onClick={()=>inCart?onOpen():onAdd()}>{inCart?<><Check size={15}/> {t("Səbətdə")} · {inCart}</>:t("Səbətə əlavə et")}</button></div></div></article>;
}
function SearchField({products,query,onQuery}:{products:CatalogProduct[];query:string;onQuery:(value:string)=>void}){const {t,languageAmount:money}=useTranslations();
 const root=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false);
 const matches=query.trim()?[...products].map(product=>({product,score:productSearchScore(product,query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||compareCatalogNames(a.product.name,b.product.name)).slice(0,6):[];
 useEffect(()=>{
  if(!open)return;
  function outside(event:MouseEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  function onKey(event:KeyboardEvent){if(event.key==="Escape")setOpen(false);}
  document.addEventListener("mousedown",outside);
  document.addEventListener("keydown",onKey);
  return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",onKey);};
 },[open]);
 return <div className="sf-search-wrap" ref={root}>
  <label className="sf-search sf-search-wide"><Search size={18}/><input aria-label={t("Məhsul axtar")} aria-expanded={open&&matches.length>0} aria-controls="search-results" placeholder={t("Məhsul axtarın")} value={query} onChange={e=>{onQuery(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)}/>{query&&<button type="button" aria-label={t("Axtarışı təmizlə")} onClick={()=>{onQuery("");setOpen(false);}}>×</button>}</label>
  {open&&!!matches.length&&<ul id="search-results" className="sf-search-results" aria-label={t("Axtarış nəticələri")}>{matches.map(({product})=> <li key={product.id}><Link href={productPath(product)} onClick={()=>setOpen(false)}><span className="sf-search-thumb">{product.image?<img src={product.image} alt=""/>:<Package size={22}/>}</span><span><strong>{product.name}</strong><small>{product.category||t("Digər")} · {productModel(product.name)}</small></span><b>{money(product.price)} AZN</b></Link></li>)}</ul>}
 </div>;
}
function OptionMenu({label,value,options,open,searchable=false,onToggle,onClose,onChange}:{label:string;value:string;options:string[];open:boolean;searchable?:boolean;onToggle:()=>void;onClose:()=>void;onChange:(value:string)=>void}){const {t}=useTranslations();
 const root=useRef<HTMLDivElement>(null),inputRef=useRef<HTMLInputElement>(null),listRef=useRef<HTMLUListElement>(null);
 const [filter,setFilter]=useState(""),[active,setActive]=useState(0);
 const shown=searchable&&filter.trim()?options.filter(item=>item!=="Hamısı"&&labelMatches(item,filter)):options;
 useEffect(()=>{if(!open){setFilter("");setActive(0);return;}if(searchable){const frame=requestAnimationFrame(()=>inputRef.current?.focus());return()=>cancelAnimationFrame(frame);}},[open,searchable]);
 useEffect(()=>{listRef.current?.querySelector<HTMLButtonElement>("[data-active='true']")?.scrollIntoView({block:"nearest"});},[active,filter,open]);
 useEffect(()=>{
  if(!open)return;
  function outside(event:MouseEvent){if(!root.current?.contains(event.target as Node))onClose();}
  function onKey(event:KeyboardEvent){if(event.key==="Escape")onClose();}
  document.addEventListener("mousedown",outside);
  document.addEventListener("keydown",onKey);
  return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",onKey);};
 },[open,onClose]);
 function pick(item:string){onChange(item);onClose();}
 function onSearchKey(event:ReactKeyboardEvent<HTMLInputElement>){
  if(event.key==="ArrowDown"){event.preventDefault();setActive(index=>Math.min(shown.length-1,index+1));}
  if(event.key==="ArrowUp"){event.preventDefault();setActive(index=>Math.max(0,index-1));}
  if(event.key==="Enter"&&shown[active]){event.preventDefault();pick(shown[active]);}
 }
 return <div className={"sf-option"+(value!=="Hamısı"?" is-set":"")+(open?" is-open":"")} ref={root}>
  <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={onToggle}><span>{t(label)}</span><strong>{t(value)}</strong></button>
  {open&&<div className="sf-option-panel">{searchable&&<label className="sf-option-search"><Search size={16}/><input ref={inputRef} aria-label={t(label)+" · "+t("Axtar")} aria-controls={label+"-options"} placeholder={t("Axtar")} value={filter} onChange={event=>{setFilter(event.target.value);setActive(0);}} onKeyDown={onSearchKey}/>{filter&&<button type="button" className="sf-search-clear" aria-label={t("Axtarışı təmizlə")} onClick={()=>{setFilter("");setActive(0);inputRef.current?.focus();}}>×</button>}</label>}<ul id={searchable?label+"-options":undefined} className="sf-option-list" role="listbox" aria-label={t(label)} ref={listRef}>{shown.map((item,index)=><li key={item}><button type="button" role="option" data-active={searchable&&index===active} aria-selected={item===value} onMouseEnter={()=>setActive(index)} onClick={()=>pick(item)}>{t(item)}{item===value&&<Check size={15}/>}</button></li>)}{searchable&&filter.trim()&&!shown.length&&<li className="sf-option-empty">{t("Uyğun seçim yoxdur")}</li>}</ul></div>}
 </div>;
}
export default function Storefront({productId,categoryId,picksPage,catalogPage,initialCatalog,initialOptionId}:{productId?:string;categoryId?:string;picksPage?:boolean;catalogPage?:boolean;initialCatalog?:PublicCatalog;initialOptionId?:string}){const {t}=useTranslations();
 const [brand,setBrand]=useState<Brand|null>(initialCatalog?.brand||null),[products,setProducts]=useState<CatalogProduct[]>(initialCatalog?.products||[]),[account,setAccount]=useState<Customer>(null),[slides,setSlides]=useState<HeroSlide[]>(initialCatalog?.slides||[]),[showcase,setShowcase]=useState<ShowcaseCategory[]>(initialCatalog?.categories||[]);
 const [cart,setCart]=useState<CustomerCart>({}),[loaded,setLoaded]=useState(Boolean(initialCatalog)),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [query,setQuery]=useState(""),[category,setCategory]=useState("Hamısı"),[model,setModel]=useState("Hamısı"),[sort,setSort]=useState("name"),[open,setOpen]=useState(false),[menu,setMenu]=useState<""|"category"|"model">(""),[visitOrder,setVisitOrder]=useState<string[]>([]),[optionProduct,setOptionProduct]=useState<CatalogProduct|null>(null);
 const closeMenu=useCallback(()=>setMenu(""),[]);
 const refresh=useCallback(async()=>{
  try{
   let r=await fetch("/api/catalog",{cache:"no-store"});if(r.status===503) r=await fetch("/api/catalog",{cache:"no-store"});const data=await r.json() as {brand:Brand;products:CatalogProduct[];slides:HeroSlide[];categories?:ShowcaseCategory[];error?:string};
   if(!r.ok)throw new Error(data.error||"Kataloq yüklənmədi.");
   setBrand(data.brand);setProducts(data.products);setSlides(data.slides||[]);setShowcase(data.categories||[]);setLoaded(true);setError("");
   setCart(current=>{const valid=Object.fromEntries(Object.entries(current).filter(([id])=>data.products.some(p=>p.id===parseCartKey(id).productId&&(!parseCartKey(id).optionId||p.options.some(o=>o.id===parseCartKey(id).optionId)))));saveCart(valid);return valid;});
  }catch{setError("Kataloqla əlaqə qurulmadı. Yenidən cəhd edin.");}
 },[]);
 useEffect(()=>{
  setCart(readCart());void refresh();
  void fetch("/api/customer-account").then(r=>r.json()).then(d=>setAccount((d as {user:Customer}).user)).catch(()=>setAccount(null));
  const timer=setInterval(()=>void refresh(),30000);return()=>clearInterval(timer);
 },[refresh]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(""),3000);return()=>clearTimeout(timer);},[notice]);
 function change(id:string,delta:number){
  setCart(current=>{const next={...current};const n=Math.max(0,Math.min(100,(next[id]||0)+delta));if(n)next[id]=n;else delete next[id];saveCart(next);return next;});
 }
 function add(id:string,optionId?:string){const p=products.find(item=>item.id===id);if(p?.options?.length&&!optionId){setOptionProduct(p);return;}change(cartKey(id,optionId),1);setOptionProduct(null);setNotice("Məhsul səbətinizə əlavə edildi.");}
 function committed(items:{id:string;optionId?:string|null;quantity:number}[]){setCart(current=>{const next={...current};for(const item of items){const key=cartKey(item.id,item.optionId);const quantity=Math.max(0,(next[key]||0)-item.quantity);if(quantity)next[key]=quantity;else delete next[key];}saveCart(next);return next;});}
 const count=Object.values(cart).reduce((a,b)=>a+b,0);
 const quantityInCart=(id:string)=>Object.entries(cart).reduce((sum,[key,quantity])=>sum+(parseCartKey(key).productId===id?quantity:0),0);
 const categories=["Hamısı",...[...new Set(products.map(p=>p.category||"Digər"))].sort(compareCatalogNames)];
 const scoped=products.filter(p=>category==="Hamısı"||(p.category||"Digər")===category);
 const models=["Hamısı",...new Set(scoped.map(p=>productModel(p.name)))].sort((a,b)=>a==="Hamısı"?-1:b==="Hamısı"?1:compareCatalogNames(a,b));
 const needle=query.trim();
 const bySort=(a:CatalogProduct,b:CatalogProduct)=>sort==="low"?a.price-b.price:sort==="high"?b.price-a.price:sort==="sale"?(b.originalPrice-b.price)-(a.originalPrice-a.price):compareCatalogNames(a.name,b.name);
 const ranked=needle?products.map(product=>({product,score:productSearchScore(product,query)})).filter(item=>item.score>0):[];
 const scopedRanked=ranked.filter(({product})=>{const itemModel=productModel(product.name);return (category==="Hamısı"||(product.category||"Digər")===category)&&(model==="Hamısı"||itemModel===model);});
 const found=needle?(scopedRanked.length?scopedRanked:ranked).sort((a,b)=>b.score-a.score||bySort(a.product,b.product)).map(item=>item.product):scoped.filter(p=>model==="Hamısı"||productModel(p.name)===model).sort(bySort);
 const visible=found;
 useEffect(()=>{if(!products.length||visitOrder.length)return;const ids=products.map(item=>item.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}setVisitOrder(ids);},[products,visitOrder.length]);
 const featured=products.find(item=>item.id===brand?.featuredProductId);
 const forYouBase=[...(featured?[featured]:[]),...products.filter(item=>item.originalPrice>item.price&&item.id!==featured?.id)].slice(0,12);
 const picks=featured?[featured]:[];
 const forYou=sort==="name"?forYouBase:[...forYouBase].sort(bySort);
 const deals=products.filter(item=>item.originalPrice>item.price).sort((a,b)=>(1-b.price/b.originalPrice)-(1-a.price/a.originalPrice)).slice(0,8);
 function chooseCategory(next:string){setCategory(next);setModel(current=>current!=="Hamısı"&&products.some(p=>(next==="Hamısı"||(p.category||"Digər")===next)&&productModel(p.name)===current)?current:"Hamısı");}
 const product=products.find(p=>p.id===productId||p.code===productId);
 const opened=showcase.find(item=>item.id===categoryId);
 const categoryProducts=opened?products.filter(item=>(item.category||"Digər")===opened.name).sort(bySort):[];
 return <div className="storefront">
  <div className="sf-announcement"><span>{t("Seçiminiz onlayn. Alışınız rahat.")}</span><span><Check size={13}/>{t("Ödəniş təhvil zamanı")}</span></div>
  <header className="sf-header"><div className="sf-header-inner">
   <Link className="sf-brand" href="/">{brand?.logo?<img src={brand.logo} alt=""/>:<BrandLogo/>}<strong>{brand?.name||"RestaMarket"}</strong></Link>
   <nav aria-label={t("Əsas menyu")}><Link href="/mehsullar">{t("Məhsullar")}</Link>{(!loaded||picks.length>0)&&<Link href="/#secilmis">{t("Seçilmişlər")}</Link>}{(!loaded||deals.length>0)&&<Link href="/#endirim">{t("Endirimli")}</Link>}<Link href="/sizin-ucun">{t("Sizin üçün seçdik")}</Link><Link href="/#about">{t("Haqqımızda")}</Link><Link href="/#contact">{t("Əlaqə")}</Link></nav>
   <div className="sf-header-actions"><LanguageSwitcher/><Link href="/account" className="sf-account" aria-label={t("Müştəri paneli")}><UserRound size={20}/><span>{t("Müştəri paneli")}</span></Link><Link href="/account?tab=orders" className="sf-account" aria-label={t("Sifarişlərim")}><Package size={20}/><span>{t("Sifarişlərim")}</span></Link><button className="sf-cart-trigger" onClick={()=>setOpen(true)} aria-label={t("Səbətim")+", "+count+" "+t("məhsul")}><ShoppingBag size={19}/><span>{t("Səbətim")}</span><b>{count}</b></button></div>
  </div></header>
  <main className="sf-main">
  {error&&<div className="sf-error" role="alert">{t(error)}<button onClick={refresh}>{t("Yenidən yoxla")}</button></div>}
  {picksPage?(loaded?<section className="sf-catalog sf-category-page"><Link className="sf-text-button" href="/mehsullar"><ArrowLeft size={16}/>{t("Kataloqa qayıt")}</Link><div className="sf-section-head"><div><span className="sf-eyebrow">{t("SİZİN ÜÇÜN")}</span><h1>{t("Sizin üçün seçdik")}</h1></div></div><div className="sf-catalog-tools"><span>{forYou.length+" "+t("Məhsullar")}</span><label>{t("Sırala")}<select value={sort} onChange={e=>setSort(e.target.value)}><option value="name">{t("Ada görə")}</option><option value="low">{t("Əvvəl ucuz")}</option><option value="high">{t("Əvvəl baha")}</option><option value="sale">{t("Əvvəl endirimli")}</option></select></label></div><div className="sf-grid">{forYou.map(p=><ProductCard key={p.id} product={p} pinned={p.id===featured?.id} inCart={quantityInCart(p.id)} onAdd={()=>add(p.id)} onOpen={()=>setOpen(true)}/>)}</div>{!forYou.length&&<div className="sf-empty"><Package size={36}/><h3>{t("Hazırda seçilmiş məhsul yoxdur")}</h3><Link className="sf-secondary" href="/mehsullar">{t("Bütün məhsullar")}</Link></div>}</section>:<section className="sf-empty"><Package size={46}/><h1>{t("Məhsullar yüklənir…")}</h1></section>):categoryId?(opened?<section className="sf-catalog sf-category-page"><Link className="sf-text-button" href="/mehsullar"><ArrowLeft size={16}/>{t("Kataloqa qayıt")}</Link>{opened.image&&<img className="sf-category-banner" src={opened.image} alt=""/>}<div className="sf-section-head"><div><span className="sf-eyebrow">{t("KATEQORİYA")}</span><h1>{opened.name}</h1></div></div><div className="sf-catalog-tools"><span>{categoryProducts.length+" "+t("Məhsullar")}</span><label>{t("Sırala")}<select value={sort} onChange={e=>setSort(e.target.value)}><option value="name">{t("Ada görə")}</option><option value="low">{t("Əvvəl ucuz")}</option><option value="high">{t("Əvvəl baha")}</option><option value="sale">{t("Əvvəl endirimli")}</option></select></label></div><div className="sf-grid">{categoryProducts.map(p=><ProductCard key={p.id} product={p} inCart={quantityInCart(p.id)} onAdd={()=>add(p.id)} onOpen={()=>setOpen(true)}/>)}</div>{!categoryProducts.length&&<div className="sf-empty"><Package size={36}/><h3>{t("Bu kateqoriyada hazırda məhsul yoxdur")}</h3><Link className="sf-secondary" href="/mehsullar">{t("Bütün məhsullar")}</Link></div>}</section>:!loaded?<section className="sf-empty"><Package size={46}/><h1>{t("Kateqoriya yüklənir…")}</h1></section>:<section className="sf-empty"><Package size={46}/><h1>{t("Kateqoriya tapılmadı")}</h1><p>{t("Bu kateqoriya ana səhifədə seçilməyib və ya artıq yoxdur.")}</p><Link className="sf-primary" href="/mehsullar">{t("Kataloqa qayıt")}<ArrowRight size={17}/></Link></section>):productId?(product?<ProductView key={product.id} product={product} initialOptionId={initialOptionId} products={products} inCart={quantityInCart(product.id)} onAdd={add} onOpenCart={()=>setOpen(true)}/>:<section className="sf-empty"><Package size={46}/><h1>{loaded?"Məhsul hazırda mövcud deyil":"Məhsul yüklənir…"}</h1><p>{loaded?"Bu məhsulun stoku bitmiş və ya satışdan çıxarılmış ola bilər.":"Bir az gözləyin, məlumatları hazırlayırıq."}</p><Link className="sf-primary" href="/mehsullar">{t("Kataloqa qayıt")}<ArrowRight size={17}/></Link></section>):<>
   {catalogPage?<section className="sf-catalog-heading"><h1>{t("Məhsullar")}</h1><p>Restoran və mətbəx ləvazimatlarını kateqoriya, ölçü və qiymət üzrə seçin.</p></section>:<HeroSlider slides={slides} products={products} description={brand?.description}/>}
   <div className="sf-benefits"><div><Store/><span><strong>{t("Mağazadan götürün")}</strong><small>{t("Hazır olduqda gəlib təhvil alın")}</small></span></div><div><Truck/><span><strong>{t("Ünvana sifariş edin")}</strong><small>{t("Təhvil üsulunu səbətdə seçin")}</small></span></div><div><ShoppingBag/><span><strong>{t("Hər addımı izləyin")}</strong><small>{t("Sifarişiniz şəxsi kabinetinizdə")}</small></span></div></div>
   <section id="catalog" className="sf-catalog"><div className="sf-section-head"><div><span className="sf-eyebrow">{t("KATALOQ")}</span><h2>{brand?.kind==="restaurant"?"Bu gün nə seçirsiniz?":t("Axtardığınız seçimlər")}</h2></div></div>
   <div className="sf-filters"><SearchField products={products} query={query} onQuery={setQuery}/><div className="sf-filter-picks"><OptionMenu label="Kateqoriya" value={category} options={categories} searchable open={menu==="category"} onToggle={()=>setMenu(current=>current==="category"?"":"category")} onClose={closeMenu} onChange={chooseCategory}/><OptionMenu label="Model" value={models.includes(model)?model:t("Hamısı")} options={models} searchable open={menu==="model"} onToggle={()=>setMenu(current=>current==="model"?"":"model")} onClose={closeMenu} onChange={setModel}/></div></div>
   {!!showcase.length&&<section className="sf-category-menu" aria-label={t("Kateqoriyalar")}><div className="sf-section-head"><div><span className="sf-eyebrow">{t("KATEQORİYALAR")}</span><h2>{t("Kateqoriyalar")}</h2></div></div><div className="sf-category-board">{showcase.map(item=><Link href={"/categories/"+item.id} key={item.id} className="sf-category-card">{item.image?<img src={item.image} alt=""/>:<Package size={42}/>}<div className="sf-category-copy"><span>{t("KOLLEKSİYA")}</span><strong>{item.name}</strong><small>{t("Məhsulları kəşf edin")}<ArrowRight size={15}/></small></div></Link>)}</div></section>}
   {!!picks.length&&<section id="secilmis" className="sf-popular" aria-label={t("Seçilmiş məhsullar")}><div className="sf-section-head"><div><span className="sf-eyebrow">{t("SEÇİLMİŞLƏR")}</span><h2>{t("Seçilmiş məhsullar")}</h2></div></div><div className="sf-grid">{picks.map(p=><ProductCard key={p.id} product={p} pinned={p.id===featured?.id} inCart={quantityInCart(p.id)} onAdd={()=>add(p.id)} onOpen={()=>setOpen(true)}/>)}</div></section>}
   {!!deals.length&&<section id="endirim" className="sf-deals" aria-label={t("Endirimli məhsullar")}><div className="sf-section-head"><div><span className="sf-eyebrow">{t("ENDİRİM")}</span><h2>{t("Endirimli məhsullar")}</h2></div></div><div className="sf-grid">{deals.map(p=><ProductCard key={p.id} product={p} inCart={quantityInCart(p.id)} onAdd={()=>add(p.id)} onOpen={()=>setOpen(true)}/>)}</div></section>}
   <div className="sf-catalog-tools"><span>{loaded?visible.length+" "+t("Məhsullar"):t("Məhsullar yüklənir…")}</span><label>{t("Sırala")}<select value={sort} onChange={e=>setSort(e.target.value)}><option value="name">{t("Ada görə")}</option><option value="low">{t("Əvvəl ucuz")}</option><option value="high">{t("Əvvəl baha")}</option><option value="sale">{t("Əvvəl endirimli")}</option></select></label></div>
   <div id="catalog-products" className="sf-grid">{visible.map(p=><ProductCard key={p.id} product={p} inCart={quantityInCart(p.id)} onAdd={()=>add(p.id)} onOpen={()=>setOpen(true)}/>)}</div>
   {loaded&&!visible.length&&<div className="sf-empty"><Search size={36}/><h3>{t("Bu seçimə uyğun məhsul yoxdur")}</h3><p>{t("Kateqoriya, model və ya axtarışı dəyişin.")}</p><button className="sf-secondary" onClick={()=>{setQuery("");setCategory("Hamısı");setModel("Hamısı");}}>{t("Bütün məhsullar")}</button></div>}
   </section>
   <section id="about" className="sf-about"><div className="sf-about-mark">{brand?.logo?<img src={brand.logo} alt=""/>:<Store size={58}/>}<strong>{brand?.name||t("Mağazamız")}</strong><span>{t("YAXININIZDA. SİZİN ÜÇÜN.")}</span></div><div><span className="sf-eyebrow">{t("HAQQIMIZDA")}</span><h2>{t("Bir mağazadan daha yaxın.")}</h2><p>{brand?.about||brand?.description||t("Kataloqumuzdakı məhsulları rahatlıqla nəzərdən keçirə, sifarişinizi saytdan göndərə və hazırlıq mərhələlərini hesabınızda izləyə bilərsiniz. Seçiminizə kömək etmək üçün bizimlə əlaqə saxlayın.")}</p><div className="sf-about-links"><a href="#contact">{t("Bizimlə əlaqə")}<ArrowRight size={16}/></a><Link href="/account">{t("Sifarişimi izləyim")}<ArrowRight size={16}/></Link></div></div></section>
  </>}
  <section id="contact" className="sf-contact"><div className="sf-contact-heading"><span className="sf-eyebrow">{t("ƏLAQƏ")}</span><h2>{t("Bir sualınız var?")}</h2><p>{t("Məhsul və sifarişlə bağlı sizə kömək edək.")}</p>{brand?.address&&<p className="sf-contact-detail"><MapPin size={18}/>{brand.address}</p>}{brand?.phone&&<a className="sf-phone" href={"tel:"+brand.phone.replace(/[^+0-9]/g,"")}>{brand.phone}</a>}</div><ContactBox whatsapp={brand?.whatsapp}/></section>
  </main>
  <footer className="sf-footer"><strong>{brand?.name||t("Mağazamız")}</strong><nav><Link href="/mehsullar">{t("Məhsullar")}</Link><Link href="/#about">{t("Haqqımızda")}</Link><Link href="/account">{t("Sifarişlərim")}</Link></nav><span>© {new Date().getFullYear()} · {t("Rahat seçim, rahat sifariş.")}</span></footer>
  <WhatsAppButton whatsapp={brand?.whatsapp}/>
  {notice&&<div className="sf-toast" role="status"><Check size={17}/>{t(notice)}<button onClick={()=>{setOpen(true);setNotice("");}}>{t("Səbətə bax")}</button></div>}
  {optionProduct&&<OptionDialog product={optionProduct} onPick={id=>add(optionProduct.id,id)} onClose={()=>setOptionProduct(null)}/>}
  {open&&<CartSheet storeAddress={brand?.address||""} products={products} cart={cart} account={account} onChange={change} onCommitted={committed} onRefresh={refresh} onClose={()=>setOpen(false)}/>}
 </div>;
}

function OptionDialog({product,onPick,onClose}:{product:CatalogProduct;onPick:(id:string)=>void;onClose:()=>void}){const {t,languageAmount:money}=useTranslations();const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);return <dialog ref={ref} className="sf-options-dialog" onCancel={onClose}><header><div><span>{t("MƏHSUL SEÇİMİ")}</span><h2>{product.name}</h2></div><button type="button" aria-label={t("Bağla")} onClick={onClose}>×</button></header><p>{t("Ölçü, rəng və ya növü seçin")}</p><div>{product.options.map(option=><button type="button" key={option.id} onClick={()=>onPick(option.id)}><span><strong>{option.label}</strong><small>{optionDetails(option)}</small></span><b>{money(option.price??product.basePrice??product.price)} AZN</b></button>)}</div></dialog>;}
