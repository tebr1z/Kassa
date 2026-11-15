import {spawn} from 'node:child_process';
import path from 'node:path';
import {readdir,lstat} from 'node:fs/promises';
function command(file,args,capture=false){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:capture?['ignore','pipe','ignore']:'ignore'});let output='';if(capture)child.stdout.on('data',part=>{output+=part;});child.once('error',reject);child.once('exit',code=>code===0?resolve(output):reject(new Error('Lokal məlumat qovluğunun giriş icazələri qorunmadı.')));});}
export async function protectData(dataRoot){
 if(process.platform!=='win32')return;
 const resolved=path.resolve(dataRoot);if(resolved===path.parse(resolved).root)throw new Error('Disk kökü məlumat qovluğu ola bilməz.');
 // Do not let recursive ACL changes follow a link outside the private data
 // root. The normal embedded PostgreSQL cluster does not use tablespaces.
 const rootInfo=await lstat(resolved);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw new Error('Lokal məlumat qovluğu keçid ola bilməz.');
 const noLinks=async directory=>{for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('Lokal məlumat qovluğunda keçid tapıldı.');if(entry.isDirectory())await noLinks(path.join(directory,entry.name));}};
 await noLinks(resolved);
 const output=await command('whoami.exe',['/user','/fo','csv','/nh'],true),sid=String(output).match(/S-1-5-[0-9-]+/)?.[0];
 if(!sid)throw new Error('Windows istifadəçi icazəsi müəyyən edilmədi.');
 // Inheritance flags belong on the directory, not individual files. Applying
 // /inheritance:r recursively would leave file ACLs empty on Windows.
 // icacls otherwise fails on existing paths over MAX_PATH during the next
 // startup after a nested backup verification. Use Win32 extended paths and
 // exact existing children rather than a wildcard that may match nothing.
 await command('icacls.exe',[path.toNamespacedPath(resolved),'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F','/Q','/L']);
 for(const name of await readdir(resolved))await command('icacls.exe',[path.toNamespacedPath(path.join(resolved,name)),'/reset','/T','/Q','/L']);
}
