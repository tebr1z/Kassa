"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {ArrowRight,MessageCircle,Send,X} from "lucide-react";

function WhatsAppIcon(){return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="22" height="22"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8a8.5 8.5 0 1 1 16.2-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M8.2 7.3c-.8.4-1 1.4-.7 2.3 1 3 3.3 5.2 6.2 6.1.9.3 2 .1 2.4-.8l.5-1-2.7-1.3-.8 1c-1.6-.6-2.8-1.8-3.5-3.4l1-.8-1.3-2.6-.9.5Z" fill="currentColor"/></svg>;}
const whatsappUrl=(number?:string)=>number&&/^[1-9][0-9]{7,14}$/.test(number)?"https://wa.me/"+number:null;
export function WhatsAppButton({whatsapp}:{whatsapp?:string}){
 const [open,setOpen]=useState(false);const url=whatsappUrl(whatsapp);const panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;function dismiss(e:KeyboardEvent){if(e.key==="Escape")setOpen(false);}function outside(e:PointerEvent){if(panel.current&&!panel.current.contains(e.target as Node))setOpen(false);}window.addEventListener("keydown",dismiss);window.addEventListener("pointerdown",outside);return()=>{window.removeEventListener("keydown",dismiss);window.removeEventListener("pointerdown",outside);};},[open]);
 return <div className="sf-whatsapp-wrap" ref={panel}>
 {open&&<section className="sf-support-card" aria-label="Əlaqə seçimləri"><button className="sf-icon-button" onClick={()=>setOpen(false)} aria-label="Əlaqə pəncərəsini bağla"><X size={18}/></button><MessageCircle size={27}/><h3>Sizə necə kömək edək?</h3><p>WhatsApp nömrəsi hələ təyin edilməyib. Sualınızı saytın əlaqə formasından göndərə bilərsiniz.</p><a href="#contact" onClick={()=>setOpen(false)}>Əlaqə formasına keç <ArrowRight size={16}/></a></section>}
 {url?<a className="sf-whatsapp" href={url} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp ilə əlaqə"><WhatsAppIcon/><span>WhatsApp</span></a>:<button className="sf-whatsapp" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-label="WhatsApp və əlaqə seçimləri"><WhatsAppIcon/><span>WhatsApp</span></button>}
 </div>;
}
export function ContactBox({whatsapp,signedIn=false}:{whatsapp?:string;signedIn?:boolean}){
 const [status,setStatus]=useState(""),[busy,setBusy]=useState(false);const url=whatsappUrl(whatsapp);
 async function send(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;setBusy(true);setStatus("");try{const r=await fetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:new FormData(form).get("message")})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setStatus("Mesajınız göndərildi. Komandamız hesabınızdakı əlaqə məlumatları ilə sizə cavab verəcək.");form.reset();}catch(e){setStatus(e instanceof Error?e.message:"Mesaj göndərilmədi.");}finally{setBusy(false);}}
 return <div className="sf-contact-box"><div className="sf-contact-box-title"><MessageCircle size={22}/><h3>Bizə yazın</h3>{url&&<a href={url} target="_blank" rel="noopener noreferrer"><WhatsAppIcon/> WhatsApp</a>}</div><form onSubmit={send}><label className="sf-form-label">Mesajınız<textarea name="message" required minLength={10} maxLength={2000} placeholder="Məhsul, sifariş və ya təklifiniz barədə…" disabled={busy||!signedIn}/></label>{signedIn?<button className="sf-primary" disabled={busy}>{busy?"Göndərilir…":"Mesajı göndər"}<Send size={16}/></button>:<div className="sf-contact-signin"><p>Mesaj göndərmək üçün hesabınıza daxil olun.</p><Link href="/account">Daxil ol / Hesab yarat <ArrowRight size={16}/></Link></div>}<p role="status" className="sf-contact-status">{status}</p></form></div>;
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
