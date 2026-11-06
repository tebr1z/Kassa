import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../desktop/local-database.mjs';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const root=path.resolve(process.env.BIRKASSA_TEST_APPLICATION||path.join('desktop-release','v'+pkg.version,'win-unpacked','resources','application'));
process.env.BIRKASSA_BUNDLED_PG_BIN=path.resolve('desktop/vendor/postgres/bin');
const db=await openLocalDatabase(path.resolve('.local-desktop-data','server-'+randomUUID()),process.cwd(),{port:55447});
const server=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,windowsHide:true,env:{...process.env,DATABASE_URL:db.url,BIRKASSA_LOCAL:'1',HOSTNAME:'127.0.0.1',PORT:'5766',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
let logs='',last='';server.stdout.on('data',part=>{logs+=part;});server.stderr.on('data',part=>{logs+=part;});
try{let ready=false;for(let n=0;n<50;n++){if(server.exitCode!==null)break;try{const r=await fetch('http://127.0.0.1:5766/api/auth',{signal:AbortSignal.timeout(2000)});last=await r.text();if(r.ok&&typeof JSON.parse(last).authenticated==='boolean'){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}assert.ok(ready,logs+'\nLast response: '+last);console.log('PASS: packaged standalone server serves a valid local auth response.');}finally{server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));await db.close();}
