"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {t,useLanguage,languageLocale} from "@/lib/language";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {desktopWebLabel,type DesktopWebLabel} from '@/lib/desktop-web-labels';
import {desktopInboxFilters,inboxIsUnpaid,inboxMatchesFilter,inboxNeedsAttention,type DesktopInboxFilter,type DesktopInboxRow,type DesktopPosOrder} from '@/lib/desktop-web-ui';
import "./desktop.css";

type Connection={local:boolean;configured:boolean;url?:string;mode?:'catalog'|'orders';lastSync?:string;lastError?:string;pending?:number;media?:{cached:number;total:number;failed:number}|null;incomingCatalogChanged?:number;incomingCatalogConflicts?:number;ordersLastSync?:string;ordersLastError?:string;supportLastSync?:string;supportLastError?:string};
async function getConnection(signal?:AbortSignal){const r=await fetch("/api/desktop-link",{cache:"no-store",signal});if(!r.ok)throw new Error("Bağlantı yoxlanmadı.");return r.json() as Promise<Connection>;}
async function getInbox(signal?:AbortSignal){const r=await fetch("/api/desktop-inbox",{cache:"no-store",signal});if(!r.ok)throw new Error("Sifarişlər yüklənmədi");return await r.json() as {rows:DesktopInboxRow[];limited?:boolean;limit?:number};}
export function DesktopConnection() {
  const language=useLanguage(),copy=(key:DesktopWebLabel)=>desktopWebLabel(language,key);
  const [state,setState]=useState<Connection|null>(null),[url,setUrl]=useState(""),[key,setKey]=useState(""),[issued,setIssued]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[statusError,setStatusError]=useState(""),[busy,setBusy]=useState<string|null>(null);
  const mounted=useRef(false),pending=useRef(false),urlEdited=useRef(false),statusRequest=useRef<AbortController|null>(null),actionRequest=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    const controller=new AbortController();statusRequest.current?.abort();statusRequest.current=controller;
    try{const data=await getConnection(controller.signal);if(mounted.current&&!controller.signal.aborted){setState(data);setStatusError("");if(!urlEdited.current)setUrl(data.url||"");}}
    catch{if(mounted.current&&!controller.signal.aborted)setStatusError("Bağlantı yoxlanmadı.");}
  },[setUrl]);
  useEffect(()=>{
    mounted.current=true;let cancelled=false;queueMicrotask(()=>{if(!cancelled)void load();});
    // Status refresh is read-only. Publishing and key rotation require an explicit action.
    const refresh=()=>{if(!pending.current&&document.visibilityState==='visible')void load();};
    const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{cancelled=true;mounted.current=false;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);statusRequest.current?.abort();actionRequest.current?.abort();};
  },[load]);
  async function act(action:string) {
    if(pending.current)return;
    pending.current=true;setBusy(action);setMessage("");setError("");statusRequest.current?.abort();
    const controller=new AbortController();actionRequest.current=controller;
    try {
      const sync=action==='sync';
      const r=await fetch(sync?"/api/desktop-inbox":"/api/desktop-link",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sync?{action:'sync'}:{action,url,key}),signal:controller.signal});
      const d=await r.json() as {error?:string;key?:string};if(!r.ok)throw new Error(d.error||"Bağlantı yoxlanmadı.");
      if(!mounted.current||controller.signal.aborted)return;
      if(!sync&&action!=='cache-media'){setKey("");setIssued(d.key||"");urlEdited.current=false;}
      setMessage(sync?"Sinxronizasiya yoxlandı. Son vəziyyəti aşağıda yoxlayın.":action==='cache-media'?"Şəkillərin endirilməsi tamamlandı.":"Saxlanıldı");
    }catch(error){if(mounted.current&&!controller.signal.aborted)setError(error instanceof Error?error.message:"Bağlantı yoxlanmadı.");}
    finally{pending.current=false;if(mounted.current&&!controller.signal.aborted){setBusy(null);await load();}}
  }
  if(!state)return <div><p role={statusError?'alert':'status'}>{t(statusError||"Yüklənir...")}</p>{statusError&&<Button type="button" variant="outline" onClick={()=>void load()}>{t('Yenidən yoxla')}</Button>}</div>;
  const catalogue=state.configured&&state.mode==='catalog';
  return <section className="desktop-connection" aria-busy={!!busy}>
    <h2>{t("Masaüstü bağlantısı")}</h2>
    <p>{t("Vebə yalnız məhsul adı, şəkillər, ölçü, rəng, satış qiyməti və sifariş statusları ötürülür. Stok, alış qiyməti və maliyyə kompüterdə qalır.")}</p>
    <p className="desktop-state">{t(state.configured?"Bağlantı qurulub":"Bağlantı qurulmayıb")}</p>
    {state.configured&&<p>{t(state.mode==='catalog'?'Kataloq və sifariş statusları':'Yalnız sifarişləri al')}</p>}
    {state.local&&<p role="note">{t('İlk bağlantı mövcud kataloqu yenidən yazmır. Bundan sonra EXE-də saxlanan dəyişikliklər sayta göndərilir.')}</p>}
    {state.local&&!state.configured&&<p role="note">{t('Şəkil və ölçüləri sayta göndərmək üçün əvvəlcə vebdə kataloq bağlantısı yaradın və açarı burada daxil edin.')}</p>}
    {state.local&&state.configured&&!catalogue&&<p role="alert" className="form-error">{t('Bu açar yalnız sifarişləri alır; şəkil və ölçülər sayta göndərilmir. Vebdə kataloq bağlantısı yaradın və yeni açarla qoşulun.')}</p>}
    {statusError&&<p role="alert" className="form-error">{t(statusError)}</p>}
    {state.local&&<div className="desktop-sync-summary">
      <p>{t('Son sinxronizasiya')}: {state.lastSync?new Date(state.lastSync).toLocaleString(languageLocale()):t('Hələ təsdiqlənməyib')}</p>
      <p>{t('Göndərilməyi gözləyir')}: {state.pending||0}</p>
      {state.lastError&&<p role="alert" className="form-error">{t(state.lastError)}</p>}
      {catalogue&&!state.lastError&&state.lastSync&&<p className="form-success">{t('Son göndərmə təsdiqlənib. Yeni dəyişikliklərin vəziyyəti avtomatik yenilənir.')}</p>}
      <p>{t('Bağlantı vəziyyəti hər 30 saniyədə yenilənir.')}</p>
      <Button type="button" disabled={!!busy||!catalogue} onClick={()=>void act('sync')}>{t(busy==='sync'?'Sinxronizasiya yoxlanılır…':'İndi sinxronlaşdır')}</Button>
      <p>{t('Oflayn şəkillər')}: {state.media?`${state.media.cached} / ${state.media.total}`:'—'}</p>
      {!!state.media?.failed&&<p role="alert" className="form-error">{t('Endirilməyən şəkillər')}: {state.media.failed}</p>}
      <Button type="button" variant="outline" disabled={!!busy} onClick={()=>void act('cache-media')}>{t('Şəkilləri kompüterə endir')}</Button>
    </div>}
    {state.local&&state.configured&&<div className="desktop-incoming-summary"><h3>{copy('syncSummary')}</h3><p>{copy('orderSync')}: {state.ordersLastSync?new Date(state.ordersLastSync).toLocaleString(languageLocale()):copy('notSynced')}</p>{state.ordersLastError&&<p className="form-error" role="alert">{t(state.ordersLastError)}</p>}<p>{copy('supportSync')}: {state.supportLastSync?new Date(state.supportLastSync).toLocaleString(languageLocale()):copy('notSynced')}</p>{state.supportLastError&&<p className="form-error" role="alert">{t(state.supportLastError)}</p>}<p>{copy('catalogIncoming')}: {state.incomingCatalogChanged||0}</p>{!!state.incomingCatalogConflicts&&<p className="desktop-review-note">{copy('catalogConflicts')}: {state.incomingCatalogConflicts}</p>}</div>}
    {state.local?<form onSubmit={(event:FormEvent)=>{event.preventDefault();void act("connect");}} className="desktop-connect-form">
      <p>{t('Vebdə: Tənzimləmələr → Masaüstü bağlantısı → Kataloq bağlantısı yarat. Sonra mağaza ünvanını və açarı burada yazın.')}</p>
      <label>{t("Mağaza ünvanı")}<Input type="url" value={url} onChange={e=>{urlEdited.current=true;setUrl(e.target.value);}} disabled={!!busy} required placeholder="https://magaza.az"/></label>
      <label>{t("Bağlantı açarı")}<Input type="password" value={key} onChange={e=>setKey(e.target.value)} disabled={!!busy} required autoComplete="new-password" placeholder="bk_catalog_…"/></label>
      <div className="row-actions"><Button disabled={!!busy}>{t("Yoxla və qoş")}</Button>{state.configured&&<Button type="button" variant="outline" disabled={!!busy} onClick={()=>void act("disconnect")}>{t("Bağlantını kəs")}</Button>}</div>
    </form>:<div className="desktop-connect-form">
      <p>{t('Şəkil, ölçü və rəng üçün “Kataloq bağlantısı yarat” seçin. “Yalnız sifariş açarı” məhsul dəyişikliklərini göndərmir.')}</p>
      <p>{t("Yeni açar əvvəlki açarı ləğv edir. Açar yalnız bir dəfə göstərilir.")}</p>
      <div className="row-actions"><Button type="button" disabled={!!busy} onClick={()=>void act("rotate-catalog")}>{t("Kataloq bağlantısı yarat")}</Button><Button type="button" variant="outline" disabled={!!busy} onClick={()=>void act("rotate")}>{t("Yalnız sifariş açarı yarat")}</Button>{state.configured&&<Button type="button" variant="outline" disabled={!!busy} onClick={()=>void act("revoke")}>{t("Açarı ləğv et")}</Button>}</div>
      <p>{t('Bağlantı bir kompüter üçündür. Stok, alış qiyməti və maliyyə vebə ötürülmür.')}</p>
      {issued&&<label>{t("Bağlantı açarı")}<Input readOnly value={issued} onFocus={e=>e.target.select()}/><small>{t("Bu açarı yalnız masaüstü tətbiqə daxil edin.")}</small></label>}
    </div>}
    {error&&<p role="alert" className="form-error">{t(error)}</p>}
    {message&&<p role="status">{t(message)}</p>}
  </section>;
}
export function DesktopInbox({onImported,onOpenAtPos}:{onImported?:()=>void;onOpenAtPos?:(order:DesktopPosOrder)=>void}) {
  const language=useLanguage(),copy=(key:DesktopWebLabel)=>desktopWebLabel(language,key);
  const [rows,setRows]=useState<DesktopInboxRow[]>([]),[filter,setFilter]=useState<DesktopInboxFilter>('active'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[limited,setLimited]=useState(false),[connection,setConnection]=useState<Connection|null>(null);
  const [hasLoaded,setHasLoaded]=useState(false);
  const mounted=useRef(false),pending=useRef(false),request=useRef<AbortController|null>(null),actionRequest=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    try{const [data,status]=await Promise.all([getInbox(controller.signal),getConnection(controller.signal).catch(()=>null)]);if(!mounted.current||controller.signal.aborted)return;setRows(data.rows);setHasLoaded(true);setLimited(data.limited===true||data.rows.length>=500);setConnection(status);setError(status?'':'connectionError');}
    catch{if(mounted.current&&!controller.signal.aborted)setError('loadError');}
    finally{if(mounted.current&&!controller.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{mounted.current=true;const frame=requestAnimationFrame(()=>void load());const refresh=()=>{if(!pending.current&&document.visibilityState!=='hidden')void load();};const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);return()=>{mounted.current=false;cancelAnimationFrame(frame);clearInterval(timer);window.removeEventListener('focus',refresh);request.current?.abort();actionRequest.current?.abort();};},[load]);
  async function act(action:string,id?:string,stage?:string){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');request.current?.abort();const controller=new AbortController();actionRequest.current=controller;
    try{const response=await fetch('/api/desktop-inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,stage}),signal:controller.signal});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||'actionError');if(!mounted.current||controller.signal.aborted)return;await load();if(action==='import'||action==='sync')onImported?.();}
    catch(cause){if(mounted.current&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'actionError');}
    finally{pending.current=false;if(mounted.current&&!controller.signal.aborted)setBusy(false);}
  }
  const visible=rows.filter(row=>inboxMatchesFilter(row,filter)),unpaid=rows.filter(inboxIsUnpaid).length,unresolved=rows.filter(inboxNeedsAttention).length;
  const statusLabel=(status:string)=>copy(({pending:'pendingOrder',ready:'ready',completed:'completedOrder',cancelled:'cancelledOrder'} as Record<string,DesktopWebLabel>)[status]||'pendingOrder');
  return <section className="desktop-inbox" aria-busy={busy||loading}>
    <div className="desktop-heading"><div><span className="desktop-eyebrow">WEB → POS</span><h2>{copy('webOrders')}</h2><p>{copy('inboxHelp')}</p></div><Button disabled={busy} onClick={()=>void act('sync')}>{copy(busy?'refreshing':'refresh')}</Button></div>
    <p>{copy('stockHelp')}</p>
    <div className="desktop-order-summary"><div><span>{copy('awaitingPayment')}</span><strong>{hasLoaded?unpaid:'—'}</strong></div><div className={unresolved?'needs-attention':''}><span>{copy('unresolved')}</span><strong>{hasLoaded?unresolved:'—'}</strong></div><div><span>{copy('lastSync')}</span><strong className="desktop-sync-time">{connection?.ordersLastSync?new Date(connection.ordersLastSync).toLocaleString(languageLocale(),{timeZone:'Asia/Baku'}):copy('notSynced')}</strong></div></div>
    <p className="desktop-scope-note">{copy(limited?'limited':'scope')}</p>
    {connection&&!connection.configured&&<p className="desktop-review-note" role="status">{copy('disconnected')}</p>}
    {connection?.ordersLastError&&<p className="desktop-review-note" role="alert">{t(connection.ordersLastError)}</p>}
    {error&&<div role="alert" className="desktop-review-note"><p>{error==='loadError'||error==='actionError'||error==='connectionError'?copy(error):t(error)}</p>{rows.length>0&&<small>{copy('previousData')}</small>}<Button type="button" variant="outline" disabled={busy} onClick={()=>void load()}>{copy('retry')}</Button></div>}
    <div className="desktop-inbox-filters" role="group" aria-label={copy('filters')}>{desktopInboxFilters.map(value=><button type="button" key={value} aria-pressed={filter===value} className={filter===value?'selected':''} onClick={()=>setFilter(value)}>{copy(value)}<span>{rows.filter(row=>inboxMatchesFilter(row,value)).length}</span></button>)}</div>
    {loading&&<p role="status">{copy('loading')}</p>}
    <div className="desktop-order-grid">{visible.map(row=>{
      const o=row.payload,attention=inboxNeedsAttention(row),cancelled=o.status==='cancelled'||row.local_status==='cancelled',stage=row.local_stage||'received';
      const nextStage=({received:'preparing',preparing:'ready',ready:o.fulfillment==='delivery'?'dispatched':'delivered',dispatched:'delivered'} as Record<string,string>)[stage];
      const nextLabel=({received:'startPreparing',preparing:'markReady',ready:o.fulfillment==='delivery'?'dispatch':'completeDelivery',dispatched:'completeDelivery'} as Record<string,DesktopWebLabel>)[stage];
      return <article key={row.id} className={'panel desktop-order'+(attention?' needs-attention':'')+(cancelled?' is-cancelled':'')}>
        <div className="desktop-heading"><strong>{o.order_no}</strong><span className={'desktop-order-badge '+o.status}>{statusLabel(o.status)}</span></div>
        <small>{new Date(o.created_at).toLocaleString(languageLocale(),{timeZone:'Asia/Baku'})}</small>
        {row.local_order_id&&<span className="desktop-import-badge">✓ {copy('automatic')}</span>}
        <div className="desktop-order-customer"><h3>{o.full_name}</h3>{o.phone&&<p>{o.phone}</p>}<p>{t(o.fulfillment==='delivery'?'Ünvana çatdırılma':'Mağazadan götürmə')}</p>{o.delivery_address&&<p>{o.delivery_address}</p>}</div>
        <ul>{o.items.map((line,index)=><li key={index}><span>{line.name}{line.option_snapshot?' · '+line.option_snapshot:''}<small>{line.sku}</small></span><strong>× {line.quantity}</strong></li>)}</ul>
        <div className="desktop-order-total">{o.coupon_discount>0&&<p><span>{copy('couponDiscount')}</span><span>−{o.coupon_discount.toLocaleString(languageLocale(),{minimumFractionDigits:2})} ₼</span></p>}{o.delivery_fee>0&&<p><span>{t('Çatdırılma haqqı')}</span><span>{o.delivery_fee.toLocaleString(languageLocale(),{minimumFractionDigits:2})} ₼</span></p>}<strong>{row.invalid_payload?'—':o.total.toLocaleString(languageLocale(),{minimumFractionDigits:2})+' ₼'}</strong></div>{o.note&&<p>{o.note}</p>}
        {cancelled&&<div className="desktop-cancel-reason"><strong>{copy('cancelReason')}</strong><p>{o.cancellation_reason||row.local_cancellation_reason||copy('noReason')}</p></div>}
        {row.import_error&&<div className="desktop-review-note" role="status"><p>{copy('importProblem')}</p><small>{t(row.import_error)}</small></div>}
        {row.invalid_payload&&<div className="desktop-review-note" role="status"><p>{copy('invalidOrder')}</p></div>}
        {(row.sync_conflict||row.needs_review)&&<div className="desktop-review-note" role="status"><p>{copy('conflict')}</p>{row.sync_conflict&&<small>{t(row.sync_conflict)}</small>}</div>}
        {row.local_order_id&&<p className="desktop-local-status">{copy('localStatus')}: {statusLabel(row.local_status||'pending')}</p>}
        {row.local_order_id&&!cancelled&&<div className="desktop-delivery-actions"><p>{copy('delivery')}: {copy((['received','preparing','ready','dispatched','delivered'].includes(stage)?stage:'received') as DesktopWebLabel)}</p>{nextStage&&nextLabel&&<Button type="button" variant="outline" disabled={busy||attention} onClick={()=>void act('delivery-stage',row.id,nextStage)}>{copy(nextLabel)}</Button>}</div>}
        <div className="desktop-order-buttons">{!row.local_order_id&&inboxIsUnpaid(row)&&<Button type="button" disabled={busy} variant={row.import_error?'outline':'default'} onClick={()=>void act('import',row.id)}>{copy(row.import_error?'retryImport':'import')}</Button>}{row.local_order_id&&row.local_order&&inboxIsUnpaid(row)&&onOpenAtPos&&<Button type="button" disabled={busy||attention} onClick={()=>onOpenAtPos(row.local_order!)}>{copy('openPos')}</Button>}</div>
      </article>;
    })}</div>{!loading&&!visible.length&&<p className="empty-table">{copy('empty')}</p>}
  </section>;
}
export function DesktopStatus({onOpen}:{onOpen:()=>void}) {
  const language=useLanguage(),copy=(key:DesktopWebLabel)=>desktopWebLabel(language,key);
  const [state,setState]=useState<"loading"|"ok"|"error">("loading"),[count,setCount]=useState<number|null>(null);
  useEffect(()=>{let active=true,running=false;const controller=new AbortController();async function poll(){if(running)return;running=true;try{const [connection,inbox]=await Promise.all([getConnection(controller.signal),getInbox(controller.signal)]);if(active){setCount(inbox.rows.filter(inboxIsUnpaid).length);setState(connection.configured&&!connection.ordersLastError?"ok":"error");}}catch{if(active)setState("error");}finally{running=false;}}void poll();const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void poll();},30000);return()=>{active=false;controller.abort();clearInterval(timer);};},[]);
  return <button type="button" className={`desktop-status ${state}`} onClick={onOpen} title={copy('unpaidCount')+' · '+copy('scope')}><span aria-hidden="true">●</span> {copy(state==='error'?'connectionError':'webOrders')}: {count??'—'}</button>;
}
