import {timingSafeEqual} from 'node:crypto';
import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {isLocalInventory} from '@/lib/inventory-mode';
import {previewSalesPeriod,resetSalesPeriod} from '@/lib/sales-period';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function nativeRequest(request:Request,secret:string){
 if(secret.length<32)return false;
 const actual=Buffer.from(request.headers.get('authorization')||''),expected=Buffer.from('Bearer '+secret);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function failure(error:unknown){
 const status=error instanceof Error&&'statusCode'in error?Number(error.statusCode):503;
 return Response.json({error:error instanceof Error&&!('code'in error)?error.message:'Satış dövrü yenilənmədi. Məlumatlar dəyişdirilmədi.'},{status});
}
async function get(request:Request){
 if(!isLocalInventory())return Response.json({error:'Not available'},{status:404});
 if(request.headers.get('x-birkassa-role')!=='admin')return Response.json({error:'Bu əməliyyat yalnız baş rəhbər üçündür.'},{status:403});
 const sql=storeDb();try{return Response.json(await sql.begin(async tx=>{await tx.unsafe('set transaction isolation level repeatable read read only');return previewSalesPeriod(tx,process.env.BIRKASSA_DESKTOP_TOKEN||'');}));}catch(error){return failure(error);}finally{await sql.end({timeout:2});}
}
async function post(request:Request){
 if(!isLocalInventory())return Response.json({error:'Not available'},{status:404});
 const secret=process.env.BIRKASSA_DESKTOP_TOKEN||'';
 if(request.headers.get('x-birkassa-role')!=='admin'||!nativeRequest(request,secret))return Response.json({error:'Yoxlanılmış ehtiyat nüsxə üçün RestaMarket masaüstü menyusundan istifadə edin.'},{status:403});
 // The renderer cannot attest a backup: only Electron's isolated native process
 // has this bearer and sends metadata after creating and verifying the archive.
 const sql=storeDb();try{return Response.json(await resetSalesPeriod(sql,request.headers.get('x-birkassa-user-id')||'',await request.json().catch(()=>null),secret));}catch(error){return failure(error);}finally{await sql.end({timeout:2});}
}
export const GET=withAdminSession(get);
export const POST=withAdminSession(post);
