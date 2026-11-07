"use client";
import {useTranslations} from "@/lib/language";
import Link from "next/link";
import {useEffect,useState} from "react";
import {ArrowLeft,ArrowRight,Pause,Play,ShoppingBag,Sparkles} from "lucide-react";
import {productPath,type CatalogProduct,type HeroSlide} from "@/lib/commerce";
import {hasProductDiscount,productDiscountLabel} from '@/lib/product-discount';
import "./hero-slider.css";

export default function HeroSlider({slides,products,description}:{slides:HeroSlide[];products:CatalogProduct[];description?:string}){const {t,languageAmount}=useTranslations();
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(false);
 const signature=slides.map(s=>s.id).join(",");
 useEffect(()=>{setIndex(0);},[signature]);
 useEffect(()=>{if(slides.length<2||paused)return;const timer=setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%slides.length);},5000);return()=>clearInterval(timer);},[slides.length,paused,signature]);
 const active=Math.min(index,Math.max(0,slides.length-1)),slide=slides[active],product=products.find(p=>p.id===slide?.productId);
 function move(delta:number){setIndex(i=>(i+delta+slides.length)%slides.length);}
 return <section className={"sf-hero sf-carousel"+(!slide?" sf-carousel-empty":"")} aria-roledescription="karusel" aria-label={t("Mağazanın seçdikləri")}>
  <div className="sf-hero-copy" key={(slide?.id||"brand")+"copy"}><span className="sf-eyebrow">{slide?.badge||t("SİZİN ÜÇÜN SEÇDİK")}</span><h1>{slide?.heading||product?.name||t("Seçmək rahatdır.\nAlmaq daha da.")}</h1><p>{slide?.description||description||t("Məhsulları kəşf edin. Səbətinizi hazırlayın, mağazadan götürün və ya ünvanınıza sifariş edin.")}</p>{product&&<div className="sf-hero-price">{hasProductDiscount(product.price,product.originalPrice)&&<del>{product.originalPrice.toFixed(2)} AZN</del>}<strong>{product.price.toFixed(2)} <small>AZN</small></strong>{hasProductDiscount(product.price,product.originalPrice)&&<span>{productDiscountLabel(product.price,product.originalPrice,languageAmount)||t("Endirim")}</span>}</div>}<Link className="sf-primary" href={product?productPath(product):"/#catalog"}>{product?t("Məhsula bax"):t("Məhsulları kəşf et")}<ArrowRight size={18}/></Link><div className="sf-hero-note"><span className="sf-dot"/> {t("Ödəniş təhvil zamanı · Rahat sifariş")}</div></div>
  <div className="sf-hero-visual" key={(slide?.id||"brand")+"image"}>{product?<Link href={productPath(product)} aria-label={product.name+" — məhsula bax"}>{product.image?<img src={product.image} alt={product.name}/>:<ShoppingBag size={88}/>}<div className="sf-featured-caption"><span>{product.category||t("YAXINDAN KƏŞF EDİN")}</span><strong>{product.name}</strong><ArrowRight size={22}/></div></Link>:<div className="sf-campaign-art"><Sparkles size={56}/><span>{slide?.badge||t("YAXININIZDA. SİZİN ÜÇÜN.")}</span><strong>{slide?.heading||t("Yaxşı seçimlər\nburadan başlayır.")}</strong><a href="#catalog">{t("Kataloqa keç")}<ArrowRight size={20}/></a></div>}</div>
  {slides.length>1&&<div className="sf-slider-controls"><div className="sf-slider-dots" aria-label={t("Slayd seçin")}>{slides.map((s,i)=><button key={s.id} onClick={()=>setIndex(i)} aria-label={"Slayd "+(i+1)+": "+(s.heading||products.find(p=>p.id===s.productId)?.name||"Kampaniya")} aria-current={i===active?"true":undefined}/>)}</div><span aria-live={paused?"polite":"off"}>{active+1} / {slides.length}</span><button aria-label={t(paused?"Avtomatik slaydı başlat":"Avtomatik slaydı dayandır")} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={15}/>:<Pause size={15}/>}</button><button aria-label={t("Əvvəlki slayd")} onClick={()=>move(-1)}><ArrowLeft size={17}/></button><button aria-label={t("Növbəti slayd")} onClick={()=>move(1)}><ArrowRight size={17}/></button></div>}
 </section>;
}
