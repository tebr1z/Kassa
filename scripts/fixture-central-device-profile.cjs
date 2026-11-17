/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Native bootstrap/verification worker for GENERATED temporary fixtures only.
// No real APPDATA path is accepted, and no private PEM/ciphertext is emitted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {generateKeyPairSync,createPrivateKey,createPublicKey,randomUUID}=require('node:crypto');
const {app,safeStorage}=require('electron');
const root=process.env.RM_FIXTURE_PROFILE_ROOT,profile=process.env.RM_FIXTURE_PROFILE,mode=process.env.RM_FIXTURE_PROFILE_MODE;
if(!root||path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('rm-profile-migration-native-'))throw Error('Fixture root required');
if(!['bootstrap-source','bootstrap-target','verify'].includes(mode)||!profile)throw Error('Fixture mode required');
if(mode==='verify'){
 if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('rm-readonly-oscrypt-'))throw Error('Isolated verification profile required');
}else if(profile!==path.join(root,mode==='bootstrap-source'?'profile-source':'profile-target'))throw Error('Explicit generated fixture profile required');
const identityFile=path.join(root,'identity.json');
app.setName('Generated profile migration fixture');app.setPath('userData',profile);app.setPath('sessionData',profile);app.setPath('crashDumps',path.join(profile,'crashes'));app.setAppLogsPath(path.join(profile,'logs'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
const timer=setTimeout(()=>app.exit(1),15000);
app.whenReady().then(()=>{
 if(!safeStorage.isEncryptionAvailable())throw Error('Fixture encryption unavailable');
 if(mode==='bootstrap-source'){
  const pair=generateKeyPairSync('ed25519'),encrypted=safeStorage.encryptString(pair.privateKey.export({type:'pkcs8',format:'pem'}));
  fs.writeFileSync(identityFile,JSON.stringify({schema:1,id:randomUUID(),publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}),privateKeyEncrypted:encrypted.toString('base64')}),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({fixture:true,mode,created:true}));
 }else if(mode==='bootstrap-target'){
  safeStorage.encryptString('Generated fixture initialization only');console.log(JSON.stringify({fixture:true,mode,created:true}));
 }else{
  const identity=JSON.parse(fs.readFileSync(identityFile,'utf8'));let decrypted=false,publicKeyMatches=false;
  try{const key=createPrivateKey({key:safeStorage.decryptString(Buffer.from(identity.privateKeyEncrypted,'base64')),format:'pem',type:'pkcs8'});decrypted=true;publicKeyMatches=key.asymmetricKeyType==='ed25519'&&createPublicKey(key).export({type:'spki',format:'pem'})===identity.publicKeyPem;}catch{}
  console.log(JSON.stringify({fixture:true,mode,decrypted,publicKeyMatches}));
 }
 clearTimeout(timer);app.quit();
}).catch(()=>{clearTimeout(timer);console.log(JSON.stringify({fixture:true,mode,failed:true}));app.exit(1);});
