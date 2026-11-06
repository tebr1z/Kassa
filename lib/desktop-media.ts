import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,rename,access} from "node:fs/promises";
import path from "node:path";
import {storeDb} from "@/lib/store-db";

const root=()=>path.join(process.env.BIRKASSA_DATA_DIR||process.cwd(),"media");
export const mediaHash=(url:string)=>createHash("sha256").update(url).digest("hex");
export async function mediaUrl(url:unknown):Promise<string> {
  const value=String(url||"");
  if(process.env.BIRKASSA_LOCAL!=="1"||!value.startsWith("https://"))return value;
  const hash=mediaHash(value);
  try{await access(path.join(root(),hash+".json"));return "/api/desktop-media/"+hash;}catch{return value;}
}
export async function cachedMedia(hash:string) {
  if(!/^[a-f0-9]{64}$/.test(hash))return null;
  try {
    const info=JSON.parse(await readFile(path.join(root(),hash+".json"),"utf8"));
    if(!["image/jpeg","image/png","image/webp","image/gif"].includes(info.type))return null;
    return {body:await readFile(path.join(root(),hash+".bin")),type:info.type as string};
  } catch{return null;}
}
export function imageType(bytes:Buffer) {
  if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return "image/jpeg";
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(["GIF87a","GIF89a"].includes(bytes.subarray(0,6).toString()))return "image/gif";
  if(bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP")return "image/webp";
  throw new Error("Şəkil formatı dəstəklənmir.");
}
let running:Promise<{cached:number;failed:number;total:number}>|null=null;
export function cacheProductMedia() {
  if(running)return running;
  running=cacheAll().finally(()=>{running=null;});return running;
}
async function cacheAll() {
  if(process.env.BIRKASSA_LOCAL!=="1")throw new Error("Yalnız masaüstündə mümkündür.");
  const sql=storeDb();
  try {
    const rows=await sql.unsafe("select image_url url from products union select image_url from product_images union select image_url from product_categories union select logo from storefront_config");
    const urls=rows.map(row=>String(row.url||"")).filter(value=>{try{const u=new URL(value);return u.protocol==="https:"&&u.hostname==="res.cloudinary.com"&&!u.username&&!u.password&&!u.port;}catch{return false;}});
    await mkdir(root(),{recursive:true});let cached=0,failed=0,index=0;
    await Promise.all(Array.from({length:3},async()=>{
      while(index<urls.length) {
        const url=urls[index++],hash=mediaHash(url);
        try {
          if(await cachedMedia(hash)){cached++;continue;}
          const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(12000)});
          if(!response.ok||!response.body||Number(response.headers.get("content-length"))>8*1024*1024)throw new Error("Şəkil alınmadı.");
          const parts:Uint8Array[]=[];let length=0;
          const reader=response.body.getReader();
          try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8*1024*1024)throw new Error("Şəkil çox böyükdür.");parts.push(value);}}
          finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
          const bytes=Buffer.concat(parts),type=imageType(bytes),tmp=path.join(root(),hash+"."+randomUUID()+".tmp");
          await writeFile(tmp,bytes);await rename(tmp,path.join(root(),hash+".bin"));
          await writeFile(tmp,JSON.stringify({type,url,size:bytes.length}));await rename(tmp,path.join(root(),hash+".json"));cached++;
        }catch{failed++;}
      }
    }));
    const result={cached,failed,total:urls.length};
    await sql.unsafe("insert into system_settings(key,value) values('desktop_media_status',$1) on conflict(key) do update set value=excluded.value",[JSON.stringify(result)]);
    return result;
  }finally{await sql.end();}
}
