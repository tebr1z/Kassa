/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Invoked only by the companion read-only controller. NEVER call centralIdentity:
// it intentionally manages locks/ACLs; this diagnostic must not change sources.
const path=require('node:path'),os=require('node:os');
const {createPrivateKey,createPublicKey}=require('node:crypto');
const {app,safeStorage}=require('electron');
const {readProfileSources,copyEncryptedOsCryptToIsolatedProfile}=require('./central-profile-readonly-helpers.cjs');
const label=process.env.RM_PROFILE_PROBE_CANDIDATE,fixture=process.env.RM_PROFILE_PROBE_DIR;
if(!['BirKassa','RestaMarket'].includes(label)||!fixture||path.dirname(path.resolve(fixture))!==path.resolve(os.tmpdir())||!path.basename(fixture).startsWith('rm-readonly-oscrypt-'))throw Error('Invalid read-only probe configuration');
app.setName('RestaMarket read-only profile probe');app.setPath('userData',fixture);app.setPath('sessionData',fixture);app.setPath('crashDumps',path.join(fixture,'crashes'));app.setAppLogsPath(path.join(fixture,'logs'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
const identityFile=path.join(process.env.APPDATA,'BirKassa','local-data','.private','central-device','identity.json');
let snapshot,identity,sourceReady=false;
try{
 snapshot=readProfileSources(path.join(process.env.APPDATA,label),identityFile);identity=snapshot.identity;
 // No browser preferences, history, credentials or cookies are copied.
 copyEncryptedOsCryptToIsolatedProfile(snapshot,fixture);sourceReady=true;
}catch{}
let timer=setTimeout(()=>{console.log(JSON.stringify({candidate:label,probeTimedOut:true}));app.exit(1);},15000);
app.whenReady().then(()=>{
 let decrypted=false,matches=false;
 if(sourceReady&&safeStorage.isEncryptionAvailable())try{
  const pem=safeStorage.decryptString(Buffer.from(identity.privateKeyEncrypted,'base64')),key=createPrivateKey({key:pem,format:'pem',type:'pkcs8'});
  decrypted=true;matches=key.asymmetricKeyType==='ed25519'&&createPublicKey(key).export({type:'spki',format:'pem'})===identity.publicKeyPem;
 }catch{}
 const unchanged=snapshot?.sourcesUnchanged()===true;
 console.log(JSON.stringify({candidate:label,sourceReady,safeStorageAvailable:safeStorage.isEncryptionAvailable(),decrypted,publicKeyMatches:matches,sourcesUnchanged:unchanged,copiedOnlyEncryptedOsCrypt:true,sourceWrites:false}));
 clearTimeout(timer);timer=null;app.quit();
}).catch(()=>{clearTimeout(timer);console.log(JSON.stringify({candidate:label,probeFailed:true,sourceWrites:false}));app.exit(1);});
