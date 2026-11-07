"use client";
import {useTranslations} from '@/lib/language';
import {hasProductDiscount,productDiscountLabel} from '@/lib/product-discount';
import './product-price.css';
export default function ProductPrice({price,originalPrice,compact=false}:{price:number;originalPrice:number;compact?:boolean}){
 const {t,languageAmount}=useTranslations();
 const discounted=hasProductDiscount(price,originalPrice),discountLabel=productDiscountLabel(price,originalPrice,languageAmount);
 return <div className={`product-price${discounted?' is-discounted':''}${compact?' is-compact':''}`}>
 {discounted&&<div className="product-price-before"><del aria-label={t('Əvvəlki qiymət')}>{languageAmount(originalPrice)} ₼</del><span>{discountLabel||t('Endirim')}</span></div>}
 {discounted&&<span className="product-price-caption">{t('Endirimli qiymət')}</span>}
 <strong aria-label={t(discounted?'Endirimli qiymət':'Qiymət')}>{languageAmount(price)} <small>₼</small></strong>
 {discounted&&!compact&&<p>{t('Qənaət')}: {languageAmount(originalPrice-price)} ₼</p>}
 </div>;
}
