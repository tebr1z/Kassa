import {z} from 'zod';
import {storeDb} from '@/lib/store-db';
import {customerAccount} from '@/lib/customer-session';
import {deliverySettings,sameOriginMutation} from '@/lib/delivery-server';
import {deliveryCharge} from '@/lib/delivery';
import {openRoutingConfigured,roadDistance} from '@/lib/open-routing';
import {isAzerbaijanCoordinate} from '@/lib/azerbaijan-location';
import {customerAddressError,normalizeCustomerAddress} from '@/lib/customer-contact';
export const dynamic='force-dynamic';
const schema=z.object({address:z.string().trim().min(5).max(500),lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)});
export async function POST(request:Request){
 if(!sameOriginMutation(request))return Response.json({error:'Başqa saytdan göndərilən sorğu qəbul edilmir.'},{status:403});
 const account=await customerAccount();if(!account)return Response.json({error:'Hesabınıza daxil olun'},{status:401});
 if(Number(request.headers.get('content-length')||0)>3000)return Response.json({error:'Sorğu çox böyükdür'},{status:413});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:'Tam ünvanı və xəritədə nöqtəni seçin.'},{status:400});
 const b={...parsed.data,address:normalizeCustomerAddress(parsed.data.address)};
 const addressError=customerAddressError(b.address,{required:true,maxLength:500});if(addressError)return Response.json({error:addressError},{status:400});
 if(!isAzerbaijanCoordinate(parsed.data.lat,parsed.data.lng))return Response.json({error:'Xəritədə Azərbaycan daxilində nöqtə seçin.'},{status:400});
 const sql=storeDb();try{
  const settings=await deliverySettings(sql);
  if(settings.mode!=='distance'||!openRoutingConfigured()||settings.originLat===null||settings.originLng===null)return Response.json({error:'Məsafə üzrə çatdırılma hələ aktiv deyil.'},{status:400});
  const allowed=await sql.begin(async tx=>{
   let ok=true;for(const [scope,max]of [['global',200],['account:'+account.id,20]] as const){
    const [row]=await tx.unsafe("insert into delivery_quote_limits(scope,attempts) values($1,1) on conflict(scope) do update set attempts=case when delivery_quote_limits.window_start<now()-interval '10 minutes' then 1 else delivery_quote_limits.attempts+1 end,window_start=case when delivery_quote_limits.window_start<now()-interval '10 minutes' then now() else delivery_quote_limits.window_start end returning attempts",[scope]);if(Number(row.attempts)>max)ok=false;
   }return ok;
  });
  if(!allowed)return Response.json({error:'Hesablama limiti dolub. 10 dəqiqə sonra yenidən cəhd edin.'},{status:429,headers:{'Retry-After':'600'}});
  const meters=await roadDistance({lat:settings.originLat,lng:settings.originLng},{lat:b.lat,lng:b.lng});
  const fee=deliveryCharge(settings,meters);
  const [quote]=await sql.unsafe('insert into delivery_quotes(account_id,address,lat,lng,distance_meters,fee,settings_revision) values($1,$2,$3,$4,$5,$6,$7) returning id,expires_at',[account.id,b.address,b.lat,b.lng,meters,fee,settings.revision]);
  await sql.unsafe("delete from delivery_quotes where account_id=$1 and expires_at<now()-interval '1 day'",[account.id]);
  return Response.json({quote:{id:quote.id,fee,distanceMeters:meters,expiresAt:quote.expires_at,address:b.address,lat:b.lat,lng:b.lng}},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Yol məsafəsi hesablanmadı. Yenidən cəhd edin və ya mağazadan götürməni seçin.'},{status:503});}finally{await sql.end();}
}
