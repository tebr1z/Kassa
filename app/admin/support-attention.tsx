'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useTranslations} from '@/lib/language';
import './support-desk.css';
export type SupportAttention={total:number;unread:number;unanswered:number};
export function validSupportAttention(value:unknown):value is SupportAttention {
 if(!value||typeof value!=='object')return false;
 const row=value as Record<string,unknown>;
 return ['total','unread','unanswered'].every(key=>Number.isSafeInteger(row[key])&&Number(row[key])>=0)&&Number(row.unread)<=Number(row.total)&&Number(row.unanswered)<=Number(row.total);
}
export function SupportCounts({attention}:{attention:SupportAttention|null}){
 const {t}=useTranslations();if(!attention)return null;
 return <span className="support-attention"><span className="support-pill is-unread" title={t('Oxunmamış biletlər')} aria-label={t('Oxunmamış biletlər')+': '+attention.unread}>{attention.unread}</span><span className="support-pill is-unanswered" title={t('Cavab gözləyən biletlər')} aria-label={t('Cavab gözləyən biletlər')+': '+attention.unanswered}>{attention.unanswered}</span></span>;
}
export function useSupportAttention(enabled:boolean){
 const [attention,setAttention]=useState<SupportAttention|null>(null),[error,setError]=useState(false);
 const request=useRef<AbortController|null>(null);
 const reload=useCallback(async()=>{
  if(!enabled)return;
  request.current?.abort();const controller=new AbortController();request.current=controller;
  try{const response=await fetch('/api/store-admin/chat?summary=1',{cache:'no-store',signal:controller.signal}),data=await response.json() as {attention?:SupportAttention};if(controller.signal.aborted)return;if(!response.ok||!validSupportAttention(data.attention))throw Error();setAttention(data.attention);setError(false);}
  catch{if(!controller.signal.aborted)setError(true);}
 },[enabled]);
 useEffect(()=>{if(!enabled)return;const frame=requestAnimationFrame(()=>void reload());const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void reload();},30000);return()=>{cancelAnimationFrame(frame);clearInterval(timer);request.current?.abort();};},[enabled,reload]);
 return {attention:enabled?attention:null,error:enabled&&error,reload,setAttention};
}
