import 'server-only';
import {isAzerbaijanCoordinate} from './azerbaijan-location';

// Self-hosted OSRM only: coordinates never go to a public demonstration server.
function routingOrigin(){
 const raw=process.env.OPEN_ROUTING_URL||'';
 try{const url=new URL(raw);return url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'?url.origin:null;}catch{return null;}
}
export function openRoutingConfigured(){return Boolean(routingOrigin());}
export async function roadDistance(origin:{lat:number;lng:number},destination:{lat:number;lng:number}){
 const base=routingOrigin();if(!base)throw new Error('Routing is not configured');
 if(![origin,destination].every(pin=>isAzerbaijanCoordinate(pin.lat,pin.lng)))throw new Error('Outside routing coverage');
 const pair=(pin:{lat:number;lng:number})=>`${pin.lng.toFixed(6)},${pin.lat.toFixed(6)}`;
 const response=await fetch(`${base}/route/v1/driving/${pair(origin)};${pair(destination)}?overview=false&steps=false&alternatives=false&radiuses=1000;1000&generate_hints=false`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Routing unavailable');
 const data=await response.json() as {code?:string;routes?:{distance?:number}[];waypoints?:{distance?:number}[]};
 const distance=data.routes?.[0]?.distance;
 if(data.code!=='Ok'||typeof distance!=='number'||!Number.isFinite(distance)||distance<=0||distance>2_000_000||data.waypoints?.length!==2||data.waypoints.some(point=>typeof point.distance!=='number'||!Number.isFinite(point.distance)||point.distance<0||point.distance>1000))throw new Error('No suitable driving route');
 return Math.ceil(distance);
}
