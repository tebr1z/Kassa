"use client";
import {useTranslations} from '@/lib/language';
import './product-price.css';
export default function ProductPrice({price,originalPrice,compact=false}:{price:number;originalPrice:number;compact?:boolean}){
 const {t,languageAmount}=useTranslations();
 const discounted=originalPrice>price&&price>0;
 return <div className={`product-price${discounted?' is-discounted':''}${compact?' is-compact':''}`}>
 {discounted&&<div className="product-price-before"><del aria-label={t('Əvvəlki qiymət')}>{languageAmount(originalPrice)} ₼</del><span>−{Math.round((1-price/originalPrice)*100)}%</span></div>}
 <strong aria-label={t(discounted?'Endirimli qiymət':'Qiymət')}>{languageAmount(price)} <small>₼</small></strong>
 {discounted&&!compact&&<p>{t('Qənaət')}: {languageAmount(originalPrice-price)} ₼</p>}
 </div>;
}
