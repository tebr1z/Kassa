// Explicit read-only device probe launcher. Parent owns the one temporary
// directory and removes it only AFTER the native child has completely exited.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {protectData} from '../desktop/protect-data.mjs';
const require=createRequire(import.meta.url),{verifyPrivateDirectory}=require('./migrate-central-device-profile.cjs');
const helper=fileURLToPath(new URL('./probe-central-device.cjs',import.meta.url));
const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
const failure=()=>Error('Read-only device probe failed');
export async function removeOwnedProfile(directory){
 if(typeof directory!=='string'||path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('rm-readonly-oscrypt-'))throw failure();
 const info=await fs.lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||normalized(await fs.realpath(directory))!==normalized(path.resolve(directory)))throw failure();
 await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
export function safeReport(value){
 if(!value||typeof value!=='object')throw failure();
 const report={pass:value.pass===true,readOnly:true,noLogin:true,noBusinessWrites:true,noLocalDatabaseOpened:true};
 for(const name of ['actualDeviceAccepted','actualProfileUnchanged','sourcesUnchanged','timedOut'])if(typeof value[name]==='boolean')report[name]=value[name];
 if(Number.isSafeInteger(value.accountCount)&&value.accountCount>=0&&value.accountCount<=100000)report.accountCount=value.accountCount;
 if(typeof value.stage==='string'&&/^[a-z-]{1,64}$/.test(value.stage))report.stage=value.stage;
 if(value.statuses&&typeof value.statuses==='object'){report.statuses={};for(const key of ['unsigned','signedAuth','replay','tamperedPath','staffRequired'])if(Number.isInteger(value.statuses[key])&&value.statuses[key]>=100&&value.statuses[key]<=599)report.statuses[key]=value.statuses[key];}
 if(report.pass&&(report.actualDeviceAccepted!==true||report.actualProfileUnchanged!==true||!(report.accountCount>0)||JSON.stringify(report.statuses)!==JSON.stringify({unsigned:401,signedAuth:200,replay:409,tamperedPath:401,staffRequired:401})))throw failure();
 return report;
}
export async function runDeviceProbe({spawnChild=spawn,electronExecutable=require('electron')}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rm-readonly-oscrypt-'));let child,timer,report={pass:false,readOnly:true,noBusinessWrites:true,noLocalDatabaseOpened:true},output='',outputTooLarge=false;
 try{
  await protectData(directory);verifyPrivateDirectory(directory);
  const environment={...process.env,RM_DEVICE_PROBE_PROFILE:directory};delete environment.ELECTRON_RUN_AS_NODE;delete environment.NODE_OPTIONS;
  child=spawnChild(electronExecutable,[helper,'--probe'],{env:environment,windowsHide:true,stdio:['ignore','pipe','ignore']});
  child.stdout.on('data',part=>{if(Buffer.byteLength(output)+part.length>32768){outputTooLarge=true;child.kill();}else output+=part;});
  timer=setTimeout(()=>child.kill(),60000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
  if(outputTooLarge)throw failure();const lines=output.split(/\r?\n/).map(line=>line.trim()).filter(line=>line.startsWith('{'));if(lines.length!==1)throw failure();
  report=safeReport(JSON.parse(lines[0]));if(code!==0)report.pass=false;
 }catch{report={pass:false,stage:'native-probe-launch-or-result',readOnly:true,noBusinessWrites:true,noLocalDatabaseOpened:true};}
 finally{clearTimeout(timer);try{await removeOwnedProfile(directory);report.temporaryProfileRemoved=true;}catch{report.pass=false;report.stage='temporary-profile-cleanup';report.temporaryProfileRemoved=false;}}
 return report;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 if(process.platform!=='win32'||process.argv.length!==3||process.argv[2]!=='--probe'){console.error(JSON.stringify({pass:false,stage:'explicit-probe-flag-required'}));process.exitCode=1;}
 else{const report=await runDeviceProbe();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;}
}
