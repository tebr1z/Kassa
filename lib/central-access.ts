import 'server-only';
import {timingSafeEqual} from 'node:crypto';
export function hasCentralDesktopAccess(request:Request){
 if(process.env.BIRKASSA_CENTRAL!=='1')return true;
 const key=process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN||'',actual=request.headers.get('x-restamarket-desktop-access')||'';
 if(!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9]{64}$/.test(actual))return false;
 return timingSafeEqual(Buffer.from(actual),Buffer.from(key));
}
export function centralDesktopDenied(){return Response.json({error:'Bu bölmə yalnız icazəli RestaMarket proqramı üçündür.',code:'DESKTOP_DEVICE_REQUIRED'},{status:403,headers:{'Cache-Control':'private, no-store'}});}
