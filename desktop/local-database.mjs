import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,access,readdir,rename,unlink,rm,cp} from 'node:fs/promises';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import postgres from 'postgres';
import {writeArchive,readArchive} from './backup-archive.mjs';
import {protectData} from './protect-data.mjs';
function execute(command,args,options){return new Promise((resolve,reject)=>{const child=spawn(command,args,{...options,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${path.basename(command)} çıxış kodu: ${code}. PostgreSQL jurnalını yoxlayın.`)));});}
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
export async function findPostgres(major=''){
 if(process.env.BIRKASSA_PG_BIN)return process.env.BIRKASSA_PG_BIN;
 const bundled=process.env.BIRKASSA_BUNDLED_PG_BIN||(process.resourcesPath?path.join(process.resourcesPath,'postgres','bin'):'');
 if(bundled&&await exists(path.join(bundled,'pg_ctl.exe'))){const version=await readFile(path.join(bundled,'..','PG_MAJOR'),'utf8').catch(()=>'');if(!major||version.trim()===major)return bundled;}
 if(process.env.BIRKASSA_REQUIRE_BUNDLED_PG==='1')throw new Error('Paketdə uyğun PostgreSQL tapılmadı.');
 const root=path.join(process.env.ProgramFiles||'C:\\Program Files','PostgreSQL');
 for(const version of (await readdir(root).catch(()=>[])).sort((a,b)=>Number(b)-Number(a))){if(major&&version!==major)continue;const bin=path.join(root,version,'bin');if(await exists(path.join(bin,'pg_ctl.exe')))return bin;}
 throw new Error('PostgreSQL tapılmadı. PostgreSQL 17+ quraşdırın və ya BIRKASSA_PG_BIN yolunu göstərin.');
}
export async function openLocalDatabase(dataRoot,projectRoot,{port=55432}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Yanlış PostgreSQL portu.');
 await mkdir(dataRoot,{recursive:true});const cluster=path.join(dataRoot,'postgres'),configFile=path.join(dataRoot,'database.json');
 await protectData(dataRoot);
 const major=(await readFile(path.join(cluster,'PG_VERSION'),'utf8').catch(()=>'')).trim(),bin=await findPostgres(major);
 let config;try{config=JSON.parse(await readFile(configFile,'utf8'));}catch(error){if(await exists(configFile))throw error;config={password:randomBytes(32).toString('hex'),port};await writeFile(configFile,JSON.stringify(config),{mode:0o600,flag:'wx'});}
 const databaseName=config.database||'birkassa';if(!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName))throw new Error('Yanlış lokal baza adı.');
 const baseUrl=`postgres://birkassa:${config.password}@127.0.0.1:${config.port}/`,url=baseUrl+databaseName;
 const pg=(command,args=[],extra={})=>execute(path.join(bin,command+'.exe'),args,{windowsHide:true,maxBuffer:4*1024*1024,...extra});
 if(!await exists(path.join(cluster,'PG_VERSION'))){const passwordFile=path.join(dataRoot,'init-password');await writeFile(passwordFile,config.password,{mode:0o600});try{await pg('initdb',['-D',cluster,'-U','birkassa','--pwfile',passwordFile,'--auth=scram-sha-256','--encoding=UTF8','--no-locale']);}finally{await writeFile(passwordFile,'');}}
 let owned=false;
 try{await pg('pg_ctl',['-D',cluster,'status']);}catch{await pg('pg_ctl',['-D',cluster,'-l',path.join(dataRoot,'postgres.log'),'-o',`-h 127.0.0.1 -p ${config.port}`,'-w','start']);owned=true;}
 try{
 const admin=postgres(baseUrl+'postgres',{max:1,prepare:false,connect_timeout:5});try{const rows=await admin.unsafe('select 1 from pg_database where datname=$1',[databaseName]);if(!rows.length)await admin.unsafe('create database "'+databaseName+'"');}finally{await admin.end({timeout:2});}
 const sql=postgres(url,{max:1,prepare:false,connect_timeout:5});try{
  await sql.unsafe('create table if not exists public.__drizzle_migrations(id serial primary key,hash text not null unique,created_at bigint not null)');
  for(const file of (await readdir(path.join(projectRoot,'drizzle'))).filter(f=>f.endsWith('.sql')).sort()){
   const source=await readFile(path.join(projectRoot,'drizzle',file),'utf8'),hash=createHash('sha256').update(source).digest('hex');
   if((await sql.unsafe('select 1 from public.__drizzle_migrations where hash=$1',[hash])).length)continue;
   await sql.begin(async tx=>{for(const statement of source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await tx.unsafe(statement);await tx.unsafe('insert into public.__drizzle_migrations(hash,created_at) values($1,$2)',[hash,Date.now()]);});
  }
  await sql.begin(async tx=>{const [count]=await tx.unsafe('select count(*) n from users');if(Number(count.n))return;const [branch]=await tx.unsafe("insert into branches(name) values('Əsas mağaza') returning id");const [warehouse]=await tx.unsafe("insert into warehouses(branch_id,name,code) values($1,'Əsas anbar','ESAS') returning id",[branch.id]);await tx.unsafe("insert into users(branch_id,full_name,role) values($1,'Administrator','admin')",[branch.id]);await tx.unsafe("insert into system_settings(key,value) values('sales_warehouse_id',$1)",[warehouse.id]);await tx.unsafe("insert into cash_registers(branch_id,name,code) values($1,'Kassa 1','KASSA-1')",[branch.id]);});
 }finally{await sql.end();}
 const environment={...process.env,PGPASSWORD:config.password};
 const backup=async destination=>{await mkdir(path.dirname(destination),{recursive:true});await pg('pg_dump',['-h','127.0.0.1','-p',String(config.port),'-U','birkassa','-d',databaseName,'-Fc','-f',destination],{env:environment});};
 const backupData=async destination=>{
  if(!destination.endsWith('.birkassa'))return backup(destination);
  const temporary=path.join(dataRoot,'backups','archive-'+randomUUID()+'.dump');
  try{await backup(temporary);await writeArchive(destination,temporary,path.join(dataRoot,'media'));}finally{await unlink(temporary).catch(()=>{});}
 };
 return {url,dataRoot,backup,backupData,async restoreData(source){
  await backupData(path.join(dataRoot,'backups','before-restore-'+new Date().toISOString().replace(/[:.]/g,'-')+'.birkassa'));
  const current=postgres(url,{max:1,prepare:false});let clock='1',identity;
  try{const [seq]=await current.unsafe("select last_value::text value from desktop_sync_outbox_revision_seq");clock=seq.value;[identity]=await current.unsafe("select value from system_settings where key='desktop_sync_client_id'");}finally{await current.end();}
  const work=path.resolve(dataRoot,'restore-work',randomUUID());await mkdir(work,{recursive:true});
  try{
   const archive=source.endsWith('.birkassa')?await readArchive(source,work):{dump:source,media:null};
   const restored='birkassa_restored_'+randomUUID().replaceAll('-','');
   const admin=postgres(baseUrl+'postgres',{max:1,prepare:false});
   try{await admin.unsafe('create database "'+restored+'"');}finally{await admin.end();}
   await pg('pg_restore',['-h','127.0.0.1','-p',String(config.port),'-U','birkassa','-d',restored,'--no-owner','--no-privileges','--exit-on-error',archive.dump],{env:environment});
   const checked=postgres(baseUrl+restored,{max:1,prepare:false});
   try{const [users]=await checked.unsafe("select count(*) n from users where role='admin' and is_active=true");if(!Number(users.n))throw new Error('Ehtiyatda administrator yoxdur.');await checked.unsafe('select id from products limit 1');await checked.unsafe('delete from auth_sessions');await checked.unsafe('delete from customer_sessions');await checked.unsafe("delete from system_settings where key='desktop_catalog_digest'");const [hasOutbox]=await checked.unsafe("select to_regclass('public.desktop_sync_outbox') present");if(hasOutbox.present){await checked.unsafe('delete from desktop_sync_outbox');await checked.unsafe("select setval('desktop_sync_outbox_revision_seq',greatest((select last_value from desktop_sync_outbox_revision_seq),$1::bigint),true)",[clock]);}await checked.unsafe("insert into system_settings(key,value) values('desktop_sync_client_id',$1) on conflict(key) do update set value=excluded.value",[identity?.value||randomUUID()]);}finally{await checked.end();}
   if(archive.media&&await exists(archive.media))await cp(archive.media,path.join(dataRoot,'media'),{recursive:true});
   const temporary=configFile+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({...config,database:restored}),{mode:0o600});await rename(temporary,configFile);
   return {database:restored};
  }finally{const parent=path.resolve(dataRoot,'restore-work');if(path.dirname(work)!==parent)throw new Error('Yanlış bərpa qovluğu.');await rm(work,{recursive:true,force:true});}
 },async close(){if(owned)await pg('pg_ctl',['-D',cluster,'-m','fast','-w','stop']);}};
 }catch(error){if(owned)await pg('pg_ctl',['-D',cluster,'-m','fast','-w','stop']).catch(()=>{});throw error;}
}
