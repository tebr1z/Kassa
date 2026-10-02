"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowRight,Check,MapPin,Package,Search,ShoppingBag,Store,Truck,UserRound} from "lucide-react";
import {productModel,productSearchScore,type CatalogProduct,type HeroSlide} from "@/lib/commerce";
import {readCart,saveCart,type CustomerCart} from "@/lib/storefront-cart";
import ProductView from "./product-view";
import HeroSlider from "./hero-slider";
import CartSheet from "./cart-sheet";
import {ContactBox,WhatsAppButton} from "./commerce-ui";
import "./storefront-v2.css";

type Brand={name:string;kind:string;description:string;about:string;logo:string;phone:string;address:string;whatsapp:string;featuredProductId:string|null};
export type Customer={id:string;name:string;phone:string}|null;
export const money=(value:number)=>value.toLocaleString("az-AZ",{minimumFractionDigits:2,maximumFractionDigits:2});
function ProductCard({product,inCart,onAdd,onOpen,pinned=false}:{product:CatalogProduct;inCart:number;onAdd:()=>void;onOpen:()=>void;pinned?:boolean}){
 return <article className="sf-product"><Link className="sf-product-image" href={"/products/"+product.id}>{product.image?<img src={product.image} alt={product.name} loading="lazy"/>:<Package size={56}/>}<span className="sf-category-tag">{product.category||"Digər"}</span>{pinned&&<span className="sf-pin-tag">Seçilmiş</span>}{product.originalPrice>product.price&&<span className="sf-sale-tag">−{Math.round((1-product.price/product.originalPrice)*100)}%</span>}</Link><div className="sf-product-copy"><span className="sf-product-meta"><i/> {productModel(product.name)}</span><h3><Link href={"/products/"+product.id}>{product.name}</Link></h3><div className="sf-card-bottom"><div className="sf-card-price">{product.originalPrice>product.price&&<del>{money(product.originalPrice)} AZN</del>}<strong>{money(product.price)} <small>AZN</small></strong></div><button className={inCart?"sf-add is-added":"sf-add"} onClick={()=>inCart?onOpen():onAdd()}>{inCart?<><Check size={15}/> Səbətdə · {inCart}</>:"Səbətə əlavə et"}</button></div></div></article>;
}
function SearchField({products,query,onQuery}:{products:CatalogProduct[];query:string;onQuery:(value:string)=>void}){
 const root=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false);
 const matches=query.trim()?[...products].map(product=>({product,score:productSearchScore(product,query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.product.name.localeCompare(b.product.name,"az")).slice(0,6):[];
 useEffect(()=>{
  if(!open)return;
  function outside(event:MouseEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  function onKey(event:KeyboardEvent){if(event.key==="Escape")setOpen(false);}
  document.addEventListener("mousedown",outside);
  document.addEventListener("keydown",onKey);
  return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",onKey);};
 },[open]);
 return <div className="sf-search-wrap" ref={root}>
  <label className="sf-search sf-search-wide"><Search size={18}/><input aria-label="Məhsul axtar" aria-expanded={open&&matches.length>0} aria-controls="search-results" placeholder="Məhsul axtarın" value={query} onChange={e=>{onQuery(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)}/>{query&&<button type="button" aria-label="Axtarışı təmizlə" onClick={()=>{onQuery("");setOpen(false);}}>×</button>}</label>
  {open&&!!matches.length&&<ul id="search-results" className="sf-search-results" role="listbox">{matches.map(({product})=> <li key={product.id}><Link href={"/products/"+product.id} onClick={()=>setOpen(false)}><span className="sf-search-thumb">{product.image?<img src={product.image} alt=""/>:<Package size={22}/>}</span><span><strong>{product.name}</strong><small>{product.category||"Digər"} · {productModel(product.name)}</small></span><b>{money(product.price)} AZN</b></Link></li>)}</ul>}
 </div>;
}
function OptionMenu({label,value,options,open,onToggle,onClose,onChange}:{label:string;value:string;options:string[];open:boolean;onToggle:()=>void;onClose:()=>void;onChange:(value:string)=>void}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open)return;
  function outside(event:MouseEvent){if(!root.current?.contains(event.target as Node))onClose();}
  function onKey(event:KeyboardEvent){if(event.key==="Escape")onClose();}
  document.addEventListener("mousedown",outside);
  document.addEventListener("keydown",onKey);
  return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",onKey);};
 },[open,onClose]);
 return <div className={"sf-option"+(value!=="Hamısı"?" is-set":"")+(open?" is-open":"")} ref={root}>
  <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={onToggle}><span>{label}</span><strong>{value}</strong></button>
  {open&&<ul className="sf-option-list" role="listbox" aria-label={label}>{options.map(item=><li key={item}><button type="button" role="option" aria-selected={item===value} onClick={()=>{onChange(item);onClose();}}>{item}{item===value&&<Check size={15}/>}</button></li>)}</ul>}
 </div>;
}
export default function Storefront({productId}:{productId?:string}){
 const [brand,setBrand]=useState<Brand|null>(null),[products,setProducts]=useState<CatalogProduct[]>([]),[account,setAccount]=useState<Customer>(null),[slides,setSlides]=useState<HeroSlide[]>([]);
 const [cart,setCart]=useState<CustomerCart>({}),[loaded,setLoaded]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [query,setQuery]=useState(""),[category,setCategory]=useState("Hamısı"),[model,setModel]=useState("Hamısı"),[sort,setSort]=useState("name"),[open,setOpen]=useState(false),[menu,setMenu]=useState<""|"category"|"model">(""),[visitOrder,setVisitOrder]=useState<string[]>([]);
 const closeMenu=useCallback(()=>setMenu(""),[]);
 const refresh=useCallback(async()=>{
  try{
   const r=await fetch("/api/catalog",{cache:"no-store"});const data=await r.json() as {brand:Brand;products:CatalogProduct[];slides:HeroSlide[];error?:string};
   if(!r.ok)throw new Error(data.error||"Kataloq yüklənmədi.");
   setBrand(data.brand);setProducts(data.products);setSlides(data.slides||[]);setLoaded(true);setError("");
   setCart(current=>{const valid=Object.fromEntries(Object.entries(current).filter(([id])=>data.products.some(p=>p.id===id)));saveCart(valid);return valid;});
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
 function add(id:string){change(id,1);setNotice("Məhsul səbətinizə əlavə edildi.");}
 function committed(items:{id:string;quantity:number}[]){setCart(current=>{const next={...current};for(const item of items){const quantity=Math.max(0,(next[item.id]||0)-item.quantity);if(quantity)next[item.id]=quantity;else delete next[item.id];}saveCart(next);return next;});}
 const count=Object.values(cart).reduce((a,b)=>a+b,0);
 const categories=["Hamısı",...new Set(products.map(p=>p.category||"Digər"))];
 const scoped=products.filter(p=>category==="Hamısı"||(p.category||"Digər")===category);
 const models=["Hamısı",...new Set(scoped.map(p=>productModel(p.name)))].sort((a,b)=>a==="Hamısı"?-1:b==="Hamısı"?1:a.localeCompare(b,"az"));
 const needle=query.trim();
 const bySort=(a:CatalogProduct,b:CatalogProduct)=>sort==="low"?a.price-b.price:sort==="high"?b.price-a.price:sort==="sale"?(b.originalPrice-b.price)-(a.originalPrice-a.price):a.name.localeCompare(b.name,"az");
 const ranked=needle?products.map(product=>({product,score:productSearchScore(product,query)})).filter(item=>item.score>0):[];
 const scopedRanked=ranked.filter(({product})=>{const itemModel=productModel(product.name);return (category==="Hamısı"||(product.category||"Digər")===category)&&(model==="Hamısı"||itemModel===model);});
 const found=needle?(scopedRanked.length?scopedRanked:ranked).sort((a,b)=>b.score-a.score||bySort(a.product,b.product)).map(item=>item.product):scoped.filter(p=>model==="Hamısı"||productModel(p.name)===model).sort(bySort);
 const visible=found;
 useEffect(()=>{if(!products.length||visitOrder.length)return;const ids=products.map(item=>item.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}setVisitOrder(ids);},[products,visitOrder.length]);
 const featured=products.find(item=>item.id===brand?.featuredProductId);
 const picks=[...(featured?[featured]:[]),...visitOrder.map(id=>products.find(item=>item.id===id)).filter((item):item is CatalogProduct=>!!item&&item.id!==featured?.id)].slice(0,8);
 function chooseCategory(next:string){setCategory(next);setModel(current=>current!=="Hamısı"&&products.some(p=>(next==="Hamısı"||(p.category||"Digər")===next)&&productModel(p.name)===current)?current:"Hamısı");}
 const product=products.find(p=>p.id===productId);
 return <div className="storefront">
  <div className="sf-announcement"><span>Seçiminiz onlayn. Alışınız rahat.</span><span><Check size={13}/> Ödəniş təhvil zamanı</span></div>
  <header className="sf-header"><div className="sf-header-inner">
   <Link className="sf-brand" href="/">{brand?.logo?<img src={brand.logo} alt=""/>:<span><Store size={24}/></span>}<strong>{brand?.name||"Mağazamız"}</strong></Link>
   <nav aria-label="Əsas menyu"><Link href="/#catalog">Məhsullar</Link><Link href="/#about">Haqqımızda</Link><Link href="/#contact">Əlaqə</Link></nav>
   <div className="sf-header-actions"><Link href="/account" className="sf-account"><UserRound size={20}/><span>Hesabım</span></Link><button className="sf-cart-trigger" onClick={()=>setOpen(true)} aria-label={"Səbətim, "+count+" məhsul"}><ShoppingBag size={19}/><span>Səbətim</span><b>{count}</b></button></div>
  </div></header>
  <main className="sf-main">
  {error&&<div className="sf-error" role="alert">{error}<button onClick={refresh}>Yenidən yoxla</button></div>}
  {productId?(product?<ProductView key={product.id} product={product} products={products} inCart={cart[product.id]||0} onAdd={add} onOpenCart={()=>setOpen(true)}/>:<section className="sf-empty"><Package size={46}/><h1>{loaded?"Məhsul hazırda mövcud deyil":"Məhsul yüklənir…"}</h1><p>{loaded?"Bu məhsulun stoku bitmiş və ya satışdan çıxarılmış ola bilər.":"Bir az gözləyin, məlumatları hazırlayırıq."}</p><Link className="sf-primary" href="/#catalog">Kataloqa qayıt <ArrowRight size={17}/></Link></section>):<>
   <HeroSlider slides={slides} products={products} description={brand?.description}/>
   <div className="sf-benefits"><div><Store/><span><strong>Mağazadan götürün</strong><small>Hazır olduqda gəlib təhvil alın</small></span></div><div><Truck/><span><strong>Ünvana sifariş edin</strong><small>Təhvil üsulunu səbətdə seçin</small></span></div><div><ShoppingBag/><span><strong>Hər addımı izləyin</strong><small>Sifarişiniz şəxsi kabinetinizdə</small></span></div></div>
   <section id="catalog" className="sf-catalog"><div className="sf-section-head"><div><span className="sf-eyebrow">KATALOQ</span><h2>{brand?.kind==="restaurant"?"Bu gün nə seçirsiniz?":"Axtardığınız seçimlər"}</h2></div></div>
   <div className="sf-filters"><SearchField products={products} query={query} onQuery={setQuery}/><div className="sf-filter-picks"><OptionMenu label="Kateqoriya" value={category} options={categories} open={menu==="category"} onToggle={()=>setMenu(current=>current==="category"?"":"category")} onClose={closeMenu} onChange={chooseCategory}/><OptionMenu label="Model" value={models.includes(model)?model:"Hamısı"} options={models} open={menu==="model"} onToggle={()=>setMenu(current=>current==="model"?"":"model")} onClose={closeMenu} onChange={setModel}/></div></div>
   {!!picks.length&&<section className="sf-popular" aria-label="Populyar məhsullar"><div className="sf-section-head"><div><span className="sf-eyebrow">SEÇİLMİŞLƏR</span><h2>Populyar məhsullar</h2></div></div><div className="sf-grid">{picks.map(p=><ProductCard key={p.id} product={p} pinned={p.id===featured?.id} inCart={cart[p.id]||0} onAdd={()=>add(p.id)} onOpen={()=>setOpen(true)}/>)}</div></section>}
   <div className="sf-catalog-tools"><span>{loaded?visible.length+" məhsul":"Məhsullar yüklənir…"}</span><label>Sırala<select value={sort} onChange={e=>setSort(e.target.value)}><option value="name">Ada görə</option><option value="low">Əvvəl ucuz</option><option value="high">Əvvəl baha</option><option value="sale">Əvvəl endirimli</option></select></label></div>
   <div className="sf-grid">{visible.map(p=><ProductCard key={p.id} product={p} inCart={cart[p.id]||0} onAdd={()=>add(p.id)} onOpen={()=>setOpen(true)}/>)}</div>
   {loaded&&!visible.length&&<div className="sf-empty"><Search size={36}/><h3>Bu seçimə uyğun məhsul yoxdur</h3><p>Kateqoriya, model və ya axtarışı dəyişin.</p><button className="sf-secondary" onClick={()=>{setQuery("");setCategory("Hamısı");setModel("Hamısı");}}>Bütün məhsullar</button></div>}
   </section>
   <section id="about" className="sf-about"><div className="sf-about-mark">{brand?.logo?<img src={brand.logo} alt=""/>:<Store size={58}/>}<strong>{brand?.name||"Mağazamız"}</strong><span>YAXININIZDA. SİZİN ÜÇÜN.</span></div><div><span className="sf-eyebrow">HAQQIMIZDA</span><h2>Bir mağazadan daha yaxın.</h2><p>{brand?.about||brand?.description||"Kataloqumuzdakı məhsulları rahatlıqla nəzərdən keçirə, sifarişinizi saytdan göndərə və hazırlıq mərhələlərini hesabınızda izləyə bilərsiniz. Seçiminizə kömək etmək üçün bizimlə əlaqə saxlayın."}</p><div className="sf-about-links"><a href="#contact">Bizimlə əlaqə <ArrowRight size={16}/></a><Link href="/account">Sifarişimi izləyim <ArrowRight size={16}/></Link></div></div></section>
  </>}
  <section id="contact" className="sf-contact"><div className="sf-contact-heading"><span className="sf-eyebrow">ƏLAQƏ</span><h2>Bir sualınız var?</h2><p>Məhsul və sifarişlə bağlı sizə kömək edək.</p>{brand?.address&&<p className="sf-contact-detail"><MapPin size={18}/>{brand.address}</p>}{brand?.phone&&<a className="sf-phone" href={"tel:"+brand.phone.replace(/[^+0-9]/g,"")}>{brand.phone}</a>}</div><ContactBox whatsapp={brand?.whatsapp}/></section>
  </main>
  <footer className="sf-footer"><strong>{brand?.name||"Mağazamız"}</strong><nav><Link href="/#catalog">Məhsullar</Link><Link href="/#about">Haqqımızda</Link><Link href="/account">Sifarişlərim</Link></nav><span>© {new Date().getFullYear()} · Rahat seçim, rahat sifariş.</span></footer>
  <WhatsAppButton whatsapp={brand?.whatsapp}/>
  {notice&&<div className="sf-toast" role="status"><Check size={17}/>{notice}<button onClick={()=>{setOpen(true);setNotice("");}}>Səbətə bax</button></div>}
  {open&&<CartSheet products={products} cart={cart} account={account} onChange={change} onCommitted={committed} onClose={()=>setOpen(false)}/>}
 </div>;
}
