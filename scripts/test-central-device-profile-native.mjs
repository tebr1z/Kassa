import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,lstat,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {protectData} from '../desktop/protect-data.mjs';
const require=createRequire(import.meta.url),{readProfileSources,copyEncryptedOsCryptToIsolatedProfile}=require('./central-profile-readonly-helpers.cjs');

// GENERATED native Windows encryption profiles only. No actual device identity,
// installed profile, actual Local State, network or plaintext private key file.
const root=await mkdtemp(path.join(os.tmpdir(),'rm-profile-migration-native-')),sourceProfile=path.join(root,'profile-source'),targetProfile=path.join(root,'profile-target'),identityFile=path.join(root,'identity.json'),electronExecutable=path.resolve('node_modules/electron/dist/electron.exe'),worker=path.resolve('scripts/fixture-central-device-profile.cjs');
async function run(mode,profile){
 const env={...process.env,RM_FIXTURE_PROFILE_ROOT:root,RM_FIXTURE_PROFILE:profile,RM_FIXTURE_PROFILE_MODE:mode};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electronExecutable,[worker],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',part=>{if(output.length<16384)output+=part;});child.stderr.resume();
 const timer=setTimeout(()=>child.kill(),20000);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
 assert.equal(code,0,'Generated native encryption fixture failed');const lines=output.split(/\r?\n/).map(line=>line.trim()).filter(line=>line.startsWith('{'));assert.equal(lines.length,1);const result=JSON.parse(lines[0]);assert.equal(result.fixture,true);assert.equal(result.mode,mode);return result;
}
async function verify(profileRoot){
 const snapshot=readProfileSources(profileRoot,identityFile),isolated=await mkdtemp(path.join(os.tmpdir(),'rm-readonly-oscrypt-'));await protectData(isolated);
 try{copyEncryptedOsCryptToIsolatedProfile(snapshot,isolated);const result=await run('verify',isolated);assert.equal(snapshot.sourcesUnchanged(),true);return result;}
 finally{if(path.dirname(isolated)!==path.resolve(os.tmpdir())||!path.basename(isolated).startsWith('rm-readonly-oscrypt-'))throw Error('Unsafe verification fixture path');await rm(isolated,{recursive:true,force:true});}
}
try{
 await protectData(root);await mkdir(sourceProfile);await mkdir(targetProfile);
 await run('bootstrap-source',sourceProfile);await run('bootstrap-target',targetProfile);
 const sourceState=await readFile(path.join(sourceProfile,'Local State')),targetState=await readFile(path.join(targetProfile,'Local State')),original=await readFile(identityFile),originalIdentity=JSON.parse(original);
 assert.ok(!original.toString('utf8').includes('BEGIN PRIVATE KEY'),'No plaintext private key file is generated');
 assert.notDeepEqual(JSON.parse(sourceState).os_crypt,JSON.parse(targetState).os_crypt,'Generated source and target use distinct native profile encryption keys');
 const oldSource=await verify(sourceProfile),oldTarget=await verify(targetProfile);assert.equal(oldSource.publicKeyMatches,true);assert.equal(oldTarget.decrypted,false);
 const {migrateDeviceProfile}=require('./migrate-central-device-profile.cjs');
 await writeFile(path.join(targetProfile,'Local State'),JSON.stringify({os_crypt:{}}));
 await assert.rejects(migrateDeviceProfile({sourceProfile,targetProfile,identityFile,electronExecutable}),'A missing target AES key must not silently generate a replacement key');
 assert.deepEqual(await readFile(identityFile),original);await writeFile(path.join(targetProfile,'Local State'),targetState);
 const corruptTarget=JSON.parse(targetState);corruptTarget.os_crypt.encrypted_key=Buffer.concat([Buffer.from('DPAPI'),randomBytes(64)]).toString('base64');
 await writeFile(path.join(targetProfile,'Local State'),JSON.stringify(corruptTarget));
 await assert.rejects(migrateDeviceProfile({sourceProfile,targetProfile,identityFile,electronExecutable}),'A canonical but undecryptable target key must not permit native fallback publication');assert.deepEqual(await readFile(identityFile),original);
 assert.equal((await readdir(root)).some(name=>name.startsWith('identity.pre-profile-migration-')),false,'Corrupt target keys cannot publish an identity or rollback copy');await writeFile(path.join(targetProfile,'Local State'),targetState);
 const lockFile=path.join(root,'identity.lock');await writeFile(lockFile,'Owned fixture lock',{flag:'wx',mode:0o600});
 await assert.rejects(migrateDeviceProfile({sourceProfile,targetProfile,identityFile,electronExecutable}),'An active identity lock must fail closed');assert.deepEqual(await readFile(identityFile),original);await unlink(lockFile);
 const result=await migrateDeviceProfile({sourceProfile,targetProfile,identityFile,electronExecutable});
 const {backupFile,...safeResult}=result;assert.deepEqual(safeResult,{pass:true,migrated:true,publicKeyPreserved:true,backupCreated:true,sourceProfileUnchanged:true,targetProfileUnchanged:true});assert.equal(path.dirname(backupFile),root);
 const updated=await readFile(identityFile),updatedIdentity=JSON.parse(updated);
 assert.equal(updatedIdentity.id,originalIdentity.id);assert.equal(updatedIdentity.publicKeyPem,originalIdentity.publicKeyPem);assert.notEqual(updatedIdentity.privateKeyEncrypted,originalIdentity.privateKeyEncrypted);assert.equal(updated.toString('utf8').includes('BEGIN PRIVATE KEY'),false);
 assert.deepEqual(await readFile(path.join(sourceProfile,'Local State')),sourceState);assert.deepEqual(await readFile(path.join(targetProfile,'Local State')),targetState);
 const newSource=await verify(sourceProfile),newTarget=await verify(targetProfile);assert.equal(newSource.decrypted,false);assert.equal(newTarget.publicKeyMatches,true);
 // A private rollback copy must contain byte-identical old encrypted identity,
 // not a rotated key or plaintext. Search only this owned fixture's direct files.
 let preserved=0;for(const name of await readdir(root)){const file=path.join(root,name),info=await lstat(file);if(info.isFile()&&name!=='identity.json'){const bytes=await readFile(file);assert.equal(bytes.toString('utf8').includes('BEGIN PRIVATE KEY'),false);if(bytes.equals(original)){preserved++;assert.equal(info.isSymbolicLink(),false);assert.equal(info.nlink,1);}}}
 assert.equal(preserved,1,'Exactly one encrypted rollback identity is retained');
 await assert.rejects(migrateDeviceProfile({sourceProfile,targetProfile,identityFile,electronExecutable}),'A completed identity must not be reinterpreted with the old encryption key');assert.deepEqual(await readFile(identityFile),updated);
 console.log(JSON.stringify({pass:true,generatedProfilesOnly:true,sourceDecryptBefore:true,targetDecryptBefore:false,sourceDecryptAfter:false,targetDecryptAfter:true,sameDeviceAndPublicKey:true,encryptedRollbackCopy:true,sourceAndTargetProfilesByteUnchanged:true,missingOrCorruptKeyAndActiveLockAndRepeatedMigrationRejected:true,noPlaintextPrivateKeyFiles:true,noActualMigration:true}));
}catch(cause){
 // Fixture-only classifications: never emit usernames, SIDs, paths, PEM or
 // encrypted payloads when diagnosing native permission incompatibilities.
 const script="$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$paths=@($env:RM_FIXTURE_DACL_DIR,$env:RM_FIXTURE_DACL_FILE);$result=@();foreach($p in $paths){try{$a=Get-Acl -LiteralPath $p -ErrorAction Stop;$owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;$rules=@();foreach($r in $a.Access){$id=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;$rules+=@{current=$id -eq $sid;system=$id -eq 'S-1-5-18';allow=$r.AccessControlType -eq 'Allow';rights=[int]$r.FileSystemRights;inheritance=[int]$r.InheritanceFlags}};$result+=@{directory=$p -eq $env:RM_FIXTURE_DACL_DIR;ownerCurrent=$owner -eq $sid;ownerSystem=$owner -eq 'S-1-5-18';protected=$a.AreAccessRulesProtected;rules=$rules}}catch{$result+=@{aclReadFailed=$true;errorClass=$_.Exception.GetType().Name;errorId=$_.FullyQualifiedErrorId}}};$result|ConvertTo-Json -Compress -Depth 5";
 const diagnostic=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,PSModulePath:path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules'),RM_FIXTURE_DACL_DIR:root,RM_FIXTURE_DACL_FILE:identityFile}});
 console.error('Generated fixture permission classifications:',JSON.stringify({childExit:typeof cause.status==='number'?cause.status:null,isolatedProfileStage:typeof cause.stack==='string'&&cause.stack.includes('at isolatedProfile'),details:JSON.parse(diagnostic)}));throw Error('Generated native profile migration fixture failed; no actual sources were accessed.');
}finally{
 if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('rm-profile-migration-native-'))throw Error('Unsafe native fixture cleanup path');await rm(root,{recursive:true,force:true});
}
