import http from 'node:http';
import {open,lstat,constants} from 'node:fs/promises';
import path from 'node:path';
import {createPublicKey,randomBytes,verify,timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import protocol from './central-protocol.cjs';

const {CENTRAL_PREFIX,MAX_BODY_BYTES,DEVICE_ID,bodySha256,canonicalSigningData,validateOriginalPath}=protocol;
const protocolHeaders=['x-rm-device-id','x-rm-epoch','x-rm-time','x-rm-nonce','x-rm-purpose','x-rm-body-sha256','x-rm-signature'];
const nativeRequests=new Set(['POST /api/sales-period','POST /api/desktop-poll','POST /api/desktop-lock','GET /api/central-backup','GET /api/auth','GET /api/sales-period']);
const backupHeaders=['x-restamarket-backup-sha256','x-restamarket-backup-bytes','x-restamarket-backup-name'];
const hopHeaders=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','expect']);
const reject=(status=401)=>Object.assign(Error('Private gateway request rejected'),{status});
function loopbackOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('An exact loopback backend origin is required');
 return url;
}
function privateToken(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('Separate 32-byte private gateway tokens are required');return value;}
function equal(left,right){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
function nativeAllowed(method,originalPath){
 if(nativeRequests.has(method+' '+originalPath))return true;
 if(method!=='GET'||!originalPath.startsWith('/api/central-backup?'))return false;
 const parameters=new URLSearchParams(originalPath.slice(originalPath.indexOf('?')+1)),entries=[...parameters.entries()];
 if(entries.length!==1||entries[0][0]!=='fileName')return false;
 const fileName=entries[0][1];return fileName.length<=180&&/^[^\\/:*?"<>|\x00-\x1f\x7f]+\.birkassa$/i.test(fileName);
}
function boundedInteger(value,fallback,min,max){const result=value===undefined?fallback:value;if(!Number.isInteger(result)||result<min||result>max)throw Error('Invalid private gateway limit');return result;}
export function canReadRegistryStat(stat,{uid=process.getuid?.(),gid=process.getgid?.()}={}){
 if(!Number.isInteger(uid)||uid<0||!Number.isInteger(gid)||gid<0||!stat||typeof stat.isFile!=='function'||!stat.isFile()||stat.nlink!==1)return false;
 const mode=stat.mode&0o7777;
 // Production: root owns the registry and the gateway's primary group may
 // only read it. Private owner-only registries also support isolated fixtures.
 return stat.uid===uid&&mode===0o600||stat.uid===0&&stat.gid===gid&&mode===0o640;
}
async function safeRegistryAncestors(file){
 if(path.resolve(file)!==file)throw reject(503);
 const uid=process.getuid?.();let directory=path.dirname(file),privateAnchor=false,depth=0;
 for(;;){
  if(++depth>256)throw reject(503);
  const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw reject(503);
  if(process.platform!=='win32'){
   if(stat.uid!==0&&stat.uid!==uid)throw reject(503);
   if((stat.mode&0o022)!==0){
    // /tmp and /var/tmp can precede an owner-only fixture directory. Sticky
    // root ownership protects that private anchor from other users; a writable
    // immediate parent, an untrusted owner or a link is never accepted.
    if(!privateAnchor||stat.uid!==0||(stat.mode&0o1000)===0)throw reject(503);
   }
   if(stat.uid===uid&&(stat.mode&0o077)===0)privateAnchor=true;
  }
  const parent=path.dirname(directory);if(parent===directory)return;directory=parent;
 }
}
async function readRegistry(file){
 let handle;
 try{
  await safeRegistryAncestors(file);
  const linkInfo=await lstat(file);if(!linkInfo.isFile()||linkInfo.isSymbolicLink())throw reject(503);
  handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  const stat=await handle.stat();
  if(!stat.isFile()||stat.nlink!==1||stat.ino!==linkInfo.ino||stat.dev!==linkInfo.dev||stat.size>128*1024||(process.platform!=='win32'&&!canReadRegistryStat(stat)))throw reject(503);
  const source=await handle.readFile({encoding:'utf8'});if(Buffer.byteLength(source)>128*1024)throw reject(503);
  const value=JSON.parse(source);
  if(!value||Object.keys(value).sort().join(',')!=='devices,schema'||value.schema!==1||!Array.isArray(value.devices)||value.devices.length>256)throw reject(503);
  const devices=new Map();
  for(const device of value.devices){
   if(!device||Object.keys(device).sort().join(',')!=='active,id,publicKeyPem'||!DEVICE_ID.test(device.id)||typeof device.active!=='boolean'||typeof device.publicKeyPem!=='string'||device.publicKeyPem.length>2048||!device.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')||devices.has(device.id))throw reject(503);
   const publicKey=createPublicKey(device.publicKeyPem);if(publicKey.asymmetricKeyType!=='ed25519')throw reject(503);
   devices.set(device.id,{active:device.active,publicKey});
  }
  return devices;
 }catch{throw reject(503);}finally{await handle?.close();}
}
function singleProtocolHeaders(request){
 const result={};
 for(const name of protocolHeaders){
  let count=0;for(let i=0;i<request.rawHeaders.length;i+=2)if(request.rawHeaders[i].toLowerCase()===name)count++;
  const value=request.headers[name];if(count!==1||typeof value!=='string'||value.length>1024)throw reject();result[name]=value;
 }
 return {deviceId:result['x-rm-device-id'],epoch:result['x-rm-epoch'],time:result['x-rm-time'],nonce:result['x-rm-nonce'],purpose:result['x-rm-purpose'],bodySha256:result['x-rm-body-sha256'],signature:result['x-rm-signature']};
}
function readBody(request,maximum){
 return new Promise((resolve,rejectBody)=>{
  let bytes=0,settled=false;const parts=[];
  const finish=(error,body)=>{if(settled)return;settled=true;clearTimeout(timer);request.removeListener('data',data);request.removeListener('end',end);request.removeListener('aborted',aborted);request.removeListener('error',failed);if(error){request.resume();rejectBody(error);}else resolve(body);};
  const data=part=>{bytes+=part.length;if(bytes>maximum){finish(reject(413));return;}parts.push(part);};
  const end=()=>finish(null,Buffer.concat(parts,bytes)),aborted=()=>finish(reject(400)),failed=()=>finish(reject(400));
  const timer=setTimeout(()=>finish(reject(408)),15000);timer.unref();
  request.on('data',data);request.once('end',end);request.once('aborted',aborted);request.once('error',failed);
 });
}
function connectionNames(headers){return new Set(String(headers.connection||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));}
function sensitive(name){return name==='authorization'||name==='forwarded'||name==='x-real-ip'||name==='x-original-url'||name==='x-rewrite-url'||name.startsWith('x-forwarded-')||name.startsWith('x-birkassa-')||name.startsWith('x-restamarket-')||name.startsWith('x-rm-')||name.startsWith('x-middleware-')||name.startsWith('x-nextjs-')||name.startsWith('x-vercel-')||name.startsWith('x-invoke-')||name.startsWith('x-now-');}
function forwardedHeaders(request,desktop,accessToken,nativeToken,purpose,body){
 const headers={},connection=connectionNames(request.headers);
 for(const [name,value]of Object.entries(request.headers))if(value!==undefined&&!hopHeaders.has(name)&&!connection.has(name)&&!sensitive(name)&&!['host','origin','content-length'].includes(name))headers[name]=value;
 headers.host=desktop.host;headers['x-restamarket-desktop-access']=accessToken;
 if(request.headers.origin!==undefined)headers.origin=desktop.origin;
 if(purpose==='native')headers.authorization='Bearer '+nativeToken;
 if(body.length||!['GET','HEAD'].includes(request.method))headers['content-length']=String(body.length);
 return headers;
}
function responseHeaders(upstream,backend,desktop,purpose,originalPath){
 const headers={},connection=connectionNames(upstream.headers);
 for(const [name,value]of Object.entries(upstream.headers))if(value!==undefined&&!hopHeaders.has(name)&&!connection.has(name)&&!sensitive(name)&&!name.startsWith('access-control-')&&!['location','content-location','set-cookie'].includes(name))headers[name]=value;
 for(const name of ['location','content-location'])if(upstream.headers[name]){
  const raw=upstream.headers[name];if(typeof raw!=='string')throw reject(502);
  let target;try{target=new URL(raw,backend);}catch{throw reject(502);}
  if(![backend.origin,desktop.origin].includes(target.origin)||target.username||target.password||target.hash)throw reject(502);
  validateOriginalPath(target.pathname+target.search);headers[name]=target.pathname+target.search;
 }
 if(upstream.headers['set-cookie'])headers['set-cookie']=upstream.headers['set-cookie'].map(cookie=>cookie.replace(/;\s*Domain\s*=[^;]*/gi,''));
 if(purpose==='native'&&(originalPath==='/api/central-backup'||originalPath.startsWith('/api/central-backup?')))for(const name of backupHeaders){
  const value=upstream.headers[name];if(value!==undefined){if(typeof value!=='string'||value.length>2048)throw reject(502);headers[name]=value;}
 }
 headers['cache-control']='private, no-store';headers['x-content-type-options']='nosniff';return headers;
}
async function forward(request,response,{backend,desktop,accessToken,nativeToken,purpose,originalPath,body}){
 await new Promise((resolve,rejectForward)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:backend.port||80,path:originalPath,method:request.method,headers:forwardedHeaders(request,desktop,accessToken,nativeToken,purpose,body),agent:false},reply=>{
   try{const headers=responseHeaders(reply,backend,desktop,purpose,originalPath);response.writeHead(reply.statusCode||502,headers);}catch(error){reply.destroy();upstream.destroy();rejectForward(error);return;}
   pipeline(reply,response).then(resolve,rejectForward);
  });
  upstream.setTimeout(120000,()=>upstream.destroy(reject(504)));
  upstream.once('error',()=>rejectForward(reject(502)));
  response.once('close',()=>{if(!response.writableEnded)upstream.destroy();});
  upstream.end(body);
 });
}
function json(response,status,value){
 if(response.headersSent){response.destroy();return;}
 response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Connection':'close'});response.end(JSON.stringify(value));
}

// This gateway contains no database credentials. The separate Next backend is
// loopback-only and independently requires the injected capability plus RBAC.
export function createCentralGateway({registryFile,backendOrigin,accessToken,nativeToken,desktopOrigin='http://127.0.0.1:5760',clock=Date.now,clockSkewMs,maxBodyBytes,maxNoncesPerDevice,maxRequestsPerDevice,maxConcurrent,globalBurst,globalRequestsPerSecond}={}){
 if(typeof registryFile!=='string'||!path.isAbsolute(registryFile))throw Error('An absolute private registry file is required');
 const backend=loopbackOrigin(backendOrigin),desktop=loopbackOrigin(desktopOrigin);privateToken(accessToken);privateToken(nativeToken);if(equal(accessToken,nativeToken))throw Error('Gateway access and native attestation tokens must differ');
 const skew=boundedInteger(clockSkewMs,30000,1,30000),bodyLimit=boundedInteger(maxBodyBytes,MAX_BODY_BYTES,1,MAX_BODY_BYTES),nonceLimit=boundedInteger(maxNoncesPerDevice,4096,1,16384),rateLimit=boundedInteger(maxRequestsPerDevice,3000,1,10000),concurrentLimit=boundedInteger(maxConcurrent,16,1,64),burst=boundedInteger(globalBurst,128,1,1024),replenish=boundedInteger(globalRequestsPerSecond,32,1,512);
 const epoch=randomBytes(32).toString('base64url'),states=new Map();let concurrent=0,bucket=burst,lastBucket=clock();
 const handle=async(request,response)=>{
  const now=clock();bucket=Math.min(burst,bucket+Math.max(0,now-lastBucket)*replenish/1000);lastBucket=now;
  if(bucket<1||concurrent>=concurrentLimit){json(response,429,{error:'Private gateway request limited'});return;}bucket--;concurrent++;
  try{
   if(request.headers.origin!==undefined&&request.headers.origin!==desktop.origin)throw reject(403);
   if(request.headers['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(request.headers['sec-fetch-site']))throw reject(403);
   if(request.url===CENTRAL_PREFIX+'/challenge'&&request.method==='GET'){
    if(request.headers['transfer-encoding']||Number(request.headers['content-length']||0)!==0)throw reject(400);
    json(response,200,{schema:1,epoch,serverTime:now});return;
   }
   if(typeof request.url!=='string'||!request.url.startsWith(CENTRAL_PREFIX+'/'))throw reject(404);
   const originalPath=request.url.slice(CENTRAL_PREFIX.length);try{validateOriginalPath(originalPath);}catch{throw reject(400);}
   const fields=singleProtocolHeaders(request);if(!equal(fields.epoch,epoch)||Math.abs(Number(fields.time)-now)>skew)throw reject();
   let signed;try{signed=canonicalSigningData({...fields,method:request.method,path:originalPath});}catch{throw reject();}
   if(!/^[A-Za-z0-9+/]{86}==$/.test(fields.signature))throw reject();const signature=Buffer.from(fields.signature,'base64');if(signature.length!==64||signature.toString('base64')!==fields.signature)throw reject();
   const devices=await readRegistry(registryFile),device=devices.get(fields.deviceId);if(!device?.active||!verify(null,signed,device.publicKey,signature))throw reject();
   if(fields.purpose==='native'&&!nativeAllowed(request.method,originalPath))throw reject(403);
   // A signed nonce is retained for its entire remaining timestamp validity.
   // Never evict an unexpired nonce to make room: saturation fails closed.
   // Removing and later re-adding an ID in the registry must not erase replay
   // evidence. Keep it past every valid timestamp, with a hard global cap.
   for(const [id,state]of states)if(state.lastSeen<now-120000)states.delete(id);
   let state=states.get(fields.deviceId);if(!state){if(states.size>=256)throw reject(429);state={nonces:new Map(),window:now,requests:0,lastSeen:now};states.set(fields.deviceId,state);}
   for(const [nonce,expires]of state.nonces)if(expires<now)state.nonces.delete(nonce);
   if(state.nonces.has(fields.nonce))throw reject(409);
   if(now-state.window>=60000){state.window=now;state.requests=0;}
   if(state.nonces.size>=nonceLimit||state.requests>=rateLimit)throw reject(429);
   state.lastSeen=now;state.requests++;state.nonces.set(fields.nonce,Number(fields.time)+skew);
   const size=request.headers['content-length'];if(size!==undefined&&(!/^[0-9]+$/.test(size)||Number(size)>bodyLimit))throw reject(413);
   const body=await readBody(request,bodyLimit);if(!equal(bodySha256(body),fields.bodySha256))throw reject();
   if(['GET','HEAD'].includes(request.method)&&body.length)throw reject(400);
   await forward(request,response,{backend,desktop,accessToken,nativeToken,purpose:fields.purpose,originalPath,body});
  }catch(error){json(response,Number(error?.status)||503,{error:'Private gateway request rejected'});}finally{concurrent--;}
 };
 const server=http.createServer({maxHeaderSize:32768,requestTimeout:20000,headersTimeout:10000,keepAliveTimeout:1000},(request,response)=>{void handle(request,response);});
 server.maxHeadersCount=200;server.on('checkContinue',(_request,response)=>json(response,417,{error:'Expectation not accepted'}));server.on('checkExpectation',(_request,response)=>json(response,417,{error:'Expectation not accepted'}));
 server.on('upgrade',(_request,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
 Object.defineProperty(server,'epoch',{value:epoch,enumerable:true});return server;
}
