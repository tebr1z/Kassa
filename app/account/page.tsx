"use client";
import {useEffect,useState,FormEvent} from "react";
import "../storefront.css";
import {SupportDesk} from "../support-desk";
import {AccountSettings} from "../account-settings";

type User={id:string;name:string;phone:string;email:string;address:string;lat:number|null;lng:number|null};
type Order={order_no:string;status:string;total:string;coupon_code:string|null;coupon_discount:string;created_at:string;fulfillment:string;delivery_stage:string;delivery_address:string;items:{name:string;quantity:number}[]};

const stageLabels:Record<string,string>={received:"Qəbul edildi",preparing:"Hazırlanır",ready:"Hazırdır",dispatched:"Yoldadır",delivered:"Çatdırıldı"};

export default function Account(){
 const [user,setUser]=useState<User|null>(null);
 const [ready,setReady]=useState(false);
 const [register,setRegister]=useState(false);
 const [orders,setOrders]=useState<Order[]>([]);
 const [tab,setTab]=useState<"orders"|"tickets"|"settings">("orders");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");

 async function load(){
  try{
   const r=await fetch("/api/customer-account");
   if(!r.ok)throw new Error("Hesab yüklənmədi");
   const d=await r.json() as {user:User|null};
   setUser(d.user);
   if(d.user){
    const ordersResponse=await fetch("/api/my-orders");
    if(!ordersResponse.ok)throw new Error("Sifarişlər yüklənmədi");
    const ordersJson=await ordersResponse.json() as {orders:Order[]};
    setOrders(ordersJson.orders);
   }
  }catch(e){setError(e instanceof Error?e.message:"Bağlantı alınmadı")}
  finally{setReady(true)}
 }
 useEffect(()=>{void load();const t=setInterval(()=>void load(),15000);return()=>clearInterval(t)},[]);

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
   setUser(null);setOrders([]);
  }catch{setError("Çıxış alınmadı")}
  finally{setBusy(false)}
 }

 return (
  <div className="shop account">
   <header className="shop-header">
    <a className="shop-brand" href="/">← Mağazaya qayıt</a>
    <strong>Hesabım</strong>
    {user&&<button className="shop-cart-button" disabled={busy} onClick={logout}>Çıxış</button>}
   </header>
   <main>
    {error&&<p role="alert" className="shop-error">{error}</p>}
    {!ready?<p>Yüklənir…</p>:!user?(
     <section className="account-login">
      <span className="shop-tag">SİZİN ŞƏXSİ KABİNETİNİZ</span>
      <h1>{register?"Hesab yaradın":"Xoş gəlmisiniz"}</h1>
      <p>Sifarişlərinizi bir yerdən izləyin, hazır olduqda mağazadan götürün.</p>
      <div className="shop-categories">
       <button className={!register?"selected":""} onClick={()=>setRegister(false)}>Daxil ol</button>
       <button className={register?"selected":""} onClick={()=>setRegister(true)}>Qeydiyyat</button>
      </div>
      <form onSubmit={submit}>
       {register&&<>
        <label>Ad və soyad<input name="name" required minLength={2} maxLength={100} autoComplete="name"/></label>
        <label>Telefon<input name="phone" type="tel" required pattern="[+0-9 ()-]{7,25}" autoComplete="tel"/></label>
       </>}
       <label>E-poçt<input name="email" type="email" required maxLength={200} autoComplete="email"/></label>
       <label>Şifrə<input name="password" type="password" required minLength={8} maxLength={128} autoComplete={register?"new-password":"current-password"}/></label>
       <small>Şifrə ən azı 8 simvol olmalıdır.</small>
       <button className="shop-primary" disabled={busy}>{busy?"Gözləyin…":register?"Hesab yarat":"Daxil ol"}</button>
      </form>
     </section>
    ):(
     <section className="account-orders">
      <span className="shop-tag">ŞƏXSİ KABİNET</span>
      <h1>Salam, {user.name}</h1>
      <p>{user.email} · {user.phone}</p>
      <nav className="account-tabs">
       <button className={tab==="orders"?"selected":""} onClick={()=>setTab("orders")}>Sifarişlər</button>
       <button className={tab==="tickets"?"selected":""} onClick={()=>setTab("tickets")}>Dəstək biletləri</button>
       <button className={tab==="settings"?"selected":""} onClick={()=>setTab("settings")}>Hesab ayarları</button>
      </nav>
      {tab==="orders"&&<OrderList orders={orders} onRefresh={load}/>}
      {tab==="tickets"&&<SupportDesk/>}
      {tab==="settings"&&<AccountSettings user={user} onSaved={load}/>}
     </section>
    )}
   </main>
  </div>
 );
}

function OrderList({orders,onRefresh}:{orders:Order[];onRefresh:()=>void}){
 return (
  <>
   <div className="shop-section-title">
    <h2>Sifarişlərim</h2>
    <button className="shop-cart-button" onClick={onRefresh}>Yenilə</button>
   </div>
   {!orders.length&&(
    <div className="account-empty">
     <h2>İlk sifarişiniz sizi gözləyir</h2>
     <p>Kataloqdan seçin, səbətdə tamamlayın.</p>
     <a className="shop-primary" href="/">Kataloqa keç</a>
    </div>
   )}
   {orders.map(order=><OrderCard key={order.order_no} order={order}/>)}
  </>
 );
}

function OrderCard({order}:{order:Order}){
 const steps=order.fulfillment==="delivery"?["received","preparing","ready","dispatched","delivered"]:["received","preparing","ready"];
 const stage=order.status==="completed"?steps.length-1:steps.indexOf(order.delivery_stage);
 const readyLabel=order.fulfillment==="pickup"?"Götürməyə hazır":"Hazırdır";
 const pickupReady=order.fulfillment==="pickup"&&(order.delivery_stage==="ready"||order.status==="ready");
 return (
  <article className="account-order">
   <div className="shop-section-title">
    <div>
     <small>{new Date(order.created_at).toLocaleString("az-AZ",{timeZone:"Asia/Baku"})}</small>
     <h2>{order.fulfillment==="pickup"?"Mağazadan götürmə":"Çatdırılma"}</h2>
    </div>
    <strong>{Number(order.total).toFixed(2)} ₼</strong>
   </div>
   {order.coupon_code&&<p>Kupon: {order.coupon_code} · −{Number(order.coupon_discount).toFixed(2)} ₼</p>}
   {order.status==="cancelled"?(
    <p className="shop-error">Sifariş ləğv edilib</p>
   ):(
    <>
     <ol className="order-timeline">
      {steps.map((step,index)=>(
       <li key={step} className={index<=stage?"done":""}>
        <span>{index<=stage?"✓":index+1}</span>
        {step==="ready"?readyLabel:stageLabels[step]}
       </li>
      ))}
     </ol>
     {order.status==="completed"&&<p>Təhvil tamamlanıb.</p>}
     {order.status!=="completed"&&pickupReady&&<p className="pickup-ready">Sifarişiniz hazırdır! Mağazaya gəlib aşağıdakı sifariş nömrəsini əməkdaşımıza göstərin.</p>}
    </>
   )}
   <div className="order-code">
    <small>SİFARİŞ NÖMRƏSİ</small>
    <strong>{order.order_no}</strong>
   </div>
   {order.items?.map((item,index)=>(
    <p className="order-item" key={index}>{item.name}<b>× {item.quantity}</b></p>
   ))}
   {order.delivery_address&&<p>Ünvan: {order.delivery_address}</p>}
  </article>
 );
}
