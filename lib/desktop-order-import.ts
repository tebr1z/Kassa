import 'server-only';
import type postgres from 'postgres';
import {z} from 'zod';
import {optionSnapshot} from '@/lib/product-options';

type Sql=Pick<ReturnType<typeof postgres>,'unsafe'>;
const money=z.coerce.number().finite().min(0).max(999999999999.99);
const timestamp=z.string().max(80).regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/)
 .refine(value=>Number.isFinite(Date.parse(value)),'Tarix düzgün deyil.');
export const remoteOrderSchema=z.object({
 id:z.string().uuid(),order_no:z.string().min(1).max(150),status:z.enum(['pending','ready','completed','cancelled']),
 fulfillment:z.enum(['pickup','delivery']),delivery_address:z.string().max(2000).nullable(),
 delivery_stage:z.enum(['received','preparing','ready','dispatched','delivered']),
 total:money,coupon_discount:money,delivery_fee:money.default(0),
 distance_meters:z.coerce.number().finite().int().min(0).max(2147483647).nullable().default(null),
 delivery_lat:z.coerce.number().finite().min(-90).max(90).nullable().default(null),
 delivery_lng:z.coerce.number().finite().min(-180).max(180).nullable().default(null),
 delivery_pricing:z.enum(['manual','distance']).default('manual'),
 cancellation_reason:z.string().min(5).max(500).nullable().default(null),cancelled_at:timestamp.nullable().default(null),
 note:z.string().max(5000).nullable(),full_name:z.string().min(1).max(200),phone:z.string().max(100).nullable(),
 created_at:timestamp,updated_at:timestamp,
 items:z.array(z.object({product_id:z.string().uuid().optional(),sku:z.string().min(1).max(100),name:z.string().min(1).max(500),
  option_snapshot:z.string().max(3000).nullable(),quantity:z.coerce.number().finite().int().positive().max(999999999),
  unit_price:money,line_total:money})).min(1).max(500)
}).superRefine((order,context)=>{
 const seen=new Set<string>();
 for(const [index,item]of order.items.entries()){
  const key=(item.product_id||item.sku)+'\0'+(item.option_snapshot||'');
  if(seen.has(key))context.addIssue({code:z.ZodIssueCode.custom,path:['items',index],message:'Eyni məhsul seçimi iki dəfə yazılıb.'});
  seen.add(key);
 }
 for(const [index,item]of order.items.entries())if(Math.abs(item.line_total-Math.round(item.quantity*item.unit_price*100)/100)>.009)
  context.addIssue({code:z.ZodIssueCode.custom,path:['items',index,'line_total'],message:'Məhsul sətrinin məbləği uyğun deyil.'});
 const subtotal=order.items.reduce((sum,item)=>sum+item.line_total,0);
 if(order.coupon_discount>subtotal||Math.abs(order.total-Number((subtotal-order.coupon_discount+order.delivery_fee).toFixed(2)))>.009)
  context.addIssue({code:z.ZodIssueCode.custom,path:['total'],message:'Sifarişin məhsul, endirim və çatdırılma məbləğləri uyğun deyil.'});
 if(order.fulfillment==='pickup'&&(order.delivery_fee!==0||order.delivery_stage==='dispatched'))
  context.addIssue({code:z.ZodIssueCode.custom,path:['delivery_fee'],message:'Mağazadan götürmə məlumatları uyğun deyil.'});
});
export type RemoteOrder=z.infer<typeof remoteOrderSchema>;
export const desktopOrderInvalidMessage='Veb sifarişinin məlumatları uyğun deyil. Vebdə sifarişi yoxlayın.';
const identity=(value:string)=>value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120);
export function desktopImportError(error:unknown){
 return error instanceof Error&&'desktopOrderError' in error?error.message.slice(0,1000):desktopOrderInvalidMessage;
}
function orderError(message:string){return Object.assign(new Error(message),{desktopOrderError:true});}
async function actor(sql:Sql,requested?:string|null){
 const rows=requested?await sql.unsafe("select id from users where id=$1 and is_active=true and role in ('admin','manager','cashier')",[requested]):
  await sql.unsafe("select id from users where is_active=true and role='admin' order by created_at,id limit 1");
 if(!rows[0])throw orderError('Sifarişi qəbul etmək üçün aktiv baş rəhbər hesabı lazımdır.');
 return String(rows[0].id);
}
async function resolveLines(sql:Sql,order:RemoteOrder){
 const lines=[];
 for(const item of order.items){
  const matches=await sql.unsafe('select id,sku from products where (sku=$1 or id=$2::uuid) and is_active=true and deleted_at is null order by id for share',
   [item.sku,item.product_id||null]);
  if(matches.length!==1)throw orderError('Yerli məhsul tapılmadı və ya kod uyğun deyil (SKU): '+identity(item.sku));
  const product=matches[0];
  const options=await sql.unsafe('select id,label,attributes from product_options where product_id=$1 and is_active=true order by id for share',[product.id]);
  let optionId:string|null=null;
  if(item.option_snapshot){
   const choices=options.filter(option=>optionSnapshot({label:String(option.label),attributes:option.attributes})===item.option_snapshot);
   if(choices.length!==1)throw orderError('Yerli ölçü/rəng seçimini yoxlayın: '+identity(item.sku)+' · '+identity(item.option_snapshot));
   optionId=String(choices[0].id);
  }else if(options.length)throw orderError('Yerli məhsulun seçimlərini yoxlayın: '+identity(item.sku));
  lines.push({...item,productId:String(product.id),optionId});
 }
 return lines;
}
async function insertLines(sql:Sql,orderId:string,lines:Awaited<ReturnType<typeof resolveLines>>){
 for(const item of lines)await sql.unsafe(`insert into sales_order_items(sales_order_id,product_id,option_id,option_snapshot,quantity,unit_price,line_total,product_name_snapshot)
  values($1,$2,$3,$4,$5,$6,$7,$8)`,[orderId,item.productId,item.optionId,item.option_snapshot,item.quantity,item.unit_price,item.line_total,item.name]);
}

// The caller owns a transaction/savepoint. Locking this row makes imports from
// the scheduler and a cashier's retry exactly-once, without creating a receipt.
export async function importDesktopOrder(sql:Sql,id:string,requestedActor?:string|null){
 const [inbox]=await sql.unsafe('select * from desktop_order_inbox where id=$1 for update',[id]);
 if(!inbox)throw orderError('Sifariş tapılmadı.');
 if(inbox.local_order_id)return {orderId:String(inbox.local_order_id),imported:false};
 const parsed=remoteOrderSchema.safeParse(inbox.payload);
 if(!parsed.success)throw orderError(desktopOrderInvalidMessage);
 const order=parsed.data;
 if(!['pending','ready'].includes(order.status))throw orderError('Bağlanmış sifariş kassaya köçürülə bilməz.');
 const userId=await actor(sql,requestedActor),lines=await resolveLines(sql,order);
 let [customer]=order.phone?await sql.unsafe('select id from customers where phone=$1 order by created_at,id limit 1',[order.phone]):[];
 if(!customer)[customer]=await sql.unsafe('insert into customers(full_name,phone) values($1,$2) returning id',[order.full_name,order.phone]);
 const [local]=await sql.unsafe(`insert into sales_orders(order_no,customer_id,status,total,note,created_by,source,
  fulfillment,delivery_address,delivery_stage,coupon_discount,delivery_fee,distance_meters,delivery_lat,delivery_lng,delivery_pricing,
  customer_name_snapshot,customer_phone_snapshot,created_at) values($1,$2,$3,$4,$5,$6,'catalog',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
  ['WEB-'+inbox.id,customer.id,order.status,order.total,[order.order_no,order.note].filter(Boolean).join(' · '),userId,
   order.fulfillment,order.delivery_address||'',order.delivery_stage,order.coupon_discount,order.delivery_fee,order.distance_meters,
   order.delivery_lat,order.delivery_lng,order.delivery_pricing,order.full_name,order.phone,order.created_at]);
 await insertLines(sql,String(local.id),lines);
 await sql.unsafe("update desktop_order_inbox set local_order_id=$1,imported_at=now(),import_error='',sync_conflict='',updated_at=now() where id=$2",[local.id,inbox.id]);
 await sql.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'desktop.order_imported','sales_order',$2,$3)",
  [userId,local.id,JSON.stringify({remoteId:order.id,orderNo:order.order_no,automatic:!requestedActor})]);
 return {orderId:String(local.id),imported:true};
}

const stages=['received','preparing','ready','dispatched','delivered'];
function financialSnapshot(order:Record<string,unknown>&{items:Record<string,unknown>[]},local=false){
 const items=order.items.map(item=>[String(item.sku),String(item.name),String(item.option_snapshot||''),Number(item.quantity),Number(item.unit_price),Number(item.line_total)])
  .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify([Number(order.total),Number(order.coupon_discount),Number(order.delivery_fee),order.fulfillment,
  order.delivery_address||'',order.distance_meters===null?null:Number(order.distance_meters),order.delivery_lat===null?null:Number(order.delivery_lat),
  order.delivery_lng===null?null:Number(order.delivery_lng),order.delivery_pricing,String(order.full_name),order.phone||'',
  local?String(order.note||''):[order.order_no,order.note].filter(Boolean).join(' · '),items]);
}
export async function mergeRemoteDesktopOrder(sql:Sql,inboxId:string,order:RemoteOrder,previous:RemoteOrder|null=null){
 const [local]=await sql.unsafe(`select o.*,coalesce(o.customer_name_snapshot,c.full_name) full_name,coalesce(o.customer_phone_snapshot,c.phone) phone,
  exists(select 1 from sales s where s.sales_order_id=o.id and s.status='completed') paid
  from sales_orders o join customers c on c.id=o.customer_id join desktop_order_inbox i on i.local_order_id=o.id where i.id=$1 for update of o`,[inboxId]);
 if(!local)return {updated:false,conflict:false};
 const items=await sql.unsafe('select p.sku,coalesce(i.product_name_snapshot,p.name) name,i.option_snapshot,i.quantity,i.unit_price,i.line_total from sales_order_items i join products p on p.id=i.product_id where i.sales_order_id=$1',[local.id]);
 let conflict='';
 let refreshed=false;
 if(financialSnapshot({...local,items},true)!==financialSnapshot(order)){
  if(!local.paid&&!['completed','cancelled'].includes(local.status)&&['pending','ready'].includes(order.status)&&previous&&financialSnapshot({...local,items},true)===financialSnapshot(previous)){
   const lines=await resolveLines(sql,order);
   await sql.unsafe('delete from sales_order_items where sales_order_id=$1',[local.id]);
   await insertLines(sql,String(local.id),lines);
   await sql.unsafe(`update sales_orders set total=$1,coupon_discount=$2,delivery_fee=$3,fulfillment=$4,delivery_address=$5,distance_meters=$6,
    delivery_lat=$7,delivery_lng=$8,delivery_pricing=$9,customer_name_snapshot=$10,customer_phone_snapshot=$11,note=$12,updated_at=now() where id=$13`,
    [order.total,order.coupon_discount,order.delivery_fee,order.fulfillment,order.delivery_address||'',order.distance_meters,order.delivery_lat,
     order.delivery_lng,order.delivery_pricing,order.full_name,order.phone,[order.order_no,order.note].filter(Boolean).join(' · '),local.id]);
   refreshed=true;
  }else conflict='Veb sifarişinin məhsul və ya məbləği dəyişib. Kassada ödənişdən əvvəl yoxlayın.';
 }
 if((local.paid||local.status==='completed')&&order.status==='cancelled')
  conflict='Sifariş vebdə ləğv edilib, amma kassada ödənilib. Çek və stok saxlanılıb; qaytarmanı ayrıca yoxlayın.';
 if(!local.paid&&local.status!=='completed'&&order.status==='completed')
  conflict='Sifariş vebdə tamamlanıb. Təkrar ödənişin qarşısını almaq üçün yerli sifariş bağlanıb; kassada yeni çek yaradılmayıb.';
 let status=String(local.status),stage=String(local.delivery_stage),reason=local.cancellation_reason,cancelledAt=local.cancelled_at;
 if(!local.paid&&local.status!=='completed'&&['cancelled','completed'].includes(order.status)){
  status='cancelled';reason=order.status==='cancelled'?order.cancellation_reason:reason;cancelledAt=order.cancelled_at||cancelledAt;
 }else if(status!=='cancelled'){
  if(stages.indexOf(order.delivery_stage)>stages.indexOf(stage))stage=order.delivery_stage;
  if(status==='pending'&&(order.status==='ready'||stages.indexOf(stage)>=2))status='ready';
 }
 const epoch=(value:unknown)=>value==null?null:new Date(value as string|Date).getTime();
 const changed=status!==local.status||stage!==local.delivery_stage||reason!==local.cancellation_reason||epoch(cancelledAt)!==epoch(local.cancelled_at);
 if(changed||refreshed){
  await sql.unsafe('update sales_orders set status=$1,delivery_stage=$2,cancellation_reason=$3,cancelled_at=$4,updated_at=now() where id=$5',
   [status,stage,reason,cancelledAt,local.id]);
  const userId=await actor(sql);
  await sql.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'desktop.remote_order_updated','sales_order',$2,$3)",
   [userId,local.id,JSON.stringify({remoteStatus:order.status,status,deliveryStage:stage,blockedRemoteCompletion:order.status==='completed'&&status==='cancelled'})]);
 }
 await sql.unsafe("update desktop_order_inbox set sync_conflict=$1,import_error='' where id=$2",[conflict,inboxId]);
 return {updated:changed||refreshed,conflict:!!conflict};
}
