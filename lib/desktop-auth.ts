import "server-only";
import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {createHash,randomBytes,scrypt as callback,timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import {storeDb} from "@/lib/store-db";
import {secureAuthCookie} from "@/lib/auth-cookie";
import {secureAdminRequest} from "@/lib/admin-security";
import {adminSetupToken} from "@/lib/admin-setup";
import {z} from 'zod';
import {isStaffRole,staffPermissions,staffRoleSqlList} from '@/lib/staff-access';
const scrypt=promisify(callback),cookieName='birkassa_session';
const isLocal=()=>process.env.BIRKASSA_LOCAL==='1';
async function derive(value:string,salt:string){return await scrypt(value,salt,64) as Buffer;}
async function hash(value:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(value,salt)).toString('hex');}
async function verify(value:string,stored:string|null){const [salt,key]=(stored||'dummy:'+ '00'.repeat(64)).split(':');const expected=Buffer.from(key||'','hex'),actual=await derive(value,salt||'dummy');return expected.length===actual.length&&timingSafeEqual(expected,actual);}
const user=(row:{id:string;full_name:string;role:string})=>({id:row.id,fullName:row.full_name,role:row.role,permissions:staffPermissions(row.role)});
function unsafeOrigin(request:Request){
 const url=new URL(request.url),origin=request.headers.get('origin');
 return request.headers.get('sec-fetch-site')==='cross-site'||Boolean(origin&&origin!==url.protocol+'//'+(request.headers.get('host')||url.host));
}
export async function desktopAuthGet(){
 const sql=storeDb();try{
  const token=(await cookies()).get(cookieName)?.value;
  if(token){const [row]=await sql.unsafe(`select u.id,u.full_name,u.role from auth_sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and s.last_seen_at>now()-interval '10 minutes' and s.authentication_method='password' and u.role in (${staffRoleSqlList}) and u.is_active=true and u.password_hash is not null`,[createHash('sha256').update(token).digest('hex')]);if(row&&isStaffRole(String(row.role)))return NextResponse.json({local:isLocal(),authenticated:true,strongAuth:true,user:user({id:String(row.id),full_name:String(row.full_name),role:String(row.role)})});}
  const rows=await sql.unsafe(`select id,full_name,role,pin_hash is not null has_pin,password_hash is not null has_password from users where role in (${staffRoleSqlList}) and (role='admin' or password_hash is not null) and is_active=true order by case when role='admin' then 0 else 1 end,created_at,id`);
  return NextResponse.json({local:isLocal(),webSetupTokenRequired:!isLocal(),authenticated:false,strongAuth:true,passwordSetupRequired:!rows.some(row=>row.has_password),users:rows.map(row=>({id:row.id,fullName:row.full_name,role:row.role,hasPin:row.has_pin,hasPassword:row.has_password}))});
 }finally{await sql.end();}
}
export async function desktopAuthPost(request:Request){
 if(!secureAdminRequest(request))return NextResponse.json({error:'Administrator girişi üçün HTTPS tələb olunur.'},{status:426});
 if(unsafeOrigin(request))return NextResponse.json({error:'Başqa saytdan göndərilən sorğu qəbul edilmir.'},{status:403});
 const parsed=z.object({userId:z.string().uuid(),password:z.string().min(1).max(128),action:z.enum(['login','setup-password']),pin:z.string().max(6).optional(),confirmPassword:z.string().max(128).optional(),setupToken:z.string().max(256).optional()}).safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Administrator və şifrəni düzgün daxil edin.'},{status:400});
 const body=parsed.data;
 const sql=storeDb();try{
  const [limit]=await sql.unsafe(`insert into staff_auth_attempts(user_id) select id from users where id=$1 and role in (${staffRoleSqlList}) and is_active=true on conflict(user_id) do update set attempts=case when staff_auth_attempts.window_start<now()-interval '15 minutes' then 1 else staff_auth_attempts.attempts+1 end,window_start=case when staff_auth_attempts.window_start<now()-interval '15 minutes' then now() else staff_auth_attempts.window_start end returning attempts`,[body.userId]);
  if(!limit)return NextResponse.json({error:'Administrator və ya şifrə yanlışdır.'},{status:401});
  if(limit.attempts>5)return NextResponse.json({error:'Çox sayda giriş cəhdi. 15 dəqiqə sonra yoxlayın.'},{status:429,headers:{'Retry-After':'900'}});
  const found=await sql.begin(async tx=>{
   const [admin]=await tx.unsafe(`select id,full_name,role,pin_hash,password_hash from users where id=$1 and role in (${staffRoleSqlList}) and is_active=true for update`,[body.userId]);
   if(!admin||!isStaffRole(String(admin.role)))throw new Error('Administrator və ya şifrə yanlışdır.');
   if(body.action==='setup-password'){
    if(admin.role!=='admin')throw new Error('İşçi şifrəsini administrator təyin edir.');
    if(admin.password_hash)throw new Error('Şifrə artıq qurulub.');
    if(!isLocal()){const expected=await adminSetupToken();const a=createHash('sha256').update(expected).digest(),b=createHash('sha256').update(body.setupToken||'').digest();if(expected.length<32||!timingSafeEqual(a,b))throw new Error('İlk veb quraşdırma açarı tələb olunur.');}
    if(admin.pin_hash&&!await verify(String(body.pin||''),admin.pin_hash))throw new Error('Cari administrator PIN-i yanlışdır.');
    if(body.password.length<12||!/[\p{L}]/u.test(body.password)||!/[0-9]/.test(body.password)||body.password!==body.confirmPassword)throw new Error('Ən azı 12 simvol, hərf və rəqəmdən ibarət şifrə yazın və eyni təkrarlayın.');
    await tx.unsafe('update users set password_hash=$1 where id=$2',[await hash(body.password),admin.id]);
    await tx.unsafe('delete from auth_sessions where user_id=$1',[admin.id]);
    await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id) values($1,'desktop.password_created','user',$1)",[admin.id]);
   }else if(!admin.password_hash||!await verify(body.password,admin.password_hash))throw new Error('Administrator və ya şifrə yanlışdır.');
   return admin;
  });
  await sql.unsafe('delete from staff_auth_attempts where user_id=$1',[found.id]);
  const token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+4*3600000);
  await sql.unsafe("insert into auth_sessions(user_id,token_hash,expires_at,authentication_method) values($1,$2,$3,'password')",[found.id,createHash('sha256').update(token).digest('hex'),expires]);
  const response=NextResponse.json({local:isLocal(),authenticated:true,strongAuth:true,user:user({id:String(found.id),full_name:String(found.full_name),role:String(found.role)})});
  response.cookies.set(cookieName,token,{httpOnly:true,sameSite:'strict',secure:secureAuthCookie(request),path:'/',expires});return response;
 }catch(error){return NextResponse.json({error:error instanceof Error&&!('code' in error)?error.message:'Giriş tamamlanmadı.'},{status:401});}finally{await sql.end();}
}
export async function desktopActivity(request:Request){
 if(!secureAdminRequest(request))return NextResponse.json({error:'İdarəetmə üçün HTTPS tələb olunur.'},{status:426});
 if(unsafeOrigin(request))return NextResponse.json({error:'Başqa saytdan göndərilən sorğu qəbul edilmir.'},{status:403});
 const token=(await cookies()).get(cookieName)?.value;if(!token)return NextResponse.json({error:'Daxil olun.'},{status:401});
 const sql=storeDb();try{const rows=await sql.unsafe(`update auth_sessions s set last_seen_at=now() from users u where s.user_id=u.id and u.role in (${staffRoleSqlList}) and u.is_active=true and u.password_hash is not null and s.token_hash=$1 and s.authentication_method='password' and s.expires_at>now() and s.last_seen_at>now()-interval '10 minutes' returning s.user_id`,[createHash('sha256').update(token).digest('hex')]);return NextResponse.json({ok:!!rows.length},{status:rows.length?200:401});}finally{await sql.end();}
}
