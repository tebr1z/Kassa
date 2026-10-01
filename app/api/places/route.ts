import {customerAccount} from "@/lib/customer-session";
export const dynamic="force-dynamic";
const headers={"User-Agent":"BirKassaStore/1.0 (customer address picker)","Accept":"application/json"};
export async function GET(request:Request){
 if(!await customerAccount())return Response.json({error:"Ünvan seçmək üçün hesabınıza daxil olun."},{status:401});
 const url=new URL(request.url),q=url.searchParams.get("q")?.trim()||"",lat=Number(url.searchParams.get("lat")),lng=Number(url.searchParams.get("lng"));
 try{
  if(q){
   if(q.length<3||q.length>120)return Response.json({error:"Axtarış 3–120 simvol olmalıdır."},{status:400});
   const r=await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=az&q="+encodeURIComponent(q),{headers,signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw new Error();
   const rows=await r.json() as {display_name:string;lat:string;lon:string}[];
   return Response.json({places:rows.map(p=>({label:p.display_name,lat:Number(p.lat),lng:Number(p.lon)}))});
  }
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return Response.json({error:"Xəritə nöqtəsi düzgün deyil."},{status:400});
  const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,{headers,signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error();
  const row=await r.json() as {display_name?:string};
  return Response.json({label:row.display_name||"",lat,lng});
 }catch{return Response.json({error:"Xəritə ünvanı tapılmadı. Yenidən cəhd edin."},{status:503});}
}
