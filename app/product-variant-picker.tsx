"use client";

import {Check,ChevronDown} from 'lucide-react';
import {useTranslations} from '@/lib/language';
import {productOptionLabel,productVariantPath,type CatalogProduct} from '@/lib/commerce';
import {type VariantSelectionState} from '@/lib/variant-selection';
import type {MouseEvent} from 'react';
import './product-variant-picker.css';

type Props={
  product:CatalogProduct;
  selection:VariantSelectionState;
  onNavigate:(href:string)=>void;
};

export default function ProductVariantPicker({product,selection,onNavigate}:Props){
  const {t}=useTranslations();
  if(!product.options.length)return null;
  const hasColorAndSize=selection.groups.some(group=>group.key==='reng')&&selection.groups.some(group=>group.key==='olcu');

  function navigate(event:MouseEvent<HTMLAnchorElement>,href:string){
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    onNavigate(href);
  }

  function exactOption(option:CatalogProduct['options'][number]){
    const href=productVariantPath(product,option);
    return <a
      className="pd-variant-option pd-choice-exact"
      href={href}
      aria-current={selection.selectedOption?.id===option.id?'true':undefined}
      onClick={event=>navigate(event,href)}
    ><span>{productOptionLabel(option)}</span><Check size={16} aria-hidden="true"/></a>;
  }

  return <section className="pd-option-picker" aria-label={t('Məhsul seçimi')}>
    {hasColorAndSize&&!selection.selectedOption&&<p className="pd-choice-intro">{t('Əvvəl rəngi, sonra ölçünü seçin.')}</p>}
    {!selection.valid&&<p className="pd-choice-warning" role="status">{t('Bu seçim mövcud deyil. Yenidən seçim edin.')}</p>}

    <div className="pd-choice-groups">
      {selection.groups.map(group=><fieldset className="pd-choice-group" key={group.key} disabled={!group.enabled}>
        <legend>{t(group.label)}</legend>
        {group.enabled?<div className="pd-choice-chips">
          {group.choices.map(choice=><a
            className="pd-choice-chip"
            key={choice.value}
            href={choice.href}
            aria-current={choice.selected?'true':undefined}
            onClick={event=>navigate(event,choice.href)}
          ><span>{choice.label}</span><Check size={15} aria-hidden="true"/></a>)}
        </div>:<p className="pd-choice-disabled">{t('Əvvəl yuxarıdakı seçimi edin.')}</p>}
      </fieldset>)}
    </div>

    {selection.showRemainingOptions&&<fieldset className="pd-choice-group pd-choice-remaining">
      <legend>{t('Seçim edin')}</legend>
      <ul className="pd-choice-exact-list">{selection.remainingOptions.map(option=><li key={option.id}>{exactOption(option)}</li>)}</ul>
    </fieldset>}

    {selection.selectedOption&&<p className="pd-choice-summary" role="status" aria-live="polite" aria-atomic="true"><Check size={16} aria-hidden="true"/><span>{t('Seçiminiz')}: <strong>{productOptionLabel(selection.selectedOption)}</strong></span></p>}

    {selection.groups.length>0&&<details className="pd-choice-all">
      <summary>{t('Bütün mövcud seçimlər')}<ChevronDown size={16} aria-hidden="true"/></summary>
      <ul className="pd-choice-exact-list">{product.options.map(option=><li key={option.id}>{exactOption(option)}</li>)}</ul>
    </details>}
  </section>;
}
