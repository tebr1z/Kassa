import 'server-only';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import ipaddr from 'ipaddr.js';
import nodemailer from 'nodemailer';
import {storeDb} from '@/lib/store-db';
import {smtpRow,smtpEmail,decryptSmtpPassword,type SmtpRow} from '@/lib/smtp-config';

export class SmtpFailure extends Error {constructor(public code:string){super(code);}}
export function safeSmtpError(error:unknown){
 if(error instanceof SmtpFailure)return error.code;
 const code=String((error as {code?:unknown})?.code||'');
 if(['EAUTH','EENVELOPE','EMESSAGE','ETIMEDOUT','ESOCKET','ECONNECTION','EDNS','ECONNREFUSED','ECONNRESET'].includes(code))return code;
 if(/CERT|TLS|SSL/.test(code))return 'TLS';
 return 'SMTP_FAILED';
}
export function publicSmtpError(code:string){
 const errors:Record<string,string>={EAUTH:'SMTP giriş məlumatları qəbul edilmədi. İstifadəçi adı və tətbiq şifrəsini yoxlayın.',EENVELOPE:'Göndərən və ya alıcı ünvanı poçt serveri tərəfindən qəbul edilmədi.',TLS:'SMTP TLS sertifikatı yoxlanmadı. Server adını və portu yoxlayın.',SMTP_HOST:'Yalnız ictimai SMTP serveri seçə bilərsiniz.',SMTP_DNS:'SMTP serverinin ünvanı tapılmadı.',SMTP_CONFIG:'Əvvəlcə tam SMTP ayarlarını saxlayın.',SMTP_STORAGE:'SMTP şifrəsinin təhlükəsiz yaddaşı açılmadı. Serverin şəxsi açar faylını yoxlayın.'};
 return errors[code]||'SMTP bağlantısı və ya göndəriş alınmadı. Server, port və poçt xidmətinin məhdudiyyətlərini yoxlayın.';
}
export function publicSmtpAddress(address:string){
 try{if(!isIP(address))return false;const parsed=ipaddr.parse(address);return parsed.range()==='unicast'&&(parsed.kind()==='ipv4'||parsed.match(ipaddr.parseCIDR('2000::/3')));}catch{return false;}
}
export async function smtpTransport(row:SmtpRow){
 const valid=smtpEmail.safeParse(row.from_email);
 if(!valid.success||!row.password_cipher||!row.host||!row.username||![465,587].includes(row.port)||(row.port===465)!==(row.security==='tls'))throw new SmtpFailure('SMTP_CONFIG');
 let addresses;
 try{addresses=await Promise.race([lookup(row.host,{all:true,verbatim:true}),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new SmtpFailure('SMTP_DNS')),5000);timer.unref();})]);}catch{throw new SmtpFailure('SMTP_DNS');}
 // Validate EVERY answer, then connect directly to the checked IP. Keeping
 // the original name only for certificate validation prevents DNS rebinding.
 if(!addresses.length||addresses.some(item=>!publicSmtpAddress(item.address)))throw new SmtpFailure('SMTP_HOST');
 const address=addresses.find(item=>item.family===4)||addresses[0];
 let password;try{password=await decryptSmtpPassword(row.password_cipher);}catch{throw new SmtpFailure('SMTP_STORAGE');}
 return nodemailer.createTransport({host:address.address,port:row.port,secure:row.port===465,requireTLS:row.port===587,ignoreTLS:false,opportunisticTLS:false,auth:{user:row.username,pass:password},tls:{servername:row.host,rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:5000,logger:false,debug:false,transactionLog:false,disableFileAccess:true,disableUrlAccess:true,maxRecipients:1});
}
function message(row:SmtpRow,to:string,subject:string,text:string){return {from:{name:row.from_name,address:row.from_email},to:{address:to,name:''},...(row.reply_to?{replyTo:{address:row.reply_to,name:''}}:{}),subject,text,disableFileAccess:true,disableUrlAccess:true};}
export async function testSmtp(row:SmtpRow,to?:string){
 const transport=await smtpTransport(row);
 try{if(!to){await transport.verify();return;}const email=smtpEmail.safeParse(to);if(!email.success)throw new SmtpFailure('SMTP_CONFIG');const result=await transport.sendMail(message(row,email.data,'RestaMarket — SMTP sınağı','Bu, RestaMarket idarəetmə panelindən göndərilmiş SMTP sınaq məktubudur. Bu məktub sifariş deyil.'));if(!result.accepted?.length||result.rejected?.length)throw new SmtpFailure('EENVELOPE');}finally{transport.close();}
}
type CustomerEmail={eventKey:string;kind:'order_cancelled'|'support_reply';to:string;subject:string;text:string};
// Best effort, once per persisted event. No raw provider errors, passwords,
// message bodies or recipients are logged, and mail never reverses an order.
export async function notifyCustomerEmail(mail:CustomerEmail):Promise<void>{
 let sql:ReturnType<typeof storeDb>;try{sql=storeDb();}catch{return;}let claimed=false;
 try{
  if(!/^(?:order-cancelled|support-reply):[a-f0-9-]{36}$/.test(mail.eventKey)||!smtpEmail.safeParse(mail.to).success||mail.subject.length>200||/[\r\n]/.test(mail.subject)||mail.text.length>12000)return;
  const row=await smtpRow(sql);if(!row.enabled)return;
  const inserted=await sql.unsafe("insert into smtp_deliveries(event_key,kind,status) values($1,$2,'sending') on conflict(event_key) do nothing returning event_key",[mail.eventKey,mail.kind]);
  if(!inserted.length)return;claimed=true;
  const transport=await smtpTransport(row);
  try{const result=await transport.sendMail(message(row,mail.to,mail.subject,mail.text));if(!result.accepted?.length||result.rejected?.length)throw new SmtpFailure('EENVELOPE');}finally{transport.close();}
  await sql.unsafe("update smtp_deliveries set status='sent',updated_at=now() where event_key=$1",[mail.eventKey]);
 }catch(error){if(claimed)try{await sql.unsafe("update smtp_deliveries set status='failed',error_code=$2,updated_at=now() where event_key=$1",[mail.eventKey,safeSmtpError(error)]);}catch{/* Never leak errors or undo the business operation. */}}
 finally{await sql.end({timeout:2}).catch(()=>{});}
}
