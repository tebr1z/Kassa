export const orderCancellationReasonError='Ləğv səbəbini aydın yazın (5–500 simvol).';
export function normalizeOrderCancellationReason(value:string){return value.normalize('NFC').trim().replace(/\s+/gu,' ');}
export function isOrderCancellationReason(value:unknown):value is string {
 if(typeof value!=='string'||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}<>]/u.test(value))return false;
 const reason=normalizeOrderCancellationReason(value);
 return reason.length>=5&&reason.length<=500&&(reason.match(/\p{L}/gu)||[]).length>=3&&!/^(.)\1+$/u.test(reason)&&!/^(?:test|sinaq|sınaq|asdf|qwerty|sadasd)[\s.!0-9]*$/iu.test(reason);
}
export type OrderCancellationNotification={id:string;orderNo:string;reason:string;to:string};
export function orderCancellationEmail(order:OrderCancellationNotification){
 return {eventKey:'order-cancelled:'+order.id,kind:'order_cancelled' as const,to:order.to,subject:'RestaMarket · Sifariş '+order.orderNo+' ləğv edilib',text:'Sifariş nömrəsi: '+order.orderNo+'\n\nMağaza sifarişinizi ləğv edib.\nLəğv səbəbi: '+order.reason};
}
