import 'dotenv/config';
import postgres from 'postgres';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {findPostgres} from '../desktop/local-database.mjs';
const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:8});
try{
 const [row]=await sql.unsafe("select to_regclass('public.product_options') as options");
 console.log('Product options schema exists:',Boolean(row.options));
 if(process.argv.includes('--schema-only')){
  const source=await readFile('drizzle/0026_product_options_invoice.sql','utf8');
  await sql.begin(async tx=>{for(const statement of source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await tx.unsafe(statement);await tx.unsafe('insert into public.__drizzle_migrations(hash,created_at) values($1,$2) on conflict(hash) do nothing',[createHash('sha256').update(source).digest('hex'),Date.now()]);});
  console.log('Additive schema migration applied transactionally; no database records were copied or deleted.');
 }
 if(process.argv.includes('--apply')){
  const url=new URL(process.env.DATABASE_URL),bin=await findPostgres(),backup=path.resolve('.private','before-product-options-'+Date.now()+'.dump');await mkdir(path.dirname(backup),{recursive:true});
  await new Promise((resolve,reject)=>{const child=spawn(path.join(bin,'pg_dump.exe'),['-Fc','-f',backup],{windowsHide:true,stdio:'ignore',env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Backup failed; migration was not applied.')));});
  const source=await readFile('drizzle/0026_product_options_invoice.sql','utf8');
  await sql.begin(async tx=>{for(const statement of source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await tx.unsafe(statement);await tx.unsafe('insert into public.__drizzle_migrations(hash,created_at) values($1,$2) on conflict(hash) do nothing',[createHash('sha256').update(source).digest('hex'),Date.now()]);});
  console.log('Backup saved locally; additive product options migration applied.');
 }
}finally{await sql.end({timeout:2});}
