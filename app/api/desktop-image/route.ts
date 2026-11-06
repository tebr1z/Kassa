import {createHash} from 'node:crypto';
import {storeDb} from '@/lib/store-db';
import {desktopAuthorization} from '@/lib/desktop-bridge';
import {saveImage} from '@/lib/catalog-media';
export const runtime='nodejs';
export async function POST(request:Request){
 if(process.env.BIRKASSA_LOCAL==='1')return Response.json({error:'Not available'},{status:404});
 const sql=storeDb();try{
  if(!await desktopAuthorization(sql,request.headers.get('authorization')?.replace(/^Bearer /,'')||'',true))return Response.json({error:'Unauthorized'},{status:401});
  const hash=request.headers.get('x-image-hash')||'';if(!/^[a-f0-9]{64}$/.test(hash)||!request.body)return Response.json({error:'Invalid image'},{status:400});
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024)return Response.json({error:'Image too large'},{status:413});parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=Buffer.concat(parts);if(createHash('sha256').update(bytes).digest('hex')!==hash)return Response.json({error:'Hash mismatch'},{status:400});
  return Response.json(await saveImage(bytes));
 }catch{return Response.json({error:'Şəkil yayımlanmadı.'},{status:400});}finally{await sql.end();}
}
