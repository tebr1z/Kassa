import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {DesktopUpdateClient,verifyManifest,compareVersions,verifyInstallerFile}=require('../desktop/update-client.cjs');
const feedUrl='https://kassa.nex.autos/desktop-updates/win-x64/stable/latest.json';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const now=Date.parse('2026-11-15T12:00:00.000Z');
const bytes=Buffer.from('Fixture installer, deliberately not executable. '.repeat(4000));
const sha256=createHash('sha256').update(bytes).digest('hex');
const directory=await mkdtemp(path.join(os.tmpdir(),'restamarket-update-client-'));
function manifest(overrides={}){
 return {schema:1,appId:'az.birkassa.desktop',channel:'stable',platform:'win32',arch:'x64',version:'0.6.2',minimumVersion:'0.6.1',postgresMajor:17,publishedAt:'2026-11-15T11:00:00.000Z',expiresAt:'2027-11-15T11:00:00.000Z',file:{url:'https://kassa.nex.autos/desktop-updates/win-x64/stable/0.6.2/RestaMarket-Setup-0.6.2.exe',bytes:bytes.length,sha256},releaseNotes:{az:'Sınaq yeniləməsi',en:'Test update',ru:'Тестовое обновление',tr:'Test güncellemesi',zh:'测试更新'},...overrides};
}
function envelope(value=manifest(),key=privateKey){const payload=Buffer.from(JSON.stringify(value));return {payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')};}
const options={publicKey,currentVersion:'0.6.1',now};
const expectCode=(code)=>error=>error?.code===code;
let serial=0;
const cache=()=>path.join(directory,'cache-'+(++serial));
const newClient=(fetchImpl,more={})=>new DesktopUpdateClient({feedUrl,publicKey,currentVersion:'0.6.1',cacheDir:cache(),now:()=>now,fetchImpl,...more});
function response(body,{status=200,headers={},chunkSize=4096}={}){
 const buffer=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body));let offset=0;
 return new Response(new ReadableStream({pull(controller){if(offset>=buffer.length){controller.close();return;}controller.enqueue(buffer.subarray(offset,offset+=Math.min(chunkSize,buffer.length-offset)));}}),{status,headers});
}
try{
 assert.equal(compareVersions('0.6.1','0.6.2'),-1);assert.equal(compareVersions('1.0.0','0.99.99'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);
 for(const version of ['01.2.3','1.2','1.2.3-beta','1.2.3.4','1.2.-3','1.2.3\n','9999999999.0.0'])assert.throws(()=>compareVersions(version,'1.0.0'),expectCode('UPDATE_INVALID_MANIFEST'));
 const accepted=verifyManifest(envelope(),options);assert.ok(Object.isFrozen(accepted)&&Object.isFrozen(accepted.file)&&Object.isFrozen(accepted.releaseNotes));assert.equal(accepted.version,'0.6.2');
 assert.throws(()=>verifyManifest({...envelope(),extra:1},options),expectCode('UPDATE_INVALID_MANIFEST'));
 const badSignature=envelope();badSignature.signature=sign(null,Buffer.from('wrong bytes'),privateKey).toString('base64');assert.throws(()=>verifyManifest(badSignature,options),expectCode('UPDATE_INVALID_MANIFEST'));
 const otherKeys=generateKeyPairSync('ed25519');assert.throws(()=>verifyManifest(envelope(manifest(),otherKeys.privateKey),options),expectCode('UPDATE_INVALID_MANIFEST'));
 assert.throws(()=>verifyManifest({...envelope(),payload:envelope().payload+'\n'},options),expectCode('UPDATE_INVALID_MANIFEST'));
 assert.throws(()=>verifyManifest(envelope({...manifest(),unknown:true}),options),expectCode('UPDATE_INVALID_MANIFEST'));
 const invalids=[{schema:2},{appId:'other'},{platform:'darwin'},{arch:'arm64'},{channel:'beta'},{postgresMajor:18},{version:'0.6.0'},{version:'0.6.2-rc'},{publishedAt:'2026-11-17T12:00:00.000Z'},{expiresAt:'2026-11-15T11:59:59.000Z'},{expiresAt:'2028-01-01T00:00:00.000Z'},{publishedAt:'2026-02-30T00:00:00.000Z'},...['https://evil.example/file.exe','http://kassa.nex.autos/file.exe','https://kassa.nex.autos/desktop-updates/win-x64/stable/0.6.2/../0.6.2/RestaMarket-Setup-0.6.2.exe','https://kassa.nex.autos/desktop-updates/win-x64/stable/0.6.2/RestaMarket-Setup-0.6.2.exe?download=1'].map(url=>({file:{...manifest().file,url}})),{file:{...manifest().file,sha256:sha256.toUpperCase()}},{file:{...manifest().file,bytes:513*1024*1024}},{releaseNotes:{...manifest().releaseNotes,az:'<b>not plain text</b>'}},{releaseNotes:{...manifest().releaseNotes,az:'x'.repeat(2001)}}];
 for(const invalid of invalids)assert.throws(()=>verifyManifest(envelope(manifest(invalid)),options),expectCode('UPDATE_INVALID_MANIFEST'),JSON.stringify(invalid));
 assert.throws(()=>verifyManifest(envelope(manifest({minimumVersion:'0.6.2'})),options),expectCode('UPDATE_INCOMPATIBLE'));
 assert.throws(()=>new DesktopUpdateClient({feedUrl:'http://localhost/latest.json',publicKey,currentVersion:'0.6.1',cacheDir:cache()}),expectCode('UPDATE_INVALID_MANIFEST'));
 const requests=[],progress=[];
 const client=newClient(async(url,init)=>{requests.push({url,init});assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');return response(url===feedUrl?envelope():bytes,{headers:url===feedUrl?{}:{'Content-Length':String(bytes.length)}});},{onProgress:state=>progress.push(state)});
 const checked=await client.check();assert.equal(checked.available,true);assert.ok(Object.isFrozen(checked));assert.throws(()=>{checked.manifest.file.url='https://evil.example';},TypeError);
 const downloaded=await client.download();assert.deepEqual(await readFile(downloaded.file),bytes);assert.ok(Object.isFrozen(downloaded)&&Object.isFrozen(downloaded.envelope));assert.ok(progress.length>2);assert.equal(progress.at(-1).percent,100);assert.equal(progress[0].percent,0);assert.equal(requests[1].url,manifest().file.url);
 assert.equal(await verifyInstallerFile(downloaded.file,accepted),true);assert.equal((await client.revalidateDownloaded()).file,downloaded.file);
 const reused=await client.download();assert.equal(reused.file,downloaded.file);assert.equal(requests.length,2,'Verified existing installer is reused without another network download');
 await writeFile(downloaded.file,Buffer.alloc(bytes.length));await assert.rejects(()=>client.revalidateDownloaded(),expectCode('UPDATE_HASH_MISMATCH'));
 const noUpdateManifest=manifest({version:'0.6.1',file:{...manifest().file,url:'https://kassa.nex.autos/desktop-updates/win-x64/stable/0.6.1/RestaMarket-Setup-0.6.1.exe'}});
 const noUpdate=newClient(async()=>response(envelope(noUpdateManifest)));assert.equal((await noUpdate.check()).available,false);await assert.rejects(()=>noUpdate.download(),expectCode('UPDATE_NOT_AVAILABLE'));
 const transferCopy=newClient(async url=>response(url===feedUrl?envelope(noUpdateManifest):bytes));assert.equal((await transferCopy.check()).available,false);
 const currentInstaller=await transferCopy.downloadForTransfer();assert.deepEqual(await readFile(currentInstaller.file),bytes,'A private transfer package may include the signed current installer');
 await assert.rejects(()=>transferCopy.download(),expectCode('UPDATE_NOT_AVAILABLE'),'Normal update still rejects reinstalling current version');
 await assert.rejects(()=>transferCopy.revalidateDownloaded(),expectCode('UPDATE_NOT_AVAILABLE'),'Transfer copying cannot weaken installation eligibility');
 await writeFile(currentInstaller.file,Buffer.alloc(bytes.length));await assert.rejects(()=>verifyInstallerFile(currentInstaller.file,currentInstaller.manifest),expectCode('UPDATE_HASH_MISMATCH'));
 const unChecked=newClient(async()=>{throw Error('Must not fetch');});await assert.rejects(()=>unChecked.download(),expectCode('UPDATE_NOT_AVAILABLE'));
 for(const status of [301,302,307,404,500]){const bad=newClient(async()=>response('',{status}));await assert.rejects(()=>bad.check(),expectCode('UPDATE_NETWORK_ERROR'));}
 const redirect=newClient(async()=>({status:200,redirected:true,url:'https://evil.example',body:new ReadableStream(),headers:new Headers()}));await assert.rejects(()=>redirect.check(),expectCode('UPDATE_NETWORK_ERROR'));
 const oversized=newClient(async()=>response('x'.repeat(64*1024+1)));await assert.rejects(()=>oversized.check(),expectCode('UPDATE_INVALID_MANIFEST'));
 const declaredOversized=newClient(async()=>response('{}',{headers:{'Content-Length':String(64*1024+1)}}));await assert.rejects(()=>declaredOversized.check(),expectCode('UPDATE_DOWNLOAD_FAILED'));
 for(const [name,badBytes,headers,code] of [['corrupt',Buffer.alloc(bytes.length),{},'UPDATE_HASH_MISMATCH'],['truncated',bytes.subarray(0,-1),{},'UPDATE_HASH_MISMATCH'],['overlong',Buffer.concat([bytes,Buffer.from('x')]),{},'UPDATE_DOWNLOAD_FAILED'],['wrong content length',bytes,{'Content-Length':String(bytes.length-1)},'UPDATE_DOWNLOAD_FAILED'],['encoded',bytes,{'Content-Encoding':'gzip'},'UPDATE_DOWNLOAD_FAILED']]){
  const isolated=cache(),bad=newClient(async url=>response(url===feedUrl?envelope():badBytes,{headers:url===feedUrl?{}:headers}),{cacheDir:isolated});await bad.check();await assert.rejects(()=>bad.download(),expectCode(code),name);assert.deepEqual(await readdir(isolated),[],name+' leaves no partial or installable file');
 }
 let resolveFetch;const busy=newClient(()=>new Promise(resolve=>{resolveFetch=resolve;}));const checking=busy.check();await assert.rejects(()=>busy.check(),expectCode('UPDATE_BUSY'));busy.cancel();await assert.rejects(()=>checking,expectCode('UPDATE_CANCELLED'));resolveFetch(response(envelope()));
 let downloadStarted;const began=new Promise(resolve=>{downloadStarted=resolve;});let bodyCancelled=false;
 const cancelledCache=cache(),cancelledClient=newClient(async url=>url===feedUrl?response(envelope()):new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,100));downloadStarted();},cancel(){bodyCancelled=true;}})),{cacheDir:cancelledCache});
 await cancelledClient.check();const pending=cancelledClient.download();await began;cancelledClient.cancel();await assert.rejects(()=>pending,expectCode('UPDATE_CANCELLED'));assert.ok(bodyCancelled);assert.deepEqual(await readdir(cancelledCache),[]);
 let clock=now;const expires=newClient(async url=>response(url===feedUrl?envelope():bytes),{now:()=>clock});await expires.check();await expires.download();clock=Date.parse(manifest().expiresAt)+1;await assert.rejects(()=>expires.revalidateDownloaded(),expectCode('UPDATE_INVALID_MANIFEST'));
 let served=envelope();const regression=newClient(async()=>response(served));await regression.check();served=envelope(noUpdateManifest);await assert.rejects(()=>regression.check(),expectCode('UPDATE_INVALID_MANIFEST'));
 console.log('PASS: signed Ed25519 update protocol; strict release/host/version/time rules; immutable manifests; streamed SHA256/size verification; manual redirects; corrupted/oversized downloads rejected; cache revalidation; cancellation and private partial cleanup. No installer or network was executed.');
}finally{
 // Only this mkdtemp-created fixture directory is removed.
 if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('restamarket-update-client-'))throw Error('Unexpected fixture directory');
 await rm(directory,{recursive:true,force:true});
}
