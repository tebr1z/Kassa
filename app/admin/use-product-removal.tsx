"use client";
import {useEffect,useRef,useState} from 'react';
import {CircleCheck,X} from 'lucide-react';
import {t,useLanguage} from '@/lib/language';
import {productRemovalRows,productRemovalDuration,type ExitingProduct} from '@/lib/product-removal';

export function useProductRemoval<T extends {id:string|number;name:string}>(rows:T[],refresh:()=>Promise<unknown>){
 const [exiting,setExiting]=useState<ExitingProduct<T>[]>([]),[hidden,setHidden]=useState<Set<string>>(new Set()),[notice,setNotice]=useState('');
 const removed=useRef(new Set<string>()),timers=useRef(new Set<ReturnType<typeof setTimeout>>());
 useEffect(()=>{const active=timers.current;return()=>{for(const timer of active)clearTimeout(timer);active.clear();};},[]);
 function remove(row:T){
  const id=String(row.id);if(removed.current.has(id))return;removed.current.add(id);
  setHidden(previous=>new Set(previous).add(id));
  setExiting(previous=>[...previous,{row,index:Math.max(0,rows.findIndex(item=>String(item.id)===id))}]);
  setNotice(row.name);
  const delay=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:productRemovalDuration;
  const timer=setTimeout(()=>{setExiting(previous=>previous.filter(item=>String(item.row.id)!==id));timers.current.delete(timer);},delay);timers.current.add(timer);
  // Refresh can finish before the exit animation or after this view unmounts.
  // The deletion has already succeeded: refresh failure must never invite a second DELETE.
  void Promise.resolve().then(refresh).catch(()=>{});
 }
 return {rows:productRemovalRows(rows,exiting,hidden),isRemoving:(id:string|number)=>exiting.some(item=>String(item.row.id)===String(id)),remove,notice,clearNotice:()=>setNotice('')};
}

export function ProductRemovalNotice({name,onClose}:{name:string;onClose:()=>void}){useLanguage();
 if(!name)return null;
 return <div className="product-removal-notice" role="status"><CircleCheck size={19} aria-hidden="true"/><span><strong>{t('Məhsul silindi.')}</strong><small>{name}</small></span><button type="button" onClick={onClose} aria-label={t('Bağla')}><X size={16}/></button></div>;
}
