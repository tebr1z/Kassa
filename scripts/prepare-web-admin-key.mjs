import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const directory=path.resolve('.private'),file=path.join(directory,'web-admin-setup-token.txt');
await mkdir(directory,{recursive:true});
try{const existing=(await readFile(file,'utf8')).trim();if(existing.length<32)throw Error('Existing setup key is invalid; it was not overwritten.');}
catch(error){if(error.code!=='ENOENT')throw error;await writeFile(file,randomBytes(48).toString('base64url')+'\n',{flag:'wx',mode:0o600});}
console.log('Private setup key file (not printed): '+file);
