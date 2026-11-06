import {spawn} from 'node:child_process';
import path from 'node:path';
import {readdir} from 'node:fs/promises';
function command(file,args,capture=false){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:capture?['ignore','pipe','ignore']:'ignore'});let output='';if(capture)child.stdout.on('data',part=>{output+=part;});child.once('error',reject);child.once('exit',code=>code===0?resolve(output):reject(new Error('Lokal məlumat qovluğunun giriş icazələri qorunmadı.')));});}
export async function protectData(dataRoot){
 if(process.platform!=='win32')return;
 const resolved=path.resolve(dataRoot);if(resolved===path.parse(resolved).root)throw new Error('Disk kökü məlumat qovluğu ola bilməz.');
 const output=await command('whoami.exe',['/user','/fo','csv','/nh'],true),sid=String(output).match(/S-1-5-[0-9-]+/)?.[0];
 if(!sid)throw new Error('Windows istifadəçi icazəsi müəyyən edilmədi.');
 // Inheritance flags belong on the directory, not individual files. Applying
 // /inheritance:r recursively would leave file ACLs empty on Windows.
 await command('icacls.exe',[resolved,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F','/Q']);
 if((await readdir(resolved)).length)await command('icacls.exe',[path.join(resolved,'*'),'/reset','/T','/Q','/L']);
}
