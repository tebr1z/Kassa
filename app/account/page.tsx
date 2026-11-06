"use client";
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,FormEvent} from "react";
import Link from "next/link";
import {Package,ShieldCheck,ShoppingBag,Truck,ArrowLeft} from "lucide-react";
import {BrandLogo} from "../brand-logo";
import "../storefront.css";
import "./account.css";
import {t,useLanguage,languageLocale,languageAmount,LanguageSwitcher} from "@/lib/language";
import {SupportDesk} from "../support-desk";
import {AccountSettings} from "../account-settings";

type User={id:string;name:string;phone:string;email:string;address:string;lat:number|null;lng:number|null};
type Order={order_no:string;status:string;total:string;coupon_code:string|null;coupon_discount:string;created_at:string;fulfillment:string;delivery_stage:string;delivery_address:string;items:{name:string;quantity:number;unitPrice?:number;lineTotal?:number}[]};
type OrderStats={total:number;active:number;completed:number};
function currentTab(){const tab=new URLSearchParams(window.location.search).get('tab');return tab==='tickets'||tab==='settings'?tab:'orders';}
function subscribeTab(callback:()=>void){window.addEventListener('popstate',callback);window.addEventListener('restamarket-account-tab',callback);return()=>{window.removeEventListener('popstate',callback);window.removeEventListener('restamarket-account-tab',callback);};}



export default function Account(){useLanguage();
 const [user,setUser]=useState<User|null>(null);
 const [ready,setReady]=useState(false);
 const [register,setRegister]=useState(false);
 const [orders,setOrders]=useState<Order[]>([]);
 const [stats,setStats]=useState<OrderStats>({total:0,active:0,completed:0});
 const tab=useSyncExternalStore(subscribeTab,currentTab,()=> 'orders' as const);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [ordersError,setOrdersError]=useState("");
 const [refreshing,setRefreshing]=useState(false);
 const generation=useRef(0);

 const load=useCallback(async()=>{
  const run=++generation.current;setRefreshing(true);
  try{
   const r=await fetch("/api/customer-account",{cache:"no-store"});
   if(!r.ok)throw new Error("Hesab yüklənmədi");
   const d=await r.json() as {user:User|null};
   if(run!==generation.current)return;
   setUser(d.user);setError("");
   if(d.user){
    try{const ordersResponse=await fetch("/api/my-orders",{cache:"no-store"});
     if(!ordersResponse.ok)throw new Error("Sifarişlər yüklənmədi");
     const ordersJson=await ordersResponse.json() as {orders:Order[];stats:OrderStats};
     if(run===generation.current){setOrders(ordersJson.orders);setStats(ordersJson.stats);setOrdersError("");}
    }catch{if(run===generation.current)setOrdersError("Sifarişlər yüklənmədi");}
   }else{setOrders([]);setOrdersError("");}
  }catch(e){if(run===generation.current)setError(e instanceof Error?e.message:"Bağlantı alınmadı")}
  finally{if(run===generation.current){setReady(true);setRefreshing(false);}}
 },[]);
 useEffect(()=>{const tracker=generation,frame=requestAnimationFrame(()=>void load());const timer=setInterval(()=>{if(!document.hidden)void load();},15000);return()=>{cancelAnimationFrame(frame);clearInterval(timer);tracker.current++;};},[load]);
 function selectTab(next:typeof tab){window.history.replaceState(null,'','/account?tab='+next);window.dispatchEvent(new Event('restamarket-account-tab'));}

 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError("");
  try{
   const d=Object.fromEntries(new FormData(e.currentTarget));
   const r=await fetch("/api/customer-account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...d,action:register?"register":"login"})});
   const json=await r.json() as {error?:string};
   if(!r.ok)throw new Error(json.error);
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Giriş alınmadı")}
  finally{setBusy(false)}
 }
 async function logout(){
  setBusy(true);
  try{
   const r=await fetch("/api/customer-account",{method:"DELETE"});
   if(!r.ok)throw new Error();
   generation.current++;setUser(null);setOrders([]);setOrdersError("");setError("");setRefreshing(false);
  }catch{setError("Çıxış alınmadı")}
  finally{setBusy(false)}
 }

 return (
  <div className="shop account">
   <header className="shop-header rm-account-header">
    <Link className="shop-brand" href="/"><BrandLogo/><strong>RestaMarket</strong></Link>
    <Link className="account-back" href="/"><ArrowLeft size={16}/>{t("Mağazaya qayıt")}</Link><LanguageSwitcher/>
    {user&&<button className="shop-cart-button" disabled={busy} onClick={logout}>{t("Hesabdan çıx")}</button>}
   </header>
   <main>
    {error&&<p role="alert" className="shop-error">{t(error)} <button onClick={()=>void load()} disabled={refreshing}>{t("Yenidən yoxla")}</button></p>}
    {!ready?<p>{t("Yüklənir…")}</p>:!user?(
     <section className="account-login">
      <div className="account-login-icon"><BrandLogo size={56}/></div><span className="shop-tag">{t("Müştəri paneli")}</span>
      <h1>{t(register?"Hesab yaradın":"Xoş gəlmisiniz")}</h1>
      <p>{t("Sifarişlərinizi bir yerdən izləyin, hazır olduqda mağazadan götürün.")}</p>
      <div className="account-perks"><span><Package size={17}/>{t("Sifarişlərim")}</span><span><Truck size={17}/>{t("Çatdırılma")}</span><span><ShieldCheck size={17}/>{t("Hesab ayarları")}</span></div>
      <div className="shop-categories">
       <button className={!register?"selected":""} onClick={()=>setRegister(false)}>{t("Daxil ol")}</button>
       <button className={register?"selected":""} onClick={()=>setRegister(true)}>{t("Qeydiyyat")}</button>
      </div>
      <form onSubmit={submit}>
       {register&&<>
        <label>{t("Ad və soyad")}<input name="name" required minLength={2} maxLength={100} autoComplete="name"/></label>
        <label>{t("Telefon")}<input name="phone" type="tel" required pattern="[+0-9 ()-]{7,25}" autoComplete="tel"/></label>
       </>}
       <label>{t("E-poçt")}<input name="email" type="email" required maxLength={200} autoComplete="email"/></label>
       <label>{t("Şifrə")}<input name="password" type="password" required minLength={8} maxLength={128} autoComplete={register?"new-password":"current-password"}/></label>
       <small>{t("Şifrə ən azı 8 simvol olmalıdır.")}</small>
       <button className="shop-primary" disabled={busy}>{t(busy?"Gözləyin…":register?"Hesab yarat":"Daxil ol")}</button>
      </form>
     </section>
    ):(
     <section className="account-orders">
      <span className="shop-tag">{t("Müştəri paneli")}</span>
      <h1>{t("Salam,")} {user.name}</h1>
      <p>{user.email} · {user.phone}</p>
      {!ordersError&&<div className="account-summary"><div><ShoppingBag/><strong>{stats.total}</strong><span>{t("Bütün sifarişlər")}</span></div><div><Truck/><strong>{stats.active}</strong><span>{t("Aktiv sifarişlər")}</span></div><div><Package/><strong>{stats.completed}</strong><span>{t("Tamamlanan sifarişlər")}</span></div></div>}
      <nav className="account-tabs" aria-label={t("Müştəri paneli")}>
       <button aria-current={tab==="orders"?'page':undefined} className={tab==="orders"?"selected":""} onClick={()=>selectTab("orders")}>{t("Sifarişlərim")}</button>
       <button aria-current={tab==="tickets"?'page':undefined} className={tab==="tickets"?"selected":""} onClick={()=>selectTab("tickets")}>{t("Dəstək biletləri")}</button>
       <button aria-current={tab==="settings"?'page':undefined} className={tab==="settings"?"selected":""} onClick={()=>selectTab("settings")}>{t("Hesab ayarları")}</button>
      </nav>
      {tab==="orders"&&<>{ordersError&&<p className="shop-error" role="alert">{t(ordersError)}</p>}{stats.total>orders.length&&<p>{t("Son 100 sifariş göstərilir.")}</p>}<OrderList orders={orders} unavailable={!!ordersError} refreshing={refreshing} onRefresh={load}/></>}
      {tab==="tickets"&&<SupportDesk/>}
      {tab==="settings"&&<AccountSettings user={user} onSaved={load}/>}
     </section>
    )}
   </main>
  </div>
 );
}

function OrderList({orders,onRefresh,unavailable,refreshing}:{orders:Order[];onRefresh:()=>void;unavailable:boolean;refreshing:boolean}){
 return (
  <>
   <div className="shop-section-title">
    <h2>{t("Sifarişlərim")}</h2>
    <button className="shop-cart-button" disabled={refreshing} onClick={onRefresh}>{t(refreshing?"Yüklənir…":"Yenilə")}</button>
   </div>
   {!orders.length&&!unavailable&&(
    <div className="account-empty">
     <h2>{t("İlk sifarişiniz sizi gözləyir")}</h2>
     <p>{t("Kataloqdan seçin, səbətdə tamamlayın.")}</p>
     <Link className="shop-primary" href="/">{t("Kataloqa keç")}</Link>
    </div>
   )}
   {orders.map(order=><OrderCard key={order.order_no} order={order}/>)}
  </>
 );
}

function OrderCard({order}:{order:Order}){
 const steps=order.fulfillment==='delivery'?['received','preparing','ready','dispatched','delivered']:['received','preparing','ready','delivered'];
 const stage=Math.max(0,steps.indexOf(order.delivery_stage));
 const labels:Record<string,string>={received:'Qəbul edildi',preparing:'Hazırlanır',ready:order.fulfillment==='pickup'?'Götürməyə hazır':'Hazırdır',dispatched:'Yoldadır',delivered:order.fulfillment==='pickup'?'Təhvil verildi':'Çatdırıldı'};
 return <article className="account-order"><div className="shop-section-title"><div><small>{new Date(order.created_at).toLocaleString(languageLocale(),{timeZone:'Asia/Baku'})}</small><h2>{t(order.fulfillment==='pickup'?'Mağazadan götürmə':'Çatdırılma')}</h2></div><strong>{languageAmount(Number(order.total))} ₼</strong></div>
 {order.coupon_code&&<p>{t('Kupon:')} {order.coupon_code} · −{languageAmount(Number(order.coupon_discount))} ₼</p>}
 {order.status==='cancelled'?<p className="shop-error">{t('Sifariş ləğv edilib')}</p>:<><ol className="order-timeline">{steps.map((step,index)=><li key={step} className={index<=stage?'done':''} aria-current={index===stage?'step':undefined}><span>{index<=stage?'✓':index+1}</span>{t(labels[step])}</li>)}</ol>
 {order.delivery_stage==='delivered'?<p className="pickup-ready">{t('Təhvil tamamlanıb.')}</p>:order.fulfillment==='pickup'&&order.delivery_stage==='ready'?<p className="pickup-ready">{t('Sifarişiniz hazırdır! Mağazaya gəlib sifariş nömrəsini göstərin.')}</p>:<p>{t('Məhsullar və təhvil vaxtı mağaza tərəfindən təsdiqlənir.')}</p>}</>}
 <div className="order-code"><small>{t('SİFARİŞ NÖMRƏSİ')}</small><strong>{order.order_no}</strong></div>{order.items?.map((item,index)=><p className="order-item" key={index}>{item.name}<b>× {item.quantity}</b></p>)}
 {order.fulfillment==='delivery'&&order.delivery_address&&<div className="account-delivery-address"><strong>{t('Çatdırılma ünvanı')}</strong><p>{order.delivery_address}</p><small>{t('Çatdırılma haqqı və vaxtı mağaza tərəfindən təsdiqlənir.')}</small></div>}</article>;
}
