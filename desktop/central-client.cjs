/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const http=require('node:http');
const {randomUUID,generateKeyPairSync,createPrivateKey,createPublicKey,timingSafeEqual,createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const {constants,createWriteStream}=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {CENTRAL_PREFIX,MAX_BODY_BYTES,DEVICE_ID,signDeviceRequest,validateOriginalPath}=require('./central-protocol.cjs');
const DEFAULT_CENTRAL_ORIGIN='https://kassa.nex.autos';
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const failure=(status=503)=>Object.assign(Error('Mərkəzi bağlantı təhlükəsizlik yoxlamasından keçmədi.'),{status});
const validName=value=>typeof value==='string'&&value.length<=180&&/^[^ .\\/:*?"<>|\x00-\x1f\x7f][^\\/:*?"<>|\x00-\x1f\x7f]*\.birkassa$/i.test(value)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value);
async function noLinkedAncestors(value){
 const resolved=path.resolve(value),root=path.parse(resolved).root;let current=root;
 for(const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,segment);let info;try{info=await fs.lstat(current);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!info.isDirectory()||info.isSymbolicLink())throw failure();
 }
}
async function privateDirectory(directory){
 await noLinkedAncestors(directory);await fs.mkdir(directory,{recursive:true,mode:0o700});await noLinkedAncestors(directory);
 const info=await fs.lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw failure();
 const {protectData}=await import('./protect-data.mjs');await protectData(directory);return directory;
}
async function privateRead(file,maximum=32768){
 await noLinkedAncestors(path.dirname(file));const info=await fs.lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>maximum||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw failure();
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const checked=await handle.stat();if(checked.ino!==info.ino||checked.dev!==info.dev||checked.size>maximum)throw failure();const source=await handle.readFile('utf8');if(Buffer.byteLength(source)>maximum)throw failure();return source;}finally{await handle.close();}
}
async function atomicNewFile(file,source){
 const temporary=file+'.'+randomUUID()+'.partial';let handle;
 try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(source);await handle.sync();await handle.close();handle=null;await fs.link(temporary,file);}
 finally{await handle?.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function centralIdentity(dataRoot,safeStorage){
 if(typeof dataRoot!=='string'||!path.isAbsolute(dataRoot)||!safeStorage?.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Windows açar qoruması hazır deyil. Mərkəzi bağlantı açılmadı.');
 const directory=await privateDirectory(path.join(dataRoot,'.private','central-device')),file=path.join(directory,'identity.json'),lockFile=path.join(directory,'identity.lock');
 let lock;try{lock=await fs.open(lockFile,'wx',0o600);}catch{throw Error('Kompüter qeydiyyatı artıq işləyir və ya qorunmayıb. Yenidən açmadan əvvəl yoxlayın.');}const lockIdentity=await lock.stat();
 try{
  let identity;try{identity=JSON.parse(await privateRead(file));}catch(error){
   if(error.code!=='ENOENT')throw failure();
   const keys=generateKeyPairSync('ed25519'),encrypted=safeStorage.encryptString(keys.privateKey.export({type:'pkcs8',format:'pem'}));
   if(!Buffer.isBuffer(encrypted)||encrypted.length<32||encrypted.length>16384)throw failure();
   identity={schema:1,id:randomUUID(),publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),privateKeyEncrypted:encrypted.toString('base64')};await atomicNewFile(file,JSON.stringify(identity));
  }
  if(!identity||Object.keys(identity).sort().join(',')!=='id,privateKeyEncrypted,publicKeyPem,schema'||identity.schema!==1||!DEVICE_ID.test(identity.id)||typeof identity.publicKeyPem!=='string'||identity.publicKeyPem.length>2048||!identity.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')||typeof identity.privateKeyEncrypted!=='string'||identity.privateKeyEncrypted.length>24576)throw failure();
  const encrypted=Buffer.from(identity.privateKeyEncrypted,'base64');if(encrypted.length<32||encrypted.toString('base64')!==identity.privateKeyEncrypted)throw failure();
  const decrypted=safeStorage.decryptString(encrypted);if(typeof decrypted!=='string'||decrypted.length>4096)throw failure();
  const privateKey=createPrivateKey({key:decrypted,format:'pem',type:'pkcs8'});if(privateKey.asymmetricKeyType!=='ed25519'||createPublicKey(privateKey).export({type:'spki',format:'pem'})!==identity.publicKeyPem)throw failure();
  const registration=path.join(directory,'RestaMarket-komputer-qeydiyyati.json'),publicRegistration={schema:1,id:identity.id,publicKeyPem:identity.publicKeyPem,active:true};
  try{const existing=JSON.parse(await privateRead(registration));if(JSON.stringify(existing)!==JSON.stringify(publicRegistration))throw failure();}catch(error){if(error.code!=='ENOENT')throw failure();await atomicNewFile(registration,JSON.stringify(publicRegistration,null,2));}
  const {protectData}=await import('./protect-data.mjs');await protectData(directory);return {id:identity.id,publicKeyPem:identity.publicKeyPem,privateKey,registration};
 }finally{await lock.close();const info=await fs.lstat(lockFile);if(!info.isFile()||info.isSymbolicLink()||info.ino!==lockIdentity.ino||info.dev!==lockIdentity.dev)throw failure();await fs.unlink(lockFile);}
}
function validatedOrigin(value){const url=new URL(value);if(url.origin!==DEFAULT_CENTRAL_ORIGIN||url.href!==url.origin+'/')throw Error('Mərkəz ünvanı etibarlı deyil.');return url.origin;}
const hopHeaders=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','expect']);
function sensitive(name){return name==='authorization'||name==='forwarded'||name==='x-real-ip'||name==='x-original-url'||name==='x-rewrite-url'||/^(?:x-forwarded-|x-birkassa-|x-restamarket-|x-rm-|x-middleware-|x-nextjs-|x-vercel-|x-invoke-|x-now-)/i.test(name);}
function cleanHeaders(headers){
 const input=new Headers(headers),connection=new Set((input.get('connection')||'').split(',').map(value=>value.trim().toLowerCase())),clean={};
 for(const [name,value]of input)if(!hopHeaders.has(name)&&!connection.has(name)&&!sensitive(name)&&!['host','content-length'].includes(name))clean[name]=value;
 return clean;
}
function nativeAllowed(method,target){
 if(new Set(['POST /api/sales-period','POST /api/desktop-poll','POST /api/desktop-lock','GET /api/auth','GET /api/sales-period','GET /api/central-backup']).has(method+' '+target))return true;
 if(method!=='GET'||!target.startsWith('/api/central-backup?'))return false;const entries=[...new URLSearchParams(target.slice(target.indexOf('?')+1)).entries()];return entries.length===1&&entries[0][0]==='fileName'&&validName(entries[0][1]);
}
const timeoutSignal=(signal,milliseconds)=>signal?AbortSignal.any([signal,AbortSignal.timeout(milliseconds)]):AbortSignal.timeout(milliseconds);
async function boundedJson(response,maximum=4096){
 if(!response.ok||!response.body){await response.body?.cancel?.().catch(()=>{});throw failure();}const parts=[];let size=0;
 for await(const part of response.body){size+=part.length;if(size>maximum)throw failure();parts.push(part);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw failure();}
}
function validChallenge(value){
 return value&&Object.keys(value).sort().join(',')==='epoch,schema,serverTime'&&value.schema===1&&typeof value.epoch==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.epoch)&&Buffer.from(value.epoch,'base64url').length===32&&Buffer.from(value.epoch,'base64url').toString('base64url')===value.epoch&&Number.isSafeInteger(value.serverTime)&&Math.abs(Date.now()-value.serverTime)<=25000;
}
function localBody(req){
 return new Promise((resolve,reject)=>{
  const chunks=[];let length=0,done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',failed);req.removeListener('aborted',failed);if(error){req.resume();reject(error);}else resolve(value);};
  const data=chunk=>{length+=chunk.length;if(length>MAX_BODY_BYTES){finish(failure(413));return;}chunks.push(chunk);},end=()=>finish(null,Buffer.concat(chunks,length)),failed=()=>finish(failure(400));
  const timer=setTimeout(()=>finish(failure(408)),15000);timer.unref();req.on('data',data);req.once('end',end);req.once('error',failed);req.once('aborted',failed);
 });
}
function singleHeader(req,name){let count=0;for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i].toLowerCase()===name)count++;return count===1&&typeof req.headers[name]==='string'?req.headers[name]:null;}
async function createCentralClient({dataRoot,safeStorage,accessToken,nativeToken,port=5760,fetchImpl=fetch,identity:fixtureIdentity,origin=DEFAULT_CENTRAL_ORIGIN}={}){
 origin=validatedOrigin(origin);if(!/^[a-f0-9]{64}$/.test(accessToken)||!/^[a-f0-9]{64}$/.test(nativeToken)||accessToken===nativeToken||!Number.isInteger(port)||port<1024||port>65535||typeof fetchImpl!=='function')throw failure();
 const identity=fixtureIdentity||await centralIdentity(dataRoot,safeStorage),localOrigin='http://127.0.0.1:'+port;
 if(!DEVICE_ID.test(identity.id)||identity.privateKey?.asymmetricKeyType!=='ed25519'||identity.publicKeyPem!==undefined&&createPublicKey(identity.privateKey).export({type:'spki',format:'pem'})!==identity.publicKeyPem)throw failure();
 let challenge,challengePending;
 async function request(target,{method='GET',headers={},body,purpose='renderer',signal}={}){
  validateOriginalPath(target);if(!['renderer','native'].includes(purpose)||purpose==='native'&&!nativeAllowed(method,target))throw failure(403);
  const bytes=body===undefined?Buffer.alloc(0):Buffer.from(body);if(bytes.length>MAX_BODY_BYTES||(['GET','HEAD'].includes(method)&&bytes.length))throw failure(413);
  const clean=cleanHeaders(headers);if(clean.origin!==undefined&&clean.origin!==localOrigin||clean['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(clean['sec-fetch-site']))throw failure(403);
  // Bind server time as a number. Date.parse(epochMilliseconds) is invalid and
  // NaN comparisons would silently disable the intended clock-skew check.
  if(!challenge||Date.now()-challenge.at>15000){
   if(!challengePending)challengePending=(async()=>{const response=await fetchImpl(origin+CENTRAL_PREFIX+'/challenge',{redirect:'error',cache:'no-store',signal:timeoutSignal(signal,10000)}),value=await boundedJson(response);if(!validChallenge(value))throw failure();return {...value,at:Date.now()};})();
   try{challenge=await challengePending;}finally{challengePending=null;}
  }
  const signed=signDeviceRequest({deviceId:identity.id,epoch:challenge.epoch,purpose,method,path:target,body:bytes,privateKey:identity.privateKey});
  const response=await fetchImpl(origin+CENTRAL_PREFIX+target,{method,headers:{...clean,...signed},...(bytes.length?{body:bytes}:{}),redirect:'manual',cache:'no-store',signal:timeoutSignal(signal,120000)});
  // Never retry writes (or native operations) after an ambiguous connection or
  // authorization failure. Reconcile receipts before submitting another sale.
  if(response.status===401)challenge=null;return response;
 }
 const handle=async(req,res)=>{
  const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   if(singleHeader(req,'host')!==new URL(localOrigin).host||!equal(singleHeader(req,'x-restamarket-desktop-access'),accessToken))throw failure(403);
   if(req.headers.origin!==undefined&&req.headers.origin!==localOrigin||req.headers['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw failure(403);
   validateOriginalPath(req.url);const size=req.headers['content-length'];if(size!==undefined&&(!/^[0-9]+$/.test(size)||Number(size)>MAX_BODY_BYTES))throw failure(413);
   const purpose=equal(singleHeader(req,'authorization'),'Bearer '+nativeToken)?'native':'renderer';
   if(purpose==='native'&&!nativeAllowed(req.method,req.url))throw failure(403);
   const body=await localBody(req),response=await request(req.url,{method:req.method,headers:req.headers,body,purpose,signal:controller.signal});
   for(const [name,value]of response.headers)if(!hopHeaders.has(name)&&!sensitive(name)&&!['set-cookie','content-encoding','content-length'].includes(name)&&!name.startsWith('access-control-'))res.setHeader(name,value);
   const location=response.headers.get('location');if(location)validateOriginalPath(location);
   const cookies=response.headers.getSetCookie?.()||[];if(cookies.length)res.setHeader('Set-Cookie',cookies.map(value=>value.replace(/;\s*Domain\s*=[^;]*/ig,'')));
   res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.statusCode=response.status;
   if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
  }catch(error){
   if(res.headersSent){res.destroy();return;}for(const name of res.getHeaderNames())res.removeHeader(name);
   res.writeHead(Number(error?.status)||503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Connection':'close'});res.end(JSON.stringify({error:'Mərkəzlə əlaqə qurulmadı. İnterneti və bu kompüterin giriş icazəsini yoxlayın. Satışı təkrar göndərməzdən əvvəl çekləri yoxlayın.'}));
  }
 };
 const server=http.createServer({maxHeaderSize:32768,requestTimeout:20000,headersTimeout:10000,keepAliveTimeout:1000},(req,res)=>void handle(req,res));server.maxHeadersCount=200;
 server.on('checkContinue',(_req,res)=>res.writeHead(417,{'Connection':'close'}).end());server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 // Preserve the updater's ChildProcess-like stopServer contract, but stop only
 // this proxy: never the central application or its PostgreSQL instance.
 server.exitCode=null;server.signalCode=null;let stopping=false;
 server.kill=()=>{if(stopping||server.exitCode!==null)return true;stopping=true;server.close(()=>{server.exitCode=0;server.emit('exit',0);});server.closeAllConnections();return true;};server.once('close',()=>{server.exitCode=0;});
 return {server,request,identity,localOrigin};
}
async function verifiedCentralBackup(response,destination){
 if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/x-birkassa-backup'||!response.body||typeof destination!=='string'||!path.isAbsolute(destination))throw failure();
 const sha256=response.headers.get('x-restamarket-backup-sha256'),rawBytes=response.headers.get('x-restamarket-backup-bytes'),fileName=response.headers.get('x-restamarket-backup-name'),bytes=Number(rawBytes);
 if(!/^[a-f0-9]{64}$/.test(sha256||'')||!/^[1-9][0-9]*$/.test(rawBytes||'')||!Number.isSafeInteger(bytes)||bytes>5*1024*1024*1024||!validName(fileName)||path.basename(destination)!==fileName)throw failure();
 const parent=path.dirname(destination);await noLinkedAncestors(parent);await fs.mkdir(parent,{recursive:true,mode:0o700});await noLinkedAncestors(parent);
 try{await fs.lstat(destination);throw failure();}catch(error){if(error.code!=='ENOENT')throw error;}
 const work=await privateDirectory(path.join(parent,'.restamarket-backup-'+randomUUID())),temporary=path.join(work,'archive.partial'),hash=createHash('sha256');let size=0;
 try{
  async function* checked(){for await(const part of response.body){const chunk=Buffer.from(part);size+=chunk.length;if(size>bytes)throw failure();hash.update(chunk);yield chunk;}}
  await pipeline(Readable.from(checked()),createWriteStream(temporary,{flags:'wx',mode:0o600}));if(size!==bytes||hash.digest('hex')!==sha256)throw failure();
  const handle=await fs.open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}
  // Hard-link publication is atomic and fails if a destination appeared while
  // downloading. rename() would silently overwrite an existing POSIX backup.
  await fs.link(temporary,destination);return {sha256,bytes,fileName};
 }finally{
  await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(path.dirname(work)!==parent||!path.basename(work).startsWith('.restamarket-backup-'))throw failure();await fs.rmdir(work);
 }
}
async function downloadCentralBackup(response,destination){
 try{return await verifiedCentralBackup(response,destination);}catch(error){await response?.body?.cancel?.().catch(()=>{});throw error;}
}
module.exports={createCentralClient,centralIdentity,downloadCentralBackup,DEFAULT_CENTRAL_ORIGIN};
