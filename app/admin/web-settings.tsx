'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {useTranslations} from '@/lib/language';
import StaffAccessSettings from './staff-access-settings';

type Branch={id:string;name:string;address:string;phone:string;currency:string;timezone:string};
type User={id:string;fullName:string;role:string;isActive:boolean;hasPin:boolean;hasPassword:boolean;branchId?:string;branchName?:string};
type Data={branch:Branch|null;branches:{id:string;name:string;address:string}[];users:User[]};
export default function WebSettings(){
 const {t}=useTranslations(),mounted=useRef(true),pending=useRef(false),request=useRef<AbortController|null>(null);
 const [data,setData]=useState<Data|null>(null),[tab,setTab]=useState<'branch'|'users'>('branch'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async()=>{
  const controller=new AbortController();request.current?.abort();request.current=controller;
  try{const response=await fetch('/api/settings',{cache:'no-store',signal:controller.signal}),result=await response.json() as Data;
   if(!response.ok||!Array.isArray(result.users)||!Array.isArray(result.branches))throw Error();
   if(mounted.current&&!controller.signal.aborted)setData({branch:result.branch,branches:result.branches,users:result.users});
  }catch{if(mounted.current&&!controller.signal.aborted)setError('Tənzimləmələr yüklənmədi. Yenidən cəhd edin.');}
 },[]);
 useEffect(()=>{mounted.current=true;let cancelled=false;queueMicrotask(()=>{if(!cancelled)void load();});return()=>{cancelled=true;mounted.current=false;request.current?.abort();};},[load]);
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current)return;const fields=new FormData(event.currentTarget);
  const body={action:'branch',name:fields.get('name'),address:fields.get('address'),phone:fields.get('phone'),currency:fields.get('currency'),timezone:fields.get('timezone')};
  pending.current=true;setBusy(true);setError('');setMessage('');const controller=new AbortController();request.current?.abort();request.current=controller;
  try{const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   if(!mounted.current||controller.signal.aborted)return;if(!response.ok)throw Error();setMessage('Dəyişikliklər saxlanıldı');await load();
  }catch{if(mounted.current&&!controller.signal.aborted)setError('Tənzimləmə saxlanmadı');}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 if(!data)return <div className="panel settings-form"><h2>{t(error||'Tənzimləmələr yüklənir...')}</h2>{error&&<button type="button" onClick={()=>{setError('');void load();}}>{t('Yenidən yoxla')}</button>}</div>;
 return <div className="settings-grid"><div className="panel settings-menu"><button type="button" disabled={busy} className={tab==='branch'?'selected':''} onClick={()=>setTab('branch')}>{t('Şirkət və filial')}</button><button type="button" disabled={busy} className={tab==='users'?'selected':''} onClick={()=>setTab('users')}>{t('İstifadəçilər və rollar')}</button></div><div className="panel settings-form">
  {error&&<p role="alert" className="form-error">{t(error)}</p>}{message&&<p role="status" className="form-success">{t(message)}</p>}
  {tab==='users'&&<StaffAccessSettings users={data.users} branches={data.branches} onChanged={load}/>}
  {tab==='branch'&&data.branch&&<form onSubmit={event=>void save(event)}><span>{t('ÜMUMİ MƏLUMATLAR')}</span><h2>{data.branch.name}</h2><fieldset disabled={busy} style={{border:0,padding:0,margin:0}}>
   <label>{t('Mağazanın adı')}<input name="name" defaultValue={data.branch.name} required maxLength={150}/></label><label>{t('Ünvan')}<input name="address" defaultValue={data.branch.address} maxLength={500}/></label><label>{t('Telefon')}<input name="phone" defaultValue={data.branch.phone} maxLength={50}/></label><div className="form-row"><label>{t('Valyuta')}<input name="currency" defaultValue={data.branch.currency} maxLength={10}/></label><label>{t('Saat qurşağı')}<input name="timezone" defaultValue={data.branch.timezone} maxLength={100}/></label></div><button type="submit" disabled={busy}>{t('Dəyişiklikləri saxla')}</button>
  </fieldset></form>}
  <p className="admin-security-notice" role="note">{t('Kassa və anbar ayarları yalnız masaüstü tətbiqdə dəyişdirilir.')}</p>
 </div></div>;
}
