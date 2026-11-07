import {storeDb} from '@/lib/store-db';
import {deliverySettings,customerDeliverySettings} from '@/lib/delivery-server';
export const dynamic='force-dynamic';
export async function GET(){const sql=storeDb();try{return Response.json({settings:customerDeliverySettings(await deliverySettings(sql))},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Çatdırılma ayarları yüklənmədi.'},{status:503});}finally{await sql.end();}}
