import 'server-only';
import {createHash} from 'node:crypto';
import {storeDb} from '@/lib/store-db';
import {isAzerbaijanCoordinate} from '@/lib/azerbaijan-location';

// Public-service requirements: https://operations.osmfoundation.org/policies/nominatim/
// Only deliberate public street/place searches belong here, never autocomplete,
// reverse GPS lookups, customer identities, apartment details or order payloads.
export type OpenPlace={label:string;lat:number;lng:number};
export type OpenPlaceSearch={query:string;language:'az'|'ru'|'en'|'tr'|'zh'};
export class OpenGeocodingError extends Error {
 constructor(public status:number,message:string){super(message);this.name='OpenGeocodingError';}
}
const unavailable='Ünvan axtarışı hazırda əlçatan deyil. Ünvanı əl ilə yazın və xəritədə nöqtə seçin.';
const busy='Ünvan axtarışı məşğuldur. Bir az sonra yenidən cəhd edin.';
const languages=['az','ru','en','tr','zh'] as const;
const languageHeaders={az:'az,en;q=0.7',ru:'ru,az;q=0.8,en;q=0.5',en:'en,az;q=0.7',tr:'tr,az;q=0.8,en;q=0.5',zh:'zh,az;q=0.8,en;q=0.5'};
const maxBodyBytes=65_536;

export function parseOpenPlaceSearch(url:URL):OpenPlaceSearch {
 const params=url.searchParams;
 // Reject missing/empty coordinates instead of turning Number(null) into zero.
 // Exact customer coordinates must not be sent to the public geocoder at all.
 if(params.has('lat')||params.has('lng'))throw new OpenGeocodingError(400,'Ünvanı əl ilə yazın və xəritədə nöqtə seçin.');
 const query=(params.get('q')||'').normalize('NFC').trim().replace(/\s+/gu,' ');
 if(params.getAll('q').length!==1||query.length<3||query.length>120||/[\u0000-\u001f\u007f]/u.test(params.get('q')||''))throw new OpenGeocodingError(400,'Axtarış 3–120 simvol olmalıdır.');
 const language=params.get('lang')||'az';
 if(params.getAll('lang').length>1||!languages.includes(language as OpenPlaceSearch['language']))throw new OpenGeocodingError(400,'Axtarış dilini düzgün seçin.');
 return {query,language:language as OpenPlaceSearch['language']};
}

function providerBase(){
 if(process.env.OPEN_GEOCODING_ENABLED==='0')throw new OpenGeocodingError(503,unavailable);
 // A server-controlled setting permits replacing/disabling the public service
 // without a client deployment; request parameters never control the upstream.
 const url=new URL(process.env.OPEN_GEOCODING_URL||'https://nominatim.openstreetmap.org/');
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new OpenGeocodingError(503,unavailable);
 // Independent desktop databases cannot coordinate one application-wide
 // public-service limit. They must use a dedicated/shared provider instead.
 if(process.env.BIRKASSA_LOCAL==='1'&&(url.hostname==='nominatim.openstreetmap.org'||url.hostname.endsWith('.nominatim.openstreetmap.org')))throw new OpenGeocodingError(503,unavailable);
 return url.href.replace(/\/+$/u,'')+'/';
}
function readPlace(value:unknown,requireCountry:boolean):OpenPlace|null {
 if(!value||typeof value!=='object')return null;
 const row=value as Record<string,unknown>;
 if(requireCountry){
  const address=row.address as {country_code?:unknown}|undefined;
  if(typeof address?.country_code!=='string'||address.country_code.toLowerCase()!=='az')return null;
 }
 const label=requireCountry?row.display_name:row.label;
 const rawLat=row.lat,rawLng=requireCountry?row.lon:row.lng;
 if(typeof label!=='string'||!label.trim()||label.length>500||/[\u0000-\u001f\u007f]/u.test(label))return null;
 const coordinate=(part:unknown)=>typeof part==='number'?part:typeof part==='string'&&/^-?\d{1,3}(?:\.\d+)?$/u.test(part)?Number(part):NaN;
 const lat=coordinate(rawLat),lng=coordinate(rawLng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||!isAzerbaijanCoordinate(lat,lng))return null;
 return {label:label.trim(),lat,lng};
}
function cachedPlaces(value:unknown):OpenPlace[]|null {
 if(!Array.isArray(value)||value.length>5)return null;
 const places=value.map(row=>readPlace(row,false));
 return places.every((place):place is OpenPlace=>place!==null)?places:null;
}
async function providerJson(response:Response):Promise<unknown> {
 if(!response.ok||!response.body||Number(response.headers.get('content-length')||0)>maxBodyBytes)throw new OpenGeocodingError(503,unavailable);
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{
  while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>maxBodyBytes)throw new OpenGeocodingError(503,unavailable);text+=decoder.decode(chunk.value,{stream:true});}
  text+=decoder.decode();return JSON.parse(text);
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function searchOpenPlaces(input:OpenPlaceSearch):Promise<OpenPlace[]> {
 const base=providerBase();
 const key=createHash('sha256').update(JSON.stringify(['v1',base,input.language,input.query.toLowerCase()])).digest('hex');
 const sql=storeDb();
 let connection:Awaited<ReturnType<typeof sql.reserve>>|null=null,locked=false,slotReserved=false;
 try{
  const [cached]=await sql.unsafe('select response from open_geocoding_cache where cache_key=$1 and expires_at>now()',[key]);
  const saved=cached&&cachedPlaces(cached.response);if(saved)return saved;
  connection=await sql.reserve();
  const [lock]=await connection.unsafe('select pg_try_advisory_lock(672033) as locked');
  if(!lock?.locked)throw new OpenGeocodingError(429,busy);
  locked=true;
  // Another worker may have filled this entry between our first read and lock.
  const [latest]=await connection.unsafe('select response from open_geocoding_cache where cache_key=$1 and expires_at>now()',[key]);
  const latestSaved=latest&&cachedPlaces(latest.response);if(latestSaved)return latestSaved;
  await connection.unsafe("insert into open_geocoding_rate(id,next_request_at) values(1,'epoch') on conflict(id) do nothing");
  // Each reserved-connection statement is its own committed transaction. Do
  // not call .begin() here: postgres 3.4.7's reserved client lacks it at runtime.
  const rows=await connection.unsafe("update open_geocoding_rate set next_request_at=clock_timestamp()+interval '1100 milliseconds' where id=1 and next_request_at<=clock_timestamp() returning id");
  slotReserved=rows.length===1;
  if(!slotReserved)throw new OpenGeocodingError(429,busy);
  // The reservation above commits BEFORE fetch. Even an upstream timeout,
  // malformed response or cache-write rollback cannot undo the global limit.
  const url=new URL('search',base);
  url.search=new URLSearchParams({format:'jsonv2',limit:'5',countrycodes:'az',addressdetails:'1','accept-language':languageHeaders[input.language],q:input.query}).toString();
  const response=await fetch(url,{headers:{'User-Agent':'RestaMarket/1.0 (https://restamarket.az/; contact: https://restamarket.az/#contact)','Accept':'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  const body=await providerJson(response);
  if(!Array.isArray(body))throw new OpenGeocodingError(503,unavailable);
  // countrycodes is an upstream hard filter; independently verify the returned
  // country code as well. The shared rectangle alone is not country proof.
  const places=body.slice(0,5).map(row=>readPlace(row,true)).filter((place):place is OpenPlace=>place!==null);
  await connection.unsafe('begin');
  try{
   await connection.unsafe("set local statement_timeout='3000ms'");
   await connection.unsafe('delete from open_geocoding_cache where expires_at<=now()');
   await connection.unsafe("insert into open_geocoding_cache(cache_key,response,expires_at) values($1,$2::jsonb,clock_timestamp()+$3*interval '1 second') on conflict(cache_key) do update set response=excluded.response,expires_at=excluded.expires_at,created_at=clock_timestamp()",[key,JSON.stringify(places),places.length?86_400:300]);
   await connection.unsafe('delete from open_geocoding_cache where cache_key in (select cache_key from open_geocoding_cache order by created_at desc,cache_key desc offset 1000)');
   await connection.unsafe('commit');
  }catch(error){await connection.unsafe('rollback').catch(()=>{});throw error;}
  return places;
 }catch(error){
  if(error instanceof OpenGeocodingError)throw error;
  // Do not log queries, returned addresses, tokens, coordinates or provider URLs.
  throw new OpenGeocodingError(503,unavailable);
 }finally{
  if(connection){
   try{
    // The session lock serializes upstream requests across all workers. Leave
    // at least 1.1s after completion too: pauses between reservation and fetch
    // cannot bunch two request starts together. The earlier committed slot is
    // retained even if this final update fails or a provider call throws.
    if(locked&&slotReserved)await connection.unsafe("update open_geocoding_rate set next_request_at=greatest(next_request_at,clock_timestamp()+interval '1100 milliseconds') where id=1");
   }finally{
    try{if(locked)await connection.unsafe('select pg_advisory_unlock(672033)');}
    finally{connection.release();await sql.end({timeout:2});}
   }
  }else await sql.end({timeout:2});
 }
}
