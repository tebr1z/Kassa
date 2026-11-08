import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,open,lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {domainToASCII} from 'node:url';
import {z} from 'zod';
import type postgres from 'postgres';

type Sql=ReturnType<typeof postgres>|postgres.TransactionSql;
export const smtpEmail=z.string().trim().max(254).email().refine(value=>/^[\x21-\x7e]+$/.test(value)&&!/[<>\r\n]/.test(value));
const singleLine=z.string().trim().max(120).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value));
const host=z.string().trim().max(253).transform(value=>domainToASCII(value.toLowerCase())).refine(value=>value.length>0&&value.includes('.')&&value.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&!/^\d+(?:\.\d+){3}$/.test(value));
export const smtpSaveSchema=z.object({action:z.literal('save'),revision:z.number().int().min(0).max(2147483646),enabled:z.boolean(),provider:z.enum(['gmail','custom']),host,port:z.union([z.literal(465),z.literal(587)]),security:z.enum(['tls','starttls']),username:z.string().trim().min(1).max(254).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value)),fromEmail:smtpEmail,fromName:singleLine,replyTo:z.union([z.literal(''),smtpEmail]),password:z.string().max(1024).refine(value=>!/[\r\n\0]/.test(value)).optional().default('')}).strict().superRefine((value,ctx)=>{
 if((value.port===465)!==(value.security==='tls'))ctx.addIssue({code:'custom',message:'port/TLS mismatch'});
 if(value.provider==='gmail'&&(value.host!=='smtp.gmail.com'||!smtpEmail.safeParse(value.username).success))ctx.addIssue({code:'custom',message:'Gmail configuration mismatch'});
});
export type SmtpRow={enabled:boolean;provider:'gmail'|'custom';host:string;port:465|587;security:'tls'|'starttls';username:string;from_email:string;from_name:string;reply_to:string;password_cipher:string|null;revision:number;last_test_at:Date|null;last_test_status:string|null;last_error_code:string|null};
export async function smtpRow(sql:Sql){const [row]=await sql.unsafe<SmtpRow[]>('select * from smtp_settings where id=1');if(!row)throw new Error('SMTP_CONFIG');return row;}
export function publicSmtpSettings(row:SmtpRow){return {enabled:row.enabled,provider:row.provider,host:row.host,port:row.port,security:row.security,username:row.username,fromEmail:row.from_email,fromName:row.from_name,replyTo:row.reply_to,passwordConfigured:!!row.password_cipher,revision:Number(row.revision)};}

// Separate from the database: a DB export alone cannot decrypt the password.
// Keep this private file when moving/restoring the application to another PC.
const keyPath=()=>path.join(process.env.BIRKASSA_DATA_DIR||process.cwd(),'.private','smtp-encryption.key');
async function encryptionKey(create=false){
 const target=keyPath(),directory=path.dirname(target);
 if(create){
  await mkdir(directory,{recursive:true,mode:0o700});
  if((await lstat(directory)).isSymbolicLink())throw new Error('SMTP_STORAGE');
  try{const file=await open(target,'wx',0o600);try{await file.writeFile(randomBytes(32).toString('hex'));}finally{await file.close();}}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 }
 const info=await lstat(target);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||process.platform!=='win32'&&(info.mode&0o077)!==0)throw new Error('SMTP_STORAGE');
 const key=await readFile(target,'utf8');if(!/^[a-f0-9]{64}$/.test(key))throw new Error('SMTP_STORAGE');return Buffer.from(key,'hex');
}
export async function encryptSmtpPassword(password:string){const key=await encryptionKey(true),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('restamarket.smtp.password.v1'));const encrypted=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');}
export async function decryptSmtpPassword(value:string){const [version,iv,tag,data,...extra]=value.split('.');if(version!=='v1'||extra.length||!iv||!tag||!data)throw new Error('SMTP_STORAGE');const decipher=createDecipheriv('aes-256-gcm',await encryptionKey(),Buffer.from(iv,'base64'));decipher.setAAD(Buffer.from('restamarket.smtp.password.v1'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');}
