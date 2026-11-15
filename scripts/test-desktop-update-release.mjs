// Generated fixture keys and temporary files only. No real release keys,
// AppData, application DB, networking, installer process or hosting is used.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,lstat,symlink,chmod} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {initializeKey,publicKeyPem,noSymbolicLinks,assertPrivateKeyRestricted} from './init-desktop-update-key.mjs';
import {makeSignedRelease,verifyEnvelope,validatePayload,readTrust,installerName,UPDATE_FEED,MAX_MANIFEST_BYTES,MAX_INSTALLER_BYTES,compareVersions,cliOptions,validateInstaller} from './sign-desktop-release.mjs';
import {publishRelease} from './publish-desktop-update.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'restamarket-update-release-test-'));
const now=Date.parse('2026-11-15T12:00:00.000Z'),publishedAt=new Date(now).toISOString();
const keys=generateKeyPairSync('ed25519'),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}),publicKey=keys.publicKey;
const {verifyManifest:clientVerify}=createRequire(import.meta.url)('../desktop/update-client.cjs');
const other=generateKeyPairSync('ed25519');
const notes={az:'Ölçü və rəng şəkilləri yeniləndi.',en:'Product images updated.',ru:'Изображения обновлены.',tr:'Görseller güncellendi.',zh:'商品图片已更新。'};
const sourceRoot=path.join(root,'incoming'),publicRoot=path.join(root,'static'),archiveRoot=path.join(root,'private-history');
const installerBytes=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(8192,7)]);
async function fixture(version,changes={}) {
 const source=path.join(sourceRoot,version);await mkdir(source,{recursive:true});
 const installer=path.join(source,installerName(version));await writeFile(installer,installerBytes);
 const release=await makeSignedRelease({version,installer,privateKey,releaseNotes:notes,publishedAt,now,...changes});await writeFile(path.join(source,'manifest.json'),release.bytes);
 return {...release,source,installer};
}
const pack=payload=>{const bytes=Buffer.from(JSON.stringify(payload));return Buffer.from(JSON.stringify({payload:bytes.toString('base64'),signature:sign(null,bytes,privateKey).toString('base64')}));};
const check=bytes=>verifyEnvelope(bytes,publicKey,{now});
const publish=(source,extras={})=>publishRelease({source,publicRoot,archiveRoot,publicKey,now,...extras});
async function latest(){return readFile(path.join(publicRoot,'win-x64/stable/latest.json'));}
async function absent(file){await assert.rejects(lstat(file),{code:'ENOENT'});}
try {
 const first=await fixture('0.6.2');assert.equal(check(first.bytes).payload.version,'0.6.2');assert.equal(first.payload.minimumVersion,'0.6.0');
 assert.equal(clientVerify(JSON.parse(first.bytes.toString()),{publicKey,currentVersion:'0.6.1',now}).version,'0.6.2','Actual client accepts the release pipeline contract');
 assert.equal(publicKeyPem(privateKey),publicKey.export({type:'spki',format:'pem'}).toString());
 const trust=readTrust(Buffer.from(JSON.stringify({feedUrl:UPDATE_FEED,publicKey:publicKey.export({type:'spki',format:'pem'}).toString()})));assert.equal(trust.key.asymmetricKeyType,'ed25519');
 assert.throws(()=>readTrust(Buffer.from(JSON.stringify({feedUrl:'https://evil.invalid/latest.json',publicKey:trust.publicKey}))));
 assert.throws(()=>readTrust(Buffer.from(JSON.stringify({feedUrl:UPDATE_FEED,publicKey:trust.publicKey,privateKey:'forbidden'}))));
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>readTrust(Buffer.from(JSON.stringify({feedUrl:UPDATE_FEED,publicKey:rsa.publicKey.export({type:'spki',format:'pem'}).toString()}))));
 assert.throws(()=>verifyEnvelope(first.bytes,other.publicKey,{now}),/signature/);
 const envelope=JSON.parse(first.bytes.toString());assert.throws(()=>check(Buffer.from(JSON.stringify({...envelope,extra:true}))));
 for(const change of [
  {payload:envelope.payload.slice(0,-2)+'!!'},
  {signature:Buffer.alloc(64).toString('base64')},
  {signature:Buffer.alloc(63).toString('base64')},
  {signature:envelope.signature+'\n'},
  {payload:envelope.payload.replace(/=+$/,'')+'\n'}
 ])assert.throws(()=>check(Buffer.from(JSON.stringify({...envelope,...change}))));
 assert.throws(()=>check(Buffer.alloc(MAX_MANIFEST_BYTES+1,32)),/large/);
 const malformed=Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d]);assert.throws(()=>check(Buffer.from(JSON.stringify({payload:malformed.toString('base64'),signature:sign(null,malformed,privateKey).toString('base64')}))),/encoded|encoding|UTF/i);
 for(const change of [
  {schema:2},{appId:'another.app'},{channel:'beta'},{platform:'linux'},{arch:'arm64'},{postgresMajor:18},{extra:true},
  {version:'0.6.02'},{version:'0.6.2-beta'},{version:'../0.6.2'},{version:'1000000000.1.1'},{version:'9007199254740992.1.1'},{minimumVersion:'0.6.3'},
  {publishedAt:'2026-11-15'},{publishedAt:new Date(now+6*60*1000).toISOString()},
  {expiresAt:new Date(now).toISOString()},{expiresAt:new Date(now+371*24*60*60*1000).toISOString()},
  {file:{...first.payload.file,url:'https://evil.invalid/setup.exe'}},
  {file:{...first.payload.file,url:first.payload.file.url+'?token=secret'}},
  {file:{...first.payload.file,url:first.payload.file.url.replace('/0.6.2/','/../0.6.2/')}},
  {file:{...first.payload.file,bytes:MAX_INSTALLER_BYTES+1}},
  {file:{...first.payload.file,bytes:0}},{file:{...first.payload.file,bytes:1.2}},
  {file:{...first.payload.file,sha256:'A'.repeat(64)}},
  {releaseNotes:{...notes,az:'a'.repeat(2001)}},{releaseNotes:{az:'only one language'}},
  {releaseNotes:{...notes,en:42}},{releaseNotes:{...notes,extra:'unknown'}},
  ...['<b>unsafe</b>','>','null\0','control\u0007','CR\r','DEL\u007f','lone\uD800','lone\uDFFF'].map(az=>({releaseNotes:{...notes,az}}))
 ])assert.throws(()=>check(pack({...first.payload,...change})),JSON.stringify(change));
 const unicode=pack({...first.payload,releaseNotes:{...notes,az:'Şəkil 🛒\nYeni sətir\tseçim'}});assert.ok(check(unicode));assert.ok(clientVerify(JSON.parse(unicode.toString()),{publicKey,currentVersion:'0.6.1',now}));
 assert.equal(validatePayload({...first.payload,expiresAt:new Date(now+1000).toISOString()},{now:now+2000,fresh:false}).version,'0.6.2');
 assert.throws(()=>validatePayload({...first.payload,expiresAt:new Date(now+1000).toISOString()},{now:now+2000}),/expired/);
 assert.equal(compareVersions('0.10.0','0.6.20'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);assert.equal(compareVersions('0.6.2','0.6.3'),-1);
 assert.throws(()=>cliOptions(['--key','one','--key','two'],['--key']));assert.throws(()=>cliOptions(['--key'],['--key']));assert.throws(()=>cliOptions(['--unexpected','x'],['--key']));
 const keyDirectory=path.join(root,'fixture-keys');let protectedPaths=0;const protectedSet=new Set();
 const protect=async target=>{protectedPaths++;protectedSet.add(target);await chmod(target,(await lstat(target)).isDirectory()?0o700:0o600);};
 const keyCheck=async target=>{if(!protectedSet.has(target))throw Error('fixture ACL is not protected');};
 const initial=await initializeKey({directory:keyDirectory,protect,check:keyCheck});const keyBefore=await readFile(initial.target);
 const retained=await initializeKey({directory:keyDirectory,protect,check:keyCheck});assert.equal(initial.created,true);assert.equal(retained.created,false);assert.equal(retained.publicKey,initial.publicKey);assert.deepEqual(await readFile(initial.target),keyBefore);assert.equal(protectedPaths,2,'Existing protected key and directory do not reset ACLs');
 if(process.platform==='win32'&&process.argv.includes('--windows-acl')) {
  const aclFixture=await initializeKey({directory:path.join(root,'acl-fixture-keys')});await assertPrivateKeyRestricted(aclFixture.target);
  const aclAgain=await initializeKey({directory:path.join(root,'acl-fixture-keys')});assert.equal(aclAgain.created,false);assert.equal(aclAgain.publicKey,aclFixture.publicKey);
 }
 await writeFile(initial.target,'not a private key');await assert.rejects(initializeKey({directory:keyDirectory,protect,check:keyCheck}));assert.equal(await readFile(initial.target,'utf8'),'not a private key','Invalid existing key is not overwritten');
 const firstPublication=await publish(first.source);assert.equal(firstPublication.version,'0.6.2');assert.equal(firstPublication.unchanged,false);assert.deepEqual(await latest(),first.bytes);assert.deepEqual(await readFile(path.join(firstPublication.destination,installerName('0.6.2'))),installerBytes);
 assert.equal((await publish(first.source)).unchanged,true,'Identical publication is idempotent');
 const immutableBefore=await latest();const resigned=await makeSignedRelease({version:'0.6.2',installer:first.installer,privateKey,releaseNotes:{...notes,en:'Different content'},publishedAt,now});
 await writeFile(path.join(first.source,'manifest.json'),resigned.bytes);await assert.rejects(publish(first.source),/cannot be re-signed/);assert.deepEqual(await latest(),immutableBefore);await writeFile(path.join(first.source,'manifest.json'),first.bytes);
 const old=await fixture('0.6.1');await assert.rejects(publish(old.source),/older version/);assert.deepEqual(await latest(),first.bytes);await absent(path.join(publicRoot,'win-x64/stable/0.6.1'));
 const second=await fixture('0.6.3');await assert.rejects(publish(second.source,{beforeLatest:()=>{throw Error('simulated interrupted publication');}}),/interrupted/);assert.deepEqual(await latest(),first.bytes,'Interrupted publication preserves last usable latest');await absent(path.join(archiveRoot,'publish.lock'));
 await validateInstaller(path.join(publicRoot,'win-x64/stable/0.6.3',installerName('0.6.3')),second.payload);await publish(second.source);assert.deepEqual(await latest(),second.bytes);
 const history=(await readdir(archiveRoot)).filter(name=>name.endsWith('.json'));assert.ok(history.length>=1);for(const file of history)assert.deepEqual(await readFile(path.join(archiveRoot,file)),first.bytes);
 const corrupt=await fixture('0.6.4');await writeFile(corrupt.installer,Buffer.concat([Buffer.from('MZ'),Buffer.alloc(8192,9)]));await assert.rejects(publish(corrupt.source),/SHA-256/);assert.deepEqual(await latest(),second.bytes);await absent(path.join(publicRoot,'win-x64/stable/0.6.4'));
 await writeFile(corrupt.installer,installerBytes);await writeFile(path.join(corrupt.source,'private.key'),'must not publish');await assert.rejects(publish(corrupt.source),/exactly/);await absent(path.join(publicRoot,'win-x64/stable/0.6.4'));
 const blocked=await fixture('0.6.5');const existing=path.join(publicRoot,'win-x64/stable/0.6.5');await mkdir(existing);await writeFile(path.join(existing,'unexpected'),'leave intact');await assert.rejects(publish(blocked.source),/ENOENT|differs/);assert.equal(await readFile(path.join(existing,'unexpected'),'utf8'),'leave intact');assert.deepEqual(await latest(),second.bytes);
 const ready=await fixture('0.6.6');await writeFile(path.join(archiveRoot,'publish.lock'),'another publisher');await assert.rejects(publish(ready.source),{code:'EEXIST'});assert.equal(await readFile(path.join(archiveRoot,'publish.lock'),'utf8'),'another publisher');await rm(path.join(archiveRoot,'publish.lock'));
 await writeFile(path.join(publicRoot,'win-x64/stable/latest.json'),'tampered latest');await assert.rejects(publish(ready.source));assert.equal(await readFile(path.join(publicRoot,'win-x64/stable/latest.json'),'utf8'),'tampered latest');await writeFile(path.join(publicRoot,'win-x64/stable/latest.json'),second.bytes);
 const badExe=path.join(root,'not-exe.exe');await writeFile(badExe,Buffer.alloc(100,1));await assert.rejects(makeSignedRelease({version:'0.6.7',installer:badExe,privateKey,releaseNotes:notes,publishedAt,now}),/Windows executable/);
 const link=path.join(root,'linked-source');let linkSupported=true;
 try{await symlink(sourceRoot,link,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code))linkSupported=false;else throw error;}
 if(linkSupported){await assert.rejects(noSymbolicLinks(path.join(link,'0.6.2')),/symbolic link|junction/);await assert.rejects(publish(path.join(link,'0.6.2')),/symbolic link|junction/);}
 const files=await readdir(path.join(publicRoot,'win-x64/stable'));assert.ok(!files.some(name=>name.startsWith('.')),'No partial public files remain');
 console.log('PASS: isolated fixture signing/key retention, strict Ed25519 manifest/metadata/expiry/URL/hash/size rejection, private staging, immutable releases, downgrade/re-sign refusal, atomic latest, interruption/retry, lock retention, prior-latest archive, corrupt/extraneous files, untrusted paths and no live DB/AppData/server access.');
} finally {
 const resolved=path.resolve(root),parent=path.resolve(os.tmpdir());if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('restamarket-update-release-test-'))throw Error('Refusing unexpected test cleanup target.');
 await rm(resolved,{recursive:true,force:true});
}
