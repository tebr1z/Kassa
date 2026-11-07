"use client";
import {useEffect,useState,type FormEvent} from "react";
import {t,useLanguage,languageLocale} from "@/lib/language";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {RemoteOrder} from "@/lib/desktop-sync";
import "./desktop.css";

type Connection={local:boolean;configured:boolean;url?:string;mode?:'catalog'|'orders';lastSync?:string;lastError?:string;pending?:number;media?:{cached:number;total:number;failed:number}|null};
async function getConnection(){const r=await fetch("/api/desktop-link");if(!r.ok)throw new Error("Bağlantı yoxlanmadı.");return r.json() as Promise<Connection>;}
async function getInbox(){const r=await fetch("/api/desktop-inbox",{cache:"no-store"});if(!r.ok)throw new Error("Sifarişlər yüklənmədi");return (await r.json() as {rows:InboxRow[]}).rows;}
export function DesktopConnection() {
  useLanguage();
  const [state,setState]=useState<Connection|null>(null),[url,setUrl]=useState(""),[key,setKey]=useState(""),[issued,setIssued]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function load(){const d=await getConnection();setState(d);setUrl(d.url||"");}
  useEffect(()=>{let active=true;void getConnection().then(d=>{if(active){setState(d);setUrl(d.url||"");}}).catch(()=>{if(active)setMessage("Bağlantı yoxlanmadı.");});return()=>{active=false;};},[]);
  async function act(action:string) {
    setBusy(true);setMessage("");
    try {
      const r=await fetch("/api/desktop-link",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,url,key})});
      const d=await r.json() as {error?:string;key?:string};if(!r.ok)throw new Error(d.error);
      setKey("");setIssued(d.key||"");setMessage("Saxlanıldı");await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Bağlantı yoxlanmadı.");}finally{setBusy(false);}
  }
  if(!state)return <p role="status">{t(message||"Yüklənir...")}</p>;
  return <section className="desktop-connection">
    <h2>{t("Masaüstü bağlantısı")}</h2>
    <p>{t(state.local?"Stok və maliyyə yalnız bu kompüterdədir. Vebə məhsul adı, şəkli, satış qiyməti və sifariş statusları göndərilir.":"Masaüstündən kataloq almaq və sifarişləri kompüterə çatdırmaq üçün bağlantı yaradın.")}</p>
    <p className="desktop-state">{t(state.configured?"Bağlantı qurulub":"Bağlantı qurulmayıb")}</p>
    {state.configured&&<p>{t(state.mode==='catalog'?'Kataloq və sifariş statusları':'Yalnız sifarişləri al')}</p>}
    {state.local&&<div className="desktop-sync-summary">
      {state.lastSync&&<p>{t('Son sinxronizasiya')}: {new Date(state.lastSync).toLocaleString(languageLocale())}</p>}
      {!!state.pending&&<p>{t('Göndərilməyi gözləyir')}: {state.pending}</p>}
      {state.lastError&&<p role="alert" className="form-error">{t(state.lastError)}</p>}
      <p>{t('Oflayn şəkillər')}: {state.media?`${state.media.cached} / ${state.media.total}`:'—'}</p>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>void act('cache-media')}>{t('Şəkilləri kompüterə endir')}</Button>
    </div>}
    {state.local?<form onSubmit={(event:FormEvent)=>{event.preventDefault();void act("connect");}} className="desktop-connect-form">
      <label>{t("Mağaza ünvanı")}<Input type="url" value={url} onChange={e=>setUrl(e.target.value)} required placeholder="https://magaza.az"/></label>
      <label>{t("Bağlantı açarı")}<Input type="password" value={key} onChange={e=>setKey(e.target.value)} required autoComplete="new-password" placeholder="bk_catalog_…"/></label>
      <div className="row-actions"><Button disabled={busy}>{t("Yoxla və qoş")}</Button>{state.configured&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void act("disconnect")}>{t("Bağlantını kəs")}</Button>}</div>
    </form>:<div className="desktop-connect-form">
      <p>{t("Yeni açar əvvəlki açarı ləğv edir. Açar yalnız bir dəfə göstərilir.")}</p>
      <div className="row-actions"><Button disabled={busy} onClick={()=>void act("rotate-catalog")}>{t("Kataloq bağlantısı yarat")}</Button><Button variant="outline" disabled={busy} onClick={()=>void act("rotate")}>{t("Yalnız sifariş açarı yarat")}</Button>{state.configured&&<Button variant="outline" disabled={busy} onClick={()=>void act("revoke")}>{t("Açarı ləğv et")}</Button>}</div>
      <p>{t('Bağlantı bir kompüter üçündür. Stok, alış qiyməti və maliyyə vebə ötürülmür.')}</p>
      {issued&&<label>{t("Bağlantı açarı")}<Input readOnly value={issued} onFocus={e=>e.target.select()}/><small>{t("Bu açarı yalnız masaüstü tətbiqə daxil edin.")}</small></label>}
    </div>}
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
  useEffect(()=>{let active=true,running=false;async function poll(){if(running)return;running=true;try{const r=await fetch("/api/desktop-inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sync"})});const synced=r.ok;const list=await fetch("/api/desktop-inbox",{cache:"no-store"});if(!list.ok)throw new Error();const data=await list.json() as {rows:InboxRow[]};if(active){setCount(data.rows.filter((r:InboxRow)=>!r.local_order_id&&["pending","ready"].includes(r.payload.status)).length);setState(synced?"ok":"error");}}catch{if(active)setState("error");}finally{running=false;}}void poll();const timer=setInterval(()=>void poll(),30000);return()=>{active=false;clearInterval(timer);};},[]);
  return <button className={`desktop-status ${state}`} onClick={onOpen}><span>●</span> {t("Lokal kassa")} · {t(state==="error"?"Bağlantını yoxlayın":"Veb sifarişləri")}: {count}</button>;
}
