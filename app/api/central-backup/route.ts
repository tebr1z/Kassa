import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {timingSafeEqual} from 'node:crypto';
import {withAdminSession} from '@/lib/require-admin';
import {createCentralBackup} from '@/desktop/central-backups.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function get(request:Request){
 const expected=process.env.BIRKASSA_DESKTOP_TOKEN||'',actual=request.headers.get('authorization')||'';
 const native=Buffer.from(actual),trusted=Buffer.from('Bearer '+expected);
 if(process.env.BIRKASSA_CENTRAL!=='1'||expected.length!==64||native.length!==trusted.length||!timingSafeEqual(native,trusted)||request.headers.get('x-birkassa-role')!=='admin')return Response.json({error:'Not available'},{status:403});
 const params=new URL(request.url).searchParams;
 if([...params.keys()].join(',')!=='fileName')return Response.json({error:'Ehtiyat faylının adı uyğun deyil.'},{status:400});
 try{
  const backup=await createCentralBackup({dataRoot:process.env.BIRKASSA_DATA_DIR||'',backupUrl:process.env.BIRKASSA_BACKUP_DATABASE_URL||'',bin:process.env.BIRKASSA_PG_BIN||'',fileName:params.get('fileName')});
  return new Response(Readable.toWeb(createReadStream(backup.file)) as ReadableStream,{headers:{'Content-Type':'application/x-birkassa-backup','Content-Length':String(backup.bytes),'X-RestaMarket-Backup-Name':backup.fileName,'X-RestaMarket-Backup-Bytes':String(backup.bytes),'X-RestaMarket-Backup-Sha256':backup.sha256,'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Mərkəzi ehtiyat tam yoxlanmadı. Bir qədər sonra yenidən cəhd edin.'},{status:503});}
}
export const GET=withAdminSession(get);
