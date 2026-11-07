import {z} from 'zod';
import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {deliverySettings,customerDeliverySettings} from '@/lib/delivery-server';
export const dynamic='force-dynamic';
const amount=z.number().finite().min(0).max(1_000_000);
const schema=z.object({mode:z.enum(['manual','distance']),minimumOrder:amount,minimumFee:amount,pricePerKm:amount,originAddress:z.string().trim().max(300),originLat:z.number().finite().min(-90).max(90).nullable(),originLng:z.number().finite().min(-180).max(180).nullable(),browserKey:z.string().trim().max(200).regex(/^[\w-]*$/),serverKey:z.string().trim().max(200).regex(/^[\w-]*$/).default(''),clearServerKey:z.boolean().optional()});
async function get(){const sql=storeDb();try{const s=await deliverySettings(sql);return Response.json({settings:{...customerDeliverySettings(s),serverConfigured:Boolean(s.serverKey)}});}catch{return Response.json({error:'Çatdırılma ayarları yüklənmədi.'},{status:503});}finally{await sql.end();}}
async function post(request:Request){
 if(Number(request.headers.get('content-length')||0)>5000)return Response.json({error:'Sorğu çox böyükdür'},{status:413});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:'Çatdırılma ayarlarını düzgün doldurun.'},{status:400});
 const sql=storeDb();try{
  const result=await sql.begin(async tx=>{
   await tx.unsafe('select id from delivery_settings where id=1 for update');const old=await deliverySettings(tx),b=parsed.data;
   const serverKey=b.clearServerKey?'':b.serverKey||old.serverKey;
   if(b.mode==='distance'&&(!b.originAddress||b.originLat===null||b.originLng===null||b.pricePerKm<=0||!serverKey))return null;
   await tx.unsafe('update delivery_settings set mode=$1,minimum_order=$2,minimum_fee=$3,price_per_km=$4,origin_address=$5,origin_lat=$6,origin_lng=$7,browser_key=$8,server_key=$9,revision=revision+1,updated_at=now() where id=1',[b.mode,b.minimumOrder,b.minimumFee,b.pricePerKm,b.originAddress,b.originLat,b.originLng,b.browserKey,serverKey]);
   // Never put API keys in audit JSON or a response.
   await tx.unsafe("insert into audit_logs(user_id,action,entity_type,after_json) values($1,'delivery.settings_updated','delivery_settings',$2)",[request.headers.get('x-birkassa-user-id'),JSON.stringify({mode:b.mode,minimumOrder:b.minimumOrder,minimumFee:b.minimumFee,pricePerKm:b.pricePerKm,keyChanged:Boolean(b.serverKey||b.clearServerKey)})]);
   const s=await deliverySettings(tx);return {...customerDeliverySettings(s),serverConfigured:Boolean(s.serverKey)};
  });
  return result?Response.json({ok:true,settings:result}):Response.json({error:'Məsafə rejimi üçün mərkəz ünvanı, koordinatlar, km tarifi və Google server açarı lazımdır.'},{status:400});
 }catch{return Response.json({error:'Çatdırılma ayarları saxlanmadı.'},{status:503});}finally{await sql.end();}
}
export const GET=withAdminSession(get);
export const POST=withAdminSession(post);
