'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {AlertCircle,Calculator,Check,ChevronDown,KeyRound,LoaderCircle,MapPin,Route,ShieldCheck,Truck} from 'lucide-react';
import {languageAmount,t,useLanguage} from '@/lib/language';
import './delivery-manager.css';

type DeliverySettings={
  mode:'manual'|'distance';
  minimumOrder:number;
  minimumFee:number;
  pricePerKm:number;
  originAddress:string;
  originLat:number|null;
  originLng:number|null;
  browserKey:string;
  serverConfigured:boolean;
};
type Draft=Omit<DeliverySettings,'minimumOrder'|'minimumFee'|'pricePerKm'|'originLat'|'originLng'>&{
  minimumOrder:string;minimumFee:string;pricePerKm:string;originLat:string;originLng:string;
};
type DeliveryResponse={settings?:DeliverySettings;ok?:boolean;error?:string};
const toDraft=(settings:DeliverySettings):Draft=>({...settings,minimumOrder:String(settings.minimumOrder),minimumFee:String(settings.minimumFee),pricePerKm:String(settings.pricePerKm),originLat:settings.originLat===null?'':String(settings.originLat),originLng:settings.originLng===null?'':String(settings.originLng)});
const bounded=(value:string,min:number,max:number)=>value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
const money=(value:number)=>`${languageAmount(value)} AZN`;

async function readSettings(signal?:AbortSignal){
  const response=await fetch('/api/admin/delivery',{cache:'no-store',signal});
  const result=await response.json() as DeliveryResponse;
  if(!response.ok)throw new Error(response.status===401?'Giriş vaxtı bitib. Yenidən daxil olun.':response.status===403?'Bu əməliyyat üçün icazəniz yoxdur.':result.error||'Çatdırılma ayarları yüklənmədi.');
  if(!result.settings)throw new Error('Çatdırılma ayarları yüklənmədi.');
  return result.settings;
}

export default function DeliveryManager(){
  useLanguage();
  const [saved,setSaved]=useState<DeliverySettings|null>(null),[draft,setDraft]=useState<Draft|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [serverKey,setServerKey]=useState(''),[clearServerKey,setClearServerKey]=useState(false),[previewKm,setPreviewKm]=useState('5');
  const pending=useRef(false),statusRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{
    const controller=new AbortController();
    void readSettings(controller.signal).then(settings=>{setSaved(settings);setDraft(toDraft(settings));}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Çatdırılma ayarları yüklənmədi.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[]);

  function update<K extends keyof Draft>(key:K,value:Draft[K]){
    setDraft(current=>current?{...current,[key]:value}:current);setNotice('');setError('');
  }
  async function retry(){
    setLoading(true);setError('');
    try{const settings=await readSettings();setSaved(settings);setDraft(toDraft(settings));}
    catch(reason){setError(reason instanceof Error?reason.message:'Çatdırılma ayarları yüklənmədi.');}
    finally{setLoading(false);}
  }
  function reset(){if(saved)setDraft(toDraft(saved));setServerKey('');setClearServerKey(false);setNotice('');setError('');}
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!draft||pending.current)return;
    setError('');setNotice('');
    if(![draft.minimumOrder,draft.minimumFee,draft.pricePerKm].every(value=>bounded(value,0,1000000))){setError('Məbləğləri 0 ilə 1 000 000 arasında yazın.');return;}
    const hasLat=draft.originLat.trim()!=='',hasLng=draft.originLng.trim()!=='';
    if(hasLat!==hasLng||(hasLat&&(!bounded(draft.originLat,-90,90)||!bounded(draft.originLng,-180,180)))){setError('Mərkəzin düzgün enlik və uzunluğunu birlikdə yazın.');return;}
    const keyReady=Boolean(serverKey.trim()||draft.serverConfigured&&!clearServerKey);
    if(draft.mode==='distance'&&(!draft.originAddress.trim()||!hasLat||Number(draft.pricePerKm)<=0||!keyReady)){
      setError('Avtomatik hesablama üçün mərkəz ünvanı, koordinatlar, müsbət km tarifi və server açarı lazımdır.');return;
    }
    pending.current=true;setBusy(true);
    try{
      const response=await fetch('/api/admin/delivery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,minimumOrder:Number(draft.minimumOrder),minimumFee:Number(draft.minimumFee),pricePerKm:Number(draft.pricePerKm),originLat:hasLat?Number(draft.originLat):null,originLng:hasLng?Number(draft.originLng):null,serverKey:serverKey.trim(),clearServerKey})});
      const result=await response.json() as DeliveryResponse;
      if(!response.ok)throw new Error(response.status===401?'Giriş vaxtı bitib. Yenidən daxil olun.':response.status===403?'Bu əməliyyat üçün icazəniz yoxdur.':result.error||'Çatdırılma ayarları saxlanmadı.');
      if(!result.settings&&result.ok!==true)throw new Error('Çatdırılma ayarları saxlanmadı.');
      const settings=result.settings||await readSettings();
      setSaved(settings);setDraft(toDraft(settings));setServerKey('');setClearServerKey(false);setNotice('Çatdırılma ayarları saxlanıldı.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Çatdırılma ayarları saxlanmadı.');}
    finally{pending.current=false;setBusy(false);statusRef.current?.focus();}
  }

  if(loading)return <section className="delivery-admin delivery-admin-loading" aria-busy="true"><LoaderCircle size={22} className="da-spin" aria-hidden="true"/><p>{t('Çatdırılma ayarları yüklənir…')}</p></section>;
  if(!draft)return <section className="delivery-admin delivery-admin-error"><AlertCircle aria-hidden="true"/><h2>{t('Çatdırılma')}</h2><p role="alert">{t(error)}</p><button type="button" onClick={()=>void retry()}>{t('Yenidən cəhd et')}</button></section>;
  const coordinatesValid=bounded(draft.originLat,-90,90)&&bounded(draft.originLng,-180,180);
  const serverReady=Boolean(serverKey.trim()||draft.serverConfigured&&!clearServerKey);
  const ready=Boolean(draft.originAddress.trim()&&coordinatesValid&&Number(draft.pricePerKm)>0&&serverReady);
  const dirty=JSON.stringify(draft)!==JSON.stringify(saved&&toDraft(saved))||Boolean(serverKey)||clearServerKey;
  const previewValid=bounded(previewKm,0,10000)&&bounded(draft.pricePerKm,0,1000000)&&bounded(draft.minimumFee,0,1000000);
  const calculated=previewValid?Math.max(Number(draft.minimumFee),Number(previewKm)*Number(draft.pricePerKm)):null;

  return <section className="delivery-admin" aria-labelledby="delivery-admin-title">
    <header className="da-heading"><div className="da-heading-icon"><Truck size={24} aria-hidden="true"/></div><div><span className="da-eyebrow">{t('ÇATDIRILMA İDARƏETMƏSİ')}</span><h2 id="delivery-admin-title">{t('Çatdırılma ayarları')}</h2><p>{t('Təhvil üsulu, minimum sifariş və məsafəyə görə çatdırılma qiyməti bir yerdə.')}</p></div></header>
    <form onSubmit={save}>
      <fieldset disabled={busy} className="da-form-fields">
        <fieldset className="da-modes"><legend>{t('Qiymət necə hesablansın?')}</legend>
          <label className={`da-mode ${draft.mode==='manual'?'is-selected':''}`}><input type="radio" name="delivery-mode" value="manual" checked={draft.mode==='manual'} onChange={()=>update('mode','manual')}/><span className="da-mode-symbol"><Truck size={20} aria-hidden="true"/></span><span><strong>{t('Mağaza təsdiqləyir')}</strong><small>{t('Məbləği mağaza müştəri ilə razılaşdırır. Səbətdə pulsuz kimi göstərilmir.')}</small></span>{draft.mode==='manual'&&<Check size={19} className="da-mode-check" aria-hidden="true"/>}</label>
          <label className={`da-mode ${draft.mode==='distance'?'is-selected':''}`}><input type="radio" name="delivery-mode" value="distance" checked={draft.mode==='distance'} onChange={()=>update('mode','distance')}/><span className="da-mode-symbol"><Route size={20} aria-hidden="true"/></span><span><strong>{t('Kilometrə görə avtomatik')}</strong><small>{t('Google avtomobil marşrutu ilə məsafə hesablanır. Qiyməti server müəyyən edir.')}</small></span>{draft.mode==='distance'&&<Check size={19} className="da-mode-check" aria-hidden="true"/>}</label>
        </fieldset>

        <div className="da-grid">
          <section className="da-card"><div className="da-card-title"><span><Calculator size={20} aria-hidden="true"/></span><div><h3>{t('Qiymətlər və minimumlar')}</h3><p>{t('Məhsul qiyməti ilə çatdırılma haqqını ayrı saxlayın.')}</p></div></div>
            <label className="da-field">{t('Çatdırılma üçün minimum sifariş')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="1000000" step=".01" required value={draft.minimumOrder} onChange={event=>update('minimumOrder',event.target.value)} aria-describedby="delivery-minimum-order-help"/><span>AZN</span></span><small id="delivery-minimum-order-help">{t('Endirimlərdən sonrakı məhsul cəmi. 0 yazsanız minimum tətbiq olunmur. Mağazadan götürməyə aid deyil.')}</small></label>
            <div className="da-two-fields"><label className="da-field">{t('Minimum çatdırılma haqqı')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="1000000" step=".01" required value={draft.minimumFee} onChange={event=>update('minimumFee',event.target.value)}/><span>AZN</span></span></label><label className="da-field">{t('Hər kilometr üçün')}<span className="da-input-unit"><input type="number" inputMode="decimal" min="0" max="1000000" step=".01" required value={draft.pricePerKm} onChange={event=>update('pricePerKm',event.target.value)}/><span>AZN / km</span></span></label></div>
            <p className="da-hint">{t('Avtomatik rejimdə çatdırılma haqqı minimum haqqdan və məsafə × km tarifindən daha böyük olanıdır.')}</p>
            <div className={`da-preview ${draft.mode==='manual'?'is-muted':''}`}><div><strong>{t('Hesablama nümunəsi')}</strong><span>{t('Bu yalnız nümunədir; Google sorğusu göndərilmir.')}</span></div><label><input aria-label={t('Nümunə məsafə')} type="number" min="0" max="10000" step=".1" inputMode="decimal" value={previewKm} onChange={event=>setPreviewKm(event.target.value)}/><span>km</span></label><output aria-live="polite">{calculated===null?'—':money(Math.round((calculated+Number.EPSILON)*100)/100)}</output>{draft.mode==='manual'&&<small>{t('Əl rejimində bu hesab müştəriyə tətbiq edilmir.')}</small>}</div>
          </section>

          <section className="da-card"><div className="da-card-title"><span><MapPin size={20} aria-hidden="true"/></span><div><h3>{t('Çatdırılmanın başlanğıc nöqtəsi')}</h3><p>{t('Məsafə bu mağaza və ya anbardan müştərinin seçdiyi yerə hesablanır.')}</p></div></div>
            <label className="da-field">{t('Mərkəz ünvanı')}<textarea rows={3} maxLength={300} value={draft.originAddress} onChange={event=>update('originAddress',event.target.value)} placeholder={t('Mağaza / anbarın tam ünvanı')}/></label>
            <div className="da-two-fields"><label className="da-field">{t('Enlik (latitude)')}<input type="number" inputMode="decimal" step="any" min="-90" max="90" value={draft.originLat} onChange={event=>update('originLat',event.target.value)} placeholder="40.4093"/></label><label className="da-field">{t('Uzunluq (longitude)')}<input type="number" inputMode="decimal" step="any" min="-180" max="180" value={draft.originLng} onChange={event=>update('originLng',event.target.value)} placeholder="49.8671"/></label></div>
            <p className="da-hint">{t('Google Maps-də mərkəzin üzərinə sağ klik edib koordinatları köçürün. Ünvan mətnini dəyişmək koordinatları avtomatik dəyişmir.')}</p>
            <a className="da-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinatesValid?`${draft.originLat},${draft.originLng}`:draft.originAddress.trim()||'Baku Azerbaijan')}`} target="_blank" rel="noopener noreferrer"><MapPin size={16} aria-hidden="true"/>{t('Mərkəzi Google Maps-də yoxla')}<span aria-hidden="true">↗</span></a>
            <div className={`da-readiness ${ready?'is-ready':''}`}><ShieldCheck size={19} aria-hidden="true"/><div><strong>{ready?t('Avtomatik hesablamaya hazırdır'):t('Avtomatik hesablama hələ hazır deyil')}</strong><small>{ready?t('Ünvan, koordinatlar, tarif və server açarı daxil edilib. Yadda saxlamağı unutmayın.'):t('Mərkəz ünvanı, düzgün koordinatlar, müsbət km tarifi və server açarı lazımdır.')}</small></div></div>
          </section>
        </div>

        <details className="da-keys"><summary><KeyRound size={19} aria-hidden="true"/><span><strong>{t('Google Maps bağlantısı')}</strong><small>{t('API açarları və təhlükəsiz giriş məhdudiyyətləri')}</small></span><span className={`da-key-status ${draft.serverConfigured&&!clearServerKey?'is-ready':''}`}>{draft.serverConfigured&&!clearServerKey?t('Server açarı saxlanılıb'):t('Server açarı yoxdur')}</span><ChevronDown size={17} className="da-details-chevron" aria-hidden="true"/></summary>
          <div className="da-key-fields"><p className="da-billing-note"><AlertCircle size={17} aria-hidden="true"/>{t('Google Maps xidmətləri üçün öz Google Cloud hesabınız və ödəniş ayarlarınız tələb oluna bilər. Bu forma hesab yaratmır və ödənişli xidməti aktivləşdirmir.')}</p>
            <div className="da-two-fields"><label className="da-field">{t('Brauzer xəritə açarı')}<input type="text" autoComplete="off" maxLength={200} value={draft.browserKey} onChange={event=>update('browserKey',event.target.value)} placeholder="AIza…" spellCheck={false}/><small>{t('Bu açar xəritə üçün brauzerə göndərilir. Google Cloud-da yalnız saytınızın domenlərinə və lazım olan Maps API-lərə məhdudlaşdırın.')}</small></label><label className="da-field">{t('Server marşrut açarı')}<input type="password" autoComplete="new-password" maxLength={200} value={serverKey} disabled={clearServerKey} onChange={event=>{setServerKey(event.target.value);setNotice('');}} placeholder={draft.serverConfigured?t('Boş saxlasanız mövcud açar qalır'):t('Routes API server açarı')} spellCheck={false}/><small>{t('Gizli saxlanılır və brauzerə geri qaytarılmır. Routes API və server IP-si ilə məhdudlaşdırın.')}</small></label></div>
            {draft.serverConfigured&&<label className="da-clear-key"><input type="checkbox" checked={clearServerKey} onChange={event=>{setClearServerKey(event.target.checked);if(event.target.checked)setServerKey('');setNotice('');}}/><span>{t('Saxlanmış server açarını sil')}<small>{t('Avtomatik çatdırılma üçün yeni açar tələb olunacaq. Əvvəl əl rejimini seçin.')}</small></span></label>}
          </div>
        </details>
      </fieldset>
      <div className="da-save-bar"><div><strong>{dirty?t('Saxlanmamış dəyişikliklər var'):t('Ayarlar aktualdır')}</strong><small>{t('Bu ayarlar yalnız yeni sifarişlərə tətbiq edilir. Mövcud sifarişlərin məbləği dəyişmir.')}</small></div><div className="da-save-actions"><button type="button" className="da-reset" disabled={busy||!dirty} onClick={reset}>{t('Dəyişiklikləri geri al')}</button><button type="submit" className="da-save" disabled={busy||!dirty}>{busy?<LoaderCircle size={17} className="da-spin" aria-hidden="true"/>:<Check size={17} aria-hidden="true"/>}{busy?t('Saxlanılır…'):t('Dəyişiklikləri saxla')}</button></div></div>
      {(error||notice)&&<p ref={statusRef} tabIndex={-1} className={`da-status ${error?'is-error':'is-success'}`} role={error?'alert':'status'}>{error?<AlertCircle size={18} aria-hidden="true"/>:<Check size={18} aria-hidden="true"/>}{t(error||notice)}</p>}
    </form>
  </section>;
}
