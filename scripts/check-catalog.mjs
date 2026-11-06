import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
const source=await readFile('lib/public-catalog.ts','utf8');
const match=source.match(/const productSql=("[^\n]+");/);
if(!match)throw Error('Catalogue SQL was not found');
const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:8});
try{const products=await sql.unsafe(JSON.parse(match[1]));console.log('Catalogue query verified; available products:',products.length);}finally{await sql.end({timeout:2});}
