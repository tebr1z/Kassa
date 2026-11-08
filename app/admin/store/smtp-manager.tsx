'use client';

import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {AlertCircle,Check,KeyRound,LoaderCircle,Mail,RefreshCw,Save,Send,ShieldCheck} from 'lucide-react';
import {useTranslations} from '@/lib/language';
import './smtp-manager.css';

type Settings={enabled:boolean;provider:'gmail'|'custom';host:string;port:465|587;security:'tls'|'starttls';username:string;fromEmail:string;fromName:string;replyTo:string;passwordConfigured:boolean;revision:number};
type Draft=Omit<Settings,'passwordConfigured'|'revision'>;
type Data={settings:Settings;status:{lastTestAt:string|null;lastTestStatus:string|null;errorCode:string|null};delivery:{failed:number}};
type Busy='save'|'verify'|'test'|null;
const toDraft=(value:Settings):Draft=>({enabled:value.enabled,provider:value.provider,host:value.host,port:value.port,security:value.security,username:value.username,fromEmail:value.fromEmail,fromName:value.fromName,replyTo:value.replyTo});
const email=(value:string)=>value.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(value);
const differs=(draft:Draft|null,saved:Data|null,password:string)=>Boolean(draft&&saved&&(JSON.stringify(draft)!==JSON.stringify(toDraft(saved.settings))||password));
async function readSettings(signal?:AbortSignal):Promise<Data>{
 const response=await fetch('/api/admin/smtp',{cache:'no-store',signal});
 const data=await response.json() as Partial<Data>&{error?:string};
 if(!response.ok)throw new Error(data.error||'SMTP ayarları yüklənmədi.');
 if(!data.settings||typeof data.settings.revision!=='number'||!data.status||!data.delivery)throw new Error('SMTP ayarları yüklənmədi.');
 return {settings:data.settings,status:data.status,delivery:data.delivery};
}
function safeStatus(status:string|null){
 if(status==='verified')return 'SMTP bağlantısı yoxlanılıb';
 if(status==='sent')return 'Test məktubu SMTP serverinə verilib';
 if(status==='failed')return 'Son yoxlama alınmadı';
 return status?'Son yoxlama tamamlanıb':'Hələ yoxlanmayıb';
}
function safeError(code:string|null){
 if(!code)return '';
 if(code==='EAUTH')return 'SMTP istifadəçi adını və tətbiq şifrəsini yoxlayın.';
 if(code==='EENVELOPE')return 'Göndərən və test alıcısının ünvanlarını yoxlayın.';
 if(code==='TLS')return 'SMTP serverinin TLS sertifikatını və portunu yoxlayın.';
 return 'SMTP yoxlaması alınmadı. Saxlanmış ayarları yoxlayın.';
}

export default function SmtpManager(){
 const {t,languageLocale}=useTranslations(),id=useId();
 const [data,setData]=useState<Data|null>(null),[draft,setDraft]=useState<Draft|null>(null),[password,setPassword]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState<Busy>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[needsReload,setNeedsReload]=useState(false),[to,setTo]=useState('');
 const mounted=useRef(true),pending=useRef(false),request=useRef<AbortController|null>(null),savedRef=useRef<Data|null>(null),draftRef=useRef<Draft|null>(null),passwordRef=useRef(''),dirtyRef=useRef(false),reloadRef=useRef(false),feedback=useRef<HTMLParagraphElement>(null);
 function accept(next:Data){savedRef.current=next;draftRef.current=toDraft(next.settings);passwordRef.current='';dirtyRef.current=false;reloadRef.current=false;setData(next);setDraft(toDraft(next.settings));setPassword('');setNeedsReload(false);}
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();request.current=controller;
  void readSettings(controller.signal).then(next=>{if(!controller.signal.aborted)accept(next);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'SMTP ayarları yüklənmədi.');}).finally(()=>{if(!controller.signal.aborted){setLoading(false);request.current=null;}});
  return()=>{mounted.current=false;controller.abort();request.current?.abort();};
 },[]);
 function change<K extends keyof Draft>(key:K,value:Draft[K]){
  if(pending.current||!draftRef.current)return;
  const next={...draftRef.current,[key]:value};
  if(key==='provider'&&value==='gmail'){next.host='smtp.gmail.com';next.port=465;next.security='tls';}
  if(key==='port')next.security=value===465?'tls':'starttls';
  draftRef.current=next;dirtyRef.current=differs(next,savedRef.current,passwordRef.current);setDraft(next);setError('');setNotice('');
 }
 function changePassword(value:string){if(pending.current)return;passwordRef.current=value;dirtyRef.current=differs(draftRef.current,savedRef.current,value);setPassword(value);setError('');setNotice('');}
 async function reload(){
  if(pending.current||dirtyRef.current&&!reloadRef.current)return;
  pending.current=true;setLoading(true);setError('');const controller=new AbortController();request.current=controller;
  try{const next=await readSettings(controller.signal);if(mounted.current)accept(next);}catch(cause){if(mounted.current&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'SMTP ayarları yüklənmədi.');}
  finally{if(mounted.current){setLoading(false);pending.current=false;request.current=null;}}
 }
 async function run(action:Exclude<Busy,null>,event?:FormEvent){
  event?.preventDefault();if(pending.current||!savedRef.current||!draftRef.current||reloadRef.current)return;
  if(action!=='save'&&(dirtyRef.current||!savedRef.current.settings.passwordConfigured)){setError('SMTP sınağından əvvəl ayarları və şifrəni saxlayın.');return;}
  const current=draftRef.current;
  if(action==='save'&&(!current.host.trim()||!current.username.trim()||!email(current.fromEmail.trim())||current.replyTo.trim()&&!email(current.replyTo.trim())||/[\r\n\u0000]/u.test(current.fromName)||!passwordRef.current&&!savedRef.current.settings.passwordConfigured)){setError('SMTP məlumatlarını düzgün doldurun.');return;}
  if(action==='test'&&!email(to.trim())){setError('Test üçün yalnız bir düzgün e-poçt ünvanı yazın.');return;}
  const payload=action==='save'?{action,revision:savedRef.current.settings.revision,...current,host:current.host.trim(),username:current.username.trim(),fromEmail:current.fromEmail.trim(),fromName:current.fromName.trim(),replyTo:current.replyTo.trim(),...(passwordRef.current?{password:passwordRef.current}:{})}:action==='test'?{action,to:to.trim()}:{action};
  pending.current=true;setBusy(action);setError('');setNotice('');const controller=new AbortController();request.current=controller;
  try{
   const response=await fetch('/api/admin/smtp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   const result=await response.json() as {ok?:boolean;message?:string;error?:string};
   if(!mounted.current)return;
   if(!response.ok||result.ok!==true){if(action==='save'&&response.status===409){reloadRef.current=true;setNeedsReload(true);}throw new Error(result.error||(action==='save'?'SMTP ayarları saxlanmadı.':'SMTP sınağı tamamlanmadı.'));}
   if(action==='save'){passwordRef.current='';setPassword('');reloadRef.current=true;setNeedsReload(true);}
   setNotice(result.message||(action==='save'?'SMTP ayarları saxlanıldı.':action==='verify'?'SMTP bağlantısı yoxlanıldı.':'Test məktubu SMTP serverinə verildi.'));
   try{const next=await readSettings(controller.signal);if(mounted.current)accept(next);}catch{if(mounted.current){reloadRef.current=true;setNeedsReload(true);setError('SMTP vəziyyəti yenilənmədi. Davam etməzdən əvvəl yenidən yükləyin.');}}
  }catch(cause){if(mounted.current&&!controller.signal.aborted){
   setError(cause instanceof TypeError||cause instanceof SyntaxError?'SMTP serveri ilə əməliyyat tamamlanmadı. Yenidən yoxlayın.':cause instanceof Error?cause.message:'SMTP sınağı tamamlanmadı.');
   if(action!=='save')try{const next=await readSettings(controller.signal);if(mounted.current)accept(next);}catch{if(mounted.current&&!controller.signal.aborted){reloadRef.current=true;setNeedsReload(true);}}
  }}
  finally{if(mounted.current){pending.current=false;setBusy(null);request.current=null;feedback.current?.focus();}}
 }
 function reset(){if(pending.current||reloadRef.current||!savedRef.current)return;accept(savedRef.current);setError('');setNotice('');}
 if(loading&&!data)return <section className="smtp-manager smtp-empty" aria-busy="true"><LoaderCircle size={22} className="smtp-spin" aria-hidden="true"/><p>{t('SMTP ayarları yüklənir…')}</p></section>;
 if(!data||!draft)return <section className="smtp-manager smtp-empty"><Mail size={26} aria-hidden="true"/><h2>{t('E-poçt və SMTP')}</h2><p role="alert">{t(error||'SMTP ayarları yüklənmədi.')}</p><button type="button" className="smtp-button" onClick={()=>void reload()}>{t('Yenidən yoxla')}</button></section>;
 const dirty=differs(draft,data,password),canTest=!dirty&&!needsReload&&data.settings.passwordConfigured&&!busy&&!loading;
 const time=data.status.lastTestAt?new Date(data.status.lastTestAt):null,lastTest=time&&Number.isFinite(time.valueOf())?time.toLocaleString(languageLocale(),{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Baku'}):'—';
 return <section className="smtp-manager" aria-labelledby={id+'-heading'}>
  <header className="smtp-heading"><span className="smtp-heading-icon"><Mail size={25} aria-hidden="true"/></span><div><small>{t('E-POÇT BİLDİRİŞLƏRİ')}</small><h2 id={id+'-heading'}>{t('E-poçt və SMTP')}</h2><p>{t('Göndərən hesabını sazlayın, bağlantını yoxlayın və ayrıca test məktubu göndərin.')}</p></div></header>
  <div className="smtp-summary"><div><span>{t('Avtomatik e-poçt')}</span><strong>{t(data.settings.enabled?'Aktivdir':'Söndürülüb')}</strong></div><div><span>{t('Çatdırılmayan e-poçtlar')}</span><strong>{Math.max(0,Number(data.delivery.failed)||0)}</strong></div><div><span>{t(safeStatus(data.status.lastTestStatus))}</span><strong className="smtp-last-date">{lastTest}</strong></div></div>
  {data.status.errorCode&&<p className="smtp-feedback is-warning" role="status"><AlertCircle size={18} aria-hidden="true"/><span>{t(safeError(data.status.errorCode))}</span></p>}
  {Number(data.delivery.failed)>0&&<p className="smtp-feedback is-warning" role="status"><Mail size={18} aria-hidden="true"/><span>{t('Çatdırılmayan bildirişlər var. Müştəri ilə başqa əlaqə vasitəsi ilə əlaqə saxlayın. Avtomatik təkrar göndəriş edilmir.')}</span></p>}
  <form onSubmit={event=>void run('save',event)} className="smtp-config-form"><fieldset disabled={Boolean(busy)||loading||needsReload}>
   <label className="smtp-enable"><input type="checkbox" checked={draft.enabled} onChange={event=>change('enabled',event.target.checked)}/><span><strong>{t('Avtomatik e-poçt göndərişini aktiv et')}</strong><small>{t('Yalnız saxladıqdan sonra aktiv olur. Yoxlama və test düymələri avtomatik göndərişi aktiv etmir.')}</small></span></label>
   <div className="smtp-grid"><section className="smtp-card"><h3><ShieldCheck size={19} aria-hidden="true"/>{t('SMTP bağlantısı')}</h3>
    <label>{t('E-poçt provayderi')}<select value={draft.provider} onChange={event=>change('provider',event.target.value==='gmail'?'gmail':'custom')}><option value="gmail">Gmail</option><option value="custom">{t('Digər SMTP serveri')}</option></select></label>
    {draft.provider==='gmail'&&<p className="smtp-info">{t('Gmail üçün 2 mərhələli doğrulama və Google tətbiq şifrəsi lazımdır. Adi hesab şifrəsini yazmayın. Bəzi hesablarda tətbiq şifrəsi seçimi bağlı ola bilər.')} <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer">{t('Google tətbiq şifrəsi haqqında')} ↗</a></p>}
    <div className="smtp-connection-fields"><label>{t('SMTP server adı')}<input value={draft.host} onChange={event=>change('host',event.target.value)} required maxLength={253} readOnly={draft.provider==='gmail'} autoComplete="off" placeholder="smtp.example.com" spellCheck={false}/></label><label>{t('Port və şifrələmə')}<select value={draft.port} disabled={draft.provider==='gmail'} onChange={event=>change('port',event.target.value==='587'?587:465)}><option value={465}>465 · TLS</option><option value={587}>587 · STARTTLS</option></select></label></div>
    <label>{t('SMTP istifadəçi adı')}<input value={draft.username} onChange={event=>change('username',event.target.value)} maxLength={254} autoComplete="off" required spellCheck={false}/></label>
    <label>{t('SMTP şifrəsi / tətbiq şifrəsi')}<input type="password" value={password} onChange={event=>changePassword(event.target.value)} maxLength={512} autoComplete="new-password" spellCheck={false} placeholder={t(data.settings.passwordConfigured?'Saxlanmış şifrə göstərilmir':'Yeni SMTP şifrəsini yazın')} aria-describedby={id+'-password-help'}/></label><small id={id+'-password-help'} className="smtp-hint">{t('Boş saxlasanız saxlanmış şifrə qalır. Server, port, provayder və ya istifadəçi adını dəyişəndə yeni şifrə yazın.')}</small>
   </section><section className="smtp-card"><h3><Mail size={19} aria-hidden="true"/>{t('Göndərən məlumatları')}</h3>
    <label>{t('Göndərən e-poçtu')}<input type="email" value={draft.fromEmail} onChange={event=>change('fromEmail',event.target.value)} required maxLength={254} autoComplete="off" placeholder="info@example.com"/><small>{t('Bu ünvan SMTP hesabınızda göndəriş üçün icazəli olmalıdır.')}</small></label>
    <label>{t('Göndərən adı')}<input value={draft.fromName} onChange={event=>change('fromName',event.target.value)} maxLength={100} autoComplete="off" placeholder="RestaMarket"/></label>
    <label>{t('Cavab ünvanı')}<input type="email" value={draft.replyTo} onChange={event=>change('replyTo',event.target.value)} maxLength={254} autoComplete="off" placeholder={t('Boşdursa göndərən ünvanı istifadə olunur')}/></label>
    <p className="smtp-info"><KeyRound size={17} aria-hidden="true"/>{t('Şifrə brauzerə geri qaytarılmır və burada saxlanmış şifrəni görmək mümkün deyil.')}</p>
    <p className="smtp-hint">{t('Bazanı başqa serverə köçürəndə şəxsi smtp-encryption.key faylını da təhlükəsiz saxlayın. Açar olmadan saxlanmış SMTP şifrəsi açıla bilməz.')}</p>
    <p className="smtp-hint">{t('TLS sertifikatı yoxlanılır. Təhlükəsiz olmayan və daxili şəbəkə serverləri qəbul edilmir.')}</p>
   </section></div>
  </fieldset><div className="smtp-save-bar"><p>{t(dirty?'SMTP ayarlarında saxlanmamış dəyişiklik var.':'SMTP ayarları aktualdır.')}</p><div><button type="button" className="smtp-button" disabled={Boolean(busy)||loading||!dirty||needsReload} onClick={reset}>{t('Dəyişiklikləri geri al')}</button><button type="submit" className="smtp-button is-primary" disabled={Boolean(busy)||loading||!dirty||needsReload}>{busy==='save'?<LoaderCircle size={17} className="smtp-spin" aria-hidden="true"/>:<Save size={17} aria-hidden="true"/>}{t(busy==='save'?'Saxlanılır…':'SMTP ayarlarını saxla')}</button></div></div></form>
  <section className="smtp-test-card" aria-labelledby={id+'-test-heading'}><div><h3 id={id+'-test-heading'}>{t('Yoxlama və test')}</h3><p>{t('Yalnız saxlanmış ayarlar istifadə olunur. Test üçün avtomatik e-poçtu aktiv etmək lazım deyil.')}</p></div>
   {(dirty||!data.settings.passwordConfigured)&&<p className="smtp-info">{t('SMTP sınağından əvvəl ayarları və şifrəni saxlayın.')}</p>}
   <button type="button" className="smtp-button" disabled={!canTest} onClick={()=>void run('verify')}>{busy==='verify'?<LoaderCircle size={17} className="smtp-spin" aria-hidden="true"/>:<ShieldCheck size={17} aria-hidden="true"/>}{t('Bağlantını yoxla')}</button><small className="smtp-hint">{t('Yalnız bağlantı və giriş yoxlanılır; məktub göndərilmir. Bu, məktubun çatdırılmasına zəmanət deyil.')}</small>
   <form onSubmit={event=>void run('test',event)} className="smtp-test-form"><label htmlFor={id+'-recipient'}>{t('Test məktubunun alıcısı')}<input id={id+'-recipient'} type="email" required maxLength={254} value={to} disabled={Boolean(busy)||loading} autoComplete="off" onChange={event=>setTo(event.target.value)} placeholder="you@example.com"/></label><button type="submit" className="smtp-button" disabled={!canTest||!email(to.trim())}>{busy==='test'?<LoaderCircle size={17} className="smtp-spin" aria-hidden="true"/>:<Send size={17} aria-hidden="true"/>}{t('Test məktubu göndər')}</button></form>
   <small className="smtp-hint">{t('Yalnız bir alıcıya sabit test mətni göndərilir. Serverin qəbul etməsi məktubun gələnlər qutusuna çatmasına zəmanət deyil; spam qovluğunu da yoxlayın.')}</small>
  </section>
  {needsReload&&<p className="smtp-feedback is-warning" role="status"><AlertCircle size={18} aria-hidden="true"/><span>{t('SMTP vəziyyəti yenilənməlidir. Saxlanmış ayarları yenidən yükləyin.')}</span><button type="button" className="smtp-button" disabled={Boolean(busy)||loading} onClick={()=>void reload()}><RefreshCw size={16} aria-hidden="true"/>{t('SMTP vəziyyətini yenilə')}</button></p>}
  {(error||notice)&&<p ref={feedback} tabIndex={-1} className={'smtp-feedback '+(error?'is-error':'is-success')} role={error?'alert':'status'}>{error?<AlertCircle size={18} aria-hidden="true"/>:<Check size={18} aria-hidden="true"/>}<span>{t(error||notice)}</span></p>}
 </section>;
}
