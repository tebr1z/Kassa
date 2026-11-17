// A root-provisioned systemd job runs this as rmcentralpg (peer auth). Unlike
// client downloads, this private disaster-recovery dump includes quota/ledger.
import {spawn} from 'node:child_process';
import {mkdir,lstat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const root='/var/lib/restamarket-central/operator-backups';
if(process.platform!=='linux'||process.getuid()===0||process.argv.length!==2)throw Error('Run only as the central PostgreSQL service account.');
await mkdir(root,{recursive:true,mode:0o700});const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o077)!==0)throw Error('Private operator backup directory is not protected.');
const file=path.join(root,'central-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.dump');
function run(program,args){return new Promise((resolve,reject)=>{const child=spawn('/usr/pgsql-17/bin/'+program,args,{stdio:'ignore',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Central operator backup failed.')));});}
await run('pg_dump',['-h','/var/lib/restamarket-central/socket','-p','55433','-U','rmcentralpg','-d','restamarket_inventory','-Fc','--no-owner','--no-acl','-f',file]);
await run('pg_restore',['--list',file]);const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);
await writeFile(file+'.sha256',hash.digest('hex')+'  '+path.basename(file)+'\n',{flag:'wx',mode:0o600});
console.log('Private central operator database backup created, including the reset ledger.');
