// Synthetic PNGs for isolated automated/browser tests only, never merchant assets.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
function crc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function chunk(type,data){
 const name=Buffer.from(type),out=Buffer.alloc(data.length+12);
 out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);
 out.writeUInt32BE(crc32(Buffer.concat([name,data])),data.length+8);return out;
}
function png(rgb){
 const size=320,header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc(size*(size*3+1));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const color=x>=50&&x<270&&y>=70&&y<250?rgb:[240,242,233];
  for(let c=0;c<3;c++)rows[y*(size*3+1)+1+x*3+c]=color[c];
 }
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
export async function writeVariantImageFixtures(directory){
 await mkdir(directory,{recursive:true});const photos={};
 for(const [key,rgb]of Object.entries({main:[121,139,124],red:[188,40,49],black:[38,42,40]})){
  const bytes=png(rgb),hash=createHash('sha256').update(bytes).digest('hex'),url='/api/catalog-media/'+hash;
  await writeFile(path.join(directory,hash+'.bin'),bytes);
  await writeFile(path.join(directory,hash+'.json'),JSON.stringify({type:'image/png',size:bytes.length,url}));photos[key]=url;
 }
 return photos;
}
