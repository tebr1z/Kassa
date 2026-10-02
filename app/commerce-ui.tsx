"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {MessageCircle,Send} from "lucide-react";

function WhatsAppIcon(){return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="22" height="22"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8a8.5 8.5 0 1 1 16.2-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M8.2 7.3c-.8.4-1 1.4-.7 2.3 1 3 3.3 5.2 6.2 6.1.9.3 2 .1 2.4-.8l.5-1-2.7-1.3-.8 1c-1.6-.6-2.8-1.8-3.5-3.4l1-.8-1.3-2.6-.9.5Z" fill="currentColor"/></svg>;}
const whatsappUrl=(number?:string)=>number&&/^[1-9][0-9]{7,14}$/.test(number)?"https://wa.me/"+number+"?text="+encodeURIComponent("Salam, dəstək lazımdır."):null;
export function WhatsAppButton({whatsapp}:{whatsapp?:string}){
 const url=whatsappUrl(whatsapp);if(!url)return null;
 return <div className="sf-whatsapp-wrap"><a className="sf-whatsapp live" href={url} target="_blank" rel="noopener noreferrer"><WhatsAppIcon/><span>WhatsApp</span></a></div>;
}
export function ContactBox({whatsapp}:{whatsapp?:string}){
 const [status,setStatus]=useState(""),[busy,setBusy]=useState(false);const url=whatsappUrl(whatsapp);
 async function send(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const data=new FormData(form);setBusy(true);setStatus("");try{const r=await fetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:data.get("name"),phone:data.get("phone"),message:data.get("message")})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setStatus("Mesajınız qəbul olundu. Tezliklə sizinlə əlaqə saxlayacağıq.");form.reset();}catch(e){setStatus(e instanceof Error?e.message:"Mesaj göndərilmədi.");}finally{setBusy(false);}}
 return <div className="sf-contact-box"><div className="sf-contact-box-title"><MessageCircle size={22}/><h3>Bizə yazın</h3>{url&&<a href={url} target="_blank" rel="noopener noreferrer"><WhatsAppIcon/> WhatsApp</a>}</div><form onSubmit={send}><div className="sf-contact-fields"><label className="sf-form-label">Ad<input name="name" required minLength={2} maxLength={80} autoComplete="name" placeholder="Adınız" disabled={busy}/></label><label className="sf-form-label">Nömrə<input name="phone" required minLength={7} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="050 000 00 00" disabled={busy}/></label></div><label className="sf-form-label">Mesaj<textarea name="message" required minLength={5} maxLength={2000} placeholder="Məhsul, sifariş və ya təklifiniz barədə…" disabled={busy}/></label><button className="sf-primary" disabled={busy}>{busy?"Göndərilir…":"Göndər"}<Send size={16}/></button><p role="status" className="sf-contact-status">{status}</p></form></div>;
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
