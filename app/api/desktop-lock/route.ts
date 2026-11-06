import {timingSafeEqual} from 'node:crypto';
import {storeDb} from '@/lib/store-db';
export const runtime='nodejs';
export async function POST(request:Request){
 const expected=process.env.BIRKASSA_DESKTOP_TOKEN||'',key=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(process.env.BIRKASSA_LOCAL!=='1'||!expected||!/^[a-f0-9]{64}$/.test(key)||key.length!==expected.length||!timingSafeEqual(Buffer.from(key),Buffer.from(expected)))return Response.json({error:'Unauthorized'},{status:401});
 const sql=storeDb();try{await sql.unsafe('delete from auth_sessions');return Response.json({ok:true});}finally{await sql.end();}
}
