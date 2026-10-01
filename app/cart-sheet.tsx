"use client";
import Link from "next/link";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {ArrowLeft,ArrowRight,Check,Minus,Package,Plus,ShoppingBag,Store,Trash2,Truck,X} from "lucide-react";
import type {CatalogProduct} from "@/lib/commerce";
import type {CustomerCart} from "@/lib/storefront-cart";
import type {Customer} from "./storefront";
import {readCheckoutAttempt,saveCheckoutAttempt,clearCheckoutAttempt,isDefinitiveCheckoutRejection,type CheckoutAttempt} from "@/lib/checkout-attempt";
import {CouponBox} from "./commerce-ui";

const money=(v:number)=>v.toLocaleString("az-AZ",{minimumFractionDigits:2,maximumFractionDigits:2})+" AZN";
export default function CartSheet({products,cart,account,onChange,onCommitted,onClose}:{products:CatalogProduct[];cart:CustomerCart;account:Customer;onChange:(id:string,n:number)=>void;onCommitted:(items:{id:string;quantity:number}[])=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),couponInFlight=useRef(false),sending=useRef(false);
 const [pending,setPending]=useState<CheckoutAttempt|null>(null),[storageBlocked,setStorageBlocked]=useState(false),[couponBusy,setCouponBusy]=useState(false);
 const [step,setStep]=useState<"cart"|"checkout">("cart"),[fulfillment,setFulfillment]=useState("pickup"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[receipt,setReceipt]=useState("");
 const [coupon,setCoupon]=useState(""),[discount,setDiscount]=useState(0);
 const lines=products.filter(p=>cart[p.id]>0),subtotal=lines.reduce((s,p)=>s+p.price*cart[p.id],0),total=Math.max(0,subtotal-discount);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();const before=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=before;previous?.focus();};},[]);
 useEffect(()=>{if(!account?.id){setPending(null);return;}const saved=readCheckoutAttempt(account.id);setStorageBlocked(saved.status==="blocked");setPending(saved.status==="pending"?saved.attempt:null);},[account?.id]);
 function couponChecking(value:boolean){couponInFlight.current=value;setCouponBusy(value);}
 async function send(attempt:CheckoutAttempt){
  if(sending.current)return;sending.current=true;setBusy(true);setError("");
  try{
   const check=await fetch("/api/customer-account",{cache:"no-store"});const session=await check.json() as {user:Customer};
   if(!check.ok||session.user?.id!==attempt.accountId)throw new Error("Sifarişi davam etdirmək üçün əvvəlki hesabınıza daxil olun.");
   const response=await fetch("/api/customer-orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(attempt.payload)});
   const data=await response.json() as {error?:string;order_no?:string};
   if(!response.ok){
    if(isDefinitiveCheckoutRejection(response.status)&&clearCheckoutAttempt(attempt.accountId,attempt.payload.requestKey))setPending(null);
    throw new Error(data.error||"Sifarişin nəticəsi bilinmir. Eyni sifarişi yenidən yoxlayın.");
   }
   if(!data.order_no)throw new Error("Sifarişin nəticəsi bilinmir. Eyni sifarişi yenidən yoxlayın.");
   if(!clearCheckoutAttempt(attempt.accountId,attempt.payload.requestKey))throw new Error("Sifariş qəbul edildi, lakin brauzer yaddaşı yenilənmədi. Hesabınızdan yoxlayın.");
   setPending(null);setReceipt(data.order_no);onCommitted(attempt.payload.items);
  }catch(e){setError(e instanceof Error?e.message:"Bağlantı kəsildi. Eyni sifarişi yenidən yoxlayın.");}finally{setBusy(false);sending.current=false;}
 }
 async function order(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||couponInFlight.current||!account?.id||!lines.length||pending||storageBlocked)return;
  const saved=readCheckoutAttempt(account.id);
  if(saved.status==="pending"){setPending(saved.attempt);return;}
  if(saved.status==="blocked"){setStorageBlocked(true);return;}
  const f=new FormData(e.currentTarget);
  const attempt:CheckoutAttempt={version:1,accountId:account.id,createdAt:new Date().toISOString(),itemNames:Object.fromEntries(lines.map(p=>[p.id,p.name])),payload:{requestKey:crypto.randomUUID(),coupon,expectedTotal:Number(total.toFixed(2)),fulfillment:fulfillment==="delivery"?"delivery":"pickup",address:String(f.get("address")||""),name:account.name,phone:account.phone,note:String(f.get("note")||""),items:lines.map(p=>({id:p.id,quantity:cart[p.id]}))}};
  if(!saveCheckoutAttempt(attempt)){setError("Brauzer yaddaşı əlçatan deyil. Sifariş göndərilmədi. Yaddaşa icazə verib yenidən cəhd edin.");return;}
  setPending(attempt);await send(attempt);
 }
 return <dialog ref={dialog} className="sf-cart-dialog" aria-labelledby="cart-heading" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
  <div className="sf-cart-panel"><header className="sf-cart-head"><div><span className="sf-eyebrow">{receipt?"SİFARİŞ QƏBUL EDİLDİ":step==="checkout"?"SON ADDIM":"SEÇDİYİNİZ MƏHSULLAR"}</span><h2 id="cart-heading">{receipt?"Təşəkkür edirik!":step==="checkout"?"Sifarişi tamamlayın":"Səbətim"} {!receipt&&step==="cart"&&<small>{lines.length}</small>}</h2></div><button className="sf-icon-button" aria-label="Səbəti bağla" disabled={busy} onClick={onClose}><X size={22}/></button></header>
  <div className="sf-cart-scroll">
  {receipt?<section className="sf-cart-empty sf-cart-success"><span className="sf-empty-icon"><Check size={36}/></span><h3>Sifarişiniz bizə çatdı.</h3><p>Hazırlanma və təhvil mərhələlərini hesabınızdan izləyə bilərsiniz.</p><code>{receipt}</code><Link className="sf-primary" href="/account">Sifarişimi izlə <ArrowRight size={17}/></Link><button className="sf-text-button" onClick={onClose}>Alış-verişə davam et</button></section>:(pending||storageBlocked)?<section className="sf-cart-recovery"><Package size={36}/><h3>{busy?"Sifariş yoxlanır…":"Əvvəlki sifarişi yoxlayaq"}</h3><p>Yeni sifariş yaratmadan əvvəl göndərilmiş sifarişin nəticəsini təsdiqləyin. Təkrar yoxlama eyni sifariş nömrəsi ilə aparılır.</p>{pending&&<><ul>{pending.payload.items.map(i=><li key={i.id}>{pending.itemNames[i.id]||"Məhsul"} × {i.quantity}</li>)}</ul><strong>{money(pending.payload.expectedTotal)}</strong><p>{pending.payload.fulfillment==="pickup"?"Mağazadan götürmə":pending.payload.address}</p><button className="sf-primary" disabled={busy} onClick={()=>void send(pending)}>{busy?"Yoxlanır…":"Sifarişi yenidən yoxla"}</button></>}{storageBlocked&&<p>Yaddaş məlumatı oxunmadı. Təkrar sifariş verməzdən əvvəl hesabınızı yoxlayın və mağaza ilə əlaqə saxlayın.</p>}{error&&<p className="sf-form-error" role="alert">{error}</p>}<Link href="/account">Sifarişlərimə bax →</Link></section>:!lines.length?<section className="sf-cart-empty"><span className="sf-empty-icon"><ShoppingBag size={38}/></span><h3>Səbətiniz hələ boşdur.</h3><p>Bəyəndiyiniz məhsulları seçin.<br/>Onları burada sizin üçün saxlayacağıq.</p><Link href="/#catalog" className="sf-primary" onClick={onClose}>Məhsullara bax <ArrowRight size={17}/></Link><div className="sf-empty-benefit"><Store size={17}/> Mağazadan götürmə <span>·</span><Truck size={17}/> Çatdırılma</div></section>:<>
   {step==="cart"?<><div className="sf-cart-lines">{lines.map(p=><article className="sf-cart-line" key={p.id}><Link href={"/products/"+p.id} className="sf-cart-thumb" onClick={onClose}>{p.image?<img src={p.image} alt={p.name}/>:<Package size={30}/>}</Link><div className="sf-cart-line-info"><Link href={"/products/"+p.id} onClick={onClose}>{p.name}</Link><small>{money(p.price)} / {p.unit}</small><div className="sf-quantity"><button aria-label={p.name+" sayını azalt"} onClick={()=>onChange(p.id,-1)}><Minus size={14}/></button><span>{cart[p.id]}</span><button aria-label={p.name+" sayını artır"} disabled={cart[p.id]>=100} onClick={()=>onChange(p.id,1)}><Plus size={14}/></button></div></div><div className="sf-cart-line-end"><strong>{money(p.price*cart[p.id])}</strong><button className="sf-icon-button" aria-label={p.name+" səbətdən çıxar"} onClick={()=>onChange(p.id,-cart[p.id])}><Trash2 size={16}/></button></div></article>)}</div><div className="sf-cart-reassurance"><Check size={16}/><p>Ödəniş indi tutulmur. Sifarişinizi mağaza təsdiqlədikdən sonra hazırlayır.</p></div></>:<form id="sf-checkout" onSubmit={order}><button className="sf-text-button" type="button" disabled={busy} onClick={()=>setStep("cart")}><ArrowLeft size={15}/> Səbətə qayıt</button><div className="sf-checkout-person"><UserBadge/><div><strong>{account?.name}</strong><span>{account?.phone}</span></div><span className="sf-person-label">Hesab məlumatlarınız</span></div><fieldset disabled={busy} className="sf-fulfillment"><legend>Sifarişinizi necə almaq istəyirsiniz?</legend><label className={fulfillment==="pickup"?"selected":""}><input type="radio" name="fulfillment" value="pickup" checked={fulfillment==="pickup"} onChange={()=>setFulfillment("pickup")}/><Store size={23}/><strong>Mağazadan götürmə</strong><span>Hazır olduqda gəlib götürün</span></label><label className={fulfillment==="delivery"?"selected":""}><input type="radio" name="fulfillment" value="delivery" checked={fulfillment==="delivery"} onChange={()=>setFulfillment("delivery")}/><Truck size={23}/><strong>Ünvana çatdırılma</strong><span>Ünvanınızı bizə göndərin</span></label></fieldset>{fulfillment==="delivery"&&<label className="sf-form-label">Çatdırılma ünvanı<textarea name="address" required minLength={10} maxLength={500} placeholder="Şəhər, küçə, bina və mənzil" disabled={busy}/></label>}<label className="sf-form-label">Əlavə qeyd <small>istəyə bağlı</small><textarea name="note" maxLength={1000} placeholder="Sifarişinizlə bağlı istəyiniz…" disabled={busy}/></label><p className="sf-checkout-note">Mövcudluq və təhvil şərtləri mağaza tərəfindən təsdiqlənir. Sifarişin vəziyyəti hesabınızda görünəcək.</p>{error&&<p className="sf-form-error" role="alert">{error}</p>}</form>}
   <details className="sf-coupon-details"><summary>Endirim kuponunuz var?</summary><CouponBox disabled={busy} onBusyChange={couponChecking} items={lines.map(p=>({id:p.id,quantity:cart[p.id],price:p.price}))} onApply={(code,amount)=>{setCoupon(code);setDiscount(amount);}}/></details>
  </>}
  </div>
  {!receipt&&!pending&&!storageBlocked&&lines.length>0&&<footer className="sf-cart-footer"><div className="sf-summary-line"><span>Məhsullar ({Object.values(cart).reduce((a,b)=>a+b,0)})</span><span>{money(subtotal)}</span></div>{discount>0&&<div className="sf-summary-line sf-discount-line"><span>Kupon endirimi</span><span>−{money(discount)}</span></div>}<div className="sf-summary-total"><span>Yekun məbləğ</span><strong>{money(total)}</strong></div>{step==="checkout"?<button className="sf-primary" form="sf-checkout" type="submit" disabled={busy||couponBusy}>{busy?"Sifariş göndərilir…":couponBusy?"Kupon yoxlanır…":"Sifarişi təsdiqlə"}<ArrowRight size={18}/></button>:account?<button className="sf-primary" onClick={()=>setStep("checkout")}>Sifarişi tamamla <ArrowRight size={18}/></button>:<><Link href="/account" className="sf-primary">Daxil ol və davam et <ArrowRight size={18}/></Link><p>Səbətiniz saxlanılır. Sifariş üçün hesabınıza daxil olun.</p></>}</footer>}
  </div>
 </dialog>;
}
function UserBadge(){return <span className="sf-user-badge"><Check size={18}/></span>;}
