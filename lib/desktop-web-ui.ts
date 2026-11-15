import type {RemoteOrder} from './desktop-sync';

export type DesktopPosOrder={id:string;order_no:string;customerId?:string;customer_name:string;total:number;deliveryFee?:number;couponDiscount?:number;source?:string;items:{productId:string;optionId?:string;unitPrice:number;quantity:number}[]};
export type DesktopInboxRow={id:string;payload:RemoteOrder&{cancellation_reason?:string|null};store_url:string;local_order_id:string|null;local_status:string|null;local_stage:string|null;import_error?:string|null;sync_conflict?:string|null;needs_review?:boolean;invalid_payload?:boolean;local_paid?:boolean;local_order?:DesktopPosOrder|null;local_cancellation_reason?:string|null};
export type DesktopInboxFilter='new'|'active'|'unresolved'|'completed'|'cancelled'|'all';
export const desktopInboxFilters:readonly DesktopInboxFilter[]=['new','active','unresolved','completed','cancelled','all'];
export function inboxNeedsAttention(row:DesktopInboxRow){return !!(row.import_error||row.sync_conflict||row.needs_review||row.invalid_payload);}
export function inboxIsUnpaid(row:DesktopInboxRow){
 return !row.invalid_payload&&!row.local_paid&&['pending','ready'].includes(row.payload.status)&&(!row.local_order_id||['pending','ready'].includes(row.local_status||'pending'));
}
export function inboxMatchesFilter(row:DesktopInboxRow,filter:DesktopInboxFilter){
 if(filter==='all')return true;
 if(filter==='unresolved')return inboxNeedsAttention(row);
 if(filter==='new')return !row.local_order_id&&inboxIsUnpaid(row);
 if(filter==='active')return inboxIsUnpaid(row)||inboxNeedsAttention(row);
 if(filter==='cancelled')return row.payload.status==='cancelled'||row.local_status==='cancelled';
 return row.payload.status==='completed'||row.local_status==='completed';
}
