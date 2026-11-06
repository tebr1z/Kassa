import 'dotenv/config';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import {findPostgres} from '../desktop/local-database.mjs';
import {protectData} from '../desktop/protect-data.mjs';

const root=process.env.BIRKASSA_DATA_DIR||path.join(process.env.APPDATA,'BirKassa','local-data');
const apply=process.argv.includes('--apply'),argument=process.argv.find(value=>value.startsWith('--url='));
let source;
function execute(file,args,env,capture=false){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,env,stdio:capture?['ignore','pipe','ignore']:'ignore'});let result='';if(capture)child.stdout.on('data',part=>result+=part);child.once('error',reject);child.once('exit',code=>code===0?resolve(result):reject(new Error('PostgreSQL ehtiyat aləti uğursuz oldu; veb məlumatları dəyişdirilmədi.')));});}
try{
 const raw=process.env.SOURCE_DATABASE_URL||process.env.DATABASE_URL;if(!raw)throw new Error('Veb DATABASE_URL yoxdur.');
 const url=new URL(raw);if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Veb mənbəsi lokal ola bilməz.');
 await mkdir(path.join(root,'backups'),{recursive:true});await protectData(root);
 const bin=await findPostgres(),stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup=path.join(root,'backups','web-original-'+stamp+'.dump');
 const password=decodeURIComponent(url.password);url.password='';
 await execute(path.join(bin,'pg_dump.exe'),['--dbname',url.toString(),'--format=custom','--no-owner','--no-acl','--file',backup],{...process.env,PGPASSWORD:password});
 const list=await execute(path.join(bin,'pg_restore.exe'),['--list',backup],process.env,true);
 if(!String(list).includes('TABLE DATA public stock_movements'))throw new Error('Ehtiyatda stok cədvəli tapılmadı.');
 source=postgres(raw,{max:1,prepare:false,connect_timeout:10});
 const [before]=await source.unsafe('select (select count(*) from products) products,(select count(*) from stock_movements) stock_movements,(select count(*) from sales_orders) orders');
 const report={backup,archiveVerified:true,before,applied:false};
 if(apply){
  if(!argument)throw new Error('--apply üçün --url=https://... tələb olunur.');
  const site=new URL(argument.slice('--url='.length));if(site.protocol!=='https:'||site.username||site.password||site.pathname!=='/')throw new Error('Canlı mağazanın HTTPS kök ünvanını yazın.');
  const response=await fetch(site.origin+'/api/catalog',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok||response.headers.get('x-birkassa-inventory')!=='local-only')throw new Error('Yeni stoksuz veb versiyası yayımlanmayıb. Köhnə stok silinmədi.');
  const [published]=await source.unsafe("select value from system_settings where key='catalog_only_protocol'");
  if(published?.value!=='2')throw new Error('Əvvəlcə masaüstü kataloqunun vebə uğurla yayımlandığını təsdiqləyin.');
  // Full original data is already in a verified local dump. This cutover only
  // removes inventory balances/counts/cost history; customer orders are retained.
  await source.begin(async tx=>{
   await tx.unsafe('lock table stock_movements,inventory_count_items,inventory_counts,product_price_history,products in access exclusive mode');
   await tx.unsafe('delete from inventory_count_items');await tx.unsafe('delete from inventory_counts');
   await tx.unsafe('delete from stock_movements');await tx.unsafe('delete from product_price_history');
   await tx.unsafe('update products set cost_price=0,min_stock=0');
   await tx.unsafe("delete from audit_logs where entity_type in ('stock','stock_movement','inventory_count','product','products','warehouse')");
   await tx.unsafe("insert into system_settings(key,value) values('inventory_removed_from_web_at',$1) on conflict(key) do update set value=excluded.value",[new Date().toISOString()]);
  });report.applied=true;
 }
 await writeFile(path.join(root,'backups','web-cutover-'+stamp+'.json'),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report));
 if(!apply)console.log('Yalnız tam lokal arxiv yaradıldı. Canlı veb bazası dəyişdirilmədi.');
}catch(error){console.error(error.code?'Keçid tamamlanmadı ('+error.code+').':error.message);process.exitCode=1;}
finally{await source?.end({timeout:2});}
