"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {useTranslations} from '@/lib/language';
import {productDiscountPercent,resolveProductDiscount} from '@/lib/product-discount';
import './product-discount-editor.css';

type Props={salePriceName:string;discountPriceName:string;discountPercentName:string;initialSalePrice?:number|string;initialDiscountPrice?:number|string|null;disabled?:boolean};

export default function ProductDiscountEditor({salePriceName,discountPriceName,discountPercentName,initialSalePrice,initialDiscountPrice,disabled=false}:Props){
  const {t,languageAmount}=useTranslations();
  const initial=Number(initialDiscountPrice),regular=Number(initialSalePrice);
  const hasInitial=initial>0&&initial<regular;
  const [sale,setSale]=useState(initialSalePrice==null?'':String(initialSalePrice));
  const [enabled,setEnabled]=useState(hasInitial);
  const [mode,setMode]=useState<'price'|'percent'>(hasInitial?'price':'percent');
  const [amount,setAmount]=useState(hasInitial?initial.toFixed(2):'');
  const [percent,setPercent]=useState(hasInitial?String(productDiscountPercent(initial,regular)):'10');
  const percentInput=useRef<HTMLInputElement>(null),amountInput=useRef<HTMLInputElement>(null),hintId=useId();
  let discounted:number|null=null,error='';
  if(enabled&&sale!==''){
    try{discounted=resolveProductDiscount(sale,mode==='percent'?{discountPercent:percent}:{discountPrice:amount});}
    catch(e){error=e instanceof Error?e.message:'Endirim məlumatlarını yoxlayın.';}
  }
  useEffect(()=>{
    percentInput.current?.setCustomValidity(enabled&&mode==='percent'?t(error):'');
    amountInput.current?.setCustomValidity(enabled&&mode==='price'?t(error):'');
  },[enabled,mode,error,t]);
  const shownPercent=mode==='percent'?percent:discounted===null?'':String(productDiscountPercent(discounted,Number(sale)));
  const shownAmount=mode==='price'?amount:discounted===null?'':discounted.toFixed(2);

  return <fieldset className="product-discount-editor" disabled={disabled}>
    <legend>{t('Qiymət və endirim')}</legend>
    <label>{t('Əsas satış qiyməti')} ₼<input name={salePriceName} type="number" min="0.01" max="1000000" step="0.01" required value={sale} onChange={event=>setSale(event.target.value)}/></label>
    <label className="product-discount-toggle"><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/><span>{t('Məhsula endirim tətbiq et')}</span></label>
    {!enabled?<input type="hidden" name={discountPriceName} value=""/>:<>
      <div className="product-discount-fields">
        <label>{t('Endirim faizi')} %<input ref={percentInput} name={mode==='percent'?discountPercentName:undefined} type="number" min="0" max="99.99" step="0.01" required={mode==='percent'} value={shownPercent} aria-describedby={hintId} onChange={event=>{setMode('percent');setPercent(event.target.value);}}/></label>
        <label>{t('Endirimli qiymət')} ₼<input ref={amountInput} name={mode==='price'?discountPriceName:undefined} type="number" min="0.01" max="1000000" step="0.01" required={mode==='price'} value={shownAmount} aria-describedby={hintId} onChange={event=>{setMode('price');setAmount(event.target.value);}}/></label>
      </div>
      {error?<p className="product-discount-error" role="alert">{t(error)}</p>:discounted!==null&&<div className="product-discount-preview" aria-live="polite"><span>{t('Müştəri qiyməti')}</span><strong>{languageAmount(discounted)} ₼</strong><del>{languageAmount(Number(sale))} ₼</del></div>}
    </>}
    <p className="product-discount-hint" id={hintId}>{t('Faiz və ya son qiyməti dəyişin; digəri avtomatik hesablanır. Öz qiyməti olan ölçü və rəng seçimlərinə əlavə endirim tətbiq edilmir.')}</p>
  </fieldset>;
}
