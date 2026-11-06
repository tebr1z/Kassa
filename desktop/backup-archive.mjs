import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readdir,stat,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import path from 'node:path';
const magic=Buffer.from('BIRKASSA_BACKUP_V1\n');
const valid=name=>name==='database.dump'||/^media\/[a-f0-9]{64}\.(bin|json)$/.test(name);
async function digest(file){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
export async function writeArchive(destination,dump,mediaRoot) {
  const entries=[{name:'database.dump',file:dump}];
  for(const name of (await readdir(mediaRoot).catch(()=>[])).sort())if(valid('media/'+name))entries.push({name:'media/'+name,file:path.join(mediaRoot,name)});
  async function* content(){
    yield magic;
    for(const entry of entries){
      const info=await stat(entry.file);if(!info.isFile())throw new Error('Yanlış ehtiyat faylı.');
      const header=Buffer.from(JSON.stringify({name:entry.name,size:info.size,sha256:await digest(entry.file)}));
      const size=Buffer.alloc(4);size.writeUInt32BE(header.length);yield size;yield header;
      yield* createReadStream(entry.file);
    }
    yield Buffer.alloc(4);
  }
  await mkdir(path.dirname(destination),{recursive:true});
  const temporary=destination+'.'+randomUUID()+'.tmp';
  try{await pipeline(Readable.from(content()),createGzip(),createWriteStream(temporary,{flags:'wx'}));await rename(temporary,destination);}
  finally{await unlink(temporary).catch(()=>{});}
}
export async function readArchive(source,destination) {
  await mkdir(destination,{recursive:true});
  const input=createReadStream(source),stream=input.pipe(createGunzip()),iterator=stream[Symbol.asyncIterator]();
  input.on('error',error=>stream.destroy(error));
  let buffer=Buffer.alloc(0),finished=false,total=0;
  async function take(length){
    const parts=[];let left=length;
    while(left){if(!buffer.length){const next=await iterator.next();if(next.done)throw new Error('Ehtiyat nüsxə yarımçıqdır.');buffer=Buffer.from(next.value);}
      const size=Math.min(left,buffer.length);parts.push(buffer.subarray(0,size));buffer=buffer.subarray(size);left-=size;
    }return Buffer.concat(parts);
  }
  const files=new Set();
  try{
    if(!(await take(magic.length)).equals(magic))throw new Error('BirKassa ehtiyat formatı düzgün deyil.');
    for(let count=0;count<50000;count++){
      const headerLength=(await take(4)).readUInt32BE();if(headerLength===0){finished=true;break;}
      if(headerLength>4096)throw new Error('Ehtiyat başlığı zədələnib.');
      const header=JSON.parse((await take(headerLength)).toString());
      if(!valid(header.name)||files.has(header.name)||!Number.isSafeInteger(header.size)||header.size<0||header.size>1024*1024*1024||!/^[a-f0-9]{64}$/.test(header.sha256))throw new Error('Ehtiyat faylı etibarsızdır.');
      total+=header.size;if(total>5*1024*1024*1024)throw new Error('Ehtiyat nüsxə çox böyükdür.');files.add(header.name);
      const file=path.resolve(destination,...header.name.split('/'));
      if(!file.startsWith(path.resolve(destination)+path.sep))throw new Error('Yanlış ehtiyat yolu.');
      await mkdir(path.dirname(file),{recursive:true});const handle=await open(file,'wx'),hash=createHash('sha256');
      try{let left=header.size;while(left){const part=await take(Math.min(left,65536));hash.update(part);await handle.writeFile(part);left-=part.length;}}
      finally{await handle.close();}
      if(hash.digest('hex')!==header.sha256)throw new Error('Ehtiyat nüsxənin bütövlüyü pozulub.');
    }
    if(!finished||!files.has('database.dump'))throw new Error('Baza ehtiyatı tapılmadı.');
    // Consume the gzip trailer as well, so truncated/corrupt compressed input fails.
    if(buffer.length)throw new Error('Ehtiyatda əlavə məlumat var.');
    if(!(await iterator.next()).done)throw new Error('Ehtiyatda əlavə məlumat var.');
    return {dump:path.join(destination,'database.dump'),media:path.join(destination,'media'),files:files.size};
  }finally{input.destroy();stream.destroy();}
}
