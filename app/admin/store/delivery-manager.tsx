'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {AlertCircle,Calculator,Check,LoaderCircle,MapPin,Route,ShieldCheck,Truck} from 'lucide-react';
import {languageAmount,t,useLanguage} from '@/lib/language';
import {deliveryCharge,type DeliverySettings} from '@/lib/delivery';
import {isAzerbaijanCoordinate} from '@/lib/azerbaijan-location';
import DeliveryLocationPicker from '../../delivery-location-picker';
import './delivery-manager.css';

type Draft={mode:'manual'|'distance';minimumOrder:string;minimumFee:string;pricePerKm:string;freeDistanceKm:string;freeOrderFrom:string;originAddress:string;originLat:string;originLng:string;routingConfigured:boolean;tileUrl?:string};
type DeliveryResponse={settings?:DeliverySettings;ok?:boolean;error?:string};
const toDraft=(settings:DeliverySettings):Draft=>({mode:settings.mode,minimumOrder:String(settings.minimumOrder),minimumFee:String(settings.minimumFee),pricePerKm:String(settings.pricePerKm),freeDistanceKm:String(settings.freeDistanceKm??0),freeOrderFrom:settings.freeOrderFrom==null?'':String(settings.freeOrderFrom),originAddress:settings.originAddress,originLat:settings.originLat===null?'':String(settings.originLat),originLng:settings.originLng===null?'':String(settings.originLng),routingConfigured:Boolean(settings.routingConfigured),tileUrl:settings.tileUrl});
const bounded=(value:string,min:number,max:number)=>value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
const money=(value:number)=>`${languageAmount(value)} AZN`;
const distanceSetupError='Məsafə rejimi üçün Azərbaycan daxilində mərkəz nöqtəsi, müsbət km tarifi və hazır marşrut xidməti lazımdır.';
async function readSettings(signal?:AbortSignal){
 const response=await fetch('/api/admin/delivery',{cache:'no-store',signal});
 const result=await response.json() as DeliveryResponse;
 if(!response.ok)throw new Error(response.status===401?'Giriş vaxtı bitib. Yenidən daxil olun.':response.status===403?'Bu əməliyyat üçün icazəniz yoxdur.':result.error||'Çatdırılma ayarları yüklənmədi.');
 if(!result.settings)throw new Error('Çatdırılma ayarları yüklənmədi.');return result.settings;
}

export default function DeliveryManager(){
 useLanguage();
 const [saved,setSaved]=useState<DeliverySettings|null>(null),[draft,setDraft]=useState<Draft|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [previewKm,setPreviewKm]=useState('5'),[previewGoods,setPreviewGoods]=useState('20');
 const pending=useRef(false),originVersion=useRef(0),statusRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=new AbortController();
  void readSettings(controller.signal).then(settings=>{if(!controller.signal.aborted){setSaved(settings);setDraft(toDraft(settings));}}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Çatdırılma ayarları yüklənmədi.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[]);
 function update<K extends keyof Draft>(key:K,value:Draft[K]){if(pending.current)return;if(key==='originAddress'||key==='originLat'||key==='originLng')originVersion.current++;setDraft(current=>current?{...current,[key]:value,...(key==='originAddress'?{originLat:'',originLng:''}:{})}:current);setNotice('');setError('');}
 function chooseOrigin(point:{lat:number;lng:number},label?:string){if(pending.current)return;originVersion.current++;setDraft(current=>current?{...current,originLat:String(point.lat),originLng:String(point.lng),...(label===undefined?{}:{originAddress:label.slice(0,300)})}:current);setNotice('');setError('');}
 async function retry(){setLoading(true);setError('');try{const settings=await readSettings();setSaved(settings);setDraft(toDraft(settings));}catch(reason){setError(reason instanceof Error?reason.message:'Çatdırılma ayarları yüklənmədi.');}finally{setLoading(false);}}
 function reset(){originVersion.current++;if(saved)setDraft(toDraft(saved));setNotice('');setError('');}
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!draft||pending.current)return;setError('');setNotice('');
  if(![draft.minimumOrder,draft.minimumFee,draft.pricePerKm].every(value=>bounded(value,0,1000000))||!bounded(draft.freeDistanceKm,0,10000)||draft.freeOrderFrom.trim()!==''&&!bounded(draft.freeOrderFrom,0,1000000)){setError('Çatdırılma məbləğlərini və pulsuz məsafəni düzgün yazın.');return;}
  const hasLat=draft.originLat.trim()!=='',hasLng=draft.originLng.trim()!=='';
  const coordinatesValid=hasLat&&hasLng&&isAzerbaijanCoordinate(Number(draft.originLat),Number(draft.originLng));
  if(hasLat!==hasLng||hasLat&&!coordinatesValid){setError('Xəritədə Azərbaycan daxilində nöqtə seçin.');return;}
  if(draft.mode==='distance'&&(!draft.originAddress.trim()||!coordinatesValid||Number(draft.pricePerKm)<=0||!draft.routingConfigured)){setError(distanceSetupError);return;}
  originVersion.current++;pending.current=true;setBusy(true);
  try{
   const response=await fetch('/api/admin/delivery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:draft.mode,minimumOrder:Number(draft.minimumOrder),minimumFee:Number(draft.minimumFee),pricePerKm:Number(draft.pricePerKm),freeDistanceKm:Number(draft.freeDistanceKm),freeOrderFrom:draft.freeOrderFrom.trim()===''?null:Number(draft.freeOrderFrom),originAddress:draft.originAddress,originLat:hasLat?Number(draft.originLat):null,originLng:hasLng?Number(draft.originLng):null})});
   const result=await response.json() as DeliveryResponse;
   if(!response.ok)throw new Error(response.status===401?'Giriş vaxtı bitib. Yenidən daxil olun.':response.status===403?'Bu əməliyyat üçün icazəniz yoxdur.':result.error||'Çatdırılma ayarları saxlanmadı.');
   if(!result.settings&&result.ok!==true)throw new Error('Çatdırılma ayarları saxlanmadı.');
   const settings=result.settings||await readSettings();setSaved(settings);setDraft(toDraft(settings));setNotice('Çatdırılma ayarları saxlanıldı.');
  }catch(reason){setError(reason instanceof Error?reason.message:'Çatdırılma ayarları saxlanmadı.');}
  finally{pending.current=false;setBusy(false);statusRef.current?.focus();}
 }
 if(loading)return <section className="delivery-admin delivery-admin-loading" aria-busy="true"><LoaderCircle size={22} className="da-spin" aria-hidden="true"/><p>{t('Çatdırılma ayarları yüklənir…')}</p></section>;
 if(!draft)return <section className="delivery-admin delivery-admin-error"><AlertCircle aria-hidden="true"/><h2>{t('Çatdırılma')}</h2><p role="alert">{t(error)}</p><button type="button" onClick={()=>void retry()}>{t('Yenidən cəhd et')}</button></section>;
 const coordinatesValid=bounded(draft.originLat,38.3,42)&&bounded(draft.originLng,44.7,51)&&isAzerbaijanCoordinate(Number(draft.originLat),Number(draft.originLng));
 const pin=coordinatesValid?{lat:Number(draft.originLat),lng:Number(draft.originLng)}:null;
 const ready=Boolean(draft.originAddress.trim()&&coordinatesValid&&Number(draft.pricePerKm)>0&&draft.routingConfigured);
 const dirty=JSON.stringify(draft)!==JSON.stringify(saved&&toDraft(saved));
 let calculated:number|null=null;
 if(bounded(previewKm,0.001,10000)&&bounded(previewGoods,0,1000000)&&bounded(draft.freeDistanceKm,0,10000)&&bounded(draft.pricePerKm,0.001,1000000)&&bounded(draft.minimumFee,0,1000000)&&(draft.freeOrderFrom.trim()===''||bounded(draft.freeOrderFrom,0,1000000))){try{calculated=deliveryCharge({pricePerKm:Number(draft.pricePerKm),minimumFee:Number(draft.minimumFee),freeDistanceKm:Number(draft.freeDistanceKm),freeOrderFrom:draft.freeOrderFrom.trim()===''?null:Number(draft.freeOrderFrom)},Number(previewKm)*1000,Number(previewGoods));}catch{/* Invalid preview never becomes a displayed free delivery. */}}
 return <section className="delivery-admin" aria-labelledby="delivery-admin-title">
  <header className="da-heading"><div className="da-heading-icon"><Truck size={24} aria-hidden="true"/></div><div><span className="da-eyebrow">{t('ÇATDIRILMA İDARƏETMƏSİ')}</span><h2 id="delivery-admin-title">{t('Çatdırılma ayarları')}</h2><p>{t('Təhvil üsulu, minimum sifariş və məsafəyə görə çatdırılma qiyməti bir yerdə.')}</p></div></header>
  <form onSubmit={save}><fieldset disabled={busy} className="da-form-fields">
   <fieldset className="da-modes"><legend>{t('Qiymət necə hesablansın?')}</legend>
    <label className={`da-mode ${draft.mode==='manual'?'is-selected':''}`}><input type="radio" name="delivery-mode" value="manual" checked={draft.mode==='manual'} onChange={()=>update('mode','manual')}/><span className="da-mode-symbol"><Truck size={20} aria-hidden="true"/></span><span><strong>{t('Mağaza təsdiqləyir')}</strong><small>{t('Məbləği mağaza müştəri ilə razılaşdırır. Səbətdə pulsuz kimi göstərilmir.')}</small></span>{draft.mode==='manual'&&<Check size={19} className="da-mode-check" aria-hidden="true"/>}</label>
    <label className={`da-mode ${draft.mode==='distance'?'is-selected':''}`}><input type="radio" name="delivery-mode" value="distance" checked={draft.mode==='distance'} onChange={()=>update('mode','distance')}/><span className="da-mode-symbol"><Route size={20} aria-hidden="true"/></span><span><strong>{t('Kilometrə görə avtomatik')}</strong><small>{t('Avtomobil yolu məsafəsi mağazanın marşrut xidməti ilə hesablanır. Google açarı lazım deyil.')}</small></span>{draft.mode==='distance'&&<Check size={19} className="da-mode-check" aria-hidden="true"/>}</label>
   </fieldset>
   <div className="da-grid">
    <section className="da-card"><div className="da-card-title"><span><Calculator size={20} aria-hidden="true"/></span><div><h3>{t('Qiymətlər və minimumlar')}</h3><p>{t('Məhsul qiyməti ilə çatdırılma haqqını ayrı saxlayın.')}</p></div></div>
     <label className="da-field">{t('Çatdırılma üçün minimum sifariş')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="1000000" step=".01" required value={draft.minimumOrder} onChange={event=>update('minimumOrder',event.target.value)}/><span>AZN</span></span><small>{t('Endirimlərdən sonrakı məhsul cəmi. 0 yazsanız minimum tətbiq olunmur. Mağazadan götürməyə aid deyil.')}</small></label>
     <div className="da-two-fields"><label className="da-field">{t('Minimum çatdırılma haqqı')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="1000000" step=".01" required value={draft.minimumFee} onChange={event=>update('minimumFee',event.target.value)}/><span>AZN</span></span></label><label className="da-field">{t('Hər kilometr üçün')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="1000000" step=".01" required value={draft.pricePerKm} onChange={event=>update('pricePerKm',event.target.value)}/><span>AZN / km</span></span></label></div>
     <div className="da-two-fields"><label className="da-field">{t('İlk pulsuz məsafə')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="10000" step=".1" required value={draft.freeDistanceKm} onChange={event=>update('freeDistanceKm',event.target.value)}/><span>km</span></span><small>{t('Bu yol məsafəsinədək çatdırılma pulsuzdur. 0 yazsanız pulsuz məsafə yoxdur.')}</small></label><label className="da-field">{t('Pulsuz çatdırılma üçün sifariş məbləği')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="1000000" step=".01" value={draft.freeOrderFrom} onChange={event=>update('freeOrderFrom',event.target.value)} placeholder={t('Tətbiq olunmur')}/><span>AZN</span></span><small>{t('Endirimdən sonrakı məhsul cəmi bu həddə çatanda çatdırılma pulsuzdur. Boş saxlasanız tətbiq olunmur.')}</small></label></div>
     <p className="da-hint">{t('Yalnız pulsuz məsafədən sonrakı yol hesablanır. Minimum haqq yalnız ödənişli məsafəyə tətbiq edilir.')}</p>
     <div className={`da-preview ${draft.mode==='manual'?'is-muted':''}`}><div><strong>{t('Hesablama nümunəsi')}</strong><span>{t('Bu yalnız nümunədir; marşrut sorğusu göndərilmir.')}</span></div><label><small className="da-preview-label">{t('Nümunə məsafə')}</small><input aria-label={t('Nümunə məsafə')} type="number" min=".1" max="2000" step=".1" inputMode="decimal" value={previewKm} onChange={event=>setPreviewKm(event.target.value)}/><span>km</span></label><label><small className="da-preview-label">{t('Nümunə məhsul cəmi')}</small><input aria-label={t('Nümunə məhsul cəmi')} type="number" min="0" max="1000000" step=".01" inputMode="decimal" value={previewGoods} onChange={event=>setPreviewGoods(event.target.value)}/><span>AZN</span></label><output aria-live="polite">{calculated===null?'—':money(calculated)}</output>{draft.mode==='manual'&&<small>{t('Əl rejimində bu hesab müştəriyə tətbiq edilmir.')}</small>}</div>
    </section>
    <section className="da-card"><div className="da-card-title"><span><MapPin size={20} aria-hidden="true"/></span><div><h3>{t('Çatdırılmanın başlanğıc nöqtəsi')}</h3><p>{t('Məsafə bu mağaza və ya anbardan müştərinin seçdiyi yerə hesablanır.')}</p></div></div>
     <label className="da-field">{t('Mərkəz ünvanı')}<textarea rows={3} maxLength={300} value={draft.originAddress} onChange={event=>update('originAddress',event.target.value)} placeholder={t('Mağaza / anbarın tam ünvanı')}/><small>{t('Ünvanı dəyişəndə köhnə nöqtə silinir. Xəritədə düzgün mərkəzi yenidən seçin.')}</small></label>
     <DeliveryLocationPicker pin={pin} address={draft.originAddress} disabled={busy} tileUrl={draft.tileUrl} selectionVersion={()=>originVersion.current} onPick={point=>chooseOrigin(point)} onAddressPick={(label,point)=>chooseOrigin(point,label)}/>
     <details className="da-keys"><summary><MapPin size={17} aria-hidden="true"/><span><strong>{t('Koordinatları əl ilə yaz')}</strong></span></summary><div className="da-two-fields da-key-fields"><label className="da-field">{t('Enlik (latitude)')}<input type="number" inputMode="decimal" step="any" min="38.3" max="42" value={draft.originLat} onChange={event=>update('originLat',event.target.value)} placeholder="40.4093"/></label><label className="da-field">{t('Uzunluq (longitude)')}<input type="number" inputMode="decimal" step="any" min="44.7" max="51" value={draft.originLng} onChange={event=>update('originLng',event.target.value)} placeholder="49.8671"/></label></div></details>
     <div className={`da-readiness ${ready?'is-ready':''}`}><ShieldCheck size={19} aria-hidden="true"/><div><strong>{ready?t('Avtomatik hesablamaya hazırdır'):t('Avtomatik hesablama hələ hazır deyil')}</strong><small>{t(draft.routingConfigured?'Marşrut xidməti serverdə sazlanıb. Mərkəzi və tarifi saxladıqdan sonra yeni sifarişlərdə tətbiq edilir.':'Marşrut xidməti hazırda sazlanmayıb. Əl rejimindən istifadə edə bilərsiniz.')}</small></div></div>
    </section>
   </div>
  </fieldset><div className="da-save-bar"><div><strong>{dirty?t('Saxlanmamış dəyişikliklər var'):t('Ayarlar aktualdır')}</strong><small>{t('Bu ayarlar yalnız yeni sifarişlərə tətbiq edilir. Mövcud sifarişlərin məbləği dəyişmir.')}</small></div><div className="da-save-actions"><button type="button" className="da-reset" disabled={busy||!dirty} onClick={reset}>{t('Dəyişiklikləri geri al')}</button><button type="submit" className="da-save" disabled={busy||!dirty}>{busy?<LoaderCircle size={17} className="da-spin" aria-hidden="true"/>:<Check size={17} aria-hidden="true"/>}{busy?t('Saxlanılır…'):t('Çatdırılma ayarlarını saxla')}</button></div></div>
  {(error||notice)&&<p ref={statusRef} tabIndex={-1} className={`da-status ${error?'is-error':'is-success'}`} role={error?'alert':'status'}>{error?<AlertCircle size={18} aria-hidden="true"/>:<Check size={18} aria-hidden="true"/>}{t(error||notice)}</p>}</form>
 </section>;
}
