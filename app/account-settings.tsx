"use client";
import {useId,useRef,useState,type FormEvent} from 'react';
import {CheckCircle2,Info,KeyRound,LoaderCircle,LockKeyhole,MapPin,Save,ShieldCheck,UserRound} from 'lucide-react';
import DeliveryLocationPicker from './delivery-location-picker';
import {useTranslations} from '@/lib/language';
import {customerPhonePattern,checkoutContactError,customerAddressError} from '@/lib/customer-contact';
import {isAzerbaijanCoordinate} from '@/lib/azerbaijan-location';
export type AccountUser={id:string;name:string;email:string;phone:string;address:string;lat:number|null;lng:number|null};
type Pin={lat:number;lng:number};
export function AccountSettings({user,onSaved}:{user:AccountUser;onSaved:()=>Promise<void>}){
 const {t}=useTranslations();const id=useId();
 const [name,setName]=useState(user.name),[phone,setPhone]=useState(user.phone),[address,setAddress]=useState(user.address);
 const [pin,setPin]=useState<Pin|null>(user.lat!=null&&user.lng!=null&&isAzerbaijanCoordinate(user.lat,user.lng)?{lat:user.lat,lng:user.lng}:null);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[saved,setSaved]=useState(false),[changingPassword,setChangingPassword]=useState(false);
 const savePending=useRef(false),addressVersion=useRef(0);
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(savePending.current)return;
  const contactError=checkoutContactError({name,phone});if(contactError){setError(contactError);return;}
  const addressError=customerAddressError(address,{required:false,maxLength:300});if(addressError){setError(addressError);return;}
  const form=event.currentTarget,fields=new FormData(form),newPassword=String(fields.get('newPassword')||''),currentPassword=String(fields.get('currentPassword')||'');
  if(newPassword&&!currentPassword){setError('Şifrəni dəyişmək üçün cari şifrənizi yazın.');form.querySelector<HTMLInputElement>('[name=currentPassword]')?.focus();return;}
  addressVersion.current++;savePending.current=true;setSaving(true);setError('');setSaved(false);
  try{
   const response=await fetch('/api/customer-account',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,phone,address,lat:pin?.lat??null,lng:pin?.lng??null,currentPassword,newPassword:newPassword||undefined})});
   const data=await response.json() as {ok?:boolean;error?:string};
   if(!response.ok||data.ok!==true)throw new Error(data.error||'Hesab ayarları saxlanmadı.');
   for(const field of ['currentPassword','newPassword']){const input=form.elements.namedItem(field);if(input instanceof HTMLInputElement)input.value='';}
   setChangingPassword(false);setSaved(true);await onSaved();
  }catch(cause){setError(cause instanceof TypeError||cause instanceof SyntaxError?'Bağlantı alınmadı':cause instanceof Error?cause.message:'Hesab ayarları saxlanmadı.');}
  finally{savePending.current=false;setSaving(false);}
 }
 return <section className="account-settings" aria-labelledby={id+'-heading'}>
  <div className="account-section-heading"><div><span className="shop-tag">{t('ŞƏXSİ MƏLUMATLAR')}</span><h2 id={id+'-heading'}>{t('Hesab ayarları')}</h2><p>{t('Əlaqə məlumatınızı və çatdırılma ünvanınızı bir yerdən idarə edin.')}</p></div><ShieldCheck size={27} aria-hidden="true"/></div>
  <form className="account-profile-form" onSubmit={save} onInvalid={event=>{const details=(event.target as HTMLElement).closest('details');if(details)details.open=true;}}>
   <fieldset className="account-form-section" disabled={saving}><legend><UserRound size={19}/>{t('Əlaqə məlumatları')}</legend><div className="account-field-grid"><label>{t('Ad və soyad')}<input value={name} onChange={event=>{setName(event.target.value);setSaved(false);}} required minLength={2} maxLength={100} autoComplete="name"/></label><label>{t('Telefon')}<input value={phone} onChange={event=>{setPhone(event.target.value);setSaved(false);}} type="tel" required pattern={customerPhonePattern} maxLength={25} autoComplete="tel"/></label></div><label>{t('E-poçt')}<span className="account-readonly-field"><input value={user.email} readOnly autoComplete="email" aria-describedby={id+'-email-help'}/><LockKeyhole size={16} aria-hidden="true"/></span></label><small id={id+'-email-help'} className="account-field-hint">{t('E-poçt giriş üçün istifadə olunur və burada dəyişdirilmir.')}</small></fieldset>
   <fieldset className="account-form-section" disabled={saving}><legend><MapPin size={19}/>{t('Çatdırılma ünvanı')}</legend><p className="account-field-hint">{t('Ünvanı axtarın, xəritədən seçin və ya əl ilə yazın.')}</p><div className="address-picker">
    <DeliveryLocationPicker pin={pin} address={address} disabled={saving} selectionVersion={()=>addressVersion.current} onPick={next=>{if(savePending.current)return;addressVersion.current++;setPin(next);setSaved(false);}} onAddressPick={(label,next)=>{if(savePending.current)return;addressVersion.current++;setAddress(label.slice(0,300));setPin(next);setSaved(false);}}/>
    <label>{t('Seçilmiş ünvan')}<textarea value={address} onChange={event=>{addressVersion.current++;setAddress(event.target.value);setPin(null);setSaved(false);}} rows={3} maxLength={300} autoComplete="street-address" placeholder={t('Şəhər, küçə, bina və mənzil')}/></label>
    <small className="account-field-hint">{pin?t('Xəritə nöqtəsi seçilib.')+' '+pin.lat.toFixed(5)+', '+pin.lng.toFixed(5):t('Xəritə məcburi deyil. Tam ünvanı əl ilə də yaza bilərsiniz.')}</small>
   </div></fieldset>
   <details className="account-password-section"><summary><span><KeyRound size={19}/>{t('Şifrəni dəyiş')}</span><span className="account-field-hint">{t('istəyə bağlı')}</span></summary><fieldset disabled={saving} className="account-field-grid"><label>{t('Cari şifrə')}<input name="currentPassword" type="password" maxLength={128} autoComplete="current-password" placeholder={t('Şifrəni dəyişmək üçün')}/></label><label>{t('Yeni şifrə')}<input name="newPassword" type="password" minLength={8} maxLength={128} autoComplete="new-password" onChange={event=>setChangingPassword(Boolean(event.target.value))} placeholder={t('Boş saxlasanız dəyişməz')}/></label></fieldset><p className="account-field-hint">{t('Şifrə ən azı 8 simvol olmalıdır.')}</p></details>
   {error&&<div className="account-notice is-error" role="alert"><Info size={18}/><p>{t(error)}</p></div>}
   {saved&&<div className="account-notice is-success" role="status"><CheckCircle2 size={18}/><p>{t('Hesab ayarları saxlanıldı.')}</p></div>}
   <div className="account-save-bar"><small><ShieldCheck size={16}/>{t(changingPassword?'Şifrə yalnız saxladıqdan sonra dəyişir.':'Dəyişiklikləri yadda saxlamağı unutmayın.')}</small><button className="shop-primary" disabled={saving}>{saving?<LoaderCircle className="account-spin" size={17}/>:<Save size={17}/>} {t(saving?'Saxlanılır…':'Ayarları saxla')}</button></div>
  </form>
 </section>;
}
