'use client';
import {useRef,useState,type FormEvent} from 'react';
import {LoaderCircle,XCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useTranslations} from '@/lib/language';
import {isOrderCancellationReason,normalizeOrderCancellationReason,orderCancellationReasonError} from '@/lib/order-cancellation';
type Props={order:{id:string;order_no:string}|null;api:'online'|'pos';onClose:()=>void;onCancelled:()=>void|Promise<void>};
export default function OrderCancelDialog(props:Props){return props.order?<CancelPrompt key={props.order.id} {...props} order={props.order}/>:null;}
function CancelPrompt({order,api,onClose,onCancelled}:Omit<Props,'order'>&{order:NonNullable<Props['order']>}){
 const {t}=useTranslations(),pending=useRef(false);
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current)return;
  if(!isOrderCancellationReason(reason)){setError(orderCancellationReasonError);return;}
  pending.current=true;setBusy(true);setError('');
  try{
   const response=await fetch(api==='online'?'/api/online-orders':'/api/orders',{method:api==='online'?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(api==='online'?{id:order.id}:{action:'status',orderId:order.id}),status:'cancelled',cancellationReason:normalizeOrderCancellationReason(reason)})});
   const body=await response.json().catch(()=>null) as {ok?:boolean;status?:string;error?:string}|null;
   if(!response.ok||!(body?.ok===true||body?.status==='cancelled'))throw Error(body?.error||'Sifariş ləğv edilmədi. Bağlantını yoxlayıb yenidən cəhd edin.');
  }catch(cause){setError(cause instanceof Error&&!(cause instanceof TypeError)?cause.message:'Sifariş ləğv edilmədi. Bağlantını yoxlayıb yenidən cəhd edin.');pending.current=false;setBusy(false);return;}
  onClose();await onCancelled();
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!pending.current)onClose();}}><DialogContent showCloseButton={!busy} onEscapeKeyDown={event=>{if(pending.current)event.preventDefault();}} onPointerDownOutside={event=>{if(pending.current)event.preventDefault();}}>
  <DialogHeader><DialogTitle>{t('Sifarişi ləğv etmək istəyirsiniz?')}</DialogTitle><DialogDescription>{t('Səbəb müştərinin sifariş tarixçəsində görünəcək. E-poçt bildirişi aktivdirsə, müştəriyə göndəriləcək.')}</DialogDescription></DialogHeader>
  <form className="product-form" onSubmit={event=>void submit(event)}><strong>{order.order_no}</strong><label>{t('Ləğv səbəbi')}<textarea autoFocus required minLength={5} maxLength={500} rows={4} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)} placeholder={t('Məsələn: Seçilən məhsul hazırda stokda yoxdur.')} aria-invalid={!!error} style={{width:'100%',padding:12,border:'1px solid #d6d3d1',borderRadius:10,resize:'vertical'}}/></label>{error&&<p className="form-error" role="alert">{t(error)}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('Geri qayıt')}</Button><Button type="submit" variant="destructive" disabled={busy} aria-busy={busy}>{busy?<LoaderCircle size={17} className="animate-spin"/>:<XCircle size={17}/>} {t(busy?'Ləğv edilir…':'Bəli, sifarişi ləğv et')}</Button></DialogFooter></form>
 </DialogContent></Dialog>;
}
