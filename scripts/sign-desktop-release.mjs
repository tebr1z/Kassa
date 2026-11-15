import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,lstat,readFile,writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertPrivateKeyRestricted,noSymbolicLinks} from './init-desktop-update-key.mjs';

export const UPDATE_ORIGIN='https://kassa.nex.autos';
export const UPDATE_PREFIX='/desktop-updates/win-x64/stable/';
export const UPDATE_FEED=UPDATE_ORIGIN+UPDATE_PREFIX+'latest.json';
export const MAX_INSTALLER_BYTES=512*1024*1024;
export const MAX_MANIFEST_BYTES=64*1024;
const languages=['az','en','ru','tr','zh'];
export function exactKeys(value,keys,label) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error('Invalid '+label+' fields.');
}
export function versionParts(version) {
 if(typeof version!=='string'||!/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/.test(version))throw Error('Version must be a plain X.Y.Z release with at most nine digits per component.');
 const parts=version.split('.').map(Number);if(parts.some(part=>!Number.isSafeInteger(part)))throw Error('Invalid version component.');return parts;
}
export function compareVersions(left,right) {const a=versionParts(left),b=versionParts(right);for(let n=0;n<3;n++)if(a[n]!==b[n])return a[n]<b[n]?-1:1;return 0;}
export const installerName=version=>{versionParts(version);return `RestaMarket-Setup-${version}.exe`;};
export const installerUrl=version=>UPDATE_ORIGIN+UPDATE_PREFIX+version+'/'+installerName(version);
function iso(value) {return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
export function validatePayload(payload,{now=Date.now(),fresh=true}={}) {
 exactKeys(payload,['schema','appId','channel','platform','arch','version','minimumVersion','postgresMajor','publishedAt','expiresAt','file','releaseNotes'],'manifest payload');
 if(payload.schema!==1||payload.appId!=='az.birkassa.desktop'||payload.channel!=='stable'||payload.platform!=='win32'||payload.arch!=='x64'||payload.postgresMajor!==17)throw Error('Manifest targets another application, channel, platform or database runtime.');
 versionParts(payload.version);versionParts(payload.minimumVersion);if(compareVersions(payload.minimumVersion,payload.version)>0)throw Error('Minimum version exceeds release version.');
 if(!iso(payload.publishedAt)||!iso(payload.expiresAt))throw Error('Manifest timestamps must be canonical ISO timestamps.');
 const published=Date.parse(payload.publishedAt),expires=Date.parse(payload.expiresAt);
 if(expires<=published||expires-published>370*24*60*60*1000)throw Error('Manifest validity must be positive and no more than 370 days.');
 if(fresh&&(published>now+5*60*1000||expires<=now))throw Error('Manifest is expired or not yet published.');
 exactKeys(payload.file,['url','bytes','sha256'],'installer');
 if(payload.file.url!==installerUrl(payload.version)||!Number.isSafeInteger(payload.file.bytes)||payload.file.bytes<1||payload.file.bytes>MAX_INSTALLER_BYTES||typeof payload.file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(payload.file.sha256))throw Error('Invalid installer location, size or SHA-256.');
 exactKeys(payload.releaseNotes,languages,'release notes');
 for(const language of languages)if(typeof payload.releaseNotes[language]!=='string'||payload.releaseNotes[language].length>2000||/[<>\u0000-\u0008\u000b-\u001f\u007f\uD800-\uDFFF]/u.test(payload.releaseNotes[language]))throw Error('Release notes must be plain Unicode text, without HTML/control characters, and at most 2000 characters.');
 return payload;
}
function base64(value,label) {
 if(typeof value!=='string'||!value.length||value.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Invalid '+label+' encoding.');
 const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)throw Error('Non-canonical '+label+' encoding.');return bytes;
}
export function readTrust(bytes) {
 const trust=JSON.parse(bytes.toString());exactKeys(trust,['feedUrl','publicKey'],'public update trust');
 if(trust.feedUrl!==UPDATE_FEED||typeof trust.publicKey!=='string')throw Error('Unexpected update feed.');
 const key=createPublicKey(trust.publicKey);if(key.asymmetricKeyType!=='ed25519')throw Error('Update trust key must be Ed25519.');return {...trust,key};
}
export function verifyEnvelope(bytes,publicKey,options={}) {
 if(bytes.length>MAX_MANIFEST_BYTES)throw Error('Update manifest is too large.');
 const envelope=JSON.parse(bytes.toString('utf8'));exactKeys(envelope,['payload','signature'],'signed envelope');
 const payload=base64(envelope.payload,'payload'),signature=base64(envelope.signature,'signature');
 if(signature.length!==64||!verify(null,payload,publicKey,signature))throw Error('Update signature verification failed.');
 // Invalid UTF-8 must never be silently replaced before JSON parsing.
 const text=new TextDecoder('utf-8',{fatal:true}).decode(payload);
 return {payload:validatePayload(JSON.parse(text),options),envelope};
}
export async function hashFile(file) {const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export async function validateInstaller(file,payload) {
 await noSymbolicLinks(file);const item=await lstat(file);
 if(!item.isFile()||item.size!==payload.file.bytes||item.size>MAX_INSTALLER_BYTES)throw Error('Installer size or file type differs from signed release.');
 const handle=await open(file,'r');try{const header=Buffer.alloc(2);await handle.read(header,0,2,0);if(header.toString('ascii')!=='MZ')throw Error('Installer is not a Windows executable.');}finally{await handle.close();}
 if(await hashFile(file)!==payload.file.sha256)throw Error('Installer SHA-256 differs from signed release.');
}
export async function makeSignedRelease({version,minimumVersion='0.6.0',installer,privateKey,releaseNotes,publishedAt=new Date().toISOString(),expiresAt,now=Date.now()}) {
 const key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ed25519')throw Error('Signing key must be Ed25519.');
 await noSymbolicLinks(installer);
 const item=await lstat(installer);if(!item.isFile()||item.size<1||item.size>MAX_INSTALLER_BYTES)throw Error('Installer size or file type is invalid.');
 const payload={schema:1,appId:'az.birkassa.desktop',channel:'stable',platform:'win32',arch:'x64',version,minimumVersion,postgresMajor:17,publishedAt,expiresAt:expiresAt??new Date(Date.parse(publishedAt)+365*24*60*60*1000).toISOString(),file:{url:installerUrl(version),bytes:item.size,sha256:await hashFile(installer)},releaseNotes};
 validatePayload(payload,{now});await validateInstaller(installer,payload);
 const bytes=Buffer.from(JSON.stringify(payload));const envelope={payload:bytes.toString('base64'),signature:sign(null,bytes,key).toString('base64')};
 return {payload,bytes:Buffer.from(JSON.stringify(envelope)+'\n')};
}
export function cliOptions(args,allowed) {
 const options={};for(let n=0;n<args.length;n+=2){const key=args[n];if(!allowed.includes(key)||!args[n+1]||Object.hasOwn(options,key))throw Error('Invalid or duplicate release option: '+key);options[key]=args[n+1];}return options;
}
function within(parent,child){const relative=path.relative(parent,child);return relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
async function main() {
 const options=cliOptions(process.argv.slice(2),['--key','--installer','--notes','--out','--minimum-version','--published-at','--expires-at']);
 if(!options['--key']||!options['--notes'])throw Error('Usage: node scripts/sign-desktop-release.mjs --key PRIVATE_KEY_PATH --notes RELEASE_NOTES_JSON [--installer EXACT_INSTALLER] [--out RELEASE_UPDATE_DIR]');
 const root=path.resolve('.'),pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),desktop=JSON.parse(await readFile(path.join(root,'desktop/package.json'),'utf8'));
 if(pkg.version!==desktop.version||pkg.build?.appId!=='az.birkassa.desktop')throw Error('Root and desktop package versions/application identity must match.');versionParts(pkg.version);
 const expected=path.join(root,'desktop-release','v'+pkg.version,installerName(pkg.version)),installer=path.resolve(options['--installer']??expected);
 if(installer!==expected)throw Error('Only the exact current workspace installer may be signed.');
 const privatePath=path.resolve(options['--key']);if(privatePath===root||within(root,privatePath))throw Error('Private signing key must be outside the repository.');
 await assertPrivateKeyRestricted(privatePath);const privateKey=await readFile(privatePath),trust=readTrust(await readFile(path.join(root,'desktop/update-trust.json')));
 if(createPublicKey(createPrivateKey(privateKey)).export({type:'spki',format:'der'}).compare(trust.key.export({type:'spki',format:'der'}))!==0)throw Error('Signing key does not match packaged public update trust.');
 const output=path.resolve(options['--out']??path.join(root,'desktop-release','v'+pkg.version,'update'));
 if(!within(path.join(root,'desktop-release','v'+pkg.version),output))throw Error('Signed release output must remain in the ignored current release directory.');
 await noSymbolicLinks(output,{missing:true});await mkdir(output,{recursive:true,mode:0o700});
 const result=await makeSignedRelease({version:pkg.version,minimumVersion:options['--minimum-version']??'0.6.0',installer,privateKey,releaseNotes:JSON.parse(await readFile(options['--notes'],'utf8')),publishedAt:options['--published-at'],expiresAt:options['--expires-at']});
 verifyEnvelope(result.bytes,trust.key);const manifest=path.join(output,'manifest.json');
 try{await writeFile(manifest,result.bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST'||!(await readFile(manifest)).equals(result.bytes))throw Error('Manifest output exists; immutable releases cannot be overwritten.');}
 console.log(JSON.stringify({version:pkg.version,manifest,installer,sha256:result.payload.file.sha256,bytes:result.payload.file.bytes,expiresAt:result.payload.expiresAt}));
 console.log('Private key stayed local. This Ed25519 update signature is not Windows Authenticode signing.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error('Release signing failed: '+error.message);process.exitCode=1;});
