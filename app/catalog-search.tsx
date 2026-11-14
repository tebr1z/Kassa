'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useCallback,useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {ArrowRight,Package,Search,X} from 'lucide-react';
import {compareCatalogNames,productModel,productPath,productSearchScore,type CatalogProduct} from '@/lib/commerce';
import {useTranslations} from '@/lib/language';
import {isCatalogIllustration} from '@/lib/catalog-illustrations';

export default function CatalogSearch({products,query,onQuery}:{products:CatalogProduct[];query:string;onQuery:(value:string)=>void}){const {t,languageAmount}=useTranslations();
 const router=useRouter(),id=useId(),root=useRef<HTMLFormElement>(null),input=useRef<HTMLInputElement>(null),list=useRef<HTMLUListElement>(null);
 const [open,setOpen]=useState(false),[activeId,setActiveId]=useState<string|null>(null);
 const matches=query.trim()?products.map(product=>({product,score:productSearchScore(product,query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||compareCatalogNames(a.product.name,b.product.name)).slice(0,6):[];
 const active=matches.findIndex(({product})=>product.id===activeId),expanded=open&&query.trim().length>0,listId=id+'-suggestions',hintId=id+'-hint',statusId=id+'-status';
 const close=useCallback(()=>{setOpen(false);setActiveId(null);},[]);
 useEffect(()=>{
  if(!open)return;
  function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))close();}
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[open,close]);
 useEffect(()=>{if(active>=0)list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[active,query]);
 function onKeyDown(event:KeyboardEvent<HTMLInputElement>){
  if(event.nativeEvent.isComposing)return;
  if(event.key==='Escape'){if(expanded)event.preventDefault();close();return;}
  if(event.key==='Tab'){close();return;}
  if((event.key==='ArrowDown'||event.key==='ArrowUp')&&matches.length){event.preventDefault();setOpen(true);const next=event.key==='ArrowDown'?(active+1)%matches.length:(active<0?matches.length-1:(active-1+matches.length)%matches.length);setActiveId(matches[next].product.id);}
  if(event.key==='Enter'&&expanded&&active>=0){event.preventDefault();const target=productPath(matches[active].product);close();router.push(target);}
 }
 function showResults(){close();const results=document.getElementById('catalog-products');results?.focus({preventScroll:true});results?.scrollIntoView({block:'start',behavior:'instant'});}
 return <form className="sf-search-wrap sf-catalog-search" role="search" aria-label={t('Kataloqda axtarış')} ref={root} onSubmit={event=>{event.preventDefault();showResults();}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))close();}}>
  <label className="sf-search-label" htmlFor={id+'-input'}>{t('Nə axtarırsınız?')}</label>
  <div className="sf-search sf-search-wide"><span className="sf-search-symbol" aria-hidden="true"><Search size={21}/></span><input id={id+'-input'} ref={input} role="combobox" type="search" autoComplete="off" spellCheck={false} enterKeyHint="search" maxLength={160} aria-autocomplete="list" aria-expanded={expanded&&matches.length>0} aria-controls={expanded&&matches.length?listId:undefined} aria-activedescendant={expanded&&active>=0?id+'-suggestion-'+active:undefined} aria-describedby={hintId+' '+statusId} placeholder={t('Məsələn: manqal, qazan, çaynik')} value={query} onChange={event=>{onQuery(event.target.value);setActiveId(null);setOpen(Boolean(event.target.value.trim()));}} onFocus={()=>setOpen(Boolean(query.trim()))} onKeyDown={onKeyDown}/>{query&&<button type="button" className="sf-search-clear" aria-label={t('Axtarışı təmizlə')} onClick={()=>{onQuery('');input.current?.focus();close();}}><X size={17} aria-hidden="true"/></button>}<button type="submit" className="sf-search-submit" aria-label={t('Axtar')}><span>{t('Axtar')}</span><ArrowRight size={18} aria-hidden="true"/></button></div>
  <p className="sf-search-help" id={hintId}>{t('Ad, kateqoriya və ya ölçü yazın.')}<span className="sf-sr-only"> {t('Oxlarla seçin, Enter ilə açın, Esc ilə bağlayın.')}</span></p>
  <span className="sf-sr-only" id={statusId} role="status" aria-live="polite">{query.trim()?(matches.length?t('Uyğun məhsullar')+': '+matches.length:t('Axtarışa uyğun məhsul tapılmadı.')):''}</span>
  {expanded&&<div className="sf-search-popup"><div className="sf-search-popup-heading"><span>{t('Sürətli nəticələr')}</span><Search size={14} aria-hidden="true"/></div>{matches.length?<ul id={listId} className="sf-search-results" role="listbox" aria-label={t('Axtarış nəticələri')} ref={list}>{matches.map(({product},index)=><li key={product.id} role="presentation"><Link id={id+'-suggestion-'+index} href={productPath(product)} role="option" aria-selected={active===index} tabIndex={-1} onPointerMove={()=>setActiveId(product.id)} onClick={close}><span className="sf-search-thumb">{product.image?<img src={product.image} alt=""/>:<Package size={24}/>}</span><span className="sf-search-result-copy"><strong>{product.name}</strong><small>{product.category||t('Digər')} · {productModel(product.name)}</small>{isCatalogIllustration(product.image)&&<small className="sf-search-illustration">{t('İllüstrativ şəkil')}</small>}</span><b>{languageAmount(product.price)} <small>AZN</small></b></Link></li>)}</ul>:<div className="sf-search-empty"><Search size={25} aria-hidden="true"/><strong>{t('Axtarışa uyğun məhsul tapılmadı.')}</strong><p>{t('Başqa ad, kateqoriya və ya ölçü ilə yenidən axtarın.')}</p></div>}<button className="sf-search-all" type="submit">{t('Kataloqda nəticələrə bax')}<ArrowRight size={16} aria-hidden="true"/></button></div>}
 </form>;
}
