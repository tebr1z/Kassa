import 'server-only';
import type postgres from 'postgres';
import type {DeliverySettings} from './delivery';
import {openRoutingConfigured} from './open-routing';
export type DeliveryDatabase=Pick<postgres.Sql,'unsafe'>;
export async function deliverySettings(sql:DeliveryDatabase){
 const [row]=await sql.unsafe('select * from delivery_settings where id=1');
 if(!row)throw new Error('Delivery configuration unavailable');
 return {...publicDeliverySettings(row),revision:Number(row.revision),serverKey:String(row.server_key||'')};
}
function publicDeliverySettings(row:Record<string,unknown>):DeliverySettings {
 return {mode:row.mode==='distance'?'distance':'manual',minimumOrder:Number(row.minimum_order),minimumFee:Number(row.minimum_fee),pricePerKm:Number(row.price_per_km),freeDistanceKm:Number(row.free_distance_km??0),freeOrderFrom:row.free_order_from==null?null:Number(row.free_order_from),originAddress:String(row.origin_address||''),originLat:row.origin_lat==null?null:Number(row.origin_lat),originLng:row.origin_lng==null?null:Number(row.origin_lng),browserKey:'',routingConfigured:openRoutingConfigured(),tileUrl:process.env.OPEN_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png'};
}
export function customerDeliverySettings(settings:Awaited<ReturnType<typeof deliverySettings>>){
 const {serverKey,revision,...publicSettings}=settings;void revision;void serverKey;
 return publicSettings;
}
export function sameOriginMutation(request:Request){
 const origin=request.headers.get('origin'),url=new URL(request.url);
 return request.headers.get('sec-fetch-site')!=='cross-site'&&(!origin||origin===url.protocol+'//'+(request.headers.get('host')||url.host));
}
