import 'dotenv/config';
import postgres from 'postgres';
const changes=[
 ['users','password_hash','text'],
 ['auth_sessions','authentication_method',"text NOT NULL DEFAULT 'pin'"],
 ['auth_sessions','last_seen_at','timestamptz NOT NULL DEFAULT now()'],
 ['sales_orders','customer_name_snapshot','text'],
 ['sales_orders','customer_phone_snapshot','text'],
 ['sales_order_items','product_name_snapshot','text'],
];
const sql=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:8});
try{
 const columns=await sql.unsafe("select table_name,column_name from information_schema.columns where table_schema='public'");
 const missing=changes.filter(([table,column])=>!columns.some(row=>row.table_name===table&&row.column_name===column));
 console.log('Missing schema columns:',missing.map(([table,column])=>table+'.'+column).join(', ')||'none');
 if(process.argv.includes('--apply')){
  await sql.begin(async tx=>{for(const [table,column,type]of missing){if(!columns.some(row=>row.table_name===table))throw Error('Required table is missing: '+table);await tx.unsafe(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);}});
  console.log('Additive schema update complete. Existing users, passwords, products, orders and sales unchanged.');
 }
}finally{await sql.end({timeout:2});}
