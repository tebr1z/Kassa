import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10});
try{
 const source=await readFile('drizzle/0030_product_locations_finance.sql','utf8');
 const [before]=await sql.unsafe('select (select count(*)::int from products) products,(select count(*)::int from sales) sales,(select count(*)::int from stock_movements) stock_movements,(select count(*)::int from users) users');
 if(!process.argv.includes('--apply')){console.log('Additive migration ready; existing row counts:',JSON.stringify(before));}
 else{
  await sql.begin(async tx=>{
   for(const statement of source.split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean))await tx.unsafe(statement);
   await tx.unsafe('create table if not exists public.__drizzle_migrations(id serial primary key,hash text not null unique,created_at bigint not null)');
   await tx.unsafe('insert into public.__drizzle_migrations(hash,created_at) values($1,$2) on conflict(hash) do nothing',[createHash('sha256').update(source).digest('hex'),Date.now()]);
   const [after]=await tx.unsafe('select (select count(*)::int from products) products,(select count(*)::int from sales) sales,(select count(*)::int from stock_movements) stock_movements,(select count(*)::int from users) users');
   if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Unexpected row count change; transaction aborted.');
  });console.log('Applied additive operations schema. Existing products, sales, stock and users unchanged:',JSON.stringify(before));
 }
}finally{await sql.end({timeout:2});}
