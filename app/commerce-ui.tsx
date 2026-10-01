"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {ArrowRight,MessageCircle,Send,X} from "lucide-react";

function WhatsAppIcon(){return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="22" height="22"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8a8.5 8.5 0 1 1 16.2-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M8.2 7.3c-.8.4-1 1.4-.7 2.3 1 3 3.3 5.2 6.2 6.1.9.3 2 .1 2.4-.8l.5-1-2.7-1.3-.8 1c-1.6-.6-2.8-1.8-3.5-3.4l1-.8-1.3-2.6-.9.5Z" fill="currentColor"/></svg>;}
const whatsappUrl=(number?:string)=>number&&/^[1-9][0-9]{7,14}$/.test(number)?"https://wa.me/"+number+"?text="+encodeURIComponent("Salam, canlı dəstək lazımdır."):null;
function liveSupportOpen(now=new Date()){const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Baku",hour:"2-digit",hourCycle:"h23"}).format(now));return hour>=8&&hour<19;}
export function WhatsAppButton({whatsapp}:{whatsapp?:string}){
 const [open,setOpen]=useState(false),[live,setLive]=useState(false);const url=whatsappUrl(whatsapp);const panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{setLive(liveSupportOpen());const t=setInterval(()=>setLive(liveSupportOpen()),60000);return()=>clearInterval(t);},[]);
 useEffect(()=>{if(!open)return;function dismiss(e:KeyboardEvent){if(e.key==="Escape")setOpen(false);}function outside(e:PointerEvent){if(panel.current&&!panel.current.contains(e.target as Node))setOpen(false);}window.addEventListener("keydown",dismiss);window.addEventListener("pointerdown",outside);return()=>{window.removeEventListener("keydown",dismiss);window.removeEventListener("pointerdown",outside);};},[open]);
 return <div className="sf-whatsapp-wrap" ref={panel}>
 {open&&<section className="sf-support-card" aria-label="Canlı dəstək"><button className="sf-icon-button" onClick={()=>setOpen(false)} aria-label="Dəstək pəncərəsini bağla"><X size={18}/></button><MessageCircle size={27}/><h3>{live?"Canlı dəstək açıqdır":"Canlı dəstək bağlıdır"}</h3><p>{live?"WhatsApp üzərindən 08:00–19:00 arası yazın. Operator sizə orada cavab verir.":"Canlı dəstək hər gün 08:00–19:00 arasıdır. İndi hesabınızdan bilet aça bilərsiniz."}</p>{live&&url?<a className="sf-primary" href={url} target="_blank" rel="noopener noreferrer">WhatsApp-a keç <ArrowRight size={16}/></a>:<Link href="/account" onClick={()=>setOpen(false)}>Bilet aç <ArrowRight size={16}/></Link>}</section>}
 <button className={live?"sf-whatsapp live":"sf-whatsapp"} onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-label="WhatsApp canlı dəstək"><WhatsAppIcon/><span>{live?"Canlı":"08:00–19:00"}</span></button>
 </div>;
}
export function ContactBox({whatsapp,signedIn=false}:{whatsapp?:string;signedIn?:boolean}){
 const [status,setStatus]=useState(""),[busy,setBusy]=useState(false);const url=whatsappUrl(whatsapp);
 async function send(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;setBusy(true);setStatus("");try{const r=await fetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:new FormData(form).get("message")})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setStatus("Biletiniz açıldı. Nömrəsini və cavabı hesabınızdakı Biletlərim bölməsində görəcəksiniz.");form.reset();}catch(e){setStatus(e instanceof Error?e.message:"Mesaj göndərilmədi.");}finally{setBusy(false);}}
 const live=liveSupportOpen();
 return <div className="sf-contact-box"><div className="sf-contact-box-title"><MessageCircle size={22}/><h3>Bilet açın</h3>{live&&url?<a href={url} target="_blank" rel="noopener noreferrer"><WhatsAppIcon/> Canlı dəstək</a>:<span>Canlı dəstək 08:00–19:00</span>}</div><form onSubmit={send}><label className="sf-form-label">Mesajınız<textarea name="message" required minLength={10} maxLength={2000} placeholder="Məhsul, sifariş və ya təklifiniz barədə…" disabled={busy||!signedIn}/></label>{signedIn?<button className="sf-primary" disabled={busy}>{busy?"Göndərilir…":"Bileti aç"}<Send size={16}/></button>:<div className="sf-contact-signin"><p>Mesaj göndərmək üçün hesabınıza daxil olun.</p><Link href="/account">Daxil ol / Hesab yarat <ArrowRight size={16}/></Link></div>}<p role="status" className="sf-contact-status">{status}</p></form></div>;
}
export function CouponBox({items,onApply,onBusyChange,disabled=false}:{items:{id:string;quantity:number;price:number}[];onApply:(code:string,discount:number)=>void;onBusyChange?:(busy:boolean)=>void;disabled?:boolean}){
 const [code,setCode]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const revision=useRef(0),applyRef=useRef(onApply),busyRef=useRef(onBusyChange);applyRef.current=onApply;busyRef.current=onBusyChange;
 useEffect(()=>()=>{busyRef.current?.(false);},[]);
 const key=JSON.stringify(items);
 useEffect(()=>{revision.current++;setMessage("");applyRef.current("",0);return()=>{revision.current++;};},[key]);
 async function apply(){if(busy||disabled)return;const version=++revision.current;setBusy(true);busyRef.current?.(true);try{const r=await fetch("/api/coupon",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,items})});const d=await r.json() as {error?:string;code:string;discount:number};if(!r.ok)throw new Error(d.error);if(version!==revision.current)return;applyRef.current(d.code,d.discount);setMessage("Kupon tətbiq edildi: −"+d.discount.toFixed(2)+" AZN");}catch(e){if(version!==revision.current)return;applyRef.current("",0);setMessage(e instanceof Error?e.message:"Kupon yoxlanmadı.");}finally{setBusy(false);busyRef.current?.(false);}}
 return <div className="sf-coupon-box"><label>Kupon kodu<input value={code} maxLength={30} disabled={disabled||busy} onChange={e=>{revision.current++;setCode(e.target.value.toUpperCase());applyRef.current("",0);setMessage("");}} placeholder="Kodu daxil edin" onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(code&&!busy&&!disabled)void apply();}}}/></label><button type="button" disabled={disabled||busy||!code||!items.length} onClick={apply}>{busy?"Yoxlanır…":"Tətbiq et"}</button><p role="status">{message}</p></div>;
}
