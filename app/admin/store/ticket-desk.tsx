"use client";
import {FormEvent,useEffect,useRef,useState} from "react";
type Ticket={id:string;ticket_no:string;account_id:string|null;subject:string;kind:string;status:"open"|"answered"|"closed";updated_at:string;name:string;email:string;phone:string;last_body:string};
type Line={id:string;sender:"customer"|"staff";body:string;edited_at:string|null;created_at:string};
const kindLabel:Record<string,string>={problem:"Problem",suggestion:"Təklif",order:"Sifariş"};
const statusLabel={open:"Açıq",answered:"Cavablanıb",closed:"Bağlı"};
export function TicketDesk(){
 const [tickets,setTickets]=useState<Ticket[]>([]),[openId,setOpenId]=useState(""),[lines,setLines]=useState<Line[]>([]),[detail,setDetail]=useState<Ticket|null>(null),[busy,setBusy]=useState(false),[note,setNote]=useState(""),[editId,setEditId]=useState("");
 const requestId=useRef(0);
 async function loadList(){const r=await fetch("/api/store-admin/chat");const d=await r.json() as {tickets?:Ticket[];error?:string};if(!r.ok)throw new Error(d.error);setTickets(d.tickets||[]);}
 async function openTicket(id:string){
  const token=++requestId.current;
  setOpenId(id);setEditId("");setLines([]);setDetail(tickets.find(t=>t.id===id)||null);
  const r=await fetch("/api/store-admin/chat?ticket="+id);
  const d=await r.json() as {ticket?:Ticket;messages?:Line[];error?:string};
  if(token!==requestId.current)return;
  if(!r.ok)throw new Error(d.error);
  setDetail(d.ticket||null);setLines(d.messages||[]);
 }
 useEffect(()=>{void loadList().catch(e=>setNote(e instanceof Error?e.message:"Yüklənmədi"));},[]);
 async function send(ticketId:string,body:unknown,form?:HTMLFormElement){
  setBusy(true);setNote("");
  try{const r=await fetch("/api/store-admin/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);form?.reset();setEditId("");await openTicket(ticketId);await loadList();}
  catch(e){setNote(e instanceof Error?e.message:"Saxlanmadı.");}finally{setBusy(false);}
 }
 const groups=new Map<string,Ticket[]>();
 for(const ticket of tickets){const key=ticket.account_id||"phone:"+(ticket.phone||ticket.id);groups.set(key,[...(groups.get(key)||[]),ticket]);}
 const showing=detail&&detail.id===openId?detail:null;
 return <div className="ticket-admin"><div className="cm-toolbar"><div><h2>Dəstək biletləri</h2><p>Hər müştəri ayrı qrupdadır. Cavab yalnız seçilmiş biletə yazılır.</p></div><button type="button" onClick={()=>void loadList()}>Yenilə</button></div>
 <div className="ticket-admin-grid"><div className="ticket-customers">{[...groups].map(([accountId,rows])=>{const person=rows[0];return <section key={accountId} className="ticket-customer"><header><strong>{person.name}</strong>{person.email&&<small>{person.email}</small>}<small>{person.phone}</small></header>{rows.map(t=><button key={t.id} type="button" className={openId===t.id?"active":""} onClick={()=>void openTicket(t.id).catch(e=>setNote(e instanceof Error?e.message:"Açılmadı"))}><b>#{t.ticket_no}</b><span>{t.subject}</span><small>{kindLabel[t.kind]||t.kind} · {statusLabel[t.status]}</small></button>)}</section>;})}{!tickets.length&&<p>Hələ bilet yoxdur.</p>}</div>
 {showing&&<section className="cm-thread" key={showing.id}><header className="ticket-person"><strong>{showing.name}</strong><p>{showing.email?<>{showing.email}<br/></>:null}{showing.phone}</p><p>Bilet #{showing.ticket_no} · {showing.subject}</p>{!showing.account_id&&<p>Sayt formasından gəlib. Cavabı {showing.phone} nömrəsinə verin.</p>}<div className="ticket-admin-actions">{(["open","answered","closed"] as const).map(s=><button key={s} type="button" className={showing.status===s?"active":""} disabled={busy} onClick={()=>void send(showing.id,{action:"status",ticketId:showing.id,status:s})}>{statusLabel[s]}</button>)}</div></header>
 {lines.map(m=><article key={m.id} className={m.sender==="staff"?"staff":""}><small>{m.sender==="staff"?"Mağaza":showing.name} · {new Date(m.created_at).toLocaleString("az-AZ")}{m.edited_at?" · düzəldilib":""}</small>{editId===m.id?<form onSubmit={e=>{e.preventDefault();void send(showing.id,{action:"edit",messageId:m.id,message:String(new FormData(e.currentTarget).get("message")||"")});}}><textarea name="message" required defaultValue={m.body}/><button disabled={busy}>Saxla</button></form>:<p>{m.body}</p>}{m.sender==="staff"&&lines.at(-1)?.id===m.id&&editId!==m.id&&<button type="button" onClick={()=>setEditId(m.id)}>Cavabı düzəlt</button>}</article>)}
 {showing.status!=="closed"&&<form key={"reply-"+showing.id} onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();void send(showing.id,{action:"reply",ticketId:showing.id,message:String(new FormData(e.currentTarget).get("message")||"")},e.currentTarget);}}><textarea name="message" required minLength={1} maxLength={2000} placeholder={showing.name+" üçün cavab"}/><button disabled={busy}>Cavabı {showing.name} adlı müştəriyə göndər</button></form>}</section>}
 </div>{note&&<p role="status" className="cm-status">{note}</p>}</div>;
}
