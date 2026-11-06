import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const executable=path.resolve('desktop-release','v'+pkg.version,'win-unpacked/RestaMarket.exe');
const child=spawn(executable,['--smoke'],{windowsHide:true,env:{...process.env,BIRKASSA_REQUIRE_BUNDLED_PG:'1',BIRKASSA_PG_PORT:'55446',BIRKASSA_PORT:'5765',BIRKASSA_DATA_DIR:path.resolve('.local-desktop-data','packaged-smoke-'+randomUUID())},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
const timeout=setTimeout(()=>child.kill(),60000);
try {
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,output);assert.match(output,/PASS: Electron window loaded local POS; language bridge available; automatic backup created\./);
  console.log('PASS: packaged Windows application starts, renders local POS, loads its isolated language bridge and writes a database backup.');
}finally{clearTimeout(timeout);}
