import {mkdir,copyFile,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {openLocalDatabase} from '../desktop/local-database.mjs';
import {readArchive} from '../desktop/backup-archive.mjs';
import postgres from 'postgres';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const installer=path.resolve('desktop-release','v'+pkg.version,`RestaMarket-Setup-${pkg.version}.exe`);
await stat(installer);
const dataRoot=path.resolve(process.env.BIRKASSA_DATA_DIR||path.join(process.env.APPDATA,'BirKassa','local-data'));
// Never create and deliver an empty database when the real shop folder is missing.
await stat(path.join(dataRoot,'database.json'));await stat(path.join(dataRoot,'postgres','PG_VERSION'));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.resolve('desktop-release',`RestaMarket-Kocurme-${pkg.version}-${stamp}`);
await mkdir(output,{recursive:false});
process.env.BIRKASSA_BUNDLED_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
const db=await openLocalDatabase(dataRoot,process.cwd());
try{
 const backup=path.join(output,'RestaMarket-data.birkassa');await db.backupData(backup);
 const sql=postgres(db.url,{max:1,prepare:false});let counts;
 try{[counts]=await sql.unsafe('select (select count(*)::int from products) products,(select count(*)::int from sales) sales,(select count(*)::int from sales_orders) orders,(select count(*)::int from stock_movements) stock_movements,(select count(*)::int from product_options) options');}finally{await sql.end();}
 // Validation extracts only to an ignored local QA folder, not the live data directory.
 const verified=await readArchive(backup,path.resolve('.local-desktop-data','transfer-verification-'+stamp));
 await copyFile(installer,path.join(output,path.basename(installer)));
 await copyFile('desktop/TRANSFER.txt',path.join(output,'OXU-KOCURME.txt'));
 await copyFile('OPERATIONS-0.5.txt',path.join(output,'YENI-FUNKSIYALAR.txt'));
 const manifest={version:pkg.version,createdAt:new Date().toISOString(),archiveFiles:verified.files,counts,files:[]};
 for(const file of [path.basename(installer),'RestaMarket-data.birkassa','OXU-KOCURME.txt','YENI-FUNKSIYALAR.txt']){const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(output,file)))hash.update(chunk);manifest.files.push({name:file,sha256:hash.digest('hex')});}
 await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log('Verified transfer folder: '+output);
 console.log('Local data included:',JSON.stringify(counts));
}finally{await db.close();}
