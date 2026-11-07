"use client";
import {useRef,useState,type FormEvent} from 'react';
import {useTranslations} from '@/lib/language';
import {staffPasswordFormError} from '@/lib/staff-onboarding';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import './staff-access-settings.css';

export default function StaffPasswordSetup({userId,name,ready,onSaved,disabled=false}:{userId:string;name:string;ready:boolean;onSaved:()=>Promise<void>;disabled?:boolean}){
 const {t}=useTranslations(),pending=useRef(false);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current)return;const form=event.currentTarget,fields=new FormData(form),password=String(fields.get('password')||'');
  const validation=staffPasswordFormError(password,String(fields.get('confirmation')||''));if(validation){setError(validation);return;}
  pending.current=true;setBusy(true);setError('');setSaved(false);
  try{const response=await fetch('/api/locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'password',userId,password})}),data=await response.json() as {ok?:boolean;error?:string};if(!response.ok||!data.ok)throw Error(data.error||'Saxlanmadı');form.reset();setOpen(false);setSaved(true);await onSaved().catch(()=>{});}catch(cause){setError(cause instanceof Error?cause.message:'Bağlantı alınmadı');}finally{pending.current=false;setBusy(false);}
 }
 return <div className="staff-password-action"><Dialog open={open} onOpenChange={next=>{if(!pending.current){setOpen(next);setError('');}}}><DialogTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled||busy}>{t(ready?'Şifrəni dəyiş':'Şifrə qur')}</Button></DialogTrigger><DialogContent className="staff-password-dialog" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onInteractOutside={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>{t('Veb giriş şifrəsi')}</DialogTitle><DialogDescription>{name} · {t('PIN veb giriş şifrəsi deyil. Giriş üçün ayrıca güclü şifrə qurun.')}</DialogDescription></DialogHeader><form className="product-form" onSubmit={submit}><fieldset disabled={busy}><label>{t('Veb giriş şifrəsi')}<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label><label>{t('Veb şifrəni təkrarla')}<input name="confirmation" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label><small>{t('Ən azı 12 simvol, hərf və rəqəm istifadə edin.')}</small>{error&&<p role="alert" className="form-error">{t(error)}</p>}<Button type="submit" disabled={busy}>{t(busy?'Saxlanılır…':'Saxla')}</Button></fieldset></form></DialogContent></Dialog>{saved&&<small role="status">{t('Veb şifrə saxlanıldı.')}</small>}</div>;
}
