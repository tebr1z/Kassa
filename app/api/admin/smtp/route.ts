import {z} from 'zod';
import {withAdminSession} from '@/lib/require-admin';
import {storeDb} from '@/lib/store-db';
import {smtpRow,smtpSaveSchema,smtpEmail,publicSmtpSettings,encryptSmtpPassword} from '@/lib/smtp-config';
import {testSmtp,safeSmtpError,publicSmtpError} from '@/lib/smtp-mail';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const reply=(error:string,status:number)=>Response.json({error},{status,headers:status===429?{'Retry-After':'30'}:{}});
const isAdmin=(request:Request)=>request.headers.get('x-birkassa-role')==='admin';
async function get(request:Request){
 if(!isAdmin(request))return reply('Bu əməliyyat üçün səlahiyyətiniz yoxdur.',403);
 const sql=storeDb();try{
  const row=await smtpRow(sql),[counts]=await sql.unsafe("select count(*)::int failed from smtp_deliveries where status='failed' or (status='sending' and updated_at<now()-interval '2 minutes')");
  return Response.json({settings:publicSmtpSettings(row),status:{lastTestAt:row.last_test_at,lastTestStatus:row.last_test_status,errorCode:row.last_error_code},delivery:{failed:Number(counts?.failed||0)}});
 }catch{return reply('SMTP ayarları yüklənmədi.',503);}finally{await sql.end({timeout:2});}
}
async function body(request:Request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return null;
 if(Number(request.headers.get('content-length')||0)>8000)throw new Error('BODY_LIMIT');
 const reader=request.body?.getReader();if(!reader)return null;
 let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>8000)throw new Error('BODY_LIMIT');text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 try{return JSON.parse(text) as unknown;}catch{return null;}
}
const testSchema=z.discriminatedUnion('action',[z.object({action:z.literal('verify')}).strict(),z.object({action:z.literal('test'),to:smtpEmail}).strict()]);
async function post(request:Request){
 if(!isAdmin(request))return reply('Bu əməliyyat üçün səlahiyyətiniz yoxdur.',403);
 let input:unknown;try{input=await body(request);}catch{return reply('Sorğu çox böyükdür.',413);}
 const save=smtpSaveSchema.safeParse(input),test=testSchema.safeParse(input);
 if(!save.success&&!test.success)return reply('SMTP ayarlarını və e-poçt ünvanını düzgün doldurun.',400);
 const sql=storeDb();try{
  if(save.success){
   const b=save.data;
   const result=await sql.begin(async tx=>{
    const [locked]=await tx.unsafe('select * from smtp_settings where id=1 for update');
    if(!locked||Number(locked.revision)!==b.revision)return 'conflict';
    const changed=locked.host!==b.host||locked.username!==b.username||locked.port!==b.port||locked.security!==b.security||locked.provider!==b.provider;
    if(!b.password&&(!locked.password_cipher||changed))return 'password';
    const password=b.password?await encryptSmtpPassword(b.password):locked.password_cipher;
    await tx.unsafe('update smtp_settings set enabled=$1,provider=$2,host=$3,port=$4,security=$5,username=$6,from_email=$7,from_name=$8,reply_to=$9,password_cipher=$10,revision=revision+1,last_test_at=null,last_test_status=null,last_error_code=null,updated_at=now() where id=1',[b.enabled,b.provider,b.host,b.port,b.security,b.username,b.fromEmail,b.fromName,b.replyTo,password]);
    await tx.unsafe("insert into audit_logs(user_id,action,entity_type,after_json) values($1,'smtp.settings_updated','smtp_settings',$2)",[request.headers.get('x-birkassa-user-id'),JSON.stringify({enabled:b.enabled,provider:b.provider,passwordChanged:!!b.password})]);
    return 'saved';
   });
   if(result==='conflict')return reply('SMTP ayarları başqa pəncərədə dəyişdirilib. Səhifəni yeniləyin.',409);
   if(result==='password')return reply('Yeni SMTP hesabı və ya bağlantısı üçün şifrəni yenidən daxil edin.',400);
   return Response.json({ok:true,message:'SMTP ayarları saxlanıldı.'});
  }
  if(!test.success)return reply('SMTP əməliyyatını düzgün seçin.',400);
  const row=await smtpRow(sql);
  if(!row.password_cipher)return reply(publicSmtpError('SMTP_CONFIG'),400);
  // A committed, shared DB slot also coordinates separate Next workers.
  const reserved=await sql.unsafe("update smtp_test_rate set next_test_at=now()+interval '30 seconds' where id=1 and next_test_at<=now() returning id");
  if(!reserved.length)return reply('SMTP sınaqları arasında 30 saniyə gözləyin.',429);
  try{
   await testSmtp(row,test.data.action==='test'?test.data.to:undefined);
   await sql.unsafe('update smtp_settings set last_test_at=now(),last_test_status=$1,last_error_code=null where id=1 and revision=$2',[test.data.action==='test'?'sent':'verified',Number(row.revision)]);
   await sql.unsafe("insert into audit_logs(user_id,action,entity_type,after_json) values($1,'smtp.test_succeeded','smtp_settings',$2)",[request.headers.get('x-birkassa-user-id'),JSON.stringify({kind:test.data.action})]);
   return Response.json({ok:true,message:test.data.action==='test'?'SMTP serveri məktubu qəbul etdi. Gələnlər və spam qovluğunu yoxlayın.':'SMTP bağlantısı və giriş məlumatları yoxlanıldı. Bu sınaq məktub göndərmir.'});
  }catch(error){
   const code=safeSmtpError(error);
   await sql.unsafe("update smtp_settings set last_test_at=now(),last_test_status='failed',last_error_code=$1 where id=1 and revision=$2",[code,Number(row.revision)]);
   return reply(publicSmtpError(code),502);
  }
 }catch{return reply('SMTP əməliyyatı tamamlanmadı. Ayarları yeniləyib yenidən yoxlayın.',503);}finally{await sql.end({timeout:2});}
}
export const GET=withAdminSession(get);
export const POST=withAdminSession(post);
export function HEAD(){return new Response(null,{status:405,headers:{Allow:'GET, POST','Cache-Control':'private, no-store'}});}
