import 'server-only';
import {createHash} from 'node:crypto';
import {storeDb} from '@/lib/store-db';
import {secureAdminRequest} from '@/lib/admin-security';
import {canUseStaffApi,isStaffRole,staffRoleSqlList} from '@/lib/staff-access';

// Check again at the data boundary: protection does not depend on Proxy running,
// and identity headers supplied by a caller are never trusted.
export function withAdminSession(handler:(request:Request)=>Promise<Response>|Response) {
 return async function protectedHandler(request:Request):Promise<Response> {
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  const deny=(error:string,status:number)=>Response.json({error},{status,headers});
  if(!secureAdminRequest(request))return deny('İdarəetmə üçün HTTPS tələb olunur.',426);
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   const origin=request.headers.get('origin');
   const url=new URL(request.url),ownOrigin=url.protocol+'//'+(request.headers.get('host')||url.host);
   if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==ownOrigin))return deny('Başqa saytdan göndərilən sorğu qəbul edilmir.',403);
  }
  const cookie=request.headers.get('cookie')||'';
  const token=cookie.split(';').map(pair=>pair.trim()).find(pair=>pair.startsWith('birkassa_session='))?.slice('birkassa_session='.length);
  if(!token)return deny('Administrator şifrəsi ilə daxil olun.',401);
  const sql=storeDb();
  let admin;
  try{
   [admin]=await sql.unsafe(`select u.id,u.role from auth_sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and s.last_seen_at>now()-interval '10 minutes' and s.authentication_method='password' and u.role in (${staffRoleSqlList}) and u.is_active=true and u.password_hash is not null`,[createHash('sha256').update(token).digest('hex')]);
  }catch{return deny('Giriş yoxlanmadı. Yenidən cəhd edin.',503);}
  finally{await sql.end({timeout:2});}
  if(!admin||!isStaffRole(String(admin.role)))return deny('Sessiya bitib. Administrator şifrəsi ilə daxil olun.',401);
  if(!canUseStaffApi(String(admin.role),new URL(request.url).pathname,request.method))return deny('Bu əməliyyat üçün səlahiyyətiniz yoxdur.',403);
  // Keep Next's original request/body implementation (including multipart File
  // objects). Re-wrapping it in a native Request breaks File branding in Node.
  request.headers.set('x-birkassa-user-id',String(admin.id));
  request.headers.set('x-birkassa-role',String(admin.role));
  const response=await handler(request);
  for(const [name,value]of Object.entries(headers))response.headers.set(name,value);
  return response;
 };
}
