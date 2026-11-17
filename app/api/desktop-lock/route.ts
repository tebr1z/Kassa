import {timingSafeEqual,createHash} from 'node:crypto';
import {hasCentralDesktopAccess,centralDesktopDenied} from '@/lib/central-access';
import {storeDb} from '@/lib/store-db';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!hasCentralDesktopAccess(request))return centralDesktopDenied();
 const expected=process.env.BIRKASSA_DESKTOP_TOKEN||'',key=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(process.env.BIRKASSA_LOCAL!=='1'||!expected||!/^[a-f0-9]{64}$/.test(key)||key.length!==expected.length||!timingSafeEqual(Buffer.from(key),Buffer.from(expected)))return Response.json({error:'Unauthorized'},{status:401});
 const sql=storeDb();try{if(process.env.BIRKASSA_CENTRAL==='1'){const token=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('birkassa_session='))?.slice('birkassa_session='.length);if(token)await sql.unsafe('delete from auth_sessions where token_hash=$1',[createHash('sha256').update(token).digest('hex')]);}else await sql.unsafe('delete from auth_sessions');return Response.json({ok:true});}finally{await sql.end();}
}
