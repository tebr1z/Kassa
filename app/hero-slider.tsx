"use client";
import {useTranslations} from "@/lib/language";
import Link from "next/link";
import {useEffect,useState,useSyncExternalStore} from "react";
import {ArrowLeft,ArrowRight,Pause,Play,ShoppingBag,Sparkles} from "lucide-react";
import {productPath,type CatalogProduct,type HeroSlide} from "@/lib/commerce";
import {hasProductDiscount,productDiscountLabel} from '@/lib/product-discount';
import {isCatalogIllustration} from '@/lib/catalog-illustrations';
import "./hero-slider.css";

const motionQuery='(prefers-reduced-motion: reduce)';
const subscribeMotion=(notify:()=>void)=>{const media=window.matchMedia(motionQuery);media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);};
const motionSnapshot=()=>window.matchMedia(motionQuery).matches;
const serverMotionSnapshot=()=>false;

export default function HeroSlider({slides,products,description}:{slides:HeroSlide[];products:CatalogProduct[];description?:string}){const {t,languageAmount}=useTranslations();
 const signature=slides.map(s=>s.id).join(",");
 const [position,setPosition]=useState({signature,index:0}),[paused,setPaused]=useState(false),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
 const reducedMotion=useSyncExternalStore(subscribeMotion,motionSnapshot,serverMotionSnapshot),stopped=paused||reducedMotion;
 useEffect(()=>{if(slides.length<2||stopped||hovered||focused)return;const timer=setInterval(()=>{if(!document.hidden)setPosition(current=>({signature,index:((current.signature===signature?current.index:0)+1)%slides.length}));},5000);return()=>clearInterval(timer);},[slides.length,stopped,hovered,focused,signature]);
 const active=Math.min(position.signature===signature?position.index:0,Math.max(0,slides.length-1)),slide=slides[active],product=products.find(p=>p.id===slide?.productId);
 function move(delta:number){setPosition({signature,index:(active+delta+slides.length)%slides.length});}
 return <section className={"sf-hero sf-carousel"+(!slide?" sf-carousel-empty":"")} aria-roledescription={t('karusel')} aria-label={t("Mağazanın seçdikləri")} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}>
  <div className="sf-hero-copy" key={(slide?.id||"brand")+"copy"}><span className="sf-eyebrow">{slide?.badge||t('RESTORAN VƏ KAFELƏR ÜÇÜN')}</span><h1>{slide?.heading||product?.name||t('Peşəkar mətbəxə\nuyğun seçimlər.')}</h1><p>{slide?.description||description||t('Restoran, kafe və iaşə məkanınız üçün qab-qacaq, mətbəx ləvazimatları və avadanlıqları bir kataloqda kəşf edin. Topdan alış üçün bizimlə əlaqə saxlayın.')}</p>{product&&<div className="sf-hero-price">{hasProductDiscount(product.price,product.originalPrice)&&<del>{languageAmount(product.originalPrice)} AZN</del>}<strong>{languageAmount(product.price)} <small>AZN</small></strong>{hasProductDiscount(product.price,product.originalPrice)&&<span>{productDiscountLabel(product.price,product.originalPrice,languageAmount)||t("Endirim")}</span>}</div>}<div className="sf-hero-actions"><Link className="sf-primary" href={product?productPath(product):"/#catalog"}>{product?t("Məhsula bax"):t("Məhsulları kəşf et")}<ArrowRight size={18} aria-hidden="true"/></Link><Link className="sf-hero-wholesale" href="/#contact">{t('Topdan alış üçün əlaqə')}<ArrowRight size={16} aria-hidden="true"/></Link></div><div className="sf-hero-note"><span className="sf-dot" aria-hidden="true"/> {t('Topdan ehtiyacınızı birlikdə dəqiqləşdirək.')}</div></div>
  <div className="sf-hero-visual" key={(slide?.id||"brand")+"image"}>{product?<Link href={productPath(product)} aria-label={product.name+" — "+t('Məhsula bax')}>{product.image?<img src={product.image} alt={product.name}/>:<ShoppingBag size={88}/>} {isCatalogIllustration(product.image)&&<span className="sf-hero-illustration" title={t('Görünüş nümunə üçündür. Dəqiq görünüşü sifarişdən əvvəl mağaza ilə dəqiqləşdirin.')}>{t('İllüstrativ şəkil')}</span>}<div className="sf-featured-caption"><span>{product.category||t("YAXINDAN KƏŞF EDİN")}</span><strong>{product.name}</strong><ArrowRight size={22} aria-hidden="true"/></div></Link>:<div className="sf-campaign-art"><Sparkles size={56} aria-hidden="true"/><span>{slide?.badge||t('İŞİNİZ ÜÇÜN SEÇİN')}</span><strong>{slide?.heading||t('Tək məhsuldan\ntopdan alışadək.')}</strong><a href="#catalog">{t("Kataloqa keç")}<ArrowRight size={20} aria-hidden="true"/></a></div>}</div>
  {slides.length>1&&<div className="sf-slider-controls"><div className="sf-slider-dots" aria-label={t("Slayd seçin")}>{slides.map((s,i)=><button key={s.id} type="button" onClick={()=>setPosition({signature,index:i})} aria-label={t('Slayd')+' '+(i+1)+": "+(s.heading||products.find(p=>p.id===s.productId)?.name||t('Kampaniya'))} aria-current={i===active?"true":undefined}/>)}</div><span aria-live={stopped||hovered||focused?"polite":"off"}>{active+1} / {slides.length}</span><button type="button" disabled={reducedMotion} aria-label={t(reducedMotion?'Azaldılmış hərəkət aktivdir':paused?"Avtomatik slaydı başlat":"Avtomatik slaydı dayandır")} onClick={()=>setPaused(value=>!value)}>{stopped?<Play size={15}/>:<Pause size={15}/>}</button><button type="button" aria-label={t("Əvvəlki slayd")} onClick={()=>move(-1)}><ArrowLeft size={17}/></button><button type="button" aria-label={t("Növbəti slayd")} onClick={()=>move(1)}><ArrowRight size={17}/></button></div>}
 </section>;
}
