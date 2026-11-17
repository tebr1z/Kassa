// Real HTTP and Ed25519 fixtures only; no application, database or real keys.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm,readFile,mkdir,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import protocol from '../desktop/central-protocol.cjs';
import {createCentralGateway,canReadRegistryStat} from '../desktop/central-gateway.mjs';

const {CENTRAL_PREFIX,MAX_BODY_BYTES,bodySha256,canonicalSigningData,signDeviceRequest,validateOriginalPath}=protocol;
const temporary=await mkdtemp(path.join(os.tmpdir(),'rm-central-gateway-test-'));
const registryFile=path.join(temporary,'devices.json'),deviceId=randomUUID(),otherDevice=randomUUID();
const {publicKey,privateKey}=generateKeyPairSync('ed25519'),otherKey=generateKeyPairSync('ed25519').privateKey;
const accessToken=randomBytes(32).toString('hex'),nativeToken=randomBytes(32).toString('hex');
const devices=[{id:deviceId,publicKeyPem:publicKey.export({type:'spki',format:'pem'}),active:true}];
const record=[],servers=new Set();
const listen=async server=>{servers.add(server);server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;};
const stop=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();servers.delete(server);});
const saveRegistry=async(value={schema:1,devices})=>writeFile(registryFile,JSON.stringify(value),{mode:0o600});
async function request(origin,target,{method='GET',headers={},body=Buffer.alloc(0)}={}){
 return new Promise((resolve,reject)=>{
  const url=new URL(origin),out=http.request({hostname:url.hostname,port:url.port,path:target,method,headers,agent:false},response=>{
   const chunks=[];response.on('data',part=>chunks.push(part));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',reject);
  });out.once('error',reject);out.end(body);
 });
}
try{
 const owner={uid:42,gid:7},stat=(mode,uid=42,gid=7,nlink=1,regular=true)=>({mode,uid,gid,nlink,isFile:()=>regular});
 assert.equal(canReadRegistryStat(stat(0o600),owner),true,'Private current-owner 0600 registry');
 assert.equal(canReadRegistryStat(stat(0o640,0,7),owner),true,'Root-controlled registry is read-only to the matching gateway group');
 for(const invalid of [stat(0o640,0,8),stat(0o600,99,7),stat(0o640,99,7),stat(0o600,0,7),stat(0o644,0,7),stat(0o660,0,7),stat(0o666,0,7),stat(0o750,0,7),stat(0o400),stat(0o4600),stat(0o600,42,7,2),stat(0o600,42,7,1,false)])assert.equal(canReadRegistryStat(invalid,owner),false);
 assert.equal(canReadRegistryStat(stat(0o640,0,7),{uid:0,gid:7}),true);assert.equal(canReadRegistryStat(stat(0o600,0,7),{uid:0,gid:7}),true);
 await saveRegistry();
 const backend=http.createServer(async(req,res)=>{
  const chunks=[];for await(const part of req)chunks.push(part);record.push({path:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks)});
  if(req.url==='/foreign-redirect'){res.writeHead(302,{location:'https://outside.invalid/must-not-follow'});res.end();return;}
  if(req.url==='/local-redirect'){res.writeHead(302,{location:'http://127.0.0.1:'+backend.address().port+'/after?x=1'});res.end();return;}
  if(req.url==='/stream'){res.writeHead(200,{'content-type':'application/octet-stream'});res.write('part-one');setImmediate(()=>res.end('-part-two'));return;}
  res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':['birkassa_session=fixture; Path=/; HttpOnly; SameSite=Strict','host_only=fixture; Domain=example.invalid; Path=/'],'X-RestaMarket-Desktop-Access':accessToken,'X-RM-Epoch':'not-public-here','Authorization':'Bearer '+nativeToken,'Access-Control-Allow-Origin':'*','X-RestaMarket-Backup-Sha256':'a'.repeat(64),'X-RestaMarket-Backup-Bytes':'123','X-RestaMarket-Backup-Name':'pre-sales-period-fixture.birkassa','X-RestaMarket-Backup-Private':'not-public'});res.end(JSON.stringify({ok:true}));
 });
 const backendOrigin=await listen(backend),config={registryFile,backendOrigin,accessToken,nativeToken};
 let gateway=createCentralGateway(config),origin=await listen(gateway);
 const challenge=async()=>{const result=await request(origin,CENTRAL_PREFIX+'/challenge');assert.equal(result.status,200);assert.equal(result.headers['access-control-allow-origin'],undefined);return JSON.parse(result.body);};
 let epoch=(await challenge()).epoch;assert.equal(epoch,gateway.epoch);assert.equal(Buffer.from(epoch,'base64url').length,32);
 const signed=(target,options={})=>{
  const method=options.method||'GET',body=options.body||Buffer.alloc(0),headers=signDeviceRequest({deviceId,epoch,method,path:target,body,privateKey,...options.signing});
  return request(origin,CENTRAL_PREFIX+target,{...options,method,body,headers:{...headers,...options.headers}});
 };
 for(const invalid of ['//evil.invalid/','/../api/auth','/%2e%2e/api/auth','/%252e%252e/api/auth','/one%2f..%2fauth','/one\\auth','/a#fragment','/a b','/%00','/%252foutside','/%zz'])assert.throws(()=>validateOriginalPath(invalid),undefined,invalid);
 for(const valid of ['/','/api/auth','/_next/static/a.js?v=1','/api/catalog?q=https%3A%2F%2Ftest.invalid','/mehsullar/%C3%A7aynik/'])assert.equal(validateOriginalPath(valid),valid);
 const canonical=JSON.parse(canonicalSigningData({deviceId,epoch,time:1234567890123,nonce:otherDevice,purpose:'renderer',method:'GET',path:'/a?b=1',bodySha256:bodySha256()}).toString());
 assert.deepEqual(canonical,[1,deviceId,epoch,'1234567890123',otherDevice,'renderer','GET','/a?b=1',bodySha256()]);
 assert.throws(()=>signDeviceRequest({deviceId,epoch,method:'TRACE',path:'/',privateKey}));
 assert.throws(()=>signDeviceRequest({deviceId,epoch,method:'POST',path:'/',body:Buffer.alloc(MAX_BODY_BYTES+1),privateKey}));
 assert.throws(()=>createCentralGateway({...config,backendOrigin:'http://example.invalid:5760'}));
 assert.throws(()=>createCentralGateway({...config,backendOrigin:'http://127.0.0.1:5760/somewhere'}));
 assert.throws(()=>createCentralGateway({...config,nativeToken:accessToken}));
 let result=await request(origin,CENTRAL_PREFIX+'/api/products');assert.equal(result.status,401);assert.equal(record.length,0);
 result=await request(origin,'/api/products');assert.equal(result.status,404);assert.equal(record.length,0);
 result=await signed('/api/products?query=red',{headers:{cookie:'birkassa_session=fixture',authorization:'Bearer forged','x-birkassa-user-id':'forged','x-birkassa-role':'admin','x-forwarded-host':'outside.invalid','x-forwarded-proto':'https','x-forwarded-for':'8.8.8.8',forwarded:'host=outside.invalid','x-real-ip':'8.8.8.8','x-restamarket-desktop-access':'forged','x-middleware-subrequest':'middleware',origin:'http://127.0.0.1:5760','sec-fetch-site':'same-origin'}});
 assert.equal(result.status,200);assert.equal(record.length,1);let received=record.at(-1);
 assert.equal(received.path,'/api/products?query=red');assert.equal(received.headers.host,'127.0.0.1:5760');assert.equal(received.headers.origin,'http://127.0.0.1:5760');assert.equal(received.headers.cookie,'birkassa_session=fixture');assert.equal(received.headers['x-restamarket-desktop-access'],accessToken);
 for(const name of ['authorization','x-birkassa-role','x-birkassa-user-id','x-forwarded-host','x-forwarded-proto','x-forwarded-for','forwarded','x-real-ip','x-middleware-subrequest',...Object.keys(signDeviceRequest({deviceId,epoch,method:'GET',path:'/',privateKey}))])assert.equal(received.headers[name],undefined,name);
 for(const name of ['authorization','x-restamarket-desktop-access','x-rm-epoch','access-control-allow-origin','x-restamarket-backup-sha256','x-restamarket-backup-bytes','x-restamarket-backup-name','x-restamarket-backup-private'])assert.equal(result.headers[name],undefined,name);
 assert.equal(result.headers['cache-control'],'private, no-store');assert.equal(result.headers['set-cookie'].length,2);assert.ok(result.headers['set-cookie'].every(cookie=>!/Domain=/i.test(cookie)));assert.match(result.headers['set-cookie'][0],/HttpOnly/);
 const beforeDenials=record.length;
 for(const options of [{signing:{privateKey:otherKey}},{signing:{deviceId:otherDevice}},{signing:{epoch:randomBytes(32).toString('base64url')}},{signing:{time:Date.now()-31000}},{signing:{time:Date.now()+31000}},{headers:{'x-rm-signature':'invalid'}},{headers:{'x-rm-time':'0'}},{headers:{origin:'https://outside.invalid'}},{headers:{origin:'null'}},{headers:{'sec-fetch-site':'cross-site'}},{headers:{'sec-fetch-site':'same-site'}}])assert.ok([401,403].includes((await signed('/api/products',options)).status));
 assert.equal(record.length,beforeDenials,'Invalid signatures and browser metadata never reach upstream');
 const replayHeaders=signDeviceRequest({deviceId,epoch,method:'GET',path:'/replay',privateKey});
 assert.equal((await request(origin,CENTRAL_PREFIX+'/replay',{headers:replayHeaders})).status,200);
 assert.equal((await request(origin,CENTRAL_PREFIX+'/replay',{headers:replayHeaders})).status,409);
 const concurrentHeaders=signDeviceRequest({deviceId,epoch,method:'GET',path:'/parallel',privateKey});
 assert.deepEqual((await Promise.all(Array.from({length:5},()=>request(origin,CENTRAL_PREFIX+'/parallel',{headers:concurrentHeaders})))).map(value=>value.status).sort(),[200,409,409,409,409]);
 const unchanged=record.length,bound=signDeviceRequest({deviceId,epoch,method:'POST',path:'/bound?a=1',body:Buffer.from('one'),privateKey});
 assert.equal((await request(origin,CENTRAL_PREFIX+'/bound?a=2',{method:'POST',headers:bound,body:Buffer.from('one')})).status,401);
 assert.equal((await request(origin,CENTRAL_PREFIX+'/bound?a=1',{method:'PUT',headers:bound,body:Buffer.from('one')})).status,401);
 assert.equal((await request(origin,CENTRAL_PREFIX+'/bound?a=1',{method:'POST',headers:bound,body:Buffer.from('two')})).status,401);
 assert.equal(record.length,unchanged,'Method, exact raw path/query and body are signature-bound');
 assert.equal((await signed('/api/sales-period',{method:'POST',body:Buffer.from('{}'),headers:{authorization:'Bearer forged'}})).status,200);assert.equal(record.at(-1).headers.authorization,undefined,'Renderer never obtains native attestation');
 assert.equal((await signed('/api/sales-period',{method:'POST',body:Buffer.from('{}'),signing:{purpose:'native'}})).status,200);assert.equal(record.at(-1).headers.authorization,'Bearer '+nativeToken);
 for(const target of ['/api/auth','/api/sales-period','/api/central-backup'])assert.equal((await signed(target,{signing:{purpose:'native'}})).status,200);
 result=await signed('/api/central-backup?fileName='+encodeURIComponent('pre-sales-period-fixture.birkassa'),{signing:{purpose:'native'}});assert.equal(result.status,200);assert.equal(record.at(-1).headers.authorization,'Bearer '+nativeToken);assert.equal(result.headers['x-restamarket-backup-sha256'],'a'.repeat(64));assert.equal(result.headers['x-restamarket-backup-bytes'],'123');assert.equal(result.headers['x-restamarket-backup-name'],'pre-sales-period-fixture.birkassa');assert.equal(result.headers['x-restamarket-backup-private'],undefined);assert.equal(result.headers.authorization,undefined);
 for(const target of ['/api/desktop-poll','/api/desktop-lock'])assert.equal((await signed(target,{method:'POST',signing:{purpose:'native'}})).status,200);
 const nativeCount=record.length;for(const [method,target]of [['GET','/api/products'],['DELETE','/api/sales-period'],['POST','/api/auth'],['GET','/api/auth?any=true'],['GET','/api/central-backup?all=true'],['GET','/api/central-backup/'],['GET','/api/central-backup?fileName=one.birkassa&fileName=two.birkassa'],['GET','/api/central-backup?fileName=one.birkassa&extra=1'],['GET','/api/central-backup?fileName=..%2Fone.birkassa'],['GET','/api/central-backup?fileName=one.dump'],['GET','/api/central-backup?fileName='+('a'.repeat(180)+'.birkassa')]])assert.equal((await signed(target,{method,signing:{purpose:'native'}})).status,403);
 assert.equal(record.length,nativeCount);
 assert.equal((await signed('/foreign-redirect')).status,502);result=await signed('/local-redirect');assert.equal(result.status,302);assert.equal(result.headers.location,'/after?x=1');
 result=await signed('/stream');assert.equal(result.body.toString(),'part-one-part-two');
 await saveRegistry({schema:1,devices:[{...devices[0],active:false}]});const revoked=record.length;assert.equal((await signed('/api/products')).status,401);assert.equal(record.length,revoked);
 await saveRegistry({schema:1,devices:[]});assert.equal((await signed('/api/products')).status,401);await saveRegistry();assert.equal((await request(origin,CENTRAL_PREFIX+'/replay',{headers:replayHeaders})).status,409,'Registry removal/re-addition never forgets a consumed nonce');
 await writeFile(registryFile,'broken',{mode:0o600});assert.equal((await signed('/api/products')).status,503);await saveRegistry();
 await saveRegistry({schema:1,devices:[devices[0],devices[0]]});assert.equal((await signed('/api/products')).status,503);await saveRegistry();
 const oldEpoch=epoch,oldHeaders=signDeviceRequest({deviceId,epoch,method:'GET',path:'/after-restart',privateKey});await stop(gateway);gateway=createCentralGateway(config);origin=await listen(gateway);epoch=(await challenge()).epoch;assert.notEqual(epoch,oldEpoch);
 const restartedCount=record.length;assert.equal((await request(origin,CENTRAL_PREFIX+'/after-restart',{headers:oldHeaders})).status,401);assert.equal(record.length,restartedCount);assert.equal((await signed('/after-restart')).status,200);
 await stop(gateway);gateway=createCentralGateway({...config,maxNoncesPerDevice:2});origin=await listen(gateway);epoch=(await challenge()).epoch;
 const retained=signDeviceRequest({deviceId,epoch,method:'GET',path:'/retained',privateKey});assert.equal((await request(origin,CENTRAL_PREFIX+'/retained',{headers:retained})).status,200);assert.equal((await signed('/second')).status,200);assert.equal((await signed('/third')).status,429);assert.equal((await request(origin,CENTRAL_PREFIX+'/retained',{headers:retained})).status,409,'A saturated cache does not evict replay evidence');
 await stop(gateway);gateway=createCentralGateway({...config,maxRequestsPerDevice:1});origin=await listen(gateway);epoch=(await challenge()).epoch;assert.equal((await signed('/first')).status,200);assert.equal((await signed('/limited')).status,429);
 await stop(gateway);gateway=createCentralGateway({...config,maxBodyBytes:8});origin=await listen(gateway);epoch=(await challenge()).epoch;const sizeCount=record.length;assert.equal((await signed('/oversize',{method:'POST',body:Buffer.from('123456789')})).status,413);assert.equal(record.length,sizeCount);
 const malformedHeaders=signDeviceRequest({deviceId,epoch,method:'GET',path:'/duplicated',privateKey});malformedHeaders['x-rm-device-id']=[deviceId,deviceId];assert.equal((await request(origin,CENTRAL_PREFIX+'/duplicated',{headers:malformedHeaders})).status,401);
 const rawSign=(target)=>({'x-rm-device-id':deviceId,'x-rm-epoch':epoch,'x-rm-time':String(Date.now()),'x-rm-nonce':randomUUID(),'x-rm-purpose':'renderer','x-rm-body-sha256':bodySha256(),'x-rm-signature':sign(null,Buffer.from(target),privateKey).toString('base64')});
 for(const target of ['/../api/auth','/%2e%2e/api/auth','//outside.invalid/','/%252foutside'])assert.equal((await request(origin,CENTRAL_PREFIX+target,{headers:rawSign(target)})).status,400);
 const actualDirectory=path.join(temporary,'actual-registry'),linkedDirectory=path.join(temporary,'linked-registry');await mkdir(actualDirectory,{mode:0o700});await writeFile(path.join(actualDirectory,'devices.json'),JSON.stringify({schema:1,devices}),{mode:0o600});await symlink(actualDirectory,linkedDirectory,process.platform==='win32'?'junction':'dir');
 await stop(gateway);gateway=createCentralGateway({...config,registryFile:path.join(linkedDirectory,'devices.json')});origin=await listen(gateway);epoch=(await challenge()).epoch;const beforeLink=record.length;assert.equal((await signed('/api/auth')).status,503);assert.equal(record.length,beforeLink,'A linked registry ancestor is rejected before upstream access');
 const startup=await readFile('scripts/start-central-gateway.mjs','utf8');assert.ok(startup.includes("server.listen(port,'127.0.0.1'"));assert.ok(!startup.includes('DATABASE_URL'));
 console.log('PASS: isolated real-HTTP central gateway, Ed25519 method/path/query/body binding, separate renderer/native capabilities, exact native allowlist, startup epoch and nonce replay protection, bounded fail-closed limits, registry revocation, origin/forwarding/identity sanitation, private cookies, redirects and streaming. No real DB, server, device key or user data.');
}finally{
 for(const server of [...servers])await stop(server);
 const resolved=path.resolve(temporary);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('rm-central-gateway-test-'))throw Error('Unexpected central gateway fixture path');await rm(resolved,{recursive:true,force:true});
}
