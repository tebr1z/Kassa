"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {t,useLanguage,languageLocale} from "@/lib/language";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {RemoteOrder} from "@/lib/desktop-sync";
import "./desktop.css";

type Connection={local:boolean;configured:boolean;url?:string;mode?:'catalog'|'orders';lastSync?:string;lastError?:string;pending?:number;media?:{cached:number;total:number;failed:number}|null};
async function getConnection(signal?:AbortSignal){const r=await fetch("/api/desktop-link",{cache:"no-store",signal});if(!r.ok)throw new Error("Bağlantı yoxlanmadı.");return r.json() as Promise<Connection>;}
async function getInbox(signal?:AbortSignal){const r=await fetch("/api/desktop-inbox",{cache:"no-store",signal});if(!r.ok)throw new Error("Sifarişlər yüklənmədi");return (await r.json() as {rows:InboxRow[]}).rows;}
export function DesktopConnection() {
  useLanguage();
  const [state,setState]=useState<Connection|null>(null),[url,setUrl]=useState(""),[key,setKey]=useState(""),[issued,setIssued]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[statusError,setStatusError]=useState(""),[busy,setBusy]=useState<string|null>(null);
  const mounted=useRef(false),pending=useRef(false),urlEdited=useRef(false),statusRequest=useRef<AbortController|null>(null),actionRequest=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    const controller=new AbortController();statusRequest.current?.abort();statusRequest.current=controller;
    try{const data=await getConnection(controller.signal);if(mounted.current&&!controller.signal.aborted){setState(data);setStatusError("");if(!urlEdited.current)setUrl(data.url||"");}}
    catch{if(mounted.current&&!controller.signal.aborted)setStatusError("Bağlantı yoxlanmadı.");}
  },[]);
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
type InboxRow={id:string;payload:RemoteOrder;store_url:string;local_order_id:string|null;local_status:string|null;local_stage:string|null};
const labels:Record<string,string>={pending:"Yeni",ready:"Hazır",completed:"Tamamlandı",cancelled:"Ləğv edilib"};
export function DesktopInbox({onImported}:{onImported:()=>void}) {
  useLanguage();
  const [rows,setRows]=useState<InboxRow[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function load(){setRows(await getInbox());}
  useEffect(()=>{let active=true;const refresh=()=>getInbox().then(data=>{if(active)setRows(data);}).catch(()=>{if(active)setError("Sifarişlər yüklənmədi");});void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>{active=false;clearInterval(timer);};},[]);
  async function act(action:string,id?:string,stage?:string){setBusy(true);setError("");try{const r=await fetch("/api/desktop-inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,id,stage})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);await load();if(action==="import")onImported();}catch(e){setError(e instanceof Error?e.message:"Sifarişlər yüklənmədi");}finally{setBusy(false);}}
  return <section className="desktop-inbox"><div className="desktop-heading"><div><h2>{t("Veb sifarişləri")}</h2><p>{t("Sifarişi yerli kassaya köçürün. SKU və məhsul seçimləri uyğun olmalıdır.")}</p></div><Button disabled={busy} onClick={()=>void act("sync")}>{t("Yenilə")}</Button></div>
    <p>{t("Stok ödəniş zamanı azalır. Yerli satış və ödənişlər vebə göndərilmir.")}</p>
    {error&&<p role="alert" className="form-error">{t(error)}</p>}
    <div className="desktop-order-grid">{rows.map(row=>{const o=row.payload;return <article key={row.id} className="panel desktop-order"><div className="desktop-heading"><strong>{o.order_no}</strong><span>{t(labels[o.status])}</span></div>
      <small>{new Date(o.created_at).toLocaleString(languageLocale(),{timeZone:"Asia/Baku"})}</small>
      <h3>{o.full_name}</h3><p>{o.phone}</p><p>{t(o.fulfillment==="delivery"?"Ünvana çatdırılma":"Mağazadan götürmə")}</p>{o.delivery_address&&<p>{o.delivery_address}</p>}
      <ul>{o.items.map((line,index)=><li key={index}>{line.name}{line.option_snapshot?" · "+line.option_snapshot:""} <strong>× {line.quantity}</strong><small>{line.sku}</small></li>)}</ul>
{o.delivery_fee>0&&<p>{t('Çatdırılma haqqı')}: {o.delivery_fee.toLocaleString(languageLocale(),{minimumFractionDigits:2})} ₼</p>}<strong>{o.total.toLocaleString(languageLocale(),{minimumFractionDigits:2})} ₼</strong>{o.note&&<p>{o.note}</p>}
      {row.local_order_id&&row.local_status!=='cancelled'&&<div className="desktop-delivery-actions"><p>{t('Təhvil mərhələsi')}: {t(({received:'Qəbul edildi',preparing:'Hazırlanır',ready:'Hazırdır',dispatched:'Yoldadır',delivered:o.fulfillment==='pickup'?'Təhvil verildi':'Çatdırıldı'} as Record<string,string>)[row.local_stage||'received'])}</p>{row.local_stage!=='delivered'&&<Button variant="outline" disabled={busy} onClick={()=>void act('delivery-stage',row.id,({received:'preparing',preparing:'ready',ready:o.fulfillment==='delivery'?'dispatched':'delivered',dispatched:'delivered'} as Record<string,string>)[row.local_stage||'received'])}>{t(({received:'Hazırlamağa başla',preparing:'Hazırdır',ready:o.fulfillment==='delivery'?'Yola sal':'Təhvil verildi',dispatched:'Çatdırıldı'} as Record<string,string>)[row.local_stage||'received'])}</Button>}</div>}
      {row.local_order_id?<p className="desktop-state">{t("Yerli sifariş")}: {t(labels[row.local_status||"pending"])}</p>:<Button disabled={busy||!["pending","ready"].includes(o.status)} onClick={()=>void act("import",row.id)}>{t("Kassaya köçür")}</Button>}
    </article>;})}</div>{!rows.length&&<p className="empty-table">{t("Bu bölmədə sifariş yoxdur.")}</p>}
  </section>;
}
export function DesktopStatus({onOpen}:{onOpen:()=>void}) {
  useLanguage();
  const [state,setState]=useState<"loading"|"ok"|"error">("loading"),[count,setCount]=useState(0);
  useEffect(()=>{let active=true,running=false;const controller=new AbortController();async function poll(){if(running)return;running=true;try{const [connection,rows]=await Promise.all([getConnection(controller.signal),getInbox(controller.signal)]);if(active){setCount(rows.filter(row=>!row.local_order_id&&["pending","ready"].includes(row.payload.status)).length);setState(connection.configured&&!connection.lastError?"ok":"error");}}catch{if(active)setState("error");}finally{running=false;}}void poll();const timer=setInterval(()=>void poll(),30000);return()=>{active=false;controller.abort();clearInterval(timer);};},[]);
  return <button className={`desktop-status ${state}`} onClick={onOpen}><span>●</span> {t("Lokal kassa")} · {t(state==="error"?"Bağlantını yoxlayın":"Veb sifarişləri")}: {count}</button>;
}
