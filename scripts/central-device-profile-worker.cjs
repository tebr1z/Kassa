/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Private IPC-only native crypto worker. Plaintext never enters stdout, argv,
// an environment variable, a file or a remote request.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),{app,safeStorage}=require('electron');
const {DEVICE_ID}=require('../desktop/central-protocol.cjs');
const fixture=process.argv[2];
if(process.argv.length!==3||typeof process.send!=='function'||!fixture||path.dirname(path.resolve(fixture))!==path.resolve(os.tmpdir())||!path.basename(fixture).startsWith('rm-readonly-oscrypt-'))throw Error('Private migration worker invocation required');
const info=fs.lstatSync(fixture);if(!info.isDirectory()||info.isSymbolicLink()||fs.realpathSync(fixture).toLowerCase()!==path.resolve(fixture).toLowerCase())throw Error('Invalid private migration profile');
app.setName('RestaMarket private profile migration');app.setPath('userData',fixture);app.setPath('sessionData',fixture);app.setPath('crashDumps',path.join(fixture,'crashes'));app.setAppLogsPath(path.join(fixture,'logs'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
let busy=false,timer=setTimeout(()=>app.exit(1),30000),transport;
function done(message,code=0){clearTimeout(timer);if(process.connected)process.send(message,()=>{app.exit(code);});else app.exit(1);}
function valid(identity){return identity&&Object.keys(identity).sort().join(',')==='id,privateKeyEncrypted,publicKeyPem,schema'&&identity.schema===1&&DEVICE_ID.test(identity.id)&&typeof identity.publicKeyPem==='string'&&identity.publicKeyPem.length<=2048&&typeof identity.privateKeyEncrypted==='string'&&identity.privateKeyEncrypted.length<=24576;}
function keyFor(pem,publicKey){const key=crypto.createPrivateKey({key:pem,format:'pem',type:'pkcs8'});if(key.asymmetricKeyType!=='ed25519'||crypto.createPublicKey(key).export({type:'spki',format:'pem'})!==publicKey)throw Error('Public key mismatch');return key;}
process.once('disconnect',()=>app.exit(1));
app.whenReady().then(()=>{
 if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Native crypto unavailable');
 transport=crypto.generateKeyPairSync('rsa',{modulusLength:2048});process.send({type:'ready',transportPublicKey:transport.publicKey.export({format:'der',type:'spki'}).toString('base64')});
 process.on('message',message=>{
  if(message?.type==='close'){clearTimeout(timer);app.exit(0);return;}
  if(busy)return;busy=true;
  try{
   if(!message||Buffer.byteLength(JSON.stringify(message))>65536||!valid(message.identity))throw Error('Invalid private command');
   const identity=message.identity;
   if(message.type==='verify-target'){
    if(typeof message.challenge!=='string'||!/^[a-f0-9]{64}$/.test(message.challenge))throw Error('Invalid verification challenge');
    const encrypted=Buffer.from(identity.privateKeyEncrypted,'base64');if(encrypted.length<32||encrypted.toString('base64')!==identity.privateKeyEncrypted)throw Error('Invalid ciphertext');
    const key=keyFor(safeStorage.decryptString(encrypted),identity.publicKeyPem);
    done({type:'result',proof:crypto.sign(null,Buffer.from(message.challenge,'hex'),key).toString('base64'),publicKeyMatches:true,targetVerified:true});return;
   }
   if(message.type==='decrypt-for-target'){
    const encrypted=Buffer.from(identity.privateKeyEncrypted,'base64');if(encrypted.length<32||encrypted.toString('base64')!==identity.privateKeyEncrypted)throw Error('Invalid ciphertext');
    const pem=safeStorage.decryptString(encrypted),key=keyFor(pem,identity.publicKeyPem),canonical=key.export({format:'pem',type:'pkcs8'});
    const target=crypto.createPublicKey({key:Buffer.from(message.transportPublicKey,'base64'),format:'der',type:'spki'});if(target.asymmetricKeyType!=='rsa'||target.asymmetricKeyDetails.modulusLength!==2048)throw Error('Invalid transport');
    const envelope=crypto.publicEncrypt({key:target,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(canonical));done({type:'result',encryptedTransport:envelope.toString('base64'),publicKeyMatches:true});return;
   }
   if(message.type==='reencrypt-for-target'){
    if(typeof message.encryptedTransport!=='string'||message.encryptedTransport.length>512||typeof message.challenge!=='string'||!/^[a-f0-9]{64}$/.test(message.challenge))throw Error('Invalid transport payload');
    const pem=crypto.privateDecrypt({key:transport.privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(message.encryptedTransport,'base64')),key=keyFor(pem,identity.publicKeyPem),canonical=key.export({format:'pem',type:'pkcs8'}),encrypted=safeStorage.encryptString(canonical);
    keyFor(safeStorage.decryptString(encrypted),identity.publicKeyPem);const next={...identity,privateKeyEncrypted:encrypted.toString('base64')};
    done({type:'result',identity:next,proof:crypto.sign(null,Buffer.from(message.challenge,'hex'),key).toString('base64'),publicKeyMatches:true,nativeRoundTripVerified:true});return;
   }
   throw Error('Unsupported private command');
  }catch{done({type:'error',stage:'native-profile-crypto'},1);}
 });
}).catch(()=>done({type:'error',stage:'native-profile-startup'},1));
