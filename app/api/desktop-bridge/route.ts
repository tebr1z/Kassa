import {storeDb} from "@/lib/store-db";
import {isDesktop} from "@/lib/desktop-sync";
import {desktopAuthorization,syncBatch,applyDesktopBatch} from "@/lib/desktop-bridge";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  if(isDesktop())return Response.json({error:'Not available'},{status:404});
  if(Number(request.headers.get('content-length'))>4*1024*1024)return Response.json({error:'Batch too large'},{status:413});
  const key=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  const sql=storeDb();
  try {
    const actor=await desktopAuthorization(sql,key,true);
    if(!actor)return Response.json({error:'Unauthorized'},{status:401});
    const parsed=syncBatch.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return Response.json({error:'Invalid batch'},{status:400});
    return Response.json(await applyDesktopBatch(sql,parsed.data,actor));
  }catch(error){return Response.json({error:error instanceof Error&&!('code' in error)?error.message:'Sinxronizasiya tamamlanmadı.'},{status:409});}
  finally{await sql.end();}
}
