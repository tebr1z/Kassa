/* Main-process-only, authenticated release downloads. Never executes installers. */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const {createHash,createPublicKey,verify,randomUUID,KeyObject}=require('node:crypto');
const {open,mkdir,lstat,rename,unlink}=require('node:fs/promises');
const path=require('node:path');

const FEED_URL='https://kassa.nex.autos/desktop-updates/win-x64/stable/latest.json';
const RELEASE_ROOT='https://kassa.nex.autos/desktop-updates/win-x64/stable/';
const MAX_MANIFEST_BYTES=64*1024;
const MAX_INSTALLER_BYTES=512*1024*1024;
const DAY=24*60*60*1000;
const VERSION=/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const SHA256=/^[a-f0-9]{64}$/;

function failure(code,message){const error=new Error(message);error.code=code;return error;}
function invalid(){return failure('UPDATE_INVALID_MANIFEST','Yeniləmə məlumatının imzası və ya formatı etibarsızdır.');}
function cancelled(){return failure('UPDATE_CANCELLED','Yeniləmə dayandırıldı.');}
function throwIfAborted(signal){if(signal?.aborted)throw cancelled();}
function exactKeys(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw invalid();
 const actual=Object.keys(value).sort(),expected=[...keys].sort();
 if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw invalid();
}
function parts(version){if(typeof version!=='string'||!VERSION.test(version))throw invalid();return version.split('.').map(Number);}
function compareVersions(a,b){const left=parts(a),right=parts(b);for(let n=0;n<3;n++){if(left[n]!==right[n])return left[n]>right[n]?1:-1;}return 0;}
function base64(value,max){
 if(typeof value!=='string'||value.length===0||value.length>max||value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw invalid();
 const buffer=Buffer.from(value,'base64');if(buffer.toString('base64')!==value)throw invalid();return buffer;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function iso(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw invalid();
 const time=Date.parse(value);if(!Number.isFinite(time)||new Date(time).toISOString()!==value.replace(/Z$/,value.includes('.')?'Z':'.000Z'))throw invalid();return time;
}
function keyOf(publicKey){
 try{const key=publicKey instanceof KeyObject?publicKey:createPublicKey(publicKey);if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')throw invalid();return key;}
 catch{throw invalid();}
}

function verifyManifest(envelope,{publicKey,currentVersion,now=Date.now(),feedUrl=FEED_URL}={}){
 try{
  if(feedUrl!==FEED_URL||!Number.isFinite(now))throw invalid();
  parts(currentVersion);
  exactKeys(envelope,['payload','signature']);
  if(Buffer.byteLength(JSON.stringify(envelope),'utf8')>MAX_MANIFEST_BYTES)throw invalid();
  const payload=base64(envelope.payload,MAX_MANIFEST_BYTES),signature=base64(envelope.signature,88);
  if(signature.length!==64||!verify(null,payload,keyOf(publicKey),signature))throw invalid();
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(payload);
  if(!Buffer.from(decoded,'utf8').equals(payload))throw invalid();
  const manifest=JSON.parse(decoded);
  exactKeys(manifest,['schema','appId','channel','platform','arch','version','minimumVersion','postgresMajor','publishedAt','expiresAt','file','releaseNotes']);
  if(manifest.schema!==1||manifest.appId!=='az.birkassa.desktop'||manifest.channel!=='stable'||manifest.platform!=='win32'||manifest.arch!=='x64'||manifest.postgresMajor!==17)throw invalid();
  parts(manifest.version);parts(manifest.minimumVersion);
  if(compareVersions(manifest.version,currentVersion)<0||compareVersions(manifest.minimumVersion,manifest.version)>0)throw invalid();
  const published=iso(manifest.publishedAt),expires=iso(manifest.expiresAt);
  if(published>now+DAY||expires<=now||expires<=published||expires-published>370*DAY)throw invalid();
  exactKeys(manifest.file,['url','bytes','sha256']);
  const expectedUrl=RELEASE_ROOT+manifest.version+'/RestaMarket-Setup-'+manifest.version+'.exe';
  if(manifest.file.url!==expectedUrl||!Number.isSafeInteger(manifest.file.bytes)||manifest.file.bytes<1||manifest.file.bytes>MAX_INSTALLER_BYTES||typeof manifest.file.sha256!=='string'||!SHA256.test(manifest.file.sha256))throw invalid();
  exactKeys(manifest.releaseNotes,['az','en','ru','tr','zh']);
  for(const note of Object.values(manifest.releaseNotes)){
   if(typeof note!=='string'||note.length>2000||/[<>\u0000-\u0008\u000b-\u001f\u007f\uD800-\uDFFF]/u.test(note))throw invalid();
  }
  if(compareVersions(manifest.minimumVersion,currentVersion)>0)throw failure('UPDATE_INCOMPATIBLE','Bu versiya üçün ilkin əl ilə yeniləmə lazımdır.');
  return freeze(manifest);
 }catch(error){if(error?.code==='UPDATE_INCOMPATIBLE')throw error;throw invalid();}
}

function abortable(promise,signal){
 if(signal?.aborted){Promise.resolve(promise).catch(()=>{});return Promise.reject(cancelled());}
 return new Promise((resolve,reject)=>{
  const stop=()=>reject(cancelled());signal?.addEventListener('abort',stop,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal?.removeEventListener('abort',stop));
 });
}
function rejectResponse(response,url,limit){
 if(!response||response.status!==200||response.redirected||(response.url&&response.url!==url))throw failure('UPDATE_NETWORK_ERROR','Yeniləmə serverindən etibarlı cavab alınmadı.');
 const length=response.headers?.get('content-length');
 if(length!==null&&length!==undefined&&(!/^[0-9]+$/.test(length)||Number(length)>limit))throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə faylının ölçüsü düzgün deyil.');
 const encoding=response.headers?.get('content-encoding');
 if(encoding&&encoding!=='identity')throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə faylının formatı düzgün deyil.');
 if(!response.body||typeof response.body.getReader!=='function')throw failure('UPDATE_NETWORK_ERROR','Yeniləmə cavabı boşdur.');
}
async function* chunks(response,signal){
 const reader=response.body.getReader();let done=false;
 try{while(true){throwIfAborted(signal);const next=await abortable(reader.read(),signal);if(next.done){done=true;break;}if(!(next.value instanceof Uint8Array))throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə faylı oxunmadı.');yield next.value;}}
 finally{if(!done)void reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function verifyInstallerFile(file,manifest,{signal}={}){
 if(typeof file!=='string'||!manifest?.file||!Number.isSafeInteger(manifest.file.bytes)||manifest.file.bytes<1||manifest.file.bytes>MAX_INSTALLER_BYTES||typeof manifest.file.sha256!=='string'||!SHA256.test(manifest.file.sha256))throw invalid();
 let handle;
 try{
  throwIfAborted(signal);
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==manifest.file.bytes)throw failure('UPDATE_HASH_MISMATCH','Yeniləmə faylının bütövlüyü təsdiqlənmədi.');
  handle=await open(file,'r');const actual=await handle.stat();
  if(!actual.isFile()||actual.size!==manifest.file.bytes||actual.ino!==info.ino||actual.dev!==info.dev)throw failure('UPDATE_HASH_MISMATCH','Yeniləmə faylı dəyişdirilib.');
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(256*1024);let total=0;
  while(true){throwIfAborted(signal);const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;if(total>manifest.file.bytes)throw failure('UPDATE_HASH_MISMATCH','Yeniləmə faylının ölçüsü dəyişib.');hash.update(buffer.subarray(0,bytesRead));}
  throwIfAborted(signal);
  if(total!==manifest.file.bytes||hash.digest('hex')!==manifest.file.sha256)throw failure('UPDATE_HASH_MISMATCH','Yeniləmə faylının bütövlüyü təsdiqlənmədi.');
  return true;
 }catch(error){if(error?.code?.startsWith('UPDATE_'))throw error;throw failure('UPDATE_HASH_MISMATCH','Yeniləmə faylı tapılmadı və ya təsdiqlənmədi.');}
 finally{if(handle)await handle.close();}
}

class DesktopUpdateClient{
 #feedUrl;#key;#version;#cache;#fetch;#now;#progress;#checked=null;#downloaded=null;#controller=null;#highestVersion;
 constructor({feedUrl=FEED_URL,publicKey,currentVersion,cacheDir,fetchImpl=fetch,now=()=>Date.now(),onProgress=()=>{}}={}){
  if(feedUrl!==FEED_URL||typeof cacheDir!=='string'||!path.isAbsolute(cacheDir)||path.resolve(cacheDir)===path.parse(path.resolve(cacheDir)).root||typeof fetchImpl!=='function'||typeof now!=='function'||typeof onProgress!=='function')throw invalid();
  parts(currentVersion);this.#key=keyOf(publicKey);this.#feedUrl=feedUrl;this.#version=currentVersion;this.#highestVersion=currentVersion;this.#cache=path.resolve(cacheDir);this.#fetch=fetchImpl;this.#now=now;this.#progress=onProgress;
 }
 #start(timeout){
  if(this.#controller)throw failure('UPDATE_BUSY','Yeniləmə əməliyyatı artıq davam edir.');
  const controller=new AbortController();this.#controller=controller;const timer=setTimeout(()=>controller.abort(),timeout);timer.unref?.();
  return {signal:controller.signal,finish:()=>{clearTimeout(timer);if(this.#controller===controller)this.#controller=null;}};
 }
 #verify(envelope){return verifyManifest(envelope,{publicKey:this.#key,currentVersion:this.#version,feedUrl:this.#feedUrl,now:this.#now()});}
 async #response(url,signal,limit){
  throwIfAborted(signal);
  const request=Promise.resolve().then(()=>{throwIfAborted(signal);return this.#fetch(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Accept:url===this.#feedUrl?'application/json':'application/octet-stream','Accept-Encoding':'identity'},signal});}).then(response=>{
   if(signal.aborted){void response?.body?.cancel?.().catch(()=>{});throw cancelled();}return response;
  });
  const response=await abortable(request,signal);
  try{rejectResponse(response,url,limit);return response;}catch(error){void response?.body?.cancel?.().catch(()=>{});throw error;}
 }
 async check(){
  const operation=this.#start(20000);
  try{
   const response=await this.#response(this.#feedUrl,operation.signal,MAX_MANIFEST_BYTES),buffers=[];let total=0;
   for await(const chunk of chunks(response,operation.signal)){total+=chunk.byteLength;if(total>MAX_MANIFEST_BYTES)throw invalid();buffers.push(Buffer.from(chunk));}
   let envelope;try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(buffers,total)));}catch{throw invalid();}
   const manifest=this.#verify(envelope);
   if(compareVersions(manifest.version,this.#highestVersion)<0)throw invalid();
   this.#highestVersion=manifest.version;this.#checked=freeze({manifest,envelope:{payload:envelope.payload,signature:envelope.signature}});
   return freeze({available:compareVersions(manifest.version,this.#version)>0,manifest});
  }catch(error){if(operation.signal.aborted)throw cancelled();if(error?.code?.startsWith('UPDATE_'))throw error;throw failure('UPDATE_NETWORK_ERROR','Yeniləmə serverinə qoşulmaq mümkün olmadı.');}
  finally{operation.finish();}
 }
 async download(){
  const operation=this.#start(10*60*1000);let partial,handle;
  try{
   if(!this.#checked)throw failure('UPDATE_NOT_AVAILABLE','Əvvəlcə yeniləmələri yoxlayın.');
   const {envelope}=this.#checked,manifest=this.#verify(envelope);
   if(compareVersions(manifest.version,this.#version)<=0||compareVersions(manifest.version,this.#highestVersion)<0)throw failure('UPDATE_NOT_AVAILABLE','Yeni yeniləmə yoxdur.');
   await mkdir(this.#cache,{recursive:true,mode:0o700});const directory=await lstat(this.#cache);
   if(!directory.isDirectory()||directory.isSymbolicLink())throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə qovluğu təhlükəsiz deyil.');
   const file=path.join(this.#cache,`RestaMarket-Setup-${manifest.version}-${manifest.file.sha256}.exe`);
   try{await verifyInstallerFile(file,manifest,{signal:operation.signal});this.#downloaded=freeze({file,manifest,envelope});this.#notify(manifest.file.bytes,manifest.file.bytes);return this.#downloaded;}catch(error){if(error.code==='UPDATE_CANCELLED')throw error;}
   partial=path.join(this.#cache,`download-${randomUUID()}.partial`);handle=await open(partial,'wx',0o600);
   const response=await this.#response(manifest.file.url,operation.signal,manifest.file.bytes);
   const length=response.headers.get('content-length');if(length!==null&&Number(length)!==manifest.file.bytes){void response.body.cancel().catch(()=>{});throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə faylının ölçüsü düzgün deyil.');}
   const hash=createHash('sha256');let total=0;this.#notify(0,manifest.file.bytes);
   for await(const chunk of chunks(response,operation.signal)){
    total+=chunk.byteLength;if(total>manifest.file.bytes)throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə faylı gözləniləndən böyükdür.');
    hash.update(chunk);let offset=0;while(offset<chunk.byteLength){throwIfAborted(operation.signal);const written=await handle.write(chunk,offset,chunk.byteLength-offset,null);if(!written.bytesWritten)throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə faylı saxlanılmadı.');offset+=written.bytesWritten;}
    this.#notify(total,manifest.file.bytes);
   }
   if(total!==manifest.file.bytes||hash.digest('hex')!==manifest.file.sha256)throw failure('UPDATE_HASH_MISMATCH','Yeniləmə faylının bütövlüyü təsdiqlənmədi.');
   throwIfAborted(operation.signal);await handle.sync();await handle.close();handle=null;
   // A previously corrupt cache entry is never trusted or executed. Replacing
   // only this fixed, locally constructed path does not follow response paths.
   const existing=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(existing&&!existing.isFile())throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə faylının yolu təhlükəsiz deyil.');
   throwIfAborted(operation.signal);await rename(partial,file);partial=null;
   await verifyInstallerFile(file,manifest,{signal:operation.signal});
   this.#downloaded=freeze({file,manifest,envelope});return this.#downloaded;
  }catch(error){if(operation.signal.aborted)throw cancelled();if(error?.code?.startsWith('UPDATE_'))throw error;throw failure('UPDATE_DOWNLOAD_FAILED','Yeniləmə endirilmədi. Yenidən cəhd edin.');}
  finally{if(handle)await handle.close().catch(()=>{});if(partial)await unlink(partial).catch(()=>{});operation.finish();}
 }
 #notify(receivedBytes,totalBytes){try{this.#progress(Object.freeze({percent:Math.min(100,Math.floor(receivedBytes*100/totalBytes)),receivedBytes,totalBytes}));}catch{/* UI observers cannot change verification. */}}
 cancel(){this.#controller?.abort();}
 async revalidateDownloaded(){
  const operation=this.#start(30000);
  try{
   if(!this.#downloaded)throw failure('UPDATE_NOT_AVAILABLE','Əvvəlcə yeniləməni endirin.');
   const {file,envelope}=this.#downloaded,manifest=this.#verify(envelope);
   if(compareVersions(manifest.version,this.#version)<=0||compareVersions(manifest.version,this.#highestVersion)<0)throw failure('UPDATE_NOT_AVAILABLE','Bu yeniləmə artıq uyğun deyil.');
   const expected=path.join(this.#cache,`RestaMarket-Setup-${manifest.version}-${manifest.file.sha256}.exe`);
   if(file!==expected)throw invalid();
   await verifyInstallerFile(file,manifest,{signal:operation.signal});return this.#downloaded;
  }finally{operation.finish();}
 }
}

module.exports={DesktopUpdateClient,verifyManifest,compareVersions,verifyInstallerFile};
