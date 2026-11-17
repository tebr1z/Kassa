import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,writeFile,copyFile,rename,rm,lstat,readdir,realpath} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import {openExistingLocalDatabase} from './local-database.mjs';
import {writeArchive,readArchive} from './backup-archive.mjs';
import {protectData} from './protect-data.mjs';
import {databaseFingerprint} from './database-fingerprint.mjs';
export {databaseFingerprint} from './database-fingerprint.mjs';

const execute=(file,args,env)=>new Promise((resolve,reject)=>{
 const child=spawn(file,args,{windowsHide:true,stdio:['ignore','ignore','pipe'],env});let diagnostic='';
 child.stderr.on('data',part=>{if(diagnostic.length<65536)diagnostic+=part;});
 child.once('error',reject);child.once('exit',code=>{
  if(code===0){resolve();return;}
  const error=new Error(path.basename(file)+' yoxlaması uğursuz oldu ('+code+').');
  // Never log SQL/row data from pg_restore on a real shop. A fixture test may
  // explicitly inspect this non-enumerable diagnostic in its own process.
  Object.defineProperty(error,'transferDiagnostic',{value:diagnostic});reject(error);
 });
});
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function removeVerification(root){
 if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('rm-xfer-'))throw new Error('Yanlış sınaq qovluğu.');
 try{await lstat(path.join(root,'verification-postgres','postmaster.pid'));throw new Error('Sınaq PostgreSQL-i bağlanmadı; qorunan müvəqqəti qovluq təhlükəsizlik üçün saxlanıldı.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await rm(root,{recursive:true,force:true});
}
async function availablePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
async function noMediaLinks(directory){
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
 const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Şəkil qovluğu keçid ola bilməz.');
 for(const entry of entries)if(entry.isSymbolicLink())throw new Error('Şəkil qovluğunda keçid tapıldı.');
}

// Counts alone can miss wrong stock, prices or receipt lines. Compare a stable
// digest of EVERY user table (including unknown future tables), not just a
// hand-maintained list of products/sales. Data never leaves this private folder.
// This separate cluster exists ONLY under the fresh export work directory. We
// never pg_restore into, CREATE DATABASE in, or migrate the source shop.
export async function verifyTransferArchive(archiveFile,{bin,workRoot,expected}){
 const root=path.resolve(workRoot),cluster=path.join(root,'verification-postgres'),extracted=path.join(root,'extracted');
 if((await lstat(root)).isSymbolicLink())throw new Error('Yoxlama qovluğu etibarlı deyil.');
 const archive=await readArchive(archiveFile,extracted),password=randomBytes(32).toString('hex'),passwordFile=path.join(root,'verification-password');
 const environment={...process.env,PGPASSWORD:password,PGOPTIONS:''},pg=(command,args)=>execute(path.join(bin,command+'.exe'),args,environment);
 await pg('pg_restore',['--list',archive.dump]);
 await writeFile(passwordFile,password,{mode:0o600,flag:'wx'});let started=false,sql;
 try{
  await pg('initdb',['-D',cluster,'-U','birkassa','--pwfile',passwordFile,'--auth=scram-sha-256','--encoding=UTF8','--no-locale']);
  const port=await availablePort();
  await pg('pg_ctl',['-D',cluster,'-l',path.join(root,'verification-postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  await pg('pg_restore',['-h','127.0.0.1','-p',String(port),'-U','birkassa','-d','postgres','--no-owner','--no-privileges','--exit-on-error',archive.dump]);
  sql=postgres(`postgres://birkassa:${password}@127.0.0.1:${port}/postgres`,{max:1,prepare:false,connect_timeout:5,onnotice:()=>{},connection:{default_transaction_read_only:'on',TimeZone:'UTC'}});
  const actual=await sql.begin('isolation level repeatable read read only',databaseFingerprint);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Köçürmə yoxlanmadı: bərpa edilən məhsul, stok, satış və ya digər məlumatlar mənbə ilə eyni deyil.');
  return {files:archive.files,tables:actual.length,restored:true};
 }finally{
  if(sql)await sql.end({timeout:2});
  if(started)await pg('pg_ctl',['-D',cluster,'-m','fast','-w','stop']);
  await rm(passwordFile,{force:true});
 }
}

export function transferInstructions({version,createdAt,counts}){
 return `RESTAMARKET ${version} — PROQRAM + MAĞAZA MƏLUMATLARI

Nüsxənin tarixi (UTC): ${createdAt}
Məhsullar: ${counts.products ?? 0}; satışlar: ${counts.sales ?? 0}; sifarişlər: ${counts.sales_orders ?? 0}; stok hərəkətləri: ${counts.stock_movements ?? 0}; məhsul seçimləri: ${counts.product_options ?? 0}.
Baza arxivi ayrıca sınaq bazasına bərpa edilib və BÜTÜN cədvəllərin məlumatları yoxlanıb.

VACİB: EXE təkbaşına stok və satışları daşımır. Bu qovluğun HAMISINI köçürün!
1. Köhnə kompüterdə satışları tamamlayıb RestaMarket-i bağlayın. Bu tarixdən sonrakı əməliyyatlar nüsxədə yoxdur; yeni əməliyyat varsa yenidən köçürmə paketi hazırlayın.
2. Qovluğu yalnız şəxsi, qorunan USB/disklə yeni Windows kompüterinə aparın.
3. RestaMarket-Setup-${version}.exe faylını açıb proqramı quraşdırın. PostgreSQL daxildir.
4. Quraşdırıcı yalnız proqramı quraşdırır, məlumatı özbaşına silmir və bərpa etmir.
5. Setup tamamlanandan sonra RestaMarket-data.birkassa faylına iki dəfə klikləyin, yaxud proqramda RestaMarket → Ehtiyatdan bərpa et menyusundan həmin faylı seçin. Boş kompüterdə yeni hesab yaratmaq lazım deyil. Bərpa təsdiq tələb edir; artıq məlumat olan kompüterdə administrator girişi tələb olunur və mövcud bazanın əvvəlcə ehtiyatı alınır. Bərpa iki bazanı birləşdirmir; seçilən nüsxəyə keçir.
6. Proqram yenidən açılanda köhnə kompüterdəki işçi və baş rəhbər şifrələri ilə daxil olun. Yeni şifrə yaratmayın. Hesablar və şifrələrin heşləri də arxivdədir.
7. Məhsul sayı, hər anbarın stoku, son satışlar/çeklər, müştərilər, seçimlər və şəkilləri müqayisə edin. Yoxlama tamamlanana qədər köhnə kompüteri və ehtiyatı SİLMƏYİN.
8. Veb bağlantı açarı və kompüterin şəxsi açar faylları təhlükəsizlik üçün köçürülmür. Yeni kompüterdə veb sinxronizasiyasını ayrıca yenidən qoşun; SMTP məxfi ayarlarını lazım olsa yenidən daxil edin. Eyni mağazanın iki nüsxəsini paralel işlətməyin.

ARXİVƏ DAXİLDİR: bütün baza cədvəlləri — məhsullar, qiymətlər, alış qiymətləri, stok hərəkətləri/anbarlar, satışlar/çeklər/ödənişlər, sifarişlər, müştərilər, maliyyə, işçi hesabları və kompüterə endirilmiş şəkillər. Yalnız internetdə olan şəkil özü daxil deyil.
Yerli canlı məlumat yolu: %APPDATA%\\BirKassa\\local-data (texniki ad dəyişməyib).
win-unpacked içindəki EXE-ni tək köçürməyin; resursları olmadan işləmir. Setup + .birkassa istifadə edin.
manifest.json faylların SHA-256 və bütün cədvəllərin yoxlama nəticələrini göstərir. Arxivi əvəz etsəniz bu manifest artıq uyğun deyil; yenidən paket hazırlayın.

MƏXFİLİK: .birkassa şifrələnmiş deyil. Müştəri/işçi/mağaza/maliyyə məlumatları daşıyır. Bu qovluğu GitHub-a, sayta, açıq yeniləmə serverinə və ya ictimai linkə YÜKLƏMƏYİN. Şəxsi şifrəli disk istifadə edin.
`;
}

export async function prepareTransferPackage({dataRoot,installer,version,output,pgBin}){
 if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw new Error('Yanlış proqram versiyası.');
 const source=path.resolve(dataRoot),target=path.resolve(output),parent=path.dirname(target),work=target+'.partial-'+randomUUID();
 if(target===source||target.startsWith(source+path.sep)||source.startsWith(target+path.sep)||target===path.parse(target).root)throw new Error('Köçürmə qovluğu canlı məlumatdan ayrı olmalıdır.');
 const installerInfo=await lstat(installer);if(!installerInfo.isFile()||installerInfo.isSymbolicLink()||path.basename(installer)!==`RestaMarket-Setup-${version}.exe`)throw new Error('Versiyaya uyğun quraşdırıcı tapılmadı.');
 try{await lstat(target);throw new Error('Köçürmə qovluğu artıq mövcuddur; yeni qovluq seçin.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(parent,{recursive:true});
 const physicalSource=await realpath(source),physicalTarget=path.join(await realpath(parent),path.basename(target));
 if(physicalTarget===physicalSource||physicalTarget.startsWith(physicalSource+path.sep)||physicalSource.startsWith(physicalTarget+path.sep))throw new Error('Köçürmə qovluğu canlı məlumatdan ayrı olmalıdır.');
 await mkdir(work,{mode:0o700});await protectData(work);
 let database,verification;let completed=false;
 try{
  database=await openExistingLocalDatabase(source,{pgBin});
  await noMediaLinks(path.join(source,'media'));
  // PostgreSQL's Windows tools still hit MAX_PATH in deeply nested project /
  // export folders. The short, owner-only temp root holds ALL dump/restore work.
  verification=await mkdtemp(path.join(os.tmpdir(),'rm-xfer-'));await protectData(verification);
  const dump=path.join(verification,'source.dump');
  const expected=await database.snapshot(async snapshot=>{const fingerprint=await databaseFingerprint(snapshot.sql);await snapshot.dump(dump);return fingerprint;});
  const archive=path.join(work,'RestaMarket-data.birkassa');
  await writeArchive(archive,dump,path.join(source,'media'));
  const bin=database.bin;await database.close();database=null;
  const verified=await verifyTransferArchive(archive,{bin,workRoot:verification,expected});
  const createdAt=new Date().toISOString(),counts=Object.fromEntries(expected.filter(table=>table.kind==='table'&&table.schema==='public').map(table=>[table.table,table.rows]));
  const installerName=`RestaMarket-Setup-${version}.exe`;
  await copyFile(installer,path.join(work,installerName));
  await writeFile(path.join(work,'OXU-KOCURME.txt'),transferInstructions({version,createdAt,counts}),{mode:0o600});
  const manifest={format:'restamarket-private-transfer-v1',version,createdAt,containsPrivateShopData:true,encrypted:false,verifiedByDisposableRestore:true,sourceMigrationsApplied:false,archiveFiles:verified.files,counts,tables:expected,files:[]};
  for(const name of [installerName,'RestaMarket-data.birkassa','OXU-KOCURME.txt'])manifest.files.push({name,bytes:(await lstat(path.join(work,name))).size,sha256:await hashFile(path.join(work,name))});
  await writeFile(path.join(work,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  await removeVerification(verification);verification=null;
  await protectData(work);await rename(work,target);completed=true;
  return {output:target,version,createdAt,counts,archiveFiles:verified.files,verifiedByDisposableRestore:true};
 }finally{
  if(database)await database.close();
  if(verification)await removeVerification(verification);
  if(!completed){if(path.dirname(work)!==parent||!path.basename(work).startsWith(path.basename(target)+'.partial-'))throw new Error('Yanlış müvəqqəti köçürmə yolu.');await rm(work,{recursive:true,force:true});}
 }
}

export async function createTransferPackage({dataRoot,installer,version,outputParent,pgBin}){
 const parent=path.resolve(outputParent),stamp=new Date().toISOString().replace(/[:.]/g,'-');
 return prepareTransferPackage({dataRoot,installer,version,pgBin,output:path.join(parent,`RestaMarket-Kocurme-${version}-${stamp}`)});
}
