'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {MessageSquare,Search,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {languageLocale,useLanguage} from '@/lib/language';
import {desktopWebLabel,type DesktopWebLabel} from '@/lib/desktop-web-labels';
import './desktop.css';

type Attention={total:number;unread:number;unanswered:number};
type Ticket={id:string;ticketNo:string;subject:string;kind:string;status:string;name:string;email:string;phone:string;unread:boolean;unanswered:boolean;updatedAt:string;lastBody:string;messageVersion?:string};
type Message={id:string;sender:string;body:string;createdAt:string;editedAt:string|null};
type SupportResponse={tickets:Ticket[];attention:Attention;configured:boolean;lastSync:string|null;lastError:string|null};
function validAttention(value:unknown):value is Attention{if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;return ['total','unread','unanswered'].every(key=>Number.isSafeInteger(row[key])&&Number(row[key])>=0)&&Number(row.unread)<=Number(row.total)&&Number(row.unanswered)<=Number(row.total);}
export function useDesktopSupportAttention(enabled:boolean){
 const [attention,setAttention]=useState<Attention|null>(null),[error,setError]=useState(false);
 useEffect(()=>{if(!enabled)return;let mounted=true,running=false;const controller=new AbortController();async function refresh(){if(running)return;running=true;try{const response=await fetch('/api/desktop-web-support?summary=1',{cache:'no-store',signal:controller.signal}),data=await response.json() as {attention:unknown};if(!response.ok||!validAttention(data.attention))throw Error();if(mounted){setAttention(data.attention);setError(false);}}catch{if(mounted&&!controller.signal.aborted)setError(true);}finally{running=false;}}void refresh();const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh();},30000);return()=>{mounted=false;controller.abort();clearInterval(timer);};},[enabled]);
 return {attention:enabled?attention:null,error:enabled&&error};
}
export function DesktopSupportCounts({attention}:{attention:Attention|null}){
 const language=useLanguage();if(!attention)return null;
 return <span className="desktop-support-counts"><span className="unread" title={desktopWebLabel(language,'unread')} aria-label={desktopWebLabel(language,'unread')+': '+attention.unread}>{attention.unread}</span><span className="unanswered" title={desktopWebLabel(language,'unanswered')} aria-label={desktopWebLabel(language,'unanswered')+': '+attention.unanswered}>{attention.unanswered}</span></span>;
}
export function DesktopSupportPanel(){
 const language=useLanguage(),copy=(key:DesktopWebLabel)=>desktopWebLabel(language,key);
 const [data,setData]=useState<SupportResponse|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true),[selected,setSelected]=useState(''),[ticket,setTicket]=useState<Ticket|null>(null),[messages,setMessages]=useState<Message[]>([]),[opening,setOpening]=useState(false),[detailError,setDetailError]=useState(false),[search,setSearch]=useState('');
 const mounted=useRef(false),listRequest=useRef<AbortController|null>(null),detailRequest=useRef<AbortController|null>(null);
 const [complete,setComplete]=useState(true),[truncated,setTruncated]=useState(false);
 const load=useCallback(async()=>{listRequest.current?.abort();const controller=new AbortController();listRequest.current=controller;try{const response=await fetch('/api/desktop-web-support',{cache:'no-store',signal:controller.signal}),result=await response.json() as SupportResponse;if(!response.ok||!Array.isArray(result.tickets)||!validAttention(result.attention))throw Error();if(mounted.current&&!controller.signal.aborted){setData(result);setError(false);}}catch{if(mounted.current&&!controller.signal.aborted)setError(true);}finally{if(mounted.current&&!controller.signal.aborted)setLoading(false);}},[]);
 useEffect(()=>{mounted.current=true;const frame=requestAnimationFrame(()=>void load());const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void load();},15000);return()=>{mounted.current=false;cancelAnimationFrame(frame);clearInterval(timer);listRequest.current?.abort();detailRequest.current?.abort();};},[load]);
 const openTicket=useCallback(async(id:string)=>{detailRequest.current?.abort();const controller=new AbortController();detailRequest.current=controller;setOpening(true);setDetailError(false);try{const response=await fetch('/api/desktop-web-support?ticket='+encodeURIComponent(id),{cache:'no-store',signal:controller.signal}),result=await response.json() as {ticket:Ticket;messages:Message[];complete?:boolean;truncated?:boolean};if(!response.ok||result.ticket?.id!==id||!Array.isArray(result.messages))throw Error();if(mounted.current&&!controller.signal.aborted){setTicket(result.ticket);setMessages(result.messages);setComplete(result.complete!==false);setTruncated(result.truncated===true);}}catch{if(mounted.current&&!controller.signal.aborted)setDetailError(true);}finally{if(mounted.current&&!controller.signal.aborted)setOpening(false);}},[]);
 // A refreshed thread is still read-only. No acknowledgement or reply is sent.
 const selectedRow=data?.tickets.find(row=>row.id===selected),selectedRevision=selectedRow?selectedRow.updatedAt+':'+(selectedRow.messageVersion||''):'';
 useEffect(()=>{if(!selected)return;const frame=requestAnimationFrame(()=>void openTicket(selected));return()=>{cancelAnimationFrame(frame);detailRequest.current?.abort();};},[selected,selectedRevision,data?.lastSync,openTicket]);
 const query=search.trim().toLocaleLowerCase(languageLocale()),tickets=(data?.tickets||[]).filter(row=>!query||[row.ticketNo,row.subject,row.name,row.email,row.phone,row.lastBody].join(' ').toLocaleLowerCase(languageLocale()).includes(query));
 const date=(value:string)=>new Date(value).toLocaleString(languageLocale(),{timeZone:'Asia/Baku'});
 return <section className="desktop-inbox desktop-support" aria-busy={loading}>
  <div className="desktop-heading"><div><span className="desktop-eyebrow">WEB → POS</span><h2>{copy('webSupport')}</h2><p>{copy('supportHelp')}</p></div><Button type="button" variant="outline" disabled={loading} onClick={()=>{void load();if(selected)void openTicket(selected);}}>{copy('refresh')}</Button></div>
  <p className="desktop-support-reply-note"><MessageSquare size={18} aria-hidden="true"/>{copy('supportReply')}</p>
  {data&&<div className="desktop-support-status"><DesktopSupportCounts attention={data.attention}/><span>{copy('lastSync')}: {data.lastSync?date(data.lastSync):copy('notSynced')}</span></div>}
  {data&&!data.configured&&<p className="desktop-review-note" role="status">{copy('disconnected')}</p>}
  {data?.lastError&&<p className="desktop-review-note" role="alert">{data.lastError}</p>}
  {error&&<div className="desktop-review-note" role="alert"><p>{copy('supportLoadError')}</p>{data&&<small>{copy('previousData')}</small>}<Button type="button" variant="outline" onClick={()=>void load()}>{copy('retry')}</Button></div>}
  <p className="desktop-scope-note">{copy((data?.tickets.length||0)>=500?'limitedTickets':'loadMoreScope')}</p>
  <div className="desktop-support-layout"><div className="desktop-support-sidebar"><div className="desktop-support-search"><Search size={17} aria-hidden="true"/><Input value={search} onChange={event=>setSearch(event.target.value)} placeholder={copy('searchTickets')} aria-label={copy('searchTickets')}/>{search&&<button type="button" onClick={()=>setSearch('')} aria-label={copy('clearSearch')}><X size={16}/></button>}</div>
   <div className="desktop-support-list">{tickets.map(row=><button type="button" key={row.id} className={selected===row.id?'selected':''} aria-pressed={selected===row.id} onClick={()=>{if(selected!==row.id){setSelected(row.id);setTicket(null);setMessages([]);}}}><span className="desktop-support-ticket-no">#{row.ticketNo}<time dateTime={row.updatedAt}>{date(row.updatedAt)}</time></span><strong>{row.subject}</strong><span>{row.name||copy('customer')}</span><p>{row.lastBody}</p><span className="desktop-ticket-flags">{row.unread&&<span>{copy('unread')}</span>}{row.unanswered&&<span>{copy('unanswered')}</span>}</span></button>)}</div>{!tickets.length&&<p className="empty-table">{copy(loading?'loading':search?'noMatch':'noTickets')}</p>}
  </div><section className="desktop-support-thread" aria-busy={opening}>
   {truncated&&ticket?.id===selected&&<p className="desktop-review-note" role="status">{copy('limitedMessages')}</p>}
   {detailError?<div className="desktop-review-note" role="alert"><p>{copy('supportLoadError')}</p><Button type="button" variant="outline" onClick={()=>void openTicket(selected)}>{copy('retry')}</Button></div>:opening?<p role="status">{copy('loading')}</p>:ticket&&ticket.id===selected?<><header><span>#{ticket.ticketNo} · {copy(ticket.status==='closed'?'closed':ticket.status==='answered'?'answered':'open')}</span><h3>{ticket.subject}</h3><strong>{ticket.name||copy('customer')}</strong>{ticket.phone&&<p>{ticket.phone}</p>}{ticket.email&&<p>{ticket.email}</p>}</header>{!complete&&<p className="desktop-review-note" role="status">{copy('incompleteMessages')}</p>}<div className="desktop-support-messages">{messages.map(message=><article key={message.id} className={message.sender==='staff'?'is-staff':''}><div><strong>{copy(message.sender==='staff'?'staff':'customer')}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}{message.editedAt?' · '+copy('edited'):''}</time></div><p>{message.body}</p></article>)}{!messages.length&&<p>{copy('noMessages')}</p>}</div></>:<p className="empty-table">{copy('selectTicket')}</p>}
  </section></div>
 </section>;
}
