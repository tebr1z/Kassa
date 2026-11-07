"use client";
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,FormEvent} from "react";
import Link from "next/link";
import {Package,ShieldCheck,ShoppingBag,Truck,ArrowLeft,ArrowRight,LogOut,Mail,Phone,UserRound,MessageSquare,Settings,LoaderCircle,AlertCircle,Eye,EyeOff} from "lucide-react";
import {BrandLogo} from "../brand-logo";
import "../storefront.css";
import "./account.css";
import {t,useLanguage,languageLocale,LanguageSwitcher} from "@/lib/language";
import {SupportDesk} from "../support-desk";
import {AccountSettings} from "../account-settings";
import {OrderList,type CustomerOrder} from './order-list';

type User={id:string;name:string;phone:string;email:string;address:string;lat:number|null;lng:number|null};
type OrderStats={total:number;active:number;completed:number};
function currentTab(){const tab=new URLSearchParams(window.location.search).get('tab');return tab==='tickets'||tab==='settings'?tab:'orders';}
function subscribeTab(callback:()=>void){window.addEventListener('popstate',callback);window.addEventListener('restamarket-account-tab',callback);return()=>{window.removeEventListener('popstate',callback);window.removeEventListener('restamarket-account-tab',callback);};}



export default function Account(){useLanguage();
 const [user,setUser]=useState<User|null>(null);
 const [ready,setReady]=useState(false);
 const [register,setRegister]=useState(false);
 const [orders,setOrders]=useState<CustomerOrder[]>([]);
 const [stats,setStats]=useState<OrderStats>({total:0,active:0,completed:0});
 const tab=useSyncExternalStore(subscribeTab,currentTab,()=> 'orders' as const);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [ordersError,setOrdersError]=useState("");
 const [refreshing,setRefreshing]=useState(false);
 const [showPassword,setShowPassword]=useState(false);
 const generation=useRef(0);
 const identity=useRef<string|null>(null),authPending=useRef(false);

 const load=useCallback(async()=>{
  const run=++generation.current;setRefreshing(true);
  try{
   const r=await fetch("/api/customer-account",{cache:"no-store"});
   if(!r.ok)throw new Error("Hesab yüklənmədi");
   const d=await r.json() as {user:User|null};
   if(!d||typeof d!=='object'||!('user' in d))throw new Error('Hesab yüklənmədi');
   if(run!==generation.current)return;
   if(identity.current!==(d.user?.id||null)){setOrders([]);setStats({total:0,active:0,completed:0});setOrdersError("");}
   identity.current=d.user?.id||null;setUser(d.user);setError("");
   if(d.user){
    try{const ordersResponse=await fetch("/api/my-orders",{cache:"no-store"});
     if(!ordersResponse.ok)throw new Error("Sifarişlər yüklənmədi");
     const ordersJson=await ordersResponse.json() as {orders:CustomerOrder[];stats:OrderStats};
     if(!Array.isArray(ordersJson.orders)||!ordersJson.stats)throw new Error('Sifarişlər yüklənmədi');
     if(run===generation.current){setOrders(ordersJson.orders);setStats(ordersJson.stats);setOrdersError("");}
    }catch{if(run===generation.current)setOrdersError("Sifarişlər yüklənmədi");}
   }else{setOrders([]);setStats({total:0,active:0,completed:0});setOrdersError("");}
  }catch{if(run===generation.current)setError("Hesab yüklənmədi")}
  finally{if(run===generation.current){setReady(true);setRefreshing(false);}}
 },[]);
 useEffect(()=>{const tracker=generation,frame=requestAnimationFrame(()=>void load());const timer=setInterval(()=>{if(!document.hidden&&!authPending.current)void load();},15000);return()=>{cancelAnimationFrame(frame);clearInterval(timer);tracker.current++;};},[load]);
 function selectTab(next:typeof tab){window.history.replaceState(null,'','/account?tab='+next);window.dispatchEvent(new Event('restamarket-account-tab'));}

 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(authPending.current)return;authPending.current=true;generation.current++;setBusy(true);setError("");
  try{
   const d=Object.fromEntries(new FormData(e.currentTarget));
   const r=await fetch("/api/customer-account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...d,action:register?"register":"login"})});
   const json=await r.json() as {ok?:boolean;error?:string};
   if(!r.ok||json.ok!==true)throw new Error(json.error||"Giriş alınmadı");
   await load();
  }catch(e){setError(e instanceof TypeError||e instanceof SyntaxError?"Giriş alınmadı":e instanceof Error?e.message:"Giriş alınmadı")}
  finally{authPending.current=false;setBusy(false);setRefreshing(false)}
 }
 async function logout(){
  if(authPending.current)return;authPending.current=true;generation.current++;setBusy(true);
  try{
   const r=await fetch("/api/customer-account",{method:"DELETE"});
   if(!r.ok)throw new Error();
   generation.current++;identity.current=null;setUser(null);setOrders([]);setStats({total:0,active:0,completed:0});setOrdersError("");setError("");setRefreshing(false);
  }catch{setError("Çıxış alınmadı")}
  finally{authPending.current=false;setBusy(false);setRefreshing(false)}
 }

 return (
  <div className="shop account">
   <header className="shop-header rm-account-header">
    <Link className="shop-brand" href="/"><BrandLogo/><strong>RestaMarket</strong></Link>
    <div className="account-header-actions"><Link className="account-back" href="/" aria-label={t("Mağazaya qayıt")} title={t("Mağazaya qayıt")}><ArrowLeft size={16}/><span>{t("Mağazaya qayıt")}</span></Link><LanguageSwitcher/>
    {user&&<button type="button" className="account-logout" disabled={busy} onClick={logout} aria-label={t("Hesabdan çıx")} title={t("Hesabdan çıx")}>{busy?<LoaderCircle className="account-spin" size={17}/>:<LogOut size={17}/>}<span>{t("Hesabdan çıx")}</span></button>}</div>
   </header>
   <main>
    {error&&user&&<div role="alert" className="account-notice is-error"><AlertCircle size={19}/><p>{t(error)}</p><button type="button" onClick={()=>void load()} disabled={refreshing}>{t("Yenidən yoxla")}</button></div>}
    {!ready?<section className="account-loading" role="status"><LoaderCircle className="account-spin" size={24}/><p>{t("Hesabınız yüklənir…")}</p><div className="account-loading-cards" aria-hidden="true"><i/><i/><i/></div></section>:!user?(
     <section className="account-login">
      <div className="account-login-icon"><BrandLogo size={56}/></div><span className="shop-tag">{t("Müştəri paneli")}</span>
      <h1>{t(register?"Hesab yaradın":"Xoş gəlmisiniz")}</h1>
      <p>{t("Sifarişlərinizi bir yerdən izləyin, hazır olduqda mağazadan götürün.")}</p>
      <div className="account-perks"><span><Package size={17}/>{t("Sifarişlərim")}</span><span><Truck size={17}/>{t("Çatdırılma")}</span><span><ShieldCheck size={17}/>{t("Hesab ayarları")}</span></div>
      <div className="account-auth-switch" aria-label={t("Hesaba giriş üsulu")}>
       <button type="button" aria-pressed={!register} disabled={busy} className={!register?"selected":""} onClick={()=>{setRegister(false);setError("");setShowPassword(false);}}>{t("Daxil ol")}</button>
       <button type="button" aria-pressed={register} disabled={busy} className={register?"selected":""} onClick={()=>{setRegister(true);setError("");setShowPassword(false);}}>{t("Qeydiyyat")}</button>
      </div>
      <form onSubmit={submit}><fieldset disabled={busy} className="account-auth-fields">
       {register&&<>
        <label>{t("Ad və soyad")}<input name="name" required minLength={2} maxLength={100} autoComplete="name"/></label>
        <label>{t("Telefon")}<input name="phone" type="tel" required pattern="[+0-9 ()-]{7,25}" autoComplete="tel"/></label>
       </>}
       <label>{t("E-poçt")}<input name="email" type="email" required maxLength={200} autoComplete="email"/></label>
       <label>{t("Şifrə")}<span className="account-password-field"><input name="password" type={showPassword?"text":"password"} required minLength={8} maxLength={128} autoComplete={register?"new-password":"current-password"} aria-describedby="account-password-hint"/><button type="button" aria-label={t(showPassword?"Şifrəni gizlət":"Şifrəni göstər")} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
       <small id="account-password-hint">{t("Şifrə ən azı 8 simvol olmalıdır.")}</small>
       {error&&<div className="account-notice is-error" role="alert"><AlertCircle size={18}/><p>{t(error)}</p>{error==='Hesab yüklənmədi'&&<button type="button" disabled={refreshing} onClick={()=>void load()}>{t('Yenidən yoxla')}</button>}</div>}
       <button className="shop-primary" disabled={busy}>{busy?<LoaderCircle className="account-spin" size={17}/>:<ArrowRight size={17}/>} {t(busy?"Gözləyin…":register?"Hesab yarat":"Daxil ol")}</button>
       </fieldset>
      </form>
     </section>
    ):(
     <section className="account-orders">
      <div className="account-welcome"><div className="account-avatar" aria-hidden="true">{user.name.trim().slice(0,1).toLocaleUpperCase(languageLocale())||<UserRound/>}</div><div><span className="shop-tag">{t("Müştəri paneli")}</span><h1>{t("Salam,")} {user.name}</h1><p>{t("Sifarişlər, ünvan və dəstək — bir yerdə.")}</p><div className="account-contact"><span><Mail size={14}/>{user.email}</span><span><Phone size={14}/>{user.phone}</span></div></div><Link href="/" className="account-continue">{t("Alış-verişə davam et")}<ArrowRight size={16}/></Link></div>
      {!ordersError&&<div className="account-summary"><div><span className="account-stat-icon"><ShoppingBag size={21}/></span><strong>{stats.total}</strong><span>{t("Bütün sifarişlər")}</span></div><div><span className="account-stat-icon"><Truck size={21}/></span><strong>{stats.active}</strong><span>{t("Aktiv sifarişlər")}</span></div><div><span className="account-stat-icon"><Package size={21}/></span><strong>{stats.completed}</strong><span>{t("Tamamlanan sifarişlər")}</span></div></div>}
      <nav className="account-tabs" aria-label={t("Müştəri paneli")}>
       <button type="button" aria-current={tab==="orders"?'page':undefined} className={tab==="orders"?"selected":""} onClick={()=>selectTab("orders")}><Package size={18}/>{t("Sifarişlərim")}</button>
       <button type="button" aria-current={tab==="tickets"?'page':undefined} className={tab==="tickets"?"selected":""} onClick={()=>selectTab("tickets")}><MessageSquare size={18}/>{t("Dəstək biletləri")}</button>
       <button type="button" aria-current={tab==="settings"?'page':undefined} className={tab==="settings"?"selected":""} onClick={()=>selectTab("settings")}><Settings size={18}/>{t("Hesab ayarları")}</button>
      </nav>
      {tab==="orders"&&<>{ordersError&&<div className="account-notice is-error" role="alert"><AlertCircle size={18}/><p>{t(ordersError)} {orders.length>0&&t("Son yüklənmiş məlumat göstərilir.")}</p></div>}{stats.total>orders.length&&<p className="account-limit-note">{t("Son 100 sifariş göstərilir.")}</p>}<OrderList key={user.id} orders={orders} unavailable={!!ordersError} refreshing={refreshing} onRefresh={load}/></>}
      {tab==="tickets"&&<SupportDesk key={user.id}/>}
      {tab==="settings"&&<AccountSettings key={user.id} user={user} onSaved={load}/>}
     </section>
    )}
   </main>
  </div>
 );
}
