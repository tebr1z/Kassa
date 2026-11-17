// Generated child fixtures only: no Electron, actual profile, key, HTTP or DB.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {runDeviceProbe,safeReport,removeOwnedProfile} from './probe-central-device.mjs';
const expected={pass:true,readOnly:true,actualDeviceAccepted:true,actualProfileUnchanged:true,accountCount:5,statuses:{unsigned:401,signedAuth:200,replay:409,tamperedPath:401,staffRequired:401}};
let profile,childExited=false;
const spawnChild=(executable,args,options)=>{
 assert.equal(args[1],'--probe');assert.equal(path.basename(args[0]),'probe-central-device.cjs');assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(options.env.NODE_OPTIONS,undefined);assert.equal(options.windowsHide,true);
 profile=options.env.RM_DEVICE_PROBE_PROFILE;assert.equal(path.dirname(profile),path.resolve(os.tmpdir()));
 const child=spawn(executable,['-e',"const fs=require('node:fs'),path=require('node:path');const handle=fs.openSync(path.join(process.env.RM_DEVICE_PROBE_PROFILE,'owned-native-handle-fixture'),'wx');console.log("+JSON.stringify(JSON.stringify({...expected,temporaryProfileCleanupPending:true,privateDummy:'must-not-escape'}))+");void handle;process.exit(0);"],options);
 child.once('exit',()=>{childExited=true;});return child;
};
const report=await runDeviceProbe({spawnChild,electronExecutable:process.execPath});assert.equal(childExited,true);assert.equal(report.pass,true);assert.equal(report.temporaryProfileRemoved,true);assert.equal(JSON.stringify(report).includes('must-not-escape'),false);await assert.rejects(fs.lstat(profile),{code:'ENOENT'});
assert.equal(safeReport({...expected,privateKey:'never-print-fixture'}).privateKey,undefined);assert.throws(()=>safeReport({...expected,statuses:{unsigned:200}}));
await assert.rejects(removeOwnedProfile(path.resolve(os.tmpdir())),'Never remove a broad TEMP directory');
let failedProfile;const failed=await runDeviceProbe({electronExecutable:process.execPath,spawnChild(executable,_args,options){failedProfile=options.env.RM_DEVICE_PROBE_PROFILE;return spawn(executable,['-e',"console.log('not a report');process.exit(1)"],options);}});assert.equal(failed.pass,false);assert.equal(failed.temporaryProfileRemoved,true);await assert.rejects(fs.lstat(failedProfile),{code:'ENOENT'});
console.log('PASS: parent-owned generated temporary profiles are removed only after child exit, sanitized reports exclude arbitrary fields, failure cleanup succeeds, and broad cleanup targets are rejected. No actual device, native crypto, network or database.');
