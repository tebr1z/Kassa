import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,lstat,rm,readdir,realpath,chmod} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {writeArchive,readArchive} from './backup-archive.mjs';
import {databaseFingerprint} from './database-fingerprint.mjs';
import {protectData} from './protect-data.mjs';

const lifetime=15*60*1000;
const validName=value=>typeof value==='string'&&/^[^ .\\/:*?"<>|\x00-\x1f][^\\/:*?"<>|\x00-\x1f]{0,170}\.birkassa$/i.test(value)&&! /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value);
const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const error=()=>new Error('Mərkəzi ehtiyat nüsxə tam yoxlanmadı. Satış dövrü dəyişdirilmədi.');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
async function hash(file){const value=createHash('sha256');for await(const chunk of createReadStream(file))value.update(chunk);return value.digest('hex');}
async function plain(file,directory=false){
 const info=await lstat(file);if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile()))throw error();return info;
}
async function privateDirectory(root,create=false){
 if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)===path.parse(root).root)throw error();
 const resolved=path.resolve(root);await plain(resolved,true);
 if(normalize(await realpath(resolved))!==normalize(resolved))throw error();
 let directory=resolved;
 for(const name of ['.private','central-backups']){
  directory=path.join(directory,name);if(create)await mkdir(directory,{mode:0o700}).catch(cause=>{if(cause.code!=='EEXIST')throw cause;});
  const info=await plain(directory,true);
  if(process.platform!=='win32'){
   if(typeof process.getuid==='function'&&info.uid!==process.getuid())throw error();
   if(create)await chmod(directory,0o700);else if((info.mode&0o077)!==0)throw error();
  }
 }
 if(create)await protectData(directory);return directory;
}
async function noMediaLinks(directory){
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(cause){if(cause.code==='ENOENT')return;throw cause;}
 await plain(directory,true);for(const entry of entries)if(entry.isSymbolicLink())throw error();
}
function databaseUrl(value){
 const url=new URL(value),database=decodeURIComponent(url.pathname.slice(1)),username=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
 if(url.protocol!=='postgres:'||url.hostname!=='127.0.0.1'||url.search||url.hash||!password||password.includes('\0')||password.length>4096||! /^[a-z_][a-z0-9_]{0,62}$/.test(username)||! /^[a-z_][a-z0-9_]{0,62}$/.test(database))throw error();
 if(url.port&&(!Number.isInteger(Number(url.port))||Number(url.port)<1024||Number(url.port)>65535))throw error();
 return {url,database,username,password};
}
function command(bin,name,args,connection){
 if(typeof bin!=='string'||!path.isAbsolute(bin))throw error();
 // No URL/password is passed in argv or command output. Explicit loopback
 // values also prevent inherited libpq service/host settings changing target.
 const environment={...process.env};for(const key of Object.keys(environment))if(/^PG(?:HOST|HOSTADDR|PORT|DATABASE|USER|PASSWORD|OPTIONS|SERVICE|SERVICEFILE|SSLMODE|PASSFILE)$/.test(key))delete environment[key];
 Object.assign(environment,{PGHOSTADDR:'127.0.0.1',PGPASSWORD:connection.password,PGOPTIONS:'',PGSSLMODE:'disable'});
 return new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,env:environment,stdio:['ignore','ignore','pipe'],timeout:15*60*1000});let diagnostic='';
  child.stderr.on('data',part=>{if(diagnostic.length<65536)diagnostic+=part;});
  child.once('error',()=>reject(error()));child.once('exit',code=>{if(code===0){resolve();return;}const failure=error();Object.defineProperty(failure,'centralBackupDiagnostic',{value:diagnostic});reject(failure);});
 });
}
function connection(url,readOnly=false){return postgres(url.href,{max:1,prepare:false,idle_timeout:0,max_lifetime:0,connect_timeout:5,onnotice:()=>{},connection:{TimeZone:'UTC',...(readOnly?{default_transaction_read_only:'on'}:{})}});}

export async function createCentralBackup({dataRoot,backupUrl,bin,fileName}){
 let sql,fixture,created=false,locked=false,fixtureName,directory,work,dump,archive,stage='validate';
 try{
  if(!validName(fileName))throw error();
  const source=databaseUrl(backupUrl);await plain(bin,true);stage='private-directory';directory=await privateDirectory(dataRoot,true);
  const id=randomUUID();work=path.join(directory,id);await mkdir(work,{mode:0o700});await protectData(work);
  dump=path.join(work,'database.dump');archive=path.join(work,fileName);fixtureName='rm_verify_'+id.replaceAll('-','');
  const fixtureUrl=new URL(source.url);sql=connection(source.url);
  const args=['-h','127.0.0.1','-p',source.url.port||'5432','-U',source.username];
  stage='source-lock';const [lock]=await sql.unsafe("select pg_try_advisory_lock(hashtext('restamarket.central-backup')) as acquired");if(!lock.acquired)throw error();locked=true;
  const expected=await sql.begin('isolation level repeatable read read only',async tx=>{
   const [{snapshot}]=await tx.unsafe('select pg_export_snapshot() snapshot');
   stage='public-fingerprint';const state=await databaseFingerprint(tx,{schema:'public'});
   stage='public-dump';await command(bin,'pg_dump',[...args,'-d',source.database,'-Fc','--no-owner','--no-acl','--schema=public','--snapshot',snapshot,'-f',dump],source);return state;
  });
  // This restricted role may create disposable verification databases, but it
  // has no read privilege on the control schema or write privilege on live data.
  stage='create-verification';await sql.unsafe('create database '+quote(fixtureName)+' template template0 encoding \'UTF8\'');created=true;fixtureUrl.pathname='/'+fixtureName;
  // template0 contains an empty public schema. A schema-selected dump includes
  // CREATE SCHEMA public, so remove only this empty, freshly owned container.
  // No CASCADE and no source connection: unexpected contents fail closed.
  fixture=connection(fixtureUrl);await fixture.unsafe('drop schema public');await fixture.end({timeout:3});fixture=null;
  stage='restore-verification';await command(bin,'pg_restore',[...args,'-d',fixtureName,'--no-owner','--no-acl','--exit-on-error',dump],source);
  fixture=connection(fixtureUrl,true);
  stage='verify-fingerprint';const actual=await fixture.begin('isolation level repeatable read read only',tx=>databaseFingerprint(tx,{schema:'public'}));
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw error();
  await fixture.end({timeout:3});fixture=null;
  stage='drop-verification';await sql.unsafe('drop database '+quote(fixtureName));created=false;
  stage='verify-archive';await noMediaLinks(path.join(dataRoot,'media'));await writeArchive(archive,dump,path.join(dataRoot,'media'));
  const extracted=path.join(work,'verified-archive'),checked=await readArchive(archive,extracted);
  if(await hash(checked.dump)!==await hash(dump))throw error();
  // readArchive verifies each media entry and the compressed trailer. Only
  // exact, internally created children of this private UUID work are removed.
  await rm(extracted,{recursive:true});await rm(dump);dump=null;
  const metadata={schema:1,fileName,sha256:await hash(archive),bytes:(await plain(archive)).size,createdAt:new Date().toISOString(),verifiedByDisposableRestore:true};
  // The private proof binds the actual server file, not renderer statements.
  // No control/quota schema is present in either the archive or its restore.
  stage='write-proof';await writeFile(path.join(directory,metadata.sha256+'.json'),JSON.stringify({...metadata,archiveId:id}),{flag:'wx',mode:0o600});
  await protectData(work);return {...metadata,file:archive};
 }catch(cause){const failure=error();Object.defineProperty(failure,'centralBackupStage',{value:stage});if(cause.centralBackupDiagnostic)Object.defineProperty(failure,'centralBackupDiagnostic',{value:cause.centralBackupDiagnostic});throw failure;}
 finally{
  let cleanupFailed=false;
  if(fixture)try{await fixture.end({timeout:3});}catch{cleanupFailed=true;}
  if(created&&sql){
   // Never drop any guessed/existing database: only this successfully created
   // per-request UUID name. A failed DROP is a failure, not a verified success.
   if(!/^rm_verify_[a-f0-9]{32}$/.test(fixtureName))cleanupFailed=true;
   else try{await sql.unsafe('drop database '+quote(fixtureName));created=false;}catch{cleanupFailed=true;}
  }
  if(locked&&sql)try{await sql.unsafe("select pg_advisory_unlock(hashtext('restamarket.central-backup'))");}catch{cleanupFailed=true;}
  if(sql)try{await sql.end({timeout:3});}catch{cleanupFailed=true;}
  // Failed work remains private for operator recovery; never recursively remove
  // dataRoot, a user path, or a database while a disposable backend may be alive.
  if(cleanupFailed)throw error();
 }
}

export async function verifyCentralResetBackup(backup){
 if(process.env.BIRKASSA_CENTRAL!=='1')return;
 try{
  if(!backup||!validName(backup.fileName)||!/^[a-f0-9]{64}$/.test(backup.sha256)||!Number.isSafeInteger(backup.bytes)||backup.bytes<1)throw error();
  const directory=await privateDirectory(process.env.BIRKASSA_DATA_DIR),proofFile=path.join(directory,backup.sha256+'.json'),info=await plain(proofFile);
  if(info.size>8192||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw error();
  const proof=JSON.parse(await readFile(proofFile,'utf8')),age=Date.now()-Date.parse(proof.createdAt);
  if(proof.schema!==1||proof.verifiedByDisposableRestore!==true||!validId(proof.archiveId)||proof.fileName!==backup.fileName||proof.sha256!==backup.sha256||proof.bytes!==backup.bytes||!Number.isFinite(age)||age<0||age>lifetime)throw error();
  const work=path.join(directory,proof.archiveId);await plain(work,true);const archive=path.join(work,proof.fileName),archiveInfo=await plain(archive);
  if(archiveInfo.size!==backup.bytes||await hash(archive)!==backup.sha256)throw error();
 }catch{throw error();}
}
