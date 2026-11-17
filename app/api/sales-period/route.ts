import {timingSafeEqual} from 'node:crypto';
import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {isLocalInventory} from '@/lib/inventory-mode';
import {previewSalesPeriod,resetSalesPeriod,salesResetFailure} from '@/lib/sales-period';
import {verifyCentralResetBackup} from '@/desktop/central-backups.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function nativeRequest(request:Request,secret:string){
 if(secret.length<32)return false;
 const actual=Buffer.from(request.headers.get('authorization')||''),expected=Buffer.from('Bearer '+secret);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function failure(error:unknown){
 const failure=salesResetFailure(error),status='statusCode'in failure?Number(failure.statusCode):503;
 return Response.json({error:failure.message,code:'errorCode'in failure?failure.errorCode:'RESET_POLICY_NOT_CONFIGURED',...('resetPolicy'in failure?{resetPolicy:failure.resetPolicy}:{})},{status});
}
async function get(request:Request){
 if(!isLocalInventory())return Response.json({error:'Not available'},{status:404});
 if(request.headers.get('x-birkassa-role')!=='admin')return Response.json({error:'Bu əməliyyat yalnız baş rəhbər üçündür.'},{status:403});
 const sql=storeDb();try{return Response.json(await sql.begin(async tx=>{await tx.unsafe('set transaction isolation level repeatable read read only');return previewSalesPeriod(tx,process.env.BIRKASSA_DESKTOP_TOKEN||'',request.headers.get('x-birkassa-user-id')||'');}));}catch(error){return failure(error);}finally{await sql.end({timeout:2});}
}
async function post(request:Request){
 if(!isLocalInventory())return Response.json({error:'Not available'},{status:404});
 const secret=process.env.BIRKASSA_DESKTOP_TOKEN||'';
 if(request.headers.get('x-birkassa-role')!=='admin'||!nativeRequest(request,secret))return Response.json({error:'Yoxlanılmış ehtiyat nüsxə üçün RestaMarket masaüstü menyusundan istifadə edin.'},{status:403});
 // The renderer cannot attest a backup: only Electron's isolated native process
 // has this bearer and sends metadata after creating and verifying the archive.
 const sql=storeDb();try{const body:unknown=await request.json().catch(()=>null);try{await verifyCentralResetBackup(body&&typeof body==='object'&&'backup'in body?body.backup:undefined);}catch{throw Object.assign(new Error('Yeni, yoxlanmış mərkəzi ehtiyat nüsxə yaradın.'),{statusCode:409,errorCode:'CENTRAL_BACKUP_REQUIRED'});}return Response.json(await resetSalesPeriod(sql,request.headers.get('x-birkassa-user-id')||'',body,secret));}catch(error){return failure(error);}finally{await sql.end({timeout:2});}
}
export const GET=withAdminSession(get);
export const POST=withAdminSession(post);
