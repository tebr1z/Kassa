import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import path from 'node:path';
import {mkdir,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {createRequire} from 'node:module';
import postgres from 'postgres';
import {openLocalDatabase} from '../desktop/local-database.mjs';
import {databaseFingerprint} from '../desktop/transfer-package.mjs';
import {createCentralGateway} from '../desktop/central-gateway.mjs';
import {generateKeyPairSync} from 'node:crypto';

// Entirely fresh fixture: actual production Next standalone → restricted PG17,
// actual signed device gateway/client and disposable backup restore. No installed
// profile, actual archive, live website, remote database or real account is read.
const require=createRequire(import.meta.url),{createCentralClient,downloadCentralBackup,DEFAULT_CENTRAL_ORIGIN}=require('../desktop/central-client.cjs');
const root=process.cwd(),parent=path.resolve('.local-desktop-data'),fixture=path.join(parent,'cp-'+randomUUID().slice(0,8)),source=path.join(fixture,'source'),bin=path.resolve('desktop/vendor/postgres/bin'),application=path.resolve('.next/standalone');
const pgPort=55465,nextPort=5847,gatewayPort=5848,clientPort=5769,localOrigin='http://127.0.0.1:'+clientPort;
const appRole='packaged_app',backupRole='packaged_backup',appPassword=randomBytes(32).toString('hex'),backupPassword=randomBytes(32).toString('hex'),masterPassword='Fixture-Only-12-'+randomBytes(12).toString('hex');
const serverAccess='a'.repeat(64),serverNative='b'.repeat(64),localAccess='c'.repeat(64),localNative='d'.repeat(64),quote=value=>'"'+value.replaceAll('"','""')+'"';
const previousBin=process.env.BIRKASSA_PG_BIN;let database,operator,appSql,child,gateway,client,ownedFixture=false,cookie='',stage='fixture setup';
async function unused(port){await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(cause=>cause?reject(cause):resolve()));});}
async function renderer(target,{method='GET',body,bearer,withCookie=true}={}){
 return fetch(localOrigin+target,{method,redirect:'manual',headers:{'x-restamarket-desktop-access':localAccess,Origin:localOrigin,...(withCookie&&cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});
}
async function native(target,{method='GET',body,withCookie=true}={}){
 return client.request(target,{method,purpose:'native',headers:{Origin:localOrigin,...(withCookie&&cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});
}
async function json(response,status){assert.equal(response.status,status,'HTTP status at '+stage+': '+await response.clone().text());return response.json();}
const stableState=rows=>rows.filter(row=>!['audit_logs','system_settings','auth_sessions','staff_auth_attempts','system_errors'].includes(row.table));
try{
 for(const port of [pgPort,nextPort,gatewayPort,clientPort])await unused(port);
 assert.equal(JSON.parse(await readFile(path.join(application,'package.json'),'utf8')).version,JSON.parse(await readFile('package.json','utf8')).version,'Use the current build, not an earlier standalone');
 await mkdir(parent,{recursive:true});await mkdir(fixture,{mode:0o700});ownedFixture=true;process.env.BIRKASSA_PG_BIN=bin;database=await openLocalDatabase(source,root,{port:pgPort});
 operator=postgres(database.url,{max:1,prepare:false,onnotice:()=>{},connection:{TimeZone:'UTC'}});
 const [master]=await operator.unsafe("select id,branch_id from users where role='admin'"),[warehouse]=await operator.unsafe('select id from warehouses limit 1'),salt=randomBytes(16).toString('hex');
 await operator.unsafe('update users set password_hash=$1 where id=$2',[salt+':'+scryptSync(masterPassword,salt,64).toString('hex'),master.id]);
 const [product]=await operator.unsafe("insert into products(sku,name,cost_price,sale_price) values('PACKAGED-CENTRAL','Packaged central fixture',7,10) returning id");
 await operator.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,performed_by) values($1,$2,'receipt',20,7,$3)",[product.id,warehouse.id,master.id]);
 const [shift]=await operator.unsafe('insert into cashier_shifts(branch_id,cashier_id,opening_cash,expected_cash,actual_cash,closed_at) values($1,$2,0,20,20,clock_timestamp()) returning id',[master.branch_id,master.id]);
 for(let index=1;index<=2;index++){
  const [sale]=await operator.unsafe("insert into sales(receipt_no,shift_id,cashier_id,subtotal,total,status,created_at) values($1,$2,$3,10,10,'completed',clock_timestamp()) returning id",['PACKAGED-'+index,shift.id,master.id]);
  await operator.unsafe('insert into sale_items(sale_id,product_id,quantity,unit_price,cost_snapshot,line_total) values($1,$2,1,10,7,10)',[sale.id,product.id]);await operator.unsafe("insert into payments(sale_id,method,amount) values($1,'cash',10)",[sale.id]);
  await operator.unsafe("insert into stock_movements(product_id,warehouse_id,type,quantity,unit_cost,reference_type,reference_id,performed_by) values($1,$2,'sale',-1,7,'sale',$3,$4)",[product.id,warehouse.id,sale.id,master.id]);
 }
 await operator.unsafe('create role '+quote(appRole)+" login password '"+appPassword+"' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls");
 await operator.unsafe('create role '+quote(backupRole)+" login createdb password '"+backupPassword+"' nosuperuser nocreaterole noinherit noreplication nobypassrls");
 for(const role of [appRole,backupRole]){await operator.unsafe('grant usage on schema public to '+quote(role));await operator.unsafe('grant select on all tables in schema public to '+quote(role));await operator.unsafe('grant select on all sequences in schema public to '+quote(role));}
 await operator.unsafe('grant insert,update,delete on all tables in schema public to '+quote(appRole));await operator.unsafe('grant usage,update on all sequences in schema public to '+quote(appRole));
 await operator.unsafe("select set_config('restamarket.application_role',$1,false)",[appRole]);await operator.unsafe(await readFile('scripts/central-reset-policy.sql','utf8'));await operator.unsafe('select restamarket_control.initialize_sales_reset_policy($1::uuid)',[master.id]);
 const appUrl=new URL(database.url);appUrl.username=appRole;appUrl.password=appPassword;const backupUrl=new URL(database.url);backupUrl.username=backupRole;backupUrl.password=backupPassword;
 appSql=postgres(appUrl.href,{max:1,prepare:false,onnotice:()=>{}});const policy=async()=>(await appSql.unsafe('select restamarket_control.read_sales_reset_policy($1::uuid) value',[master.id]))[0].value;
 assert.equal((await policy()).remaining,3);
 child=spawn(process.execPath,[path.join(application,'server.js')],{cwd:application,windowsHide:true,stdio:'ignore',env:{...process.env,DATABASE_URL:appUrl.href,BIRKASSA_BACKUP_DATABASE_URL:backupUrl.href,BIRKASSA_DATA_DIR:source,BIRKASSA_PG_BIN:bin,BIRKASSA_CENTRAL:'1',BIRKASSA_LOCAL:'1',BIRKASSA_DESKTOP_ACCESS_TOKEN:serverAccess,BIRKASSA_DESKTOP_TOKEN:serverNative,HOSTNAME:'127.0.0.1',PORT:String(nextPort),NODE_ENV:'production'}});
 stage='Next standalone readiness';let ready=false;
 for(let attempt=0;attempt<60;attempt++){if(child.exitCode!==null)break;try{const response=await fetch('http://127.0.0.1:'+nextPort+'/api/auth',{headers:{'x-restamarket-desktop-access':serverAccess},signal:AbortSignal.timeout(2000)});if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
 assert.ok(ready,'Current standalone central backend must start');
 const keys=generateKeyPairSync('ed25519'),identity={id:randomUUID(),privateKey:keys.privateKey,publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'})},registryFile=path.join(fixture,'devices.json');
 await writeFile(registryFile,JSON.stringify({schema:1,devices:[{id:identity.id,publicKeyPem:identity.publicKeyPem,active:true}]}),{mode:0o600});
 gateway=createCentralGateway({registryFile,backendOrigin:'http://127.0.0.1:'+nextPort,desktopOrigin:localOrigin,accessToken:serverAccess,nativeToken:serverNative});gateway.listen(gatewayPort,'127.0.0.1');await once(gateway,'listening');
 client=await createCentralClient({identity,accessToken:localAccess,nativeToken:localNative,port:clientPort,fetchImpl:(target,options)=>{assert.equal(new URL(target).origin,DEFAULT_CENTRAL_ORIGIN);return fetch('http://127.0.0.1:'+gatewayPort+new URL(target).pathname+new URL(target).search,options);}});
 stage='device and staff login gates';assert.equal((await fetch(localOrigin+'/api/auth')).status,403);assert.equal((await fetch('http://127.0.0.1:'+gatewayPort+'/desktop-private/api/auth')).status,401);assert.equal((await fetch('http://127.0.0.1:'+nextPort+'/api/auth')).status,403);
 const auth=await json(await renderer('/api/auth'),200);assert.equal(auth.authenticated,false);assert.equal(auth.users.length,1);
 const login=await renderer('/api/auth',{method:'POST',body:{userId:master.id,password:masterPassword,action:'login'}});assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.match(cookie,/birkassa_session=/);await login.arrayBuffer();
 stage='actual product finance preview APIs';const products=await renderer('/api/products');assert.equal(products.status,200);await products.arrayBuffer();const finance=await json(await renderer('/api/finance'),200);assert.equal(finance.metrics.receipts,2);
 let preview=await json(await renderer('/api/sales-period'),200);assert.equal(preview.resetPolicy.remaining,3);assert.equal(preview.sales.receipts,2);assert.equal(preview.openShiftCount,0);
 const body={confirm:'YENİ DÖVR',reason:'Only disposable packaged integration fixture',preview:preview.preview,backup:{fileName:'forged-fixture.birkassa',sha256:'f'.repeat(64),bytes:100}};
 stage='renderer and forged backup denial';assert.equal((await renderer('/api/sales-period',{method:'POST',body,bearer:'wrong-native-fixture'})).status,403);assert.equal((await native('/api/sales-period',{withCookie:false})).status,401);
 const forged=await json(await native('/api/sales-period',{method:'POST',body}),409);assert.equal(forged.code,'CENTRAL_BACKUP_REQUIRED');assert.equal((await policy()).used,0);
 const before=stableState(await operator.begin('isolation level repeatable read read only',sql=>databaseFingerprint(sql,{schema:'public'})));
 stage='actual verified server backup and native download';const backupName='packaged-central-fixture.birkassa',download=await native('/api/central-backup?fileName='+backupName),destination=path.join(fixture,'download',backupName);
 assert.equal(download.status,200,'Production backup route must create and verify a real restricted-role public-schema archive');const attestation=await downloadCentralBackup(download,destination);assert.ok((await lstat(destination)).size>0);assert.equal(attestation.fileName,backupName);
 stage='actual native period reset';preview=await json(await renderer('/api/sales-period'),200);const reset=await json(await native('/api/sales-period',{method:'POST',body:{...body,preview:preview.preview,backup:attestation}}),200);assert.equal(reset.resetPolicy.used,1);assert.equal(reset.resetPolicy.remaining,2);assert.equal((await policy()).used,1);
 const after=stableState(await operator.begin('isolation level repeatable read read only',sql=>databaseFingerprint(sql,{schema:'public'})));assert.deepEqual(after,before,'Business rows and sequences stay byte-equivalent: products, stock, receipts, items, payments, users, shifts and other public data');
 stage='archive/current report correctness';const current=await json(await renderer('/api/reports?scope=current'),200),all=await json(await renderer('/api/reports?scope=all'),200);assert.equal(current.summary.receipts,0);assert.equal(all.summary.receipts,2);assert.equal((await operator.unsafe('select count(*)::int n from sales'))[0].n,2);
 const finalPreview=await json(await renderer('/api/sales-period'),200);assert.equal(finalPreview.resetPolicy.remaining,2);assert.equal(finalPreview.sales.receipts,0);
 console.log(JSON.stringify({pass:true,fixtureOnly:true,standaloneVersion:JSON.parse(await readFile(path.join(application,'package.json'),'utf8')).version,realPostgres:true,realStandaloneHttp:true,realDeviceSignatures:true,realVerifiedBackup:true,salesPreserved:2,currentReceipts:0,archivedReceipts:2,resetUsed:1,resetRemaining:2,businessFingerprintsUnchanged:true,unauthorizedAndForgedRequestsDenied:true}));
}catch(cause){console.error('Fixture packaged integration failed at:',stage);throw cause;}
finally{
 const failures=[],cleanup=async action=>{try{await action();}catch{failures.push('owned fixture cleanup failed');}};
 if(client)await cleanup(()=>stopServer(client.server,3000));if(gateway?.listening)await cleanup(()=>new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections();}));
 if(child&&child.exitCode===null)await cleanup(async()=>{child.kill();await Promise.race([once(child,'exit'),new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned fixture Next process did not exit')),5000);timer.unref();})]);});
 await cleanup(()=>appSql?.end({timeout:2}));await cleanup(()=>operator?.end({timeout:2}));await cleanup(()=>database?.close());
 if(previousBin===undefined)delete process.env.BIRKASSA_PG_BIN;else process.env.BIRKASSA_PG_BIN=previousBin;
 if(path.dirname(fixture)!==parent||!/^cp-[a-f0-9]{8}$/.test(path.basename(fixture)))throw Error('Invalid packaged fixture cleanup path');
 if(ownedFixture){
  try{await lstat(path.join(source,'postgres','postmaster.pid'));failures.push('fixture PG remains running');}catch(cause){if(cause.code!=='ENOENT')failures.push('fixture PG state is unknown');}
  if(!failures.length)await rm(fixture,{recursive:true,force:true});
 }
 if(failures.length)throw Error('Owned integration fixture cleanup did not complete; private files retained.');
}

function stopServer(server,timeout){return require('../desktop/update-lifecycle.cjs').stopServer(server,timeout);}
