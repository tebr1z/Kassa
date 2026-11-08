"use client";
import {useState} from 'react';
import Link from 'next/link';
import {ArrowRight,Check,CheckCircle2,ChevronDown,Clock3,Copy,MapPin,Package,RefreshCw,ShoppingBag,Store,Truck,XCircle} from 'lucide-react';
import {useTranslations} from '@/lib/language';

export type CustomerOrder={order_no:string;status:string;cancellation_reason?:string|null;cancelled_at?:string|null;total:string;coupon_code:string|null;coupon_discount:string;created_at:string;fulfillment:string;delivery_stage:string;delivery_address:string;delivery_fee?:string|number|null;distance_meters?:number|null;items:{name:string;quantity:number;unitPrice?:number;lineTotal?:number}[]};
const filters=['all','active','completed','cancelled'] as const;
const filterLabels={all:'Hamısı',active:'Aktiv sifarişlər',completed:'Tamamlanan sifarişlər',cancelled:'Ləğv edilənlər'};
function completed(order:CustomerOrder){return order.status!=='cancelled'&&(order.delivery_stage==='delivered'||order.status==='completed');}

export function OrderList({orders,onRefresh,unavailable,refreshing}:{orders:CustomerOrder[];onRefresh:()=>void;unavailable:boolean;refreshing:boolean}){
 const {t}=useTranslations();const [filter,setFilter]=useState<typeof filters[number]>('all');
 const shown=orders.filter(order=>filter==='all'||(filter==='cancelled'?order.status==='cancelled':filter==='completed'?completed(order):order.status!=='cancelled'&&!completed(order)));
 return <section className="account-order-list" aria-labelledby="account-order-heading">
  <div className="account-section-heading"><div><h2 id="account-order-heading">{t('Sifarişlərim')}</h2><p>{t('Sifarişinizin hazırkı mərhələsini buradan izləyin.')}</p></div><button type="button" className="account-secondary" disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} className={refreshing?'account-spin':undefined}/>{t(refreshing?'Yüklənir…':'Yenilə')}</button></div>
  {orders.length>0&&<div className="account-order-filters" aria-label={t('Sifariş filtri')}>{filters.map(value=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{t(filterLabels[value])}</button>)}</div>}
  {!shown.length&&!unavailable&&<div className="account-empty"><span className="account-empty-icon"><ShoppingBag size={29}/></span><h3>{t(orders.length?'Bu bölmədə sifariş yoxdur.':'İlk sifarişiniz sizi gözləyir')}</h3><p>{t(orders.length?'Digər sifarişlərə baxmaq üçün filtri dəyişin.':'Kataloqdan seçin, səbətdə tamamlayın.')}</p>{orders.length?<button type="button" className="account-secondary" onClick={()=>setFilter('all')}>{t('Bütün sifarişlər')}</button>:<Link className="shop-primary" href="/">{t('Kataloqa keç')}<ArrowRight size={17}/></Link>}</div>}
  <div className="account-order-stack">{shown.map(order=><OrderCard key={order.order_no} order={order}/>)}</div>
 </section>;
}

function OrderCard({order}:{order:CustomerOrder}){
 const {t,languageLocale,languageAmount}=useTranslations();
 const [copyState,setCopyState]=useState<'idle'|'copied'|'failed'>('idle');
 const delivery=order.fulfillment==='delivery',cancelled=order.status==='cancelled',done=completed(order);
 const steps=delivery?['received','preparing','ready','dispatched','delivered']:['received','preparing','ready','delivered'];
 const stage=done?steps.length-1:Math.max(0,steps.indexOf(order.delivery_stage));
 const labels:Record<string,string>={received:'Qəbul edildi',preparing:'Hazırlanır',ready:delivery?'Hazırdır':'Götürməyə hazır',dispatched:'Yoldadır',delivered:delivery?'Çatdırıldı':'Təhvil verildi'};
 const fee=Number(order.delivery_fee||0);
 async function copyNumber(){try{await navigator.clipboard.writeText(order.order_no);setCopyState('copied');}catch{setCopyState('failed');}}
 return <article className={'account-order '+(cancelled?'is-cancelled':done?'is-completed':'is-active')}>
  <header className="account-order-heading"><span className="account-order-type" aria-hidden="true">{delivery?<Truck size={23}/>:<Store size={23}/>}</span><div><span className={'account-order-status '+(cancelled?'is-cancelled':done?'is-completed':'is-active')}>{cancelled?<XCircle size={13}/>:done?<CheckCircle2 size={13}/>:<Clock3 size={13}/>} {t(cancelled?'Sifariş ləğv edilib':labels[steps[stage]])}</span><h3>{t(delivery?'Ünvana çatdırılma':'Mağazadan götürmə')}</h3><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleString(languageLocale(),{timeZone:'Asia/Baku',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time></div><div className="account-order-amount"><small>{t('Yekun məbləğ')}</small><strong>{languageAmount(Number(order.total))} <small>₼</small></strong>{delivery&&fee>0&&<span>{t('Çatdırılma haqqı')}: {languageAmount(fee)} ₼</span>}</div></header>
  <div className="order-code"><div><small>{t('SİFARİŞ NÖMRƏSİ')}</small><strong>{order.order_no}</strong></div><button type="button" className="account-order-copy" onClick={()=>void copyNumber()} aria-label={t('Sifariş nömrəsini kopyala')} title={t('Sifariş nömrəsini kopyala')}>{copyState==='copied'?<Check size={17}/>:<Copy size={17}/>}</button></div>
  {copyState!=='idle'&&<p className="account-copy-status" role="status">{t(copyState==='copied'?'Sifariş nömrəsi kopyalandı.':'Nömrəni seçib əl ilə kopyalaya bilərsiniz.')}</p>}
  {cancelled&&<div className="account-order-hint" style={{color:'#9d372b',background:'#fff4f1',overflowWrap:'anywhere'}}><strong>{t('Mağazanın ləğv səbəbi')}</strong><p>{order.cancellation_reason||t('Bu köhnə sifariş üçün ləğv səbəbi qeyd edilməyib.')}</p></div>}
  {!cancelled&&<><ol className="order-timeline" data-steps={steps.length} aria-label={t('Sifarişin mərhələləri')}>{steps.map((step,index)=><li key={step} className={index<=stage?'done':''} aria-current={index===stage?'step':undefined}><span>{index<=stage?<Check size={14} aria-hidden="true"/>:index+1}</span><b>{t(labels[step])}</b></li>)}</ol><p className={'account-order-hint '+(!delivery&&order.delivery_stage==='ready'?'is-ready':'')}>{t(done?'Təhvil tamamlanıb.':!delivery&&order.delivery_stage==='ready'?'Sifarişiniz hazırdır! Mağazaya gəlib sifariş nömrəsini göstərin.':'Məhsullar və təhvil vaxtı mağaza tərəfindən təsdiqlənir.')}</p></>}
  <details className="account-order-details"><summary><span><Package size={17}/>{t('Məhsullar və təhvil məlumatı')}<small>{order.items?.length||0}</small></span><ChevronDown size={16}/></summary><ul className="account-order-items">{order.items?.map((item,index)=><li key={index}><span>{item.name}<small>{t('Miqdar')}: {item.quantity}</small></span>{item.lineTotal!=null&&<strong>{languageAmount(Number(item.lineTotal))} ₼</strong>}</li>)}</ul>{order.coupon_code&&<p className="account-order-coupon">{t('Kupon:')} {order.coupon_code} · −{languageAmount(Number(order.coupon_discount))} ₼</p>}{delivery&&order.delivery_address&&<div className="account-delivery-address"><MapPin size={18}/><div><strong>{t('Çatdırılma ünvanı')}</strong><p>{order.delivery_address}</p><small>{t('Çatdırılma vaxtı mağaza tərəfindən təsdiqlənir.')}</small></div></div>}</details>
 </article>;
}
