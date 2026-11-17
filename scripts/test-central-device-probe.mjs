// Pure mock-HTTPS and generated identity. Never enroll or read a real device.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomBytes,randomUUID,verify,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url),{readOnlyDeviceIdentity,probeDevice,isNativeProbeEntry}=require('./probe-central-device.cjs'),{canonicalSigningData,bodySha256}=require('../desktop/central-protocol.cjs');
const entryFile=path.resolve('scripts/probe-central-device.cjs'),nativeRuntime={versions:{electron:'45.0.0'},type:'browser',argv:['electron.exe',entryFile,'--probe']};
assert.equal(isNativeProbeEntry(nativeRuntime,entryFile),true,'Electron default_app can enter without require.main');
for(const invalid of [{...nativeRuntime,type:'renderer'},{...nativeRuntime,versions:{}},{...nativeRuntime,argv:['electron.exe',entryFile]},{...nativeRuntime,argv:['electron.exe',entryFile,'--probe','extra']},{...nativeRuntime,argv:['electron.exe',path.resolve('another-script.cjs'),'--probe']}])assert.equal(isNativeProbeEntry(invalid,entryFile),false,'Only the exact explicit native entry is accepted');
const temporary=await mkdtemp(path.join(os.tmpdir(),'rm-device-probe-test-'));
try{
 const keys=generateKeyPairSync('ed25519'),id=randomUUID(),secret=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv),ciphertext=Buffer.concat([cipher.update(keys.privateKey.export({type:'pkcs8',format:'pem'}),'utf8'),cipher.final()]),encrypted=Buffer.concat([iv,cipher.getAuthTag(),ciphertext]);
 const directory=path.join(temporary,'existing-private-identity');await mkdir(directory,{mode:0o700});const file=path.join(directory,'identity.json');
 await writeFile(file,JSON.stringify({schema:1,id,publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),privateKeyEncrypted:encrypted.toString('base64')}),{mode:0o600});const before=await readFile(file),beforeStat=await lstat(file);
 const safeStorage={isEncryptionAvailable:()=>true,decryptString(value){const decrypt=createDecipheriv('aes-256-gcm',secret,value.subarray(0,12));decrypt.setAuthTag(value.subarray(12,28));return Buffer.concat([decrypt.update(value.subarray(28)),decrypt.final()]).toString('utf8');},encryptString(){assert.fail('A read-only probe must never encrypt or create an identity');}};
 const source=readOnlyDeviceIdentity(file,safeStorage);assert.equal(source.identity.id,id);assert.equal(source.assertUnchanged(),true);assert.deepEqual(await readdir(directory),['identity.json'],'No registration, temporary key or identity lock is created');
 const epoch=randomBytes(32).toString('base64url'),nonces=new Set(),calls=[];
 const fixtureFetch=async(target,options)=>{
  const url=new URL(target);assert.equal(url.origin,'https://kassa.nex.autos');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);calls.push({path:url.pathname+url.search,options});
  if(url.pathname==='/desktop-private/challenge')return Response.json({schema:1,epoch,serverTime:Date.now()});
  const headers=options.headers;if(!headers)return Response.json({error:'generic'},{status:401});
  assert.equal(headers['x-rm-purpose'],'renderer');assert.equal('cookie'in headers,false);assert.equal('authorization'in headers,false);assert.equal(headers['x-rm-body-sha256'],bodySha256());
  const original=url.pathname.slice('/desktop-private'.length)+url.search,valid=verify(null,canonicalSigningData({deviceId:headers['x-rm-device-id'],epoch:headers['x-rm-epoch'],time:headers['x-rm-time'],nonce:headers['x-rm-nonce'],purpose:headers['x-rm-purpose'],method:'GET',path:original,bodySha256:headers['x-rm-body-sha256']}),keys.publicKey,Buffer.from(headers['x-rm-signature'],'base64'));
  if(!valid)return Response.json({error:'generic'},{status:401});if(nonces.has(headers['x-rm-nonce']))return Response.json({error:'generic'},{status:409});nonces.add(headers['x-rm-nonce']);
  if(original==='/api/products')return Response.json({error:'staff required'},{status:401});
  return Response.json({local:true,authenticated:false,strongAuth:true,users:[{id:'do-not-print-id',fullName:'do-not-print-name'},{id:'another-private-id',fullName:'another-name'}]});
 };
 const report=await probeDevice(source.identity,{fetchImpl:fixtureFetch});assert.equal(report.pass,true);assert.equal(report.accountCount,2);assert.deepEqual(report.statuses,{unsigned:401,signedAuth:200,replay:409,tamperedPath:401,staffRequired:401});assert.equal(calls.length,6);
 const printable=JSON.stringify(report);for(const forbidden of [id,'do-not-print','another-name',epoch,'x-rm-signature','privateKey'])assert.equal(printable.includes(forbidden),false);
 assert.deepEqual(await readFile(file),before);assert.equal((await lstat(file)).mtimeMs,beforeStat.mtimeMs);assert.equal(source.assertUnchanged(),true);
 await assert.rejects(probeDevice(source.identity,{fetchImpl:async()=>Response.json({}, {status:200})}),'An unexpected unsigned response fails before signing anything');
 await writeFile(file,'changed fixture',{mode:0o600});assert.throws(()=>source.assertUnchanged(),'Concurrent identity changes are detected and never repaired/overwritten');
 const code=await readFile('scripts/probe-central-device.cjs','utf8');assert.ok(!/\bcentralIdentity\s*\(/.test(code));assert.ok(!/\bopenLocalDatabase\s*\(/.test(code));assert.ok(!/method\s*:\s*['"]POST['"]/.test(code));assert.ok(code.includes("process.argv[2]==='--probe'"));assert.ok(code.includes('},45000)'),'The actual native probe has a bounded watchdog');
 console.log('PASS: read-only device probe uses only existing encrypted fixture bytes, in-memory decryption and GET signatures; no identity/ACL/registration/session/database mutations; sanitized statuses/counts, replay/path/staff gates, source-change detection and explicit CLI guard. No actual device, network or server.');
}finally{const resolved=path.resolve(temporary);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('rm-device-probe-test-'))throw Error('Unexpected probe fixture cleanup path');await rm(resolved,{recursive:true,force:true});}
