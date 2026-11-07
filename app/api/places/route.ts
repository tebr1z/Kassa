import {customerAccount} from "@/lib/customer-session";
import {withAdminSession} from '@/lib/require-admin';
import {OpenGeocodingError,parseOpenPlaceSearch,searchOpenPlaces} from '@/lib/open-geocoding';
export const dynamic="force-dynamic";
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const reply=(body:object,status=200)=>Response.json(body,{status,headers:{...headers,...(status===429?{'Retry-After':'2'}:{})}});
async function searchUrl(request:Request){
 const url=new URL(request.url);if(request.method!=='POST')return url;
 if(!/^application\/json(?:;|$)/iu.test(request.headers.get('content-type')||''))throw new OpenGeocodingError(400,'Axtarış 3–120 simvol olmalıdır.');
 const reader=request.body?.getReader();if(!reader)throw new OpenGeocodingError(400,'Axtarış 3–120 simvol olmalıdır.');
 let bytes=0,text='';const decoder=new TextDecoder();
 try{
  while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>3000)throw new OpenGeocodingError(413,'Sorğu çox böyükdür');text+=decoder.decode(chunk.value,{stream:true});}
  text+=decoder.decode();
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 let body:unknown;try{body=JSON.parse(text);}catch{throw new OpenGeocodingError(400,'Axtarış 3–120 simvol olmalıdır.');}
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof(body as {q?:unknown}).q!=='string')throw new OpenGeocodingError(400,'Axtarış 3–120 simvol olmalıdır.');
 const values=body as Record<string,unknown>;
 if('lat'in values||'lng'in values)throw new OpenGeocodingError(400,'Ünvanı əl ilə yazın və xəritədə nöqtə seçin.');
 if(values.lang!==undefined&&typeof values.lang!=='string')throw new OpenGeocodingError(400,'Axtarış dilini düzgün seçin.');
 url.search='';url.searchParams.set('q',values.q as string);if(typeof values.lang==='string')url.searchParams.set('lang',values.lang);
 return url;
}
async function search(request:Request){
 try{
  const input=parseOpenPlaceSearch(await searchUrl(request));
  return reply({places:await searchOpenPlaces(input)});
 }catch(error){return reply({error:error instanceof OpenGeocodingError?error.message:'Ünvan axtarışı hazırda əlçatan deyil. Ünvanı əl ilə yazın və xəritədə nöqtə seçin.'},error instanceof OpenGeocodingError?error.status:503);}
}
const adminSearch=withAdminSession(async(request:Request)=>request.headers.get('x-birkassa-role')==='admin'?search(request):reply({error:'Bu əməliyyat üçün səlahiyyətiniz yoxdur.'},403));
async function authorizedSearch(request:Request){
 const url=new URL(request.url),origin=request.headers.get('origin'),ownOrigin=url.protocol+'//'+(request.headers.get('host')||url.host);
 // GET can incur a scarce upstream lookup. Prevent cross-site cookie requests
 // from consuming it; no caller-supplied identity header grants access.
 if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==ownOrigin))return reply({error:'Başqa saytdan göndərilən sorğu qəbul edilmir.'},403);
 if(request.method==='POST'&&Number(request.headers.get('content-length')||0)>3000)return reply({error:'Sorğu çox böyükdür'},413);
 try{
  if(await customerAccount())return search(request);
  if((request.headers.get('cookie')||'').split(';').some(part=>part.trim().startsWith('birkassa_session=')))return await adminSearch(request);
  return reply({error:'Ünvan seçmək üçün hesabınıza daxil olun.'},401);
 }catch{return reply({error:'Ünvan axtarışı hazırda əlçatan deyil. Ünvanı əl ilə yazın və xəritədə nöqtə seçin.'},503);}
}
export const GET=authorizedSearch;
// Preferred client transport: search text is not put in a web access-log URL.
export const POST=authorizedSearch;
// Next otherwise invokes GET automatically for HEAD, which must not consume an
// upstream request merely because a crawler/probe checks an address endpoint.
export function HEAD(){return new Response(null,{status:405,headers:{...headers,Allow:'GET, POST'}});}
