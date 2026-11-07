"use client";
import {useId,useRef,useState,type FormEvent} from 'react';
import {CheckCircle2,Info,KeyRound,LoaderCircle,LockKeyhole,MapPin,Save,Search,ShieldCheck,UserRound,X} from 'lucide-react';
import {AddressMap} from './address-map';
import {t,useLanguage} from '@/lib/language';
export type AccountUser={id:string;name:string;email:string;phone:string;address:string;lat:number|null;lng:number|null};
type Pin={lat:number;lng:number};
type Place=Pin&{label:string};

export function AccountSettings({user,onSaved}:{user:AccountUser;onSaved:()=>Promise<void>}){
 useLanguage();const id=useId();
 const [name,setName]=useState(user.name),[phone,setPhone]=useState(user.phone),[address,setAddress]=useState(user.address);
 const [pin,setPin]=useState<Pin|null>(user.lat!=null&&user.lng!=null?{lat:user.lat,lng:user.lng}:null);
 const [query,setQuery]=useState(''),[places,setPlaces]=useState<Place[]>([]);
 const [searching,setSearching]=useState(false),[locating,setLocating]=useState(false),[saving,setSaving]=useState(false);
 const [addressNote,setAddressNote]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(false),[changingPassword,setChangingPassword]=useState(false);
 const savePending=useRef(false),searchRun=useRef(0),reverseRun=useRef(0);

 async function search(){
  if(savePending.current||query.trim().length<3||query.trim().length>120)return;
  const run=++searchRun.current;setSearching(true);setAddressNote('');setPlaces([]);
  try{
   const response=await fetch('/api/places?q='+encodeURIComponent(query.trim()),{cache:'no-store'});
   const data=await response.json() as {places?:Place[];error?:string};
   if(!response.ok)throw new Error(data.error||'Axtarış alınmadı.');
   if(run!==searchRun.current)return;
   setPlaces(data.places||[]);if(!data.places?.length)setAddressNote('Bu axtarışla ünvan tapılmadı.');
  }catch(cause){if(run===searchRun.current)setAddressNote(cause instanceof TypeError||cause instanceof SyntaxError?'Axtarış alınmadı.':cause instanceof Error?cause.message:'Axtarış alınmadı.');}
  finally{if(run===searchRun.current)setSearching(false);}
 }
 async function choose(next:Pin){
  if(savePending.current)return;
  const run=++reverseRun.current;setPin(next);setLocating(true);setAddressNote('');setSaved(false);
  try{
   const response=await fetch('/api/places?lat='+next.lat+'&lng='+next.lng,{cache:'no-store'});
   const data=await response.json() as {label?:string;error?:string};
   if(run!==reverseRun.current)return;
   if(response.ok&&data.label)setAddress(data.label.slice(0,300));
   else setAddressNote('Xəritə nöqtəsi seçildi. Ünvanı əl ilə yaza bilərsiniz.');
  }catch{if(run===reverseRun.current)setAddressNote('Xəritə nöqtəsi seçildi. Ünvanı əl ilə yaza bilərsiniz.');}
  finally{if(run===reverseRun.current)setLocating(false);}
 }
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(savePending.current||searching||locating)return;
  const form=event.currentTarget,fields=new FormData(form),newPassword=String(fields.get('newPassword')||''),currentPassword=String(fields.get('currentPassword')||'');
  if(newPassword&&!currentPassword){setError('Şifrəni dəyişmək üçün cari şifrənizi yazın.');form.querySelector<HTMLInputElement>('[name=currentPassword]')?.focus();return;}
  savePending.current=true;setSaving(true);setError('');setSaved(false);
  try{
   const response=await fetch('/api/customer-account',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,phone,address,lat:pin?.lat??null,lng:pin?.lng??null,currentPassword,newPassword:newPassword||undefined})});
   const data=await response.json() as {ok?:boolean;error?:string};
   if(!response.ok||data.ok!==true)throw new Error(data.error||'Hesab ayarları saxlanmadı.');
   for(const field of ['currentPassword','newPassword']){const input=form.elements.namedItem(field);if(input instanceof HTMLInputElement)input.value='';}
   setChangingPassword(false);setSaved(true);await onSaved();
  }catch(cause){setError(cause instanceof TypeError||cause instanceof SyntaxError?'Bağlantı alınmadı':cause instanceof Error?cause.message:'Hesab ayarları saxlanmadı.');}
  finally{savePending.current=false;setSaving(false);}
 }
 function choosePlace(place:Place){reverseRun.current++;setLocating(false);setPin({lat:place.lat,lng:place.lng});setAddress(place.label.slice(0,300));setPlaces([]);setAddressNote('');setSaved(false);}

 return <section className="account-settings" aria-labelledby={id+'-heading'}>
  <div className="account-section-heading"><div><span className="shop-tag">{t('ŞƏXSİ MƏLUMATLAR')}</span><h2 id={id+'-heading'}>{t('Hesab ayarları')}</h2><p>{t('Əlaqə məlumatınızı və çatdırılma ünvanınızı bir yerdən idarə edin.')}</p></div><ShieldCheck size={27} aria-hidden="true"/></div>
  <form className="account-profile-form" onSubmit={save} onInvalid={event=>{const details=(event.target as HTMLElement).closest('details');if(details)details.open=true;}}>
   <fieldset className="account-form-section" disabled={saving}><legend><UserRound size={19}/>{t('Əlaqə məlumatları')}</legend><div className="account-field-grid"><label>{t('Ad və soyad')}<input value={name} onChange={event=>{setName(event.target.value);setSaved(false);}} required minLength={2} maxLength={100} autoComplete="name"/></label><label>{t('Telefon')}<input value={phone} onChange={event=>{setPhone(event.target.value);setSaved(false);}} type="tel" required pattern="[+0-9 ()-]{7,25}" maxLength={25} autoComplete="tel"/></label></div><label>{t('E-poçt')}<span className="account-readonly-field"><input value={user.email} readOnly autoComplete="email" aria-describedby={id+'-email-help'}/><LockKeyhole size={16} aria-hidden="true"/></span></label><small id={id+'-email-help'} className="account-field-hint">{t('E-poçt giriş üçün istifadə olunur və burada dəyişdirilmir.')}</small></fieldset>
   <fieldset className="account-form-section" disabled={saving}><legend><MapPin size={19}/>{t('Çatdırılma ünvanı')}</legend><p className="account-field-hint">{t('Ünvanı axtarın, xəritədən seçin və ya əl ilə yazın.')}</p><div className="address-picker">
    <div className="address-search"><label htmlFor={id+'-address-search'}>{t('Ünvan axtar')}<span className="account-address-query"><Search size={17} aria-hidden="true"/><input id={id+'-address-search'} value={query} onChange={event=>{searchRun.current++;setSearching(false);setQuery(event.target.value);setPlaces([]);setAddressNote('');}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void search();}}} maxLength={120} autoComplete="off" placeholder={t('Küçə, məhəllə və ya nişan')}/>{query&&<button type="button" aria-label={t('Axtarışı təmizlə')} onClick={()=>{searchRun.current++;setSearching(false);setQuery('');setPlaces([]);}}><X size={16}/></button>}</span></label><button type="button" className="account-secondary" disabled={searching||query.trim().length<3} onClick={()=>void search()}>{searching?<LoaderCircle className="account-spin" size={16}/>:<Search size={16}/>} {t(searching?'Axtarılır…':'Axtar')}</button></div>
    {places.length>0&&<ul className="address-results" aria-label={t('Ünvan nəticələri')}>{places.map(place=><li key={place.lat+','+place.lng}><button type="button" onClick={()=>choosePlace(place)}><MapPin size={17}/><span>{place.label}</span></button></li>)}</ul>}
    <div className="account-map-frame"><AddressMap key={pin?'selected':'manual'} pin={pin} onPick={next=>void choose(next)}/><p><MapPin size={14}/>{t('Dəqiq nöqtə üçün xəritəyə toxunun. Ünvanı aşağıda dəqiqləşdirə bilərsiniz.')}</p></div>
    {locating&&<p className="account-inline-status" role="status"><LoaderCircle className="account-spin" size={15}/>{t('Ünvan müəyyənləşdirilir…')}</p>}
    {addressNote&&<p className="account-inline-status" role="status"><Info size={16}/>{t(addressNote)}</p>}
    <label>{t('Seçilmiş ünvan')}<textarea value={address} onChange={event=>{reverseRun.current++;setLocating(false);setAddress(event.target.value);setPin(null);setSaved(false);}} rows={3} maxLength={300} autoComplete="street-address" placeholder={t('Şəhər, küçə, bina və mənzil')}/></label>
    <small className="account-field-hint">{pin?t('Xəritə nöqtəsi seçilib.')+' '+pin.lat.toFixed(5)+', '+pin.lng.toFixed(5):t('Xəritə məcburi deyil. Tam ünvanı əl ilə də yaza bilərsiniz.')}</small>
   </div></fieldset>
   <details className="account-password-section"><summary><span><KeyRound size={19}/>{t('Şifrəni dəyiş')}</span><span className="account-field-hint">{t('istəyə bağlı')}</span></summary><fieldset disabled={saving} className="account-field-grid"><label>{t('Cari şifrə')}<input name="currentPassword" type="password" maxLength={128} autoComplete="current-password" placeholder={t('Şifrəni dəyişmək üçün')}/></label><label>{t('Yeni şifrə')}<input name="newPassword" type="password" minLength={8} maxLength={128} autoComplete="new-password" onChange={event=>setChangingPassword(Boolean(event.target.value))} placeholder={t('Boş saxlasanız dəyişməz')}/></label></fieldset><p className="account-field-hint">{t('Şifrə ən azı 8 simvol olmalıdır.')}</p></details>
   {error&&<div className="account-notice is-error" role="alert"><Info size={18}/><p>{t(error)}</p></div>}
   {saved&&<div className="account-notice is-success" role="status"><CheckCircle2 size={18}/><p>{t('Hesab ayarları saxlanıldı.')}</p></div>}
   <div className="account-save-bar"><small><ShieldCheck size={16}/>{t(changingPassword?'Şifrə yalnız saxladıqdan sonra dəyişir.':'Dəyişiklikləri yadda saxlamağı unutmayın.')}</small><button className="shop-primary" disabled={saving||searching||locating}>{saving?<LoaderCircle className="account-spin" size={17}/>:<Save size={17}/>} {t(saving?'Saxlanılır…':'Ayarları saxla')}</button></div>
  </form>
 </section>;
}
