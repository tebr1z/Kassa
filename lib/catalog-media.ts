import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {imageType} from '@/lib/desktop-media';
const publicRoot=()=>process.env.BIRKASSA_PUBLIC_MEDIA_DIR||path.join(process.cwd(),'.public-media');
export async function saveImage(bytes:Buffer,local=false){
 if(!bytes.length||bytes.length>5*1024*1024)throw new Error('Şəkil maksimum 5 MB ola bilər.');
 const type=imageType(bytes),hash=createHash('sha256').update(bytes).digest('hex');
 const root=local?path.join(process.env.BIRKASSA_DATA_DIR||process.cwd(),'media'):publicRoot();await mkdir(root,{recursive:true});
 const temporary=path.join(root,hash+'.'+randomUUID()+'.tmp'),url=(local?'/api/desktop-media/':'/api/catalog-media/')+hash;
 await writeFile(temporary,bytes);await rename(temporary,path.join(root,hash+'.bin'));
 await writeFile(temporary,JSON.stringify({type,size:bytes.length,url}));await rename(temporary,path.join(root,hash+'.json'));
 return {hash,url};
}
export async function publicImage(hash:string){
 if(!/^[a-f0-9]{64}$/.test(hash))return null;
 try{const info=JSON.parse(await readFile(path.join(publicRoot(),hash+'.json'),'utf8'));if(!['image/jpeg','image/png','image/webp','image/gif'].includes(info.type))return null;return {type:info.type as string,body:await readFile(path.join(publicRoot(),hash+'.bin'))};}catch{return null;}
}
