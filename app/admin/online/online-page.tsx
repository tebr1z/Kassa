"use client";
// Rendered only by the unlisted staff portal route.
import {staffPortalPath} from '@/lib/staff-portal';
import {useAdminActivity} from "@/lib/use-admin-activity";
import {useTranslations} from "@/lib/language";
import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import OrderCancelDialog from './order-cancel-dialog';
import "../store/store-admin.css";
type Order={id:string;order_no:string;status:string;cancellation_reason?:string|null;fulfillment:string;delivery_stage:string;delivery_address:string;total:string;coupon_code:string|null;coupon_discount:string;note:string;created_at:string;full_name:string;phone:string;items:{name:string;quantity:number}[]};
export default function OnlineOrders(){useAdminActivity();const {t,languageLocale}=useTranslations();
 const [rows,setRows]=useState<Order[]>([]),[filter,setFilter]=useState("pending"),[error,setError]=useState(""),[canCancel,setCanCancel]=useState(false),[canManage,setCanManage]=useState(false),[busy,setBusy]=useState(false),[cancelOrder,setCancelOrder]=useState<Order|null>(null);
 async function logout(){setBusy(true);setError('');try{const response=await fetch('/api/auth',{method:'DELETE'});if(!response.ok)throw Error();window.location.replace(staffPortalPath());}catch{setError('Bağlantı xətası');setBusy(false);}}
 async function load(){try{const r=await fetch("/api/online-orders",{cache:"no-store"});if(!r.ok)throw new Error("Bu bölmə üçün hesabınıza daxil olun.");const d=await r.json() as {rows:Order[];canCancel:boolean;canManage:boolean};setRows(d.rows);setCanCancel(d.canCancel);setCanManage(d.canManage);setError("")}catch(e){setError(e instanceof Error?e.message:"Yüklənmədi")}}
 useEffect(()=>{const frame=requestAnimationFrame(()=>void load()),timer=setInterval(()=>void load(),15000);return()=>{cancelAnimationFrame(frame);clearInterval(timer);}},[]);
 async function update(id:string,status:string){setBusy(true);try{const r=await fetch("/api/online-orders",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);if(status==="completed")setFilter("completed");await load()}catch(e){setError(e instanceof Error?e.message:"Saxlanmadı")}finally{setBusy(false)}}
 return <main className="store-admin">
  <div className="sa-title"><a href={staffPortalPath()}>{t("İdarəetmə mərkəzi")}</a><Button type="button" variant="outline" disabled={busy} onClick={()=>void logout()}>{t("Çıxış")}</Button></div>
  <span className="sa-eyebrow" style={{display:"block",marginTop:28}}>{t("SİFARİŞ MƏRKƏZİ")}</span><h1>{t("Onlayn sifarişlər")}</h1><p>{t("Sifarişləri və çatdırılma mərhələlərini buradan idarə edin. Ödəniş və çek üçün kassa panelindən istifadə edin.")}</p>
  <nav className="sa-tabs">{[["pending","Yeni"],["ready","Hazır"],["completed","Tamamlandı"],["cancelled","Ləğv edilib"]].map(([id,label])=><button key={id} className={filter===id?"selected":""} onClick={()=>setFilter(id)}>{t(label)} · {rows.filter(r=>r.status===id).length}</button>)}<button onClick={load}>{t("Yenilə")}</button></nav>
  {error&&<p role="alert" className="form-error">{t(error)}</p>}
  <div style={{display:"grid",gap:16}}>{rows.filter(r=>r.status===filter).map(o=><article className="panel settings-form" key={o.id}>
   <div className="sa-title"><div><small>{new Date(o.created_at).toLocaleString(languageLocale(),{timeZone:"Asia/Baku"})}</small><h2>{o.full_name}</h2><p>{o.phone} · {o.fulfillment==="delivery"?t("Çatdırılma"):t("Mağazadan götürmə")}</p><p>{o.delivery_address}</p><p>{t(({received:"Qəbul edildi",preparing:"Hazırlanır",ready:"Hazırdır",dispatched:"Yoldadır",delivered:"Çatdırıldı"} as Record<string,string>)[o.delivery_stage]||o.delivery_stage)}</p></div><strong>{Number(o.total).toFixed(2)} ₼</strong></div>
   {o.coupon_code&&<p>{t("Kupon:")}{o.coupon_code} · −{Number(o.coupon_discount).toFixed(2)} ₼</p>}<small style={{overflowWrap:"anywhere"}}>{o.order_no}</small>
   <div style={{margin:"20px 0"}}>{o.items?.map((i,n)=><p key={n} style={{padding:"8px 0",borderBottom:"1px solid #eee"}}>{i.name} <strong>× {i.quantity}</strong></p>)}</div>{o.note&&<p>{o.note}</p>}
   {o.status==='cancelled'&&<div style={{padding:14,background:'#fff4f1',borderRadius:12,color:'#9d372b',overflowWrap:'anywhere'}}><strong>{t('Ləğv səbəbi')}</strong><p>{o.cancellation_reason||t('Bu köhnə sifariş üçün ləğv səbəbi qeyd edilməyib.')}</p></div>}
   <div style={{display:"flex",gap:10,marginTop:16,flexWrap:"wrap"}}>{canManage&&o.status!=="cancelled"&&o.status!=="completed"&&<>
    {o.delivery_stage==="received"&&<Button disabled={busy} onClick={()=>update(o.id,"preparing")}>{t("Hazırlamağa başla")}</Button>}
    {o.delivery_stage==="preparing"&&<Button disabled={busy} onClick={()=>update(o.id,"ready")}>{t("Hazırdır")}</Button>}
    {o.delivery_stage==="ready"&&o.fulfillment==="delivery"&&<Button disabled={busy} onClick={()=>update(o.id,"dispatched")}>{t("Yola sal")}</Button>}
    {o.delivery_stage==="dispatched"&&<Button disabled={busy} onClick={()=>update(o.id,"delivered")}>{t("Çatdırıldı")}</Button>}
    {o.status==="ready"&&<Button disabled={busy} onClick={()=>update(o.id,"completed")}>{t("Sifarişi tamamla")}</Button>}
   </>}{canManage&&canCancel&&["pending","ready","completed"].includes(o.status)&&<Button disabled={busy} variant="outline" onClick={()=>setCancelOrder(o)}>{t("Sifarişi ləğv et")}</Button>}</div>
  </article>)}{!rows.some(r=>r.status===filter)&&<p className="empty-table">{t("Bu bölmədə sifariş yoxdur.")}</p>}</div>
  <OrderCancelDialog order={cancelOrder} api="online" onClose={()=>setCancelOrder(null)} onCancelled={async()=>{setFilter('cancelled');await load();}}/>
 </main>;
}
