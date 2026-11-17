/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Explicit operator READ-ONLY probe. Never enroll, acquire an identity lock,
// rewrite ACLs, log in, create a session, poll, back up or reset any sales.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {createPrivateKey,createPublicKey,createHash}=require('node:crypto');
const {CENTRAL_PREFIX,DEVICE_ID,signDeviceRequest}=require('../desktop/central-protocol.cjs');
const {DEFAULT_CENTRAL_ORIGIN}=require('../desktop/central-client.cjs');
const {readProfileSources,copyEncryptedOsCryptToIsolatedProfile}=require('./central-profile-readonly-helpers.cjs');
function check(value){if(!value)throw Error('Read-only device probe failed');}
function sourceHash(value){return createHash('sha256').update(value).digest('hex');}
function noLinkedDirectories(directory){
 const absolute=path.resolve(directory),root=path.parse(absolute).root;let current=root;
 for(const name of absolute.slice(root.length).split(path.sep).filter(Boolean)){current=path.join(current,name);const stat=fs.lstatSync(current);check(stat.isDirectory()&&!stat.isSymbolicLink());}
}
function readIdentityBytes(file){
 check(typeof file==='string'&&path.isAbsolute(file));noLinkedDirectories(path.dirname(file));
 const stat=fs.lstatSync(file);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0&&stat.size<=32768&&(process.platform==='win32'||(stat.mode&0o077)===0));
 const handle=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const opened=fs.fstatSync(handle);check(opened.ino===stat.ino&&opened.dev===stat.dev&&opened.size<=32768);const bytes=fs.readFileSync(handle);check(bytes.length<=32768);return {bytes,stat};}finally{fs.closeSync(handle);}
}
function readOnlyDeviceIdentity(file,safeStorage){
 check(safeStorage?.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text');
 const {bytes,stat}=readIdentityBytes(file),value=JSON.parse(bytes.toString('utf8'));
 check(value&&Object.keys(value).sort().join(',')==='id,privateKeyEncrypted,publicKeyPem,schema'&&value.schema===1&&DEVICE_ID.test(value.id)&&typeof value.publicKeyPem==='string'&&value.publicKeyPem.length<=2048&&typeof value.privateKeyEncrypted==='string'&&value.privateKeyEncrypted.length<=24576);
 const encrypted=Buffer.from(value.privateKeyEncrypted,'base64');check(encrypted.length>=32&&encrypted.toString('base64')===value.privateKeyEncrypted);
 const plaintext=safeStorage.decryptString(encrypted);check(typeof plaintext==='string'&&plaintext.length<=4096);
 const privateKey=createPrivateKey({key:plaintext,format:'pem',type:'pkcs8'});check(privateKey.asymmetricKeyType==='ed25519'&&createPublicKey(privateKey).export({type:'spki',format:'pem'})===value.publicKeyPem);
 const initialHash=sourceHash(bytes);
 return {identity:{id:value.id,publicKeyPem:value.publicKeyPem,privateKey},assertUnchanged(){const after=readIdentityBytes(file);check(after.stat.ino===stat.ino&&after.stat.dev===stat.dev&&after.stat.size===stat.size&&after.stat.mtimeMs===stat.mtimeMs&&sourceHash(after.bytes)===initialHash);return true;}};
}
async function limitedJson(response,maximum=65536){
 check(response.body);let bytes=0;const chunks=[];
 for await(const chunk of response.body){bytes+=chunk.length;check(bytes<=maximum);chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function discard(response){await response.body?.cancel?.().catch(()=>{});}
async function probeDevice(identity,{fetchImpl=fetch,onStage=()=>{}}={}){
 check(DEVICE_ID.test(identity?.id)&&identity.privateKey?.asymmetricKeyType==='ed25519');
 const statuses={},send=async(target,headers)=>{
  check(target.startsWith('/')&&!target.startsWith('//'));const response=await fetchImpl(DEFAULT_CENTRAL_ORIGIN+CENTRAL_PREFIX+target,{method:'GET',headers,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});return response;
 };
 onStage('unsigned-denial');let response=await send('/api/auth');statuses.unsigned=response.status;await discard(response);check(statuses.unsigned===401);
 onStage('challenge');response=await send('/challenge');check(response.status===200);const challenge=await limitedJson(response,4096);
 check(challenge&&Object.keys(challenge).sort().join(',')==='epoch,schema,serverTime'&&challenge.schema===1&&typeof challenge.epoch==='string'&&/^[A-Za-z0-9_-]{43}$/.test(challenge.epoch)&&Buffer.from(challenge.epoch,'base64url').length===32&&Buffer.from(challenge.epoch,'base64url').toString('base64url')===challenge.epoch&&Number.isSafeInteger(challenge.serverTime)&&Math.abs(Date.now()-challenge.serverTime)<=25000);
 const authHeaders=signDeviceRequest({deviceId:identity.id,epoch:challenge.epoch,purpose:'renderer',method:'GET',path:'/api/auth',privateKey:identity.privateKey});
 onStage('signed-auth');response=await send('/api/auth',authHeaders);statuses.signedAuth=response.status;check(response.status===200);const auth=await limitedJson(response);
 check(auth.local===true&&auth.authenticated===false&&auth.strongAuth===true&&Array.isArray(auth.users)&&auth.users.length>0);
 onStage('replay-denial');response=await send('/api/auth',authHeaders);statuses.replay=response.status;await discard(response);check(statuses.replay===409);
 onStage('signature-path-denial');response=await send('/api/auth?probe=signature-path-binding',authHeaders);statuses.tamperedPath=response.status;await discard(response);check(statuses.tamperedPath===401);
 onStage('staff-auth-required');const productHeaders=signDeviceRequest({deviceId:identity.id,epoch:challenge.epoch,purpose:'renderer',method:'GET',path:'/api/products',privateKey:identity.privateKey});response=await send('/api/products',productHeaders);statuses.staffRequired=response.status;await discard(response);check(statuses.staffRequired===401);
 return {pass:true,readOnly:true,actualDeviceAccepted:true,accountCount:auth.users.length,statuses,noLogin:true,noBusinessWrites:true,noLocalDatabaseOpened:true};
}
function removeTemporaryProfile(directory){
 check(typeof directory==='string'&&path.dirname(directory)===path.resolve(os.tmpdir())&&path.basename(directory).startsWith('rm-readonly-oscrypt-'));
 const stat=fs.lstatSync(directory);check(stat.isDirectory()&&!stat.isSymbolicLink());fs.rmSync(directory,{recursive:true,force:true});
}
function runElectronProbe(){
 const {app,safeStorage}=require('electron');let temporary,snapshot,identityFile,stage='startup',report,failed=false;
 const parentOwnsProfile=typeof process.env.RM_DEVICE_PROBE_PROFILE==='string';
 const watchdog=setTimeout(()=>{
  const timedOutStage=stage;let sourcesUnchanged=false,temporaryProfileRemoved=false;
  try{sourcesUnchanged=!snapshot||snapshot.sourcesUnchanged();}catch{}
  try{if(temporary&&!parentOwnsProfile)removeTemporaryProfile(temporary);temporaryProfileRemoved=!parentOwnsProfile;}catch{}
  console.error(JSON.stringify({pass:false,stage:timedOutStage,timedOut:true,readOnly:true,sourcesUnchanged,temporaryProfileRemoved,noBusinessWrites:true,noLocalDatabaseOpened:true}));app.exit(1);
 },45000);
 try{
  check(process.platform==='win32'&&process.argv.length===3&&process.argv[2]==='--probe');
  temporary=parentOwnsProfile?process.env.RM_DEVICE_PROBE_PROFILE:fs.mkdtempSync(path.join(os.tmpdir(),'rm-readonly-oscrypt-'));
  check(path.isAbsolute(temporary)&&path.dirname(temporary)===path.resolve(os.tmpdir())&&path.basename(temporary).startsWith('rm-readonly-oscrypt-'));
  const temporaryInfo=fs.lstatSync(temporary);check(temporaryInfo.isDirectory()&&!temporaryInfo.isSymbolicLink()&&fs.realpathSync(temporary).toLowerCase()===path.resolve(temporary).toLowerCase());
  app.setName('RestaMarket read-only device probe');
  app.setPath('userData',temporary);app.setPath('sessionData',temporary);app.setPath('crashDumps',path.join(temporary,'crashes'));app.setAppLogsPath(path.join(temporary,'logs'));
  // Protect ONLY this newly created temporary directory before copying the
  // existing encrypted profile key. No actual profile/identity ACL is changed.
  const owner=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4096,stdio:['ignore','pipe','ignore']}).match(/S-1-5-[0-9-]+/)?.[0];check(owner);
  execFileSync('icacls.exe',[path.toNamespacedPath(temporary),'/inheritance:r','/grant:r','*'+owner+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F','/Q','/L'],{windowsHide:true,timeout:10000,stdio:'ignore'});
  // Importing the helper is inert; invoke only its read-only TEMP ACL check,
  // never its explicit migration entry point.
  require('./migrate-central-device-profile.cjs').verifyPrivateDirectory(temporary);
  stage='target-profile-copy';const profile=path.join(app.getPath('appData'),'BirKassa');identityFile=path.join(profile,'local-data','.private','central-device','identity.json');snapshot=readProfileSources(profile,identityFile);copyEncryptedOsCryptToIsolatedProfile(snapshot,temporary);
  app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
 }catch{clearTimeout(watchdog);console.error(JSON.stringify({pass:false,stage,noBusinessWrites:true}));if(temporary&&!parentOwnsProfile)try{removeTemporaryProfile(temporary);}catch{}app.exit(1);return;}
 app.whenReady().then(async()=>{
  let source;
  try{
   stage='existing-identity-read';source=readOnlyDeviceIdentity(identityFile,safeStorage);
   report=await probeDevice(source.identity,{onStage:value=>{stage=value;}});stage='source-unchanged';check(source.assertUnchanged()&&snapshot.sourcesUnchanged());report.actualProfileUnchanged=true;
  }catch{failed=true;report={pass:false,stage,readOnly:true,noBusinessWrites:true,noLocalDatabaseOpened:true};}
  finally{if(source)try{check(source.assertUnchanged()&&snapshot.sourcesUnchanged());}catch{failed=true;report={pass:false,stage:'source-identity-changed',readOnly:true,noBusinessWrites:true};}}
  app.once('quit',()=>{
   clearTimeout(watchdog);
   if(parentOwnsProfile)report.temporaryProfileCleanupPending=true;
   else try{removeTemporaryProfile(temporary);report.temporaryProfileRemoved=true;}catch{failed=true;report={...report,pass:false,stage:'temporary-profile-cleanup',temporaryProfileRemoved:false};}
   if(failed)console.error(JSON.stringify(report));else console.log(JSON.stringify(report));app.exit(failed?1:0);
  });app.quit();
 }).catch(()=>{clearTimeout(watchdog);if(!parentOwnsProfile)try{removeTemporaryProfile(temporary);}catch{}console.error(JSON.stringify({pass:false,stage,noBusinessWrites:true}));app.exit(1);});
}
// Electron 45's default_app ESM loader does not necessarily set require.main
// for a CommonJS entry. Accept ONLY this exact explicit native CLI invocation;
// importing the helper from tests or another app remains inert.
function isNativeProbeEntry(runtime=process,file=__filename){return Boolean(runtime.versions?.electron&&runtime.type==='browser'&&Array.isArray(runtime.argv)&&runtime.argv.length===3&&runtime.argv[2]==='--probe'&&typeof runtime.argv[1]==='string'&&path.resolve(runtime.argv[1]).toLowerCase()===path.resolve(file).toLowerCase());}
module.exports={readOnlyDeviceIdentity,probeDevice,removeTemporaryProfile,isNativeProbeEntry};
if(require.main===module||isNativeProbeEntry())runElectronProbe();
