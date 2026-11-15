import {constants} from 'node:fs';
import {mkdir,lstat,readFile,writeFile,copyFile,chmod,rename,unlink,readdir,open,rmdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {noSymbolicLinks} from './init-desktop-update-key.mjs';
import {MAX_MANIFEST_BYTES,verifyEnvelope,validateInstaller,installerName,compareVersions,readTrust,cliOptions} from './sign-desktop-release.mjs';

const PUBLIC_ROOT='/opt/restamarket/desktop-updates';
const STAGING_ROOT='/var/lib/restamarket-update-staging';
async function rootControlledAncestors(target,{missing=false}={}) {
 await noSymbolicLinks(target,{missing});let current=path.parse(path.resolve(target)).root;
 for(const part of path.resolve(target).slice(current.length).split(path.sep).filter(Boolean)) {
  current=path.join(current,part);let stat;
  try{stat=await lstat(current);}catch(error){if(missing&&error.code==='ENOENT')return;throw error;}
  if(stat.uid!==0||(stat.mode&0o022)!==0)throw Error('Production update ancestors must be root-owned and not group/other writable.');
 }
}
async function exists(file){try{await lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function manifestFile(file){await noSymbolicLinks(file);const stat=await lstat(file);if(!stat.isFile()||stat.size>MAX_MANIFEST_BYTES)throw Error('Manifest must be a bounded regular file.');return readFile(file);}
async function directory(target,mode=0o755){await noSymbolicLinks(target,{missing:true});const present=await exists(target);await mkdir(target,{recursive:true,mode});if(!(await lstat(target)).isDirectory())throw Error('Release directory is not a directory.');if(!present)await chmod(target,mode);}
async function syncFile(file){const handle=await open(file,'r+');try{await handle.sync();}finally{await handle.close();}}
async function syncDirectory(target){let handle;try{handle=await open(target,'r');await handle.sync();}catch(error){if(process.platform!=='win32'||!['EISDIR','EPERM','EACCES'].includes(error.code))throw error;}finally{if(handle)await handle.close();}}
async function writeExclusive(file,bytes,mode){await writeFile(file,bytes,{flag:'wx',mode});await syncFile(file);}
async function removeOwnTemp(directoryPath,files){for(const name of files)try{await unlink(path.join(directoryPath,name));}catch(error){if(error.code!=='ENOENT')throw error;}try{await rmdir(directoryPath);}catch(error){if(error.code!=='ENOENT')throw error;}}

// Injectable directories are only for fixture tests; the CLI below fixes both
// production roots and requires a root-owned private staging directory.
export async function publishRelease({source,publicRoot=PUBLIC_ROOT,archiveRoot=path.join(STAGING_ROOT,'history'),publicKey,now=Date.now(),beforeLatest,verifyOwnership=false}) {
 source=path.resolve(source);publicRoot=path.resolve(publicRoot);archiveRoot=path.resolve(archiveRoot);
 if(publicRoot===path.parse(publicRoot).root||archiveRoot===path.parse(archiveRoot).root)throw Error('A filesystem root is not an update directory.');
 await noSymbolicLinks(source);if(!(await lstat(source)).isDirectory())throw Error('Source staging must be a directory.');
 const manifest=await manifestFile(path.join(source,'manifest.json')),{payload}=verifyEnvelope(manifest,publicKey,{now});
 if(path.basename(source)!==payload.version)throw Error('Staging directory must equal the signed release version.');
 const name=installerName(payload.version);if((await readdir(source)).sort().join('\n')!==['manifest.json',name].sort().join('\n'))throw Error('Staging must contain exactly one installer and its signed manifest.');
 await validateInstaller(path.join(source,name),payload);
 const owned=async(target,privateDirectory=false)=>{if(!verifyOwnership)return;await noSymbolicLinks(target);const stat=await lstat(target);if(stat.uid!==0||(stat.mode&(privateDirectory?0o077:0o022))!==0)throw Error('Update path is not exclusively controlled by root.');if(!privateDirectory&&(stat.mode&(stat.isDirectory()?0o005:0o004))!==(stat.isDirectory()?0o005:0o004))throw Error('Public update path is not readable/traversable by the static Apache reader.');};
 await directory(archiveRoot,0o700);await owned(archiveRoot,true);const lock=path.join(archiveRoot,'publish.lock');
 let lockOwned=false,temp,latestTemp;
 try {
  await writeFile(lock,String(process.pid)+'\n',{flag:'wx',mode:0o600});lockOwned=true;
  await directory(publicRoot);await owned(publicRoot);const platform=path.join(publicRoot,'win-x64');await directory(platform);await owned(platform);const channel=path.join(platform,'stable');await directory(channel);await owned(channel);
  const latest=path.join(channel,'latest.json');let previous;
  if(await exists(latest)) {
   await owned(latest);previous=await manifestFile(latest);const current=verifyEnvelope(previous,publicKey,{now,fresh:false}).payload,comparison=compareVersions(payload.version,current.version);
   if(comparison<0)throw Error('Publishing an older version is not permitted.');
   if(comparison===0&&!manifest.equals(previous))throw Error('An existing version cannot be re-signed or changed.');
  }
  const destination=path.join(channel,payload.version);await noSymbolicLinks(destination,{missing:true});
  if(await exists(destination)) {
   await owned(destination);await owned(path.join(destination,'manifest.json'));await owned(path.join(destination,name));
   if(!(await lstat(destination)).isDirectory()||(await readdir(destination)).sort().join('\n')!==['manifest.json',name].sort().join('\n'))throw Error('Existing immutable version directory differs.');
   if(!(await manifestFile(path.join(destination,'manifest.json'))).equals(manifest))throw Error('Existing immutable manifest differs.');
   await validateInstaller(path.join(destination,name),payload);
  } else {
   temp=path.join(channel,'.'+payload.version+'-'+randomUUID()+'.staging');await mkdir(temp,{mode:0o700});
   await copyFile(path.join(source,name),path.join(temp,name),constants.COPYFILE_EXCL);await chmod(path.join(temp,name),0o644);await syncFile(path.join(temp,name));
   await writeExclusive(path.join(temp,'manifest.json'),manifest,0o644);await validateInstaller(path.join(temp,name),payload);await chmod(temp,0o755);await syncDirectory(temp);
   await rename(temp,destination);temp=undefined;await syncDirectory(channel);
  }
  if(previous&&!manifest.equals(previous)) {
   const current=verifyEnvelope(previous,publicKey,{now,fresh:false}).payload;
   await writeExclusive(path.join(archiveRoot,'latest-'+current.version+'-'+randomUUID()+'.json'),previous,0o600);await syncDirectory(archiveRoot);
  }
  if(beforeLatest)await beforeLatest({destination,latest,payload});
  if(!previous||!manifest.equals(previous)) {
   latestTemp=path.join(channel,'.latest-'+randomUUID()+'.tmp');await writeExclusive(latestTemp,manifest,0o644);
   await rename(latestTemp,latest);latestTemp=undefined;await syncDirectory(channel);
  }
  return {version:payload.version,destination,latest,sha256:payload.file.sha256,bytes:payload.file.bytes,unchanged:!!previous&&manifest.equals(previous)};
 } finally {
  try{if(temp)await removeOwnTemp(temp,['manifest.json',name]);if(latestTemp)try{await unlink(latestTemp);}catch(error){if(error.code!=='ENOENT')throw error;}}
  finally{if(lockOwned)await unlink(lock);}
 }
}

async function main() {
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()!==0)throw Error('Static publishing must run as root on the selected Linux hosting server.');
 const options=cliOptions(process.argv.slice(2),['--source','--trust']);if(!options['--source']||!options['--trust'])throw Error('Usage: node scripts/publish-desktop-update.mjs --source /var/lib/restamarket-update-staging/VERSION --trust PUBLIC_TRUST_JSON');
 const source=path.resolve(options['--source']);if(path.dirname(source)!==STAGING_ROOT)throw Error('Source must be an immediate version directory in the fixed private staging root.');
 await rootControlledAncestors(source);await rootControlledAncestors(PUBLIC_ROOT,{missing:true});
 await noSymbolicLinks(STAGING_ROOT);await noSymbolicLinks(source);
 for(const target of [STAGING_ROOT,source]){const stat=await lstat(target);if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('Staging directories must be root-owned and private (0700).');}
 if(await exists(PUBLIC_ROOT)){await noSymbolicLinks(PUBLIC_ROOT);const stat=await lstat(PUBLIC_ROOT);if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o022)!==0)throw Error('Public update root must be root-owned and not writable by another account.');}
 const trustPath=path.resolve(options['--trust']);await rootControlledAncestors(trustPath);const trustStat=await lstat(trustPath);if(!trustStat.isFile()||trustStat.size>16*1024)throw Error('Public trust must be a bounded root-controlled regular file.');
 const trust=readTrust(await readFile(trustPath));
 const result=await publishRelease({source,publicKey:trust.key,verifyOwnership:true});console.log(JSON.stringify(result));
 console.log('Static update files published. No database, application environment, web release, service or private key was read or changed.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error('Static update publication failed: '+error.message);process.exitCode=1;});
