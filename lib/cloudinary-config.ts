import "server-only";
import {readFile} from "node:fs/promises";
import path from "node:path";
export const credentialsPath=path.join(process.cwd(),".private","cloudinary.json");
export async function cloudCredentials():Promise<{cloud:string;key:string;secret:string}>{
 try{return JSON.parse(await readFile(credentialsPath,"utf8"))}
 catch{return {cloud:process.env.CLOUDINARY_CLOUD_NAME||"",key:process.env.CLOUDINARY_API_KEY||"",secret:process.env.CLOUDINARY_API_SECRET||""}}
}
