/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Explicit, local operator recovery ONLY. No server calls, key rotation, database
// access or runtime auto-import. Both Chromium crypto contexts use private copies
// of encrypted os_crypt settings; actual browser profiles remain untouched.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {randomUUID,randomBytes,verify,createPublicKey}=require('node:crypto');
const {DEVICE_ID}=require('../desktop/central-protocol.cjs');
const {boundedCanonicalRead,readProfileSources,copyEncryptedOsCryptToIsolatedProfile}=require('./central-profile-readonly-helpers.cjs');
const fail=()=>Error('Device profile migration failed closed; the existing public key was not rotated.');
const valid=identity=>identity&&Object.keys(identity).sort().join(',')==='id,privateKeyEncrypted,publicKeyPem,schema'&&identity.schema===1&&DEVICE_ID.test(identity.id)&&typeof identity.publicKeyPem==='string'&&identity.publicKeyPem.length<=2048&&typeof identity.privateKeyEncrypted==='string'&&identity.privateKeyEncrypted.length<=24576;
function verifyPrivateDirectory(directory,files=[]){
 // Read-only DACL validation. Never repair/rewrite actual profile permissions.
 // New wx files inherit this already protected owner + SYSTEM-only directory.
 const script="$ErrorActionPreference='Stop';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$system='S-1-5-18';$paths=@($env:RM_MIGRATION_PRIVATE_DIRECTORY);foreach($file in (ConvertFrom-Json $env:RM_MIGRATION_PRIVATE_FILES)){if($file -isnot [string] -or [string]::IsNullOrEmpty($file)){throw 'Invalid private file'};$paths+=$file};$ok=$true;foreach($p in $paths){$a=Get-Acl -LiteralPath $p;$isDirectory=$p -eq $env:RM_MIGRATION_PRIVATE_DIRECTORY;if($isDirectory -and -not $a.AreAccessRulesProtected){$ok=$false};$owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;if($owner -ne $sid -and $owner -ne $system){$ok=$false};$seen=@{};foreach($r in $a.Access){$id=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if(($id -ne $sid -and $id -ne $system) -or $r.AccessControlType -ne 'Allow' -or (([int]$r.FileSystemRights -band 2032127) -ne 2032127)){$ok=$false};if($isDirectory -and (([int]$r.InheritanceFlags -band 3) -ne 3)){$ok=$false};$seen[$id]=$true};if(-not $seen[$sid] -or -not $seen[$system]){$ok=$false}};if(-not $ok){exit 1};Write-Output 'private'";
 // Windows PowerShell must not inherit incompatible PowerShell 7 modules from
 // an operator's pwsh terminal. Use only its system module directory.
 const moduleRoot=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules');
 const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4096,stdio:['ignore','pipe','ignore'],env:{...process.env,PSModulePath:moduleRoot,RM_MIGRATION_PRIVATE_DIRECTORY:directory,RM_MIGRATION_PRIVATE_FILES:JSON.stringify(files)}});
 if(output.trim()!=='private')throw fail();
}
function copiedProfileKeyUnchanged(profile,snapshot){
 try{return JSON.parse(boundedCanonicalRead(path.join(profile,'Local State'),1024*1024)).os_crypt.encrypted_key===snapshot.osCrypt.encrypted_key;}catch{return false;}
}
async function isolatedProfile(snapshot){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rm-readonly-oscrypt-'));const {protectData}=await import('../desktop/protect-data.mjs');
 try{await protectData(directory);verifyPrivateDirectory(directory);copyEncryptedOsCryptToIsolatedProfile(snapshot,directory);return directory;}catch(error){await removeProfile(directory);throw error;}
}
async function removeProfile(directory){
 if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('rm-readonly-oscrypt-'))throw fail();
 const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail();await fs.rm(directory,{recursive:true,force:true});
}
function nativeWorker(executable,profile){
 const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;delete environment.NODE_OPTIONS;
 const child=spawn(executable,[path.join(__dirname,'central-device-profile-worker.cjs'),profile],{env:environment,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 let resolveReady,rejectReady,resolveResult,rejectResult,finished=false,resultReceived=false;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;}),result=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});ready.catch(()=>{});result.catch(()=>{});
 const error=()=>{rejectReady(fail());rejectResult(fail());};
 const timer=setTimeout(()=>{error();child.kill();},35000);
 const exited=new Promise(resolve=>{
  child.once('error',()=>{finished=true;clearTimeout(timer);error();resolve(1);});child.once('exit',code=>{finished=true;clearTimeout(timer);if(!resultReceived)error();resolve(code);});
 });
 child.on('message',message=>{
  if(!message||Buffer.byteLength(JSON.stringify(message))>65536){error();child.kill();return;}
  if(message.type==='ready'&&typeof message.transportPublicKey==='string'&&message.transportPublicKey.length<2048){resolveReady(message);return;}
  if(message.type==='result'){resultReceived=true;resolveResult(message);return;}error();
 });
 return {ready,async perform(message){await ready;if(!child.connected)throw fail();child.send(message,error=>{if(error){rejectResult(fail());}});const value=await result,code=await exited;if(code!==0)throw fail();return value;},async close(){if(!finished){if(child.connected)child.send({type:'close'},()=>{});await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,1000))]);if(!finished){child.kill();await exited;}}}};
}
async function writeNew(file,bytes){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
async function migrateDeviceProfile({sourceProfile,targetProfile,identityFile,electronExecutable,workerFactory=nativeWorker}={}){
 if(process.platform!=='win32'||![sourceProfile,targetProfile,identityFile,electronExecutable].every(value=>typeof value==='string'&&path.isAbsolute(value))||path.resolve(sourceProfile).toLowerCase()===path.resolve(targetProfile).toLowerCase())throw fail();
 const source=readProfileSources(sourceProfile,identityFile),target=readProfileSources(targetProfile,identityFile),original=boundedCanonicalRead(identityFile,32768);if(!valid(source.identity)||JSON.stringify(source.identity)!==JSON.stringify(target.identity))throw fail();
 const publicKey=createPublicKey(source.identity.publicKeyPem);if(publicKey.asymmetricKeyType!=='ed25519')throw fail();
 const directory=path.dirname(identityFile);verifyPrivateDirectory(directory,[identityFile]);
 const lockFile=path.join(directory,'identity.lock'),lock=await fs.open(lockFile,'wx',0o600),lockStat=await lock.stat();
 const profiles=[],workers=[];let temporary,published=false,backupFile;
 try{
  if(!source.sourcesUnchanged()||!target.sourcesUnchanged()||!boundedCanonicalRead(identityFile,32768).equals(original))throw fail();
  const targetTemporary=await isolatedProfile(target);profiles.push(targetTemporary);const targetWorker=workerFactory(electronExecutable,targetTemporary);workers.push(targetWorker);const transport=await targetWorker.ready;
  const sourceTemporary=await isolatedProfile(source);profiles.push(sourceTemporary);const sourceWorker=workerFactory(electronExecutable,sourceTemporary);workers.push(sourceWorker);
  const exported=await sourceWorker.perform({type:'decrypt-for-target',identity:source.identity,transportPublicKey:transport.transportPublicKey});if(exported.publicKeyMatches!==true||typeof exported.encryptedTransport!=='string')throw fail();
  const challenge=randomBytes(32).toString('hex'),imported=await targetWorker.perform({type:'reencrypt-for-target',identity:source.identity,encryptedTransport:exported.encryptedTransport,challenge});
  if(imported.publicKeyMatches!==true||imported.nativeRoundTripVerified!==true||!valid(imported.identity)||imported.identity.id!==source.identity.id||imported.identity.publicKeyPem!==source.identity.publicKeyPem||!verify(null,Buffer.from(challenge,'hex'),publicKey,Buffer.from(imported.proof||'','base64')))throw fail();
  if(!copiedProfileKeyUnchanged(sourceTemporary,source)||!copiedProfileKeyUnchanged(targetTemporary,target))throw fail();
  // A new native process must decrypt using a FRESH copy of the actual target
  // encrypted key. Same-process round trips alone permit an in-memory fallback.
  const verifyTemporary=await isolatedProfile(target);profiles.push(verifyTemporary);const verifyWorker=workerFactory(electronExecutable,verifyTemporary);workers.push(verifyWorker);
  const verifyChallenge=randomBytes(32).toString('hex'),verified=await verifyWorker.perform({type:'verify-target',identity:imported.identity,challenge:verifyChallenge});
  if(verified.publicKeyMatches!==true||verified.targetVerified!==true||!verify(null,Buffer.from(verifyChallenge,'hex'),publicKey,Buffer.from(verified.proof||'','base64'))||!copiedProfileKeyUnchanged(verifyTemporary,target))throw fail();
  if(!source.sourcesUnchanged()||!target.sourcesUnchanged()||!boundedCanonicalRead(identityFile,32768).equals(original))throw fail();
  backupFile=path.join(directory,'identity.pre-profile-migration-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.json');await writeNew(backupFile,original);
  temporary=identityFile+'.migration-'+randomUUID()+'.partial';await writeNew(temporary,JSON.stringify(imported.identity));
  verifyPrivateDirectory(directory,[identityFile,backupFile,temporary,lockFile]);
  if(!source.sourcesUnchanged()||!target.sourcesUnchanged()||!boundedCanonicalRead(identityFile,32768).equals(original))throw fail();
  await fs.rename(temporary,identityFile);temporary=null;published=true;
  const actual=JSON.parse(boundedCanonicalRead(identityFile,32768));if(actual.id!==source.identity.id||actual.publicKeyPem!==source.identity.publicKeyPem||actual.privateKeyEncrypted!==imported.identity.privateKeyEncrypted||!boundedCanonicalRead(backupFile,32768).equals(original))throw fail();
  const sourceProfileUnchanged=source.profileUnchanged(),targetProfileUnchanged=target.profileUnchanged();if(!sourceProfileUnchanged||!targetProfileUnchanged)throw fail();
  return {pass:true,migrated:true,publicKeyPreserved:true,backupCreated:true,sourceProfileUnchanged,targetProfileUnchanged,backupFile};
 }finally{
  let cleanupFailed=false;const clean=async action=>{try{await action();}catch{cleanupFailed=true;}};
  for(const worker of workers)await clean(()=>worker.close());for(const profile of profiles)await clean(()=>removeProfile(profile));
  if(temporary)await clean(()=>fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}));
  await clean(()=>lock.close());await clean(async()=>{const after=await fs.lstat(lockFile);if(!after.isFile()||after.isSymbolicLink()||after.ino!==lockStat.ino||after.dev!==lockStat.dev)throw fail();await fs.unlink(lockFile);});
  if(!published)await clean(async()=>{if(!boundedCanonicalRead(identityFile,32768).equals(original))throw fail();});
  if(cleanupFailed)throw fail();
 }
}
async function main(){
 if(process.platform!=='win32'||process.argv.length!==4||process.argv[2]!=='--migrate'||process.argv[3]!=='--confirm-same-device')throw fail();
 const applicationData=process.env.APPDATA;if(!applicationData||!path.isAbsolute(applicationData))throw fail();
 const listing=execFileSync('tasklist.exe',['/FI','IMAGENAME eq RestaMarket.exe','/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true});if(/^"RestaMarket\.exe",/im.test(listing))throw Error('Close RestaMarket before explicit profile migration.');
 const result=await migrateDeviceProfile({sourceProfile:path.join(applicationData,'RestaMarket'),targetProfile:path.join(applicationData,'BirKassa'),identityFile:path.join(applicationData,'BirKassa','local-data','.private','central-device','identity.json'),electronExecutable:require('electron')});
 const {backupFile,...safe}=result;void backupFile;console.log(JSON.stringify(safe));
}
module.exports={migrateDeviceProfile,verifyPrivateDirectory};
if(require.main===module)main().catch(()=>{console.error(JSON.stringify({pass:false,operation:'explicit-device-profile-migration',publicKeyRotated:false}));process.exitCode=1;});
