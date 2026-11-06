import 'server-only';
import {randomBytes,scrypt as callback} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(callback);
export const strongPassword=(password:string)=>password.length>=12&&password.length<=128&&/[\p{L}]/u.test(password)&&/[0-9]/.test(password);
export async function staffPasswordHash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64) as Buffer).toString('hex');}
