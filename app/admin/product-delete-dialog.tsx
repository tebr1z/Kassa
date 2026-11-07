"use client";

import {useRef,useState} from 'react';
import {AlertCircle,LoaderCircle,Package,ShieldCheck,Trash2} from 'lucide-react';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {t,useLanguage} from '@/lib/language';
import './product-delete-dialog.css';

export type DeleteProductTarget={id:string;name:string;sku?:string};
type Props={product:DeleteProductTarget|null;onClose:()=>void;onDeleted:(product:DeleteProductTarget)=>void};

export default function ProductDeleteDialog({product,onClose,onDeleted}:Props){
  return product?<ProductDeletePrompt key={product.id} product={product} onClose={onClose} onDeleted={onDeleted}/>:null;
}

function ProductDeletePrompt({product,onClose,onDeleted}:Omit<Props,'product'>&{product:DeleteProductTarget}){
  useLanguage();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),cancelButton=useRef<HTMLButtonElement>(null),previousFocus=useRef<HTMLElement|null>(null);

  async function removeProduct(){
    if(pending.current)return;
    pending.current=true;
    setBusy(true);
    setError('');
    try{
      const response=await fetch('/api/store-admin/commerce',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'delete-product',id:product.id,confirm:'SİL'}),
      });
      const body:unknown=await response.json().catch(()=>null);
      if(!response.ok){
        const detail=body&&typeof body==='object'&&'error' in body&&typeof body.error==='string'?body.error:'';
        throw new Error(response.status===401?'Giriş vaxtı bitib. Yenidən daxil olun.':response.status===403?'Bu əməliyyat üçün icazəniz yoxdur.':detail||'Məhsul silinmədi. Yenidən cəhd edin.');
      }
      if(!body||typeof body!=='object'||!('ok' in body)||body.ok!==true)throw new Error('Məhsul silinmədi. Yenidən cəhd edin.');
    }catch(cause){
      setError(cause instanceof TypeError?'Məhsul silinmədi. Bağlantını yoxlayıb yenidən cəhd edin.':cause instanceof Error?cause.message:'Məhsul silinmədi. Yenidən cəhd edin.');
      pending.current=false;
      setBusy(false);
      return;
    }
    // These callbacks only run after the server has confirmed the deletion.
    onClose();
    onDeleted(product);
  }

  return <AlertDialog open onOpenChange={open=>{if(!open&&!pending.current)onClose();}}>
    <AlertDialogContent className="product-delete-dialog" onOpenAutoFocus={event=>{event.preventDefault();previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;cancelButton.current?.focus();}} onCloseAutoFocus={event=>{if(!pending.current&&previousFocus.current?.isConnected){event.preventDefault();previousFocus.current.focus();}}} onEscapeKeyDown={event=>{if(pending.current)event.preventDefault();}}>
      <AlertDialogHeader className="product-delete-header">
        <div className="product-delete-icon" aria-hidden="true"><Trash2 size={26}/></div>
        <span className="product-delete-eyebrow">{t('MƏHSULUN SİLİNMƏSİ')}</span>
        <AlertDialogTitle className="product-delete-title">{t('Məhsulu silmək istəyirsiniz?')}</AlertDialogTitle>
        <AlertDialogDescription className="product-delete-description">{t('Məhsul saytdan və kassadan çıxarılacaq.')}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="product-delete-target">
        <span className="product-delete-target-icon" aria-hidden="true"><Package size={21}/></span>
        <div><strong>{product.name}</strong>{product.sku&&<small>SKU · {product.sku}</small>}</div>
      </div>
      <div className="product-delete-reassurance"><ShieldCheck size={19} aria-hidden="true"/><p>{t('Köhnə çeklər, satış və stok tarixçəsi saxlanılır.')}</p></div>
      {error&&<div className="product-delete-error" role="alert"><AlertCircle size={18} aria-hidden="true"/><p>{t(error)}</p></div>}
      <AlertDialogFooter className="product-delete-footer">
        <AlertDialogCancel ref={cancelButton} className="product-delete-cancel" disabled={busy} onClick={event=>{if(pending.current)event.preventDefault();}}>{t('Ləğv et')}</AlertDialogCancel>
        <AlertDialogAction className="product-delete-confirm" variant="destructive" disabled={busy} aria-busy={busy} onClick={event=>{event.preventDefault();void removeProduct();}}>
          {busy?<LoaderCircle className="product-delete-spinner" size={17} aria-hidden="true"/>:<Trash2 size={17} aria-hidden="true"/>}
          <span role={busy?'status':undefined}>{t(busy?'Silinir…':'Bəli, məhsulu sil')}</span>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
