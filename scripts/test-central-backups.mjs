import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm,readdir,lstat,symlink,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
import {createCentralBackup,verifyCentralResetBackup} from '../desktop/central-backups.mjs';
import {databaseFingerprint} from '../desktop/transfer-package.mjs';
import {readArchive} from '../desktop/backup-archive.mjs';

// Fresh fixture ONLY. No actual APPDATA/profile, server, source credentials or
// production database is ever opened. The fixed port is checked before initdb.
const port=55464,bin=path.resolve('desktop/vendor/postgres/bin'),root=await mkdtemp(path.join(os.tmpdir(),'rm-central-backup-test-')),source=path.join(root,'source');
const envKeys=['BIRKASSA_PG_BIN','BIRKASSA_CENTRAL','BIRKASSA_DATA_DIR','PGHOSTADDR','PGSERVICE','PGOPTIONS'],previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
const role='rm_backup_fixture',password=randomBytes(32).toString('hex'),quote=value=>'"'+value.replaceAll('"','""')+'"';
const run=promisify(execFile);let database,admin,backup;
async function unusedPort(){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(cause=>cause?reject(cause):resolve()));});}
try{
 await unusedPort();process.env.BIRKASSA_PG_BIN=bin;
 database=await openLocalDatabase(source,process.cwd(),{port});
 admin=postgres(database.url,{max:1,prepare:false,onnotice:()=>{},connection:{TimeZone:'UTC'}});
 await admin.unsafe('create schema rm_fixture_control');
 await admin.unsafe('create table rm_fixture_control.reset_quota(id int primary key,used int not null)');
 await admin.unsafe('insert into rm_fixture_control.reset_quota values(1,2)');
 await admin.unsafe('revoke all on schema rm_fixture_control from public');
 await admin.unsafe('create table central_fixture_rows(id bigint generated always as identity primary key,description text,payload jsonb)');
 await admin.unsafe("insert into central_fixture_rows(description,payload) values('fixture one','{\"size\":40}'),(null,null),('fixture one','{\"size\":40}')");
 await admin.unsafe("insert into products(sku,name,cost_price,sale_price) values('CENTRAL-FIXTURE','Central fixture',7.4,12.5)");
 await admin.unsafe('create role '+quote(role)+" login createdb password '"+password+"'");
 await admin.unsafe('grant connect on database birkassa to '+quote(role));
 await admin.unsafe('grant usage on schema public to '+quote(role));
 await admin.unsafe('grant select on all tables in schema public to '+quote(role));
 await admin.unsafe('grant select on all sequences in schema public to '+quote(role));
 const url=new URL(database.url);url.username=role;url.password=password;
 backup=postgres(url.href,{max:1,prepare:false,onnotice:()=>{},connection:{TimeZone:'UTC'}});
 await assert.rejects(backup.unsafe('select * from rm_fixture_control.reset_quota'),/permission denied/i);
 await assert.rejects(backup.unsafe("update products set sale_price=0"),/permission denied/i);
 await assert.rejects(databaseFingerprint(backup),/permission denied/i,'The restricted account cannot fingerprint/read the protected control schema');
 const expected=await backup.begin('isolation level repeatable read read only',sql=>databaseFingerprint(sql,{schema:'public'}));
 assert.ok(expected.some(row=>row.kind==='sequence'&&row.table==='central_fixture_rows_id_seq'));
 assert.ok(expected.every(row=>row.schema==='public'));
 await mkdir(path.join(source,'media'));
 const image=Buffer.from('Private central fixture image'),imageHash=createHash('sha256').update(image).digest('hex');
 await writeFile(path.join(source,'media',imageHash+'.bin'),image);await writeFile(path.join(source,'media',imageHash+'.json'),'{}');
 // An inherited libpq service/PGOPTIONS must not redirect dump/restore or force
 // the verification restore read-only. They are not secrets and never connect.
 process.env.PGHOSTADDR='192.0.2.1';process.env.PGSERVICE='invalid-fixture-service';process.env.PGOPTIONS='-c default_transaction_read_only=on';
 const fileName='RestaMarket-server-fixture.birkassa';
 const result=await createCentralBackup({dataRoot:source,backupUrl:url.href,bin,fileName});
 assert.equal(result.verifiedByDisposableRestore,true);assert.equal(result.schema,1);assert.equal(result.fileName,fileName);assert.ok(result.bytes>0);assert.match(result.sha256,/^[a-f0-9]{64}$/);
 assert.equal((await lstat(result.file)).size,result.bytes);assert.equal(createHash('sha256').update(await readFile(result.file)).digest('hex'),result.sha256);
 assert.ok(result.file.startsWith(path.join(source,'.private','central-backups')+path.sep));
 const archive=await readArchive(result.file,path.join(root,'inspect-archive'));
 assert.deepEqual(await readFile(path.join(archive.media,imageHash+'.bin')),image);
 assert.equal(archive.files,3);
 const listing=(await run(path.join(bin,'pg_restore.exe'),['--list',archive.dump],{windowsHide:true,maxBuffer:8*1024*1024})).stdout;
 assert.ok(listing.includes('central_fixture_rows'));assert.equal(listing.includes('rm_fixture_control'),false,'Control quota schema never enters the archive');
 assert.deepEqual(await backup.begin('isolation level repeatable read read only',sql=>databaseFingerprint(sql,{schema:'public'})),expected,'No public source rows, schema or sequence state changed');
 assert.equal((await admin.unsafe('select used from rm_fixture_control.reset_quota where id=1'))[0].used,2,'Backup cannot roll back/reset the protected allowance');
 assert.equal((await admin.unsafe("select count(*)::int n from pg_database where datname like 'rm_verify_%'"))[0].n,0,'Disposable verification database was actually dropped');
 process.env.BIRKASSA_CENTRAL='1';process.env.BIRKASSA_DATA_DIR=source;
 const attestation={fileName:result.fileName,sha256:result.sha256,bytes:result.bytes};
 await verifyCentralResetBackup(attestation);
 for(const value of [null,{...attestation,fileName:'../escape.birkassa'},{...attestation,fileName:'Wrong.birkassa'},{...attestation,bytes:0},{...attestation,bytes:result.bytes+1},{...attestation,sha256:'f'.repeat(64)},{...attestation,sha256:result.sha256.toUpperCase()}])await assert.rejects(verifyCentralResetBackup(value));
 const proofFile=path.join(source,'.private','central-backups',result.sha256+'.json'),proof=JSON.parse(await readFile(proofFile,'utf8'));
 assert.equal(typeof proof.archiveId,'string');assert.ok(!JSON.stringify(proof).includes(password),'Proof does not contain database credentials');
 for(const changed of [
  {...proof,createdAt:new Date(Date.now()-16*60*1000).toISOString()},
  {...proof,createdAt:new Date(Date.now()+60*1000).toISOString()},
  {...proof,createdAt:'invalid'}, {...proof,verifiedByDisposableRestore:false},
  {...proof,schema:2},{...proof,archiveId:'../../outside'},{...proof,bytes:proof.bytes+1},
 ]){await writeFile(proofFile,JSON.stringify(changed),{mode:0o600});await assert.rejects(verifyCentralResetBackup(attestation));}
 await writeFile(proofFile,'not JSON',{mode:0o600});await assert.rejects(verifyCentralResetBackup(attestation));
 await writeFile(proofFile,' '.repeat(8193),{mode:0o600});await assert.rejects(verifyCentralResetBackup(attestation));
 await writeFile(proofFile,JSON.stringify(proof),{mode:0o600});
 const original=await readFile(result.file),corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=0xff;
 await writeFile(result.file,corrupt);await assert.rejects(verifyCentralResetBackup(attestation),'A previously proven but now corrupted archive is rejected');
 await writeFile(result.file,original);await verifyCentralResetBackup(attestation);
 const alias=path.join(root,'source-alias');await symlink(source,alias,process.platform==='win32'?'junction':'dir');
 process.env.BIRKASSA_DATA_DIR=alias;await assert.rejects(verifyCentralResetBackup(attestation));
 await assert.rejects(createCentralBackup({dataRoot:alias,backupUrl:url.href,bin,fileName}));await unlink(alias);process.env.BIRKASSA_DATA_DIR=source;
 for(const input of [
  {backupUrl:url.href+'?host=192.0.2.1'}, {backupUrl:url.href.replace('127.0.0.1','192.0.2.1')},
  {fileName:'../unsafe.birkassa'},{fileName:'CON.birkassa'},{dataRoot:path.parse(source).root},
 ])await assert.rejects(createCentralBackup({dataRoot:source,backupUrl:url.href,bin,fileName,...input}));
 // A busy backup fails before creating/restoring a disposable database. Only
 // its private UUID workspace may remain; no proof is fabricated for failure.
 await admin.unsafe("select pg_advisory_lock(hashtext('restamarket.central-backup'))");
 const beforeProofs=(await readdir(path.join(source,'.private','central-backups'))).filter(name=>name.endsWith('.json'));
 await assert.rejects(createCentralBackup({dataRoot:source,backupUrl:url.href,bin,fileName:'Busy-fixture.birkassa'}));
 await admin.unsafe("select pg_advisory_unlock(hashtext('restamarket.central-backup'))");
 assert.deepEqual((await readdir(path.join(source,'.private','central-backups'))).filter(name=>name.endsWith('.json')),beforeProofs);
 assert.equal((await admin.unsafe('select used from rm_fixture_control.reset_quota'))[0].used,2);
 process.env.BIRKASSA_CENTRAL='0';await verifyCentralResetBackup(null);
 // The code must surface, never silently absorb, a failed owned-database DROP.
 const implementation=await readFile('desktop/central-backups.mjs','utf8');
 assert.doesNotMatch(implementation,/drop database[^\n]*\.catch\(\(\)=>\{\}\)/i);
 assert.match(implementation,/if\(cleanupFailed\)throw error\(\)/);
 console.log('Central backup PASS: isolated PostgreSQL fixture only; restricted public-only snapshot/dump/real restore, every public table and sequence match, media integrity, private fresh proof and actual-file rehash; quota/control unreadable and excluded, source unchanged; invalid/expired/tampered/busy/unsafe input rejected; no production profile or network service accessed.');
}catch(cause){if(cause.centralBackupStage)console.error('Fixture-only backup failure stage:',cause.centralBackupStage);if(cause.centralBackupDiagnostic)console.error('Fixture-only PostgreSQL diagnostic:',cause.centralBackupDiagnostic);throw cause;}
finally{
 await backup?.end({timeout:2});await admin?.end({timeout:2});await database?.close();
 for(const key of envKeys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
 if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('rm-central-backup-test-'))throw new Error('Invalid fixture cleanup path');
 try{await lstat(path.join(source,'postgres','postmaster.pid'));throw new Error('Fixture PostgreSQL still running; private test files retained.');}catch(cause){if(cause.code!=='ENOENT')throw cause;}
 await rm(root,{recursive:true,force:true});
}
