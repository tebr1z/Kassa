// Device enrollment is an operator action, not a public web registration API.
import {readFile,writeFile,lstat,open,rename,unlink,chown,chmod,mkdir} from 'node:fs/promises';
import {createPublicKey,randomUUID} from 'node:crypto';
import path from 'node:path';
const directory='/var/lib/restamarket-central/private',registry=directory+'/devices.json';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const [operation,value]=process.argv.slice(2);
if(process.platform!=='linux'||process.getuid()!==0||process.argv.length!==4||!['--approve','--revoke'].includes(operation))throw Error('Run as the central operator: --approve /absolute/public-registration.json OR --revoke DEVICE_UUID');
const parent=await lstat(directory),stat=await lstat(registry);if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o022)!==0||!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o027)!==0||stat.size>128*1024)throw Error('The operator registry is not protected.');
const lockFile=directory+'/devices.lock',lock=await open(lockFile,'wx',0o600);let temporary;
try{
 const original=await readFile(registry),data=JSON.parse(original);if(data.schema!==1||!Array.isArray(data.devices)||data.devices.length>256)throw Error('Unexpected registry format.');
 if(operation==='--approve'){
  if(!path.isAbsolute(value)||value.includes('\0'))throw Error('An absolute public-registration path is required.');
  const item=await lstat(value);if(!item.isFile()||item.isSymbolicLink()||item.size>8192)throw Error('Invalid public registration.');
  const registration=JSON.parse(await readFile(value,'utf8'));
  if(Object.keys(registration).sort().join(',')!=='active,id,publicKeyPem,schema'||registration.schema!==1||!uuid(registration.id)||registration.active!==true||typeof registration.publicKeyPem!=='string'||registration.publicKeyPem.length>2048||createPublicKey(registration.publicKeyPem).asymmetricKeyType!=='ed25519')throw Error('Invalid public registration. No private key is needed.');
  const existing=data.devices.find(item=>item.id===registration.id);if(existing&&existing.publicKeyPem!==registration.publicKeyPem)throw Error('A device identity cannot change its public key.');
  if(existing)existing.active=true;else{if(data.devices.length>=256)throw Error('Device registry is full.');data.devices.push({id:registration.id,publicKeyPem:registration.publicKeyPem,active:true});}
 }else{
  if(!uuid(value))throw Error('Invalid device UUID.');const existing=data.devices.find(item=>item.id===value);if(!existing)throw Error('Device not found.');existing.active=false;
 }
 const history=directory+'/device-history';await mkdir(history,{recursive:true,mode:0o700});await writeFile(history+'/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.json',original,{flag:'wx',mode:0o600});
 temporary=registry+'.'+randomUUID()+'.tmp';const output=await open(temporary,'wx',0o640);try{await output.writeFile(JSON.stringify(data));await output.sync();}finally{await output.close();}
 await chown(temporary,0,stat.gid);await chmod(temporary,0o640);await rename(temporary,registry);temporary=null;
 const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}
 console.log('Device permission updated. The gateway rechecks it on the next request. No inventory, staff password or reset quota changed.');
}finally{if(temporary)await unlink(temporary).catch(()=>{});await lock.close();await unlink(lockFile);}
