/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Explicitly invoked diagnostics only. Imports perform no filesystem access.
// Returned encrypted material must NEVER be logged or sent to remote services.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
const digest=value=>createHash('sha256').update(value).digest('hex');
function existingWindowsProfileKey(osCrypt){
 if(!osCrypt||typeof osCrypt!=='object'||Array.isArray(osCrypt)||typeof osCrypt.encrypted_key!=='string'||osCrypt.encrypted_key.length>32768)throw Error('Existing encrypted Windows profile key is required');
 const bytes=Buffer.from(osCrypt.encrypted_key,'base64');if(bytes.length<16||bytes.toString('base64')!==osCrypt.encrypted_key||bytes.subarray(0,5).toString('ascii')!=='DPAPI')throw Error('Existing encrypted Windows profile key is invalid');
}
function boundedCanonicalRead(file,maximum){
 const resolved=path.resolve(file),directory=path.dirname(resolved);
 if(normalized(fs.realpathSync(directory))!==normalized(directory))throw Error('Read-only source directory is not canonical');
 const before=fs.lstatSync(resolved);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)throw Error('Invalid read-only source');
 const descriptor=fs.openSync(resolved,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const actual=fs.fstatSync(descriptor);if(actual.ino!==before.ino||actual.dev!==before.dev||actual.size>maximum)throw Error('Read-only source changed');const bytes=fs.readFileSync(descriptor);if(bytes.length>maximum)throw Error('Read-only source is too large');return bytes;}finally{fs.closeSync(descriptor);}
}
function readProfileSources(profileRoot,identityFile){
 if(!path.isAbsolute(profileRoot)||!path.isAbsolute(identityFile))throw Error('Absolute read-only sources are required');
 const stateFile=path.join(profileRoot,'Local State'),stateBytes=boundedCanonicalRead(stateFile,1024*1024),identityBytes=boundedCanonicalRead(identityFile,32768),stateDigest=digest(stateBytes),identityDigest=digest(identityBytes);
 const state=JSON.parse(stateBytes.toString('utf8')),identity=JSON.parse(identityBytes.toString('utf8'));
 existingWindowsProfileKey(state.os_crypt);if(!identity||typeof identity.privateKeyEncrypted!=='string'||typeof identity.publicKeyPem!=='string')throw Error('Read-only encrypted fields are unavailable');
 const osCrypt=JSON.parse(JSON.stringify(state.os_crypt));
 if(Buffer.byteLength(JSON.stringify(osCrypt))>32768)throw Error('Encrypted settings are too large');
 return {identity,osCrypt,profileUnchanged(){try{return digest(boundedCanonicalRead(stateFile,1024*1024))===stateDigest;}catch{return false;}},sourcesUnchanged(){try{return digest(boundedCanonicalRead(stateFile,1024*1024))===stateDigest&&digest(boundedCanonicalRead(identityFile,32768))===identityDigest;}catch{return false;}}};
}
function copyEncryptedOsCryptToIsolatedProfile(snapshot,fixture){
 const resolved=path.resolve(fixture),info=fs.lstatSync(resolved);
 if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('rm-readonly-oscrypt-')||info.isSymbolicLink()||!info.isDirectory()||normalized(fs.realpathSync(resolved))!==normalized(resolved))throw Error('Unsafe isolated profile');
 existingWindowsProfileKey(snapshot.osCrypt);const source=JSON.stringify({os_crypt:snapshot.osCrypt});if(Buffer.byteLength(source)>32768)throw Error('Encrypted settings are too large');
 fs.writeFileSync(path.join(resolved,'Local State'),source,{flag:'wx',mode:0o600});
}
module.exports={boundedCanonicalRead,readProfileSources,copyEncryptedOsCryptToIsolatedProfile};
