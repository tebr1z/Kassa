import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {protectData} from '../desktop/protect-data.mjs';

// Explicitly authorized diagnostic: only encrypted os_crypt + encrypted device
// identity are read from the two named actual profiles. Nothing is modified there.
// Child stdout contains ONLY candidate labels and boolean results. No raw Local
// State, ciphertext, private PEM, account information or cookie data is printed.
const executable=path.resolve('node_modules/electron/dist/electron.exe'),helper=path.resolve('scripts/probe-central-profile-readonly.cjs');
for(const candidate of ['BirKassa','RestaMarket']){
 const fixture=await mkdtemp(path.join(os.tmpdir(),'rm-readonly-oscrypt-'));await protectData(fixture);
 try{
  const env={...process.env,RM_PROFILE_PROBE_CANDIDATE:candidate,RM_PROFILE_PROBE_DIR:fixture};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[helper],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='';
  child.stdout.on('data',part=>{if(stdout.length<16384)stdout+=part;});child.stderr.resume();
  const timer=setTimeout(()=>child.kill(),20000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
  const lines=stdout.split(/\r?\n/).map(value=>value.trim()).filter(value=>value.startsWith('{'));
  assert.equal(code,0,'Read-only diagnostic process did not complete');assert.equal(lines.length,1,'Unexpected diagnostic output');
  const result=JSON.parse(lines[0]);assert.equal(result.candidate,candidate);assert.equal(result.sourceWrites,false);assert.equal(result.sourcesUnchanged,true,'Read-only diagnostic source bytes must remain unchanged');console.log(JSON.stringify(result));
 }finally{
  if(path.dirname(fixture)!==path.resolve(os.tmpdir())||!path.basename(fixture).startsWith('rm-readonly-oscrypt-'))throw Error('Unsafe diagnostic cleanup path');
  await rm(fixture,{recursive:true,force:true});
 }
}
