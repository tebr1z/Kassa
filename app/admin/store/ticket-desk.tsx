'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Check,ChevronLeft,ChevronRight,Inbox,LoaderCircle,MailOpen,MessageSquare,RefreshCw,Send} from 'lucide-react';
import {languageLocale,useTranslations} from '@/lib/language';
import {SupportCounts,validSupportAttention,type SupportAttention} from '../support-attention';
import '../support-desk.css';
type Ticket={id:string;ticket_no:string;account_id:string|null;subject:string;kind:string;status:'open'|'answered'|'closed';updated_at:string;name:string;email:string;phone:string;last_body:string;unread:boolean;unanswered:boolean;customerRevision:string};
type Line={id:string;sender:'customer'|'staff';body:string;edited_at:string|null;created_at:string};
type ListResponse={tickets?:Ticket[];attention?:SupportAttention;page?:number;pages?:number;total?:number;error?:string};
const kinds:Record<string,string>={problem:'Problem bileti',suggestion:'Təklif bileti',order:'Sifariş bileti'};
const statuses={open:'Bilet açıqdır',answered:'Bilet cavablandırılıb',closed:'Bilet bağlıdır'};
export function TicketDesk({onAttentionChange}:{onAttentionChange?:(value:SupportAttention)=>void}={}){
 const {t,language}=useTranslations();
 const [tickets,setTickets]=useState<Ticket[]>([]),[attention,setAttention]=useState<SupportAttention|null>(null),[filter,setFilter]=useState('all'),[page,setPage]=useState(1),[pages,setPages]=useState(1),[total,setTotal]=useState(0);
 const [openId,setOpenId]=useState(''),[detail,setDetail]=useState<Ticket|null>(null),[lines,setLines]=useState<Line[]>([]),[loading,setLoading]=useState(true),[opening,setOpening]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reply,setReply]=useState(''),[editId,setEditId]=useState(''),[editText,setEditText]=useState('');
 const listRun=useRef(0),detailRun=useRef(0),pending=useRef(false),mounted=useRef(true),listRequest=useRef<AbortController|null>(null),detailRequest=useRef<AbortController|null>(null);
 const loadList=useCallback(async(quiet=false)=>{
  const run=++listRun.current;listRequest.current?.abort();const controller=new AbortController();listRequest.current=controller;if(!quiet)setLoading(true);
  try{const response=await fetch('/api/store-admin/chat?filter='+encodeURIComponent(filter)+'&page='+page,{cache:'no-store',signal:controller.signal}),data=await response.json() as ListResponse;
   if(!mounted.current||run!==listRun.current)return;
   if(!response.ok||!Array.isArray(data.tickets)||!validSupportAttention(data.attention))throw new Error(data.error||'Biletlər yüklənmədi.');
   setTickets(data.tickets);setAttention(data.attention);onAttentionChange?.(data.attention);setPages(data.pages||1);setTotal(data.total||0);if(page>(data.pages||1))setPage(data.pages||1);
  }finally{if(mounted.current&&run===listRun.current)setLoading(false);}
 },[filter,page,onAttentionChange]);
 useEffect(()=>{mounted.current=true;const frame=requestAnimationFrame(()=>void loadList().catch(cause=>{if(mounted.current&&!(cause instanceof DOMException&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'Biletlər yüklənmədi.');}));const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void loadList(true).catch(()=>{if(mounted.current)setError('Biletlər yüklənmədi.');});},30000);return()=>{cancelAnimationFrame(frame);clearInterval(timer);listRequest.current?.abort();};},[loadList]);
 useEffect(()=>()=>{mounted.current=false;detailRun.current++;detailRequest.current?.abort();},[]);
 async function loadDetail(id:string,acknowledge=false){
  const run=++detailRun.current;detailRequest.current?.abort();const controller=new AbortController();detailRequest.current=controller;setOpening(true);
  try{
   const response=await fetch('/api/store-admin/chat?ticket='+encodeURIComponent(id),{cache:'no-store',signal:controller.signal}),data=await response.json() as {ticket?:Ticket;messages?:Line[];error?:string};
   if(!mounted.current||run!==detailRun.current)return;
   if(!response.ok||data.ticket?.id!==id||!Array.isArray(data.messages))throw new Error(data.error||'Bilet açılmadı.');
   setDetail(data.ticket);setLines(data.messages);
   if(acknowledge){
    const read=await fetch('/api/store-admin/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',ticketId:id,customerRevision:data.ticket.customerRevision}),signal:controller.signal});
    const result=await read.json() as {ok?:boolean;error?:string};if(!mounted.current||run!==detailRun.current)return;
    if(!read.ok||result.ok!==true)throw new Error(result.error||'Oxunma qeydi saxlanmadı. Bileti yenidən açın.');
    await loadList(true);
   }
  }finally{if(mounted.current&&run===detailRun.current)setOpening(false);}
 }
 function openTicket(id:string){if(pending.current)return;setOpenId(id);setDetail(null);setLines([]);setReply('');setEditId('');setError('');setNotice('');void loadDetail(id,true).catch(cause=>{if(mounted.current&&!(cause instanceof DOMException&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'Bilet açılmadı.');});}
 async function send(body:Record<string,unknown>){
  if(pending.current||!detail)return;const ticketId=detail.id;pending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/store-admin/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json() as {ok?:boolean;error?:string};
   if(!response.ok||data.ok!==true)throw new Error(data.error||'Bilet yenilənmədi.');if(!mounted.current)return;
   if(body.action==='reply')setReply('');setEditId('');setNotice(body.action==='reply'?'Dəstək cavabı saxlanıldı.':'Bilet yeniləndi.');
   await Promise.all([loadDetail(ticketId),loadList(true)]).catch(()=>{if(mounted.current)setError('Dəyişiklik saxlanıldı, siyahı yenilənmədi. Yeniləyin.');});
  }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'Bilet yenilənmədi.');}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 const date=(value:string)=>new Date(value).toLocaleString(languageLocale(language),{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 const showing=detail?.id===openId?detail:null;
 return <section className="support-desk" aria-labelledby="support-heading">
  <header className="support-heading"><div><span className="support-eyebrow">{t('MÜŞTƏRİ DƏSTƏYİ')}</span><h2 id="support-heading">{t('Dəstək biletləri')} <SupportCounts attention={attention}/></h2><p>{t('Problem, təklif və sifariş müraciətləri bir yerdə.')}</p></div><button type="button" disabled={busy||loading} onClick={()=>{setError('');void loadList().catch(()=>setError('Biletlər yüklənmədi.'));}}><RefreshCw size={16} aria-hidden="true"/>{t('Yenilə')}</button></header>
  <p className="support-guide">{t('Biletlər yalnız açıldıqda oxunmuş kimi qeyd olunur. Cavab gözləyənlər son müştəri mesajına görə hesablanır; bağlı biletlər daxil edilmir.')}</p>
  <nav className="support-filters" aria-label={t('Dəstək filtrləri')}>{[['all','Bütün biletlər'],['unread','Oxunmamış biletlər'],['unanswered','Cavab gözləyən biletlər'],['suggestion','Bütün təkliflər'],['closed','Bağlı biletlər']].map(([value,label])=><button key={value} type="button" disabled={busy} aria-pressed={filter===value} className={filter===value?'selected':''} onClick={()=>{setFilter(value);setPage(1);}}>{t(label)}{value==='unread'&&attention&&<b>{attention.unread}</b>}{value==='unanswered'&&attention&&<b>{attention.unanswered}</b>}</button>)}</nav>
  {error&&<p role="alert" className="support-message is-error">{t(error)}</p>}{notice&&<p role="status" className="support-message"><Check size={17} aria-hidden="true"/>{t(notice)}</p>}
  <div className="support-grid"><aside className="support-list" aria-label={t('Bilet siyahısı')} aria-busy={loading}>
   {loading&&!tickets.length?<p role="status" className="support-empty"><LoaderCircle className="support-spin" size={20} aria-hidden="true"/>{t('Biletlər yüklənir…')}</p>:tickets.length?tickets.map(ticket=><button key={ticket.id} type="button" disabled={busy} className={'support-ticket'+(openId===ticket.id?' selected':'')+(ticket.unread?' is-unread':'')} aria-current={openId===ticket.id?'true':undefined} onClick={()=>openTicket(ticket.id)}><span className="support-ticket-top"><b>#{ticket.ticket_no}</b><span>{t(kinds[ticket.kind]||'Problem bileti')}</span></span><strong>{ticket.subject}</strong><span>{ticket.name||t('Qonaq müraciəti')}{ticket.phone?' · '+ticket.phone:''}</span><p>{ticket.last_body}</p><span className="support-ticket-bottom"><time dateTime={ticket.updated_at}>{date(ticket.updated_at)}</time>{ticket.unread&&<em>{t('Oxunmamış')}</em>}{ticket.unanswered&&<em className="awaiting">{t('Cavab gözləyir')}</em>}</span></button>):<p className="support-empty"><Inbox size={25} aria-hidden="true"/>{t('Bu filtrdə bilet yoxdur.')}</p>}
   <div className="support-pagination"><button type="button" disabled={busy||loading||page<=1} aria-label={t('Əvvəlki bilet səhifəsi')} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={17}/></button><span>{page} / {pages} · {total} {t('bilet')}</span><button type="button" disabled={busy||loading||page>=pages} aria-label={t('Növbəti bilet səhifəsi')} onClick={()=>setPage(value=>value+1)}><ChevronRight size={17}/></button></div>
  </aside><div className="support-thread-area" aria-busy={opening}>
   {opening&&!showing?<p role="status" className="support-empty"><LoaderCircle className="support-spin" size={22} aria-hidden="true"/>{t('Bilet açılır…')}</p>:showing?<section className="support-thread" key={showing.id} aria-label={t('Bilet yazışması')+' #'+showing.ticket_no}><header className="support-person"><div><small>#{showing.ticket_no} · {t(statuses[showing.status])}</small><h3>{showing.subject}</h3><strong>{showing.name||t('Qonaq müraciəti')}</strong><p>{showing.email}{showing.email&&showing.phone?' · ':''}{showing.phone}</p></div><div className="support-thread-actions"><button type="button" disabled={busy||opening} onClick={()=>{setError('');void loadDetail(showing.id,true).catch(()=>setError('Oxunma qeydi saxlanmadı. Bileti yenidən açın.'));}}><MailOpen size={16} aria-hidden="true"/>{t('Bileti yenidən aç və oxunmuş et')}</button><button type="button" disabled={busy} onClick={()=>void send({action:'status',ticketId:showing.id,status:showing.status==='closed'?'open':'closed'})}>{t(showing.status==='closed'?'Bağlı bileti yenidən aç':'Bileti bağla')}</button></div></header>
    {!showing.account_id&&<p className="support-guide">{t('Qonaq müraciəti: əlaqə üçün göstərilən telefon nömrəsindən istifadə edin.')}</p>}
    <div className="support-messages">{lines.map(line=><article key={line.id} className={line.sender==='staff'?'is-staff':''}><header><strong>{line.sender==='staff'?t('Mağaza'):showing.name||t('Qonaq müraciəti')}</strong><time dateTime={line.created_at}>{date(line.created_at)}{line.edited_at?' · '+t('Düzəldilmiş mesaj'):''}</time></header>{editId===line.id?<form onSubmit={event=>{event.preventDefault();void send({action:'edit',messageId:line.id,message:editText});}}><label>{t('Cavabı redaktə edin')}<textarea value={editText} onChange={event=>setEditText(event.target.value)} maxLength={2000} required disabled={busy}/></label><div className="support-thread-actions"><button disabled={busy||!editText.trim()}>{t('Redaktəni saxla')}</button><button type="button" disabled={busy} onClick={()=>setEditId('')}>{t('Bağla')}</button></div></form>:<p>{line.body}</p>}{line.sender==='staff'&&lines.at(-1)?.id===line.id&&editId!==line.id&&<button type="button" className="support-text-button" disabled={busy} onClick={()=>{setEditId(line.id);setEditText(line.body);}}>{t('Son dəstək cavabını redaktə et')}</button>}</article>)}</div>
    {showing.status!=='closed'?<form className="support-reply" onSubmit={(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();void send({action:'reply',ticketId:showing.id,message:reply});}}><label htmlFor={'support-reply-'+showing.id}>{t('Bu biletə cavabınız')}<textarea id={'support-reply-'+showing.id} value={reply} onChange={event=>setReply(event.target.value)} required maxLength={2000} rows={4} disabled={busy} placeholder={t('Müştəriyə göndəriləcək cavabı yazın.')}/></label><small>{t('Cavab hesabda saxlanılır; e-poçt bildirişi mövcud ayarlardan asılıdır.')}</small><button type="submit" className="support-primary" disabled={busy||!reply.trim()}>{busy?<LoaderCircle className="support-spin" size={17} aria-hidden="true"/>:<Send size={17} aria-hidden="true"/>}{t('Dəstək cavabını göndər')}</button></form>:<p className="support-guide">{t('Bilet bağlıdır. Cavab yazmaq üçün əvvəl bileti açın.')}</p>}
   </section>:<div className="support-empty support-select-empty"><MessageSquare size={36} aria-hidden="true"/><h3>{t('Yazışmanı seçin')}</h3><p>{t('Biletə basaraq mesajları açın. Sadəcə siyahını yeniləmək bileti oxunmuş etmir.')}</p></div>}
  </div></div>
 </section>;
}
