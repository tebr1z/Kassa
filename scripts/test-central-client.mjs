// Generated-key, private temporary profiles and real loopback HTTP fixtures.
// No installed desktop profile, Windows DPAPI key or database is read.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,readdir,mkdir,lstat,link,symlink,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomUUID,randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {createCentralGateway} from '../desktop/central-gateway.mjs';
const require=createRequire(import.meta.url),{createCentralClient,centralIdentity,downloadCentralBackup,DEFAULT_CENTRAL_ORIGIN}=require('../desktop/central-client.cjs');
const temporary=await mkdtemp(path.join(os.tmpdir(),'rm-central-client-test-')),registryFile=path.join(temporary,'devices.json');
const servers=new Set(),clients=[],records=[],signedCalls=[];let slowStarted,slowClosed;
const listen=async server=>{servers.add(server);server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;};
const stop=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();servers.delete(server);});
const unusedPort=async()=>{const probe=http.createServer();await listen(probe);const result=probe.address().port;await stop(probe);return result;};
const accessToken=randomBytes(32).toString('hex'),nativeToken=randomBytes(32).toString('hex'),deviceId=randomUUID(),keys=generateKeyPairSync('ed25519');
const identity={id:deviceId,publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),privateKey:keys.privateKey};
const registry=active=>writeFile(registryFile,JSON.stringify({schema:1,devices:[{id:identity.id,publicKeyPem:identity.publicKeyPem,active}]}),{mode:0o600});
async function local(origin,target,{headers={},method='GET',body=Buffer.alloc(0)}={}){
 return new Promise((resolve,reject)=>{const url=new URL(origin),out=http.request({hostname:'127.0.0.1',port:url.port,path:target,method,headers,agent:false},response=>{const chunks=[];response.on('data',part=>chunks.push(part));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',reject);});out.once('error',reject);out.end(body);});
}
function storage(secret=randomBytes(32)){
 return {isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>process.platform==='win32'?'dpapi':'fixture',encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv),bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]);},decryptString(value){const decipher=createDecipheriv('aes-256-gcm',secret,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');}};
}
const payload=Buffer.from('Isolated fixture backup archive; this is not production data.');
const backupResponse=(fileName,overrides={},body=payload)=>new Response(body,{headers:{'content-type':'application/x-birkassa-backup','x-restamarket-backup-name':fileName,'x-restamarket-backup-sha256':createHash('sha256').update(payload).digest('hex'),'x-restamarket-backup-bytes':String(payload.length),...overrides}});
try{
 const profile=path.join(temporary,'identity-profile'),safe=storage();
 await assert.rejects(centralIdentity(profile,{isEncryptionAvailable:()=>false}));
 await assert.rejects(centralIdentity(profile,{...safe,getSelectedStorageBackend:()=> 'basic_text'}));
 const results=await Promise.allSettled([centralIdentity(profile,safe),centralIdentity(profile,safe)]);assert.ok(results.some(value=>value.status==='fulfilled'));
 const first=results.find(value=>value.status==='fulfilled').value,second=await centralIdentity(profile,safe);assert.equal(first.id,second.id);assert.equal(first.publicKeyPem,second.publicKeyPem);
 for(const item of results.filter(value=>value.status==='fulfilled'))assert.equal(item.value.id,first.id);
 const identityFile=path.join(profile,'.private','central-device','identity.json'),identityBytes=await readFile(identityFile,'utf8'),publicBytes=await readFile(first.registration,'utf8');
 assert.ok(!identityBytes.includes('BEGIN PRIVATE KEY'));assert.ok(!publicBytes.includes('privateKey'));assert.deepEqual(Object.keys(JSON.parse(publicBytes)).sort(),['active','id','publicKeyPem','schema']);assert.equal((await lstat(identityFile)).nlink,1);
 await assert.rejects(centralIdentity(profile,storage()));assert.equal(await readFile(identityFile,'utf8'),identityBytes,'A decryption failure never replaces an existing device key');
 const hardlinked=path.join(temporary,'identity-hardlink');await mkdir(path.join(hardlinked,'.private','central-device'),{recursive:true,mode:0o700});await link(identityFile,path.join(hardlinked,'.private','central-device','identity.json'));await assert.rejects(centralIdentity(hardlinked,safe));
 const linkedRoot=path.join(temporary,'identity-junction');await symlink(profile,linkedRoot,process.platform==='win32'?'junction':'dir');await assert.rejects(centralIdentity(linkedRoot,safe));
 const corrupt=path.join(temporary,'identity-corrupt'),corruptDir=path.join(corrupt,'.private','central-device');await mkdir(corruptDir,{recursive:true,mode:0o700});await writeFile(path.join(corruptDir,'identity.json'),'broken',{mode:0o600});await assert.rejects(centralIdentity(corrupt,safe));assert.equal(await readFile(path.join(corruptDir,'identity.json'),'utf8'),'broken');
 const lockProfile=path.join(temporary,'identity-locked'),lockDir=path.join(lockProfile,'.private','central-device');await mkdir(lockDir,{recursive:true,mode:0o700});await writeFile(path.join(lockDir,'identity.lock'),'held',{mode:0o600});await assert.rejects(centralIdentity(lockProfile,safe));assert.equal(await readFile(path.join(lockDir,'identity.lock'),'utf8'),'held');
 await registry(true);
 const backend=http.createServer(async(req,res)=>{
  const chunks=[];for await(const part of req)chunks.push(part);records.push({path:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks)});
  if(req.url==='/uncertain-write'){req.socket.destroy();return;}
  if(req.url==='/slow-fixture'){slowStarted?.();const timer=setTimeout(()=>res.end('late fixture'),1000);res.once('close',()=>{clearTimeout(timer);slowClosed?.();});return;}
  if(req.url.startsWith('/api/central-backup?')){const name=new URL(req.url,'http://fixture.invalid').searchParams.get('fileName');const compressed=name.startsWith('compressed'),bytes=compressed?gzipSync(payload):payload;res.writeHead(200,{'content-type':'application/x-birkassa-backup','content-length':String(bytes.length),...(compressed?{'content-encoding':'gzip'}:{}),'x-restamarket-backup-name':name,'x-restamarket-backup-bytes':String(payload.length),'x-restamarket-backup-sha256':createHash('sha256').update(payload).digest('hex')});res.end(bytes);return;}
  if(req.url==='/compressed'){const bytes=gzipSync(Buffer.from('streaming decoded fixture'));res.writeHead(200,{'content-type':'text/plain','content-encoding':'gzip','content-length':String(bytes.length)});res.end(bytes);return;}
  res.writeHead(req.method==='POST'?201:200,{'content-type':'application/json','set-cookie':'birkassa_session=fixture; Path=/; HttpOnly; SameSite=Strict'});res.end(JSON.stringify({ok:true}));
 });
 const backendOrigin=await listen(backend),port=await unusedPort(),localOrigin='http://127.0.0.1:'+port;
 const gateway=createCentralGateway({registryFile,backendOrigin,accessToken,nativeToken,desktopOrigin:localOrigin}),gatewayOrigin=await listen(gateway);
 let challengeOverride,dropNext=false,challengeRequests=0;
 const fetchImpl=async(url,options)=>{
  assert.equal(new URL(url).origin,DEFAULT_CENTRAL_ORIGIN);assert.ok(url.startsWith(DEFAULT_CENTRAL_ORIGIN+'/desktop-private/'));
  if(url.endsWith('/challenge')){challengeRequests++;if(challengeOverride!==undefined)return new Response(JSON.stringify(challengeOverride),{headers:{'content-type':'application/json'}});}
  else{signedCalls.push({url,options});if(dropNext){dropNext=false;throw Error('Fixture network failure');}}
  return fetch(gatewayOrigin+new URL(url).pathname+new URL(url).search,options);
 };
 let client=await createCentralClient({identity,accessToken,nativeToken,port,fetchImpl});clients.push(client);assert.equal(client.localOrigin,localOrigin);assert.equal(client.server.address().address,'127.0.0.1');assert.equal(client.server.exitCode,null);assert.equal(client.server.signalCode,null);
 for(const insecure of ['http://kassa.nex.autos','https://outside.invalid','https://kassa.nex.autos/path','https://user:password@kassa.nex.autos/'])await assert.rejects(createCentralClient({identity,accessToken,nativeToken,port:await unusedPort(),fetchImpl,origin:insecure}));
 await assert.rejects(createCentralClient({identity,accessToken,nativeToken,port:0,fetchImpl}));
 let response=await local(localOrigin,'/api/auth');assert.equal(response.status,403);assert.equal(signedCalls.length,0,'An ordinary browser never causes a signed central request');
 const cap={'x-restamarket-desktop-access':accessToken};
 for(const headers of [{...cap,host:'outside.invalid'},{...cap,origin:'https://outside.invalid'},{...cap,'sec-fetch-site':'cross-site'},{...cap,'sec-fetch-site':'same-site'},{...cap,'x-restamarket-desktop-access':[accessToken,accessToken]}])assert.equal((await local(localOrigin,'/api/auth',{headers})).status,403);
 assert.equal(signedCalls.length,0);
 response=await local(localOrigin,'/api/products?color=red',{headers:{...cap,cookie:'birkassa_session=fixture',origin:localOrigin,'sec-fetch-site':'same-origin','x-rm-purpose':'native','x-rm-device-id':randomUUID(),'x-rm-signature':'forged','x-birkassa-role':'admin','x-forwarded-host':'outside.invalid',authorization:'Bearer forged'}});
 assert.equal(response.status,200);assert.equal(challengeRequests,1);let record=records.at(-1);assert.equal(record.path,'/api/products?color=red');assert.equal(record.headers.authorization,undefined);assert.equal(record.headers['x-birkassa-role'],undefined);assert.equal(record.headers['x-forwarded-host'],undefined);assert.equal(record.headers.cookie,'birkassa_session=fixture');assert.equal(signedCalls.at(-1).options.headers['x-rm-purpose'],'renderer');assert.equal(signedCalls.at(-1).options.headers['x-rm-device-id'],deviceId);
 const body=Buffer.from('{"item":"qırmızı","count":2}');response=await local(localOrigin,'/api/sales',{method:'POST',headers:{...cap,'content-type':'application/json'},body});assert.equal(response.status,201);assert.deepEqual(records.at(-1).body,body);assert.equal(records.at(-1).headers.authorization,undefined);
 response=await local(localOrigin,'/api/sales-period',{method:'POST',headers:{...cap,authorization:'Bearer '+nativeToken},body:Buffer.from('{}')});assert.equal(response.status,201);assert.equal(records.at(-1).headers.authorization,'Bearer '+nativeToken);assert.equal(signedCalls.at(-1).options.headers['x-rm-purpose'],'native');
 const privilegedCount=signedCalls.length;assert.equal((await local(localOrigin,'/api/products',{headers:{...cap,authorization:'Bearer '+nativeToken}})).status,403);assert.equal(signedCalls.length,privilegedCount);
 const native=await client.request('/api/auth',{purpose:'native',headers:{cookie:'birkassa_session=fixture','x-rm-purpose':'renderer'}});assert.equal(native.status,200);await native.arrayBuffer();assert.equal(records.at(-1).headers.authorization,'Bearer '+nativeToken);assert.equal(records.at(-1).headers.cookie,'birkassa_session=fixture');
 response=await local(localOrigin,'/compressed',{headers:cap});assert.equal(response.body.toString(),'streaming decoded fixture');assert.equal(response.headers['content-encoding'],undefined);assert.equal(response.headers['content-length'],undefined);
 const writesBefore=records.length;response=await local(localOrigin,'/uncertain-write',{method:'POST',headers:cap,body:Buffer.from('{}')});assert.equal(response.status,502);assert.equal(records.length,writesBefore+1,'A failed-after-commit write is not automatically retried');
 dropNext=true;const callCount=signedCalls.length;await assert.rejects(client.request('/api/sales',{method:'POST',body:'{}'}));assert.equal(signedCalls.length,callCount+1);
 const started=new Promise(resolve=>{slowStarted=resolve;}),closed=new Promise(resolve=>{slowClosed=resolve;}),slowRequest=http.request({hostname:'127.0.0.1',port,path:'/slow-fixture',headers:cap,agent:false});slowRequest.on('error',()=>{});slowRequest.end();await started;slowRequest.destroy();await Promise.race([closed,new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Disconnected proxy did not cancel upstream')),2000);timer.unref();})]);
 await registry(false);const revokedCount=records.length;const denied=await client.request('/api/auth',{purpose:'native'});assert.equal(denied.status,401);await denied.arrayBuffer();assert.equal(records.length,revokedCount);const previousChallenges=challengeRequests;await registry(true);const recovered=await client.request('/api/auth',{purpose:'native'});assert.equal(recovered.status,200);await recovered.arrayBuffer();assert.equal(challengeRequests,previousChallenges+1,'401 invalidates the cached challenge, without retrying the failed request');
 const downloads=path.join(temporary,'downloads');await mkdir(downloads,{mode:0o700});
 for(const fileName of ['safe-fixture.birkassa','compressed-fixture.birkassa']){const backup=await client.request('/api/central-backup?fileName='+encodeURIComponent(fileName),{purpose:'native',headers:{cookie:'birkassa_session=fixture'}}),destination=path.join(downloads,fileName),metadata=await downloadCentralBackup(backup,destination);assert.deepEqual(await readFile(destination),payload);assert.equal(metadata.fileName,fileName);assert.equal(metadata.bytes,payload.length);}
 const existing=path.join(downloads,'safe-fixture.birkassa');await assert.rejects(downloadCentralBackup(backupResponse('safe-fixture.birkassa'),existing));assert.deepEqual(await readFile(existing),payload,'An existing backup is never overwritten');
 for(const [name,overrides,bytes]of [['wrong-hash.birkassa',{'x-restamarket-backup-sha256':'f'.repeat(64)},payload],['short.birkassa',{},payload.subarray(0,4)],['oversize.birkassa',{'x-restamarket-backup-bytes':'3'},payload],['bad-meta.birkassa',{'x-restamarket-backup-bytes':'NaN'},payload],['wrong-name.birkassa',{'x-restamarket-backup-name':'different.birkassa'},payload],['invalid-name.birkassa',{'x-restamarket-backup-name':'../outside.birkassa'},payload]]){const destination=path.join(downloads,name);await assert.rejects(downloadCentralBackup(backupResponse(name,overrides,bytes),destination));await assert.rejects(lstat(destination),{code:'ENOENT'});}
 assert.ok((await readdir(downloads)).every(name=>!name.startsWith('.restamarket-backup-')),'Failed downloads leave no partial files or work folders');
 const linkedDownloads=path.join(temporary,'downloads-junction');await symlink(downloads,linkedDownloads,process.platform==='win32'?'junction':'dir');await assert.rejects(downloadCentralBackup(backupResponse('linked.birkassa'),path.join(linkedDownloads,'linked.birkassa')));
 const {stopServer}=require('../desktop/update-lifecycle.cjs');await stopServer(client.server,2000);assert.equal(client.server.exitCode,0);clients.pop();
 const epoch=randomBytes(32).toString('base64url');
 for(const value of [{schema:1,epoch,serverTime:'2026-01-01T00:00:00Z'},{schema:1,epoch,serverTime:null},{schema:1,epoch:'short',serverTime:Date.now()},{schema:1,epoch,serverTime:Date.now()-26000},{schema:1,epoch,serverTime:Date.now()+26000},{schema:2,epoch,serverTime:Date.now()}]){
  challengeOverride=value;const badClient=await createCentralClient({identity,accessToken,nativeToken,port:await unusedPort(),fetchImpl});clients.push(badClient);const count=signedCalls.length;await assert.rejects(badClient.request('/api/auth'));assert.equal(signedCalls.length,count,'An invalid numeric-time challenge never produces a signature');await stopServer(badClient.server,2000);clients.pop();
 }
 console.log('PASS: generated DPAPI-like identity fixtures, atomic no-overwrite private identity/public registration and link/lock guards; real central client→gateway→HTTP backend signatures; numeric challenge/time checks; exact local capability/host/origin, native isolation, raw bodies, no retries, revocation, compression, streamed backup hash/size/name/no-overwrite/cleanup and updater lifecycle. No installed profile, real DPAPI key, server or DB.');
}finally{
 for(const client of clients)await new Promise(resolve=>{if(!client.server.listening){resolve();return;}client.server.once('close',resolve);client.server.kill();});
 for(const server of [...servers])await stop(server);
 const resolved=path.resolve(temporary);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('rm-central-client-test-'))throw Error('Unexpected client fixture cleanup path');await rm(resolved,{recursive:true,force:true});
}
