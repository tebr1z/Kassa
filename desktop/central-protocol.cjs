/* Shared by the isolated Electron process and the private central gateway. */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const {createHash,randomUUID,sign}=require('node:crypto');
const CENTRAL_PREFIX='/desktop-private';
const MAX_BODY_BYTES=16*1024*1024;
const DEVICE_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EPOCH=/^[A-Za-z0-9_-]{43}$/;
const BODY_HASH=/^[a-f0-9]{64}$/;
const METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
function bodySha256(body=Buffer.alloc(0)){
 if(!Buffer.isBuffer(body)&&!(body instanceof Uint8Array))throw Error('Body must contain bytes');
 return createHash('sha256').update(body).digest('hex');
}
function validateOriginalPath(value){
 if(typeof value!=='string'||value.length>16384||!value.startsWith('/')||value.startsWith('//')||/[\\#\x00-\x20\x7f]/.test(value))throw Error('Invalid request path');
 let pathname=value.split('?')[0];
 // Do not permit a proxy, WHATWG URL parser and the backend to disagree about
 // path traversal, encoded separators, double encoding or request targets.
 for(let attempt=0;attempt<5;attempt++){
  if(/[\\\x00-\x20\x7f?#]/.test(pathname)||pathname.startsWith('//')||/(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)||/%(?:2f|5c)/i.test(pathname))throw Error('Invalid request path');
  let decoded;try{decoded=decodeURIComponent(pathname);}catch{throw Error('Invalid request path');}
  if(decoded===pathname)return value;
  pathname=decoded;
 }
 throw Error('Invalid request path');
}
function canonicalSigningData({deviceId,epoch,time,nonce,purpose,method,path,bodySha256:hash}){
 const stamp=String(time);
 if(!DEVICE_ID.test(deviceId)||!EPOCH.test(epoch)||Buffer.from(epoch,'base64url').toString('base64url')!==epoch||!DEVICE_ID.test(nonce)||!['renderer','native'].includes(purpose)||!METHODS.has(method)||!BODY_HASH.test(hash)||!/^[1-9][0-9]{0,15}$/.test(stamp)||!Number.isSafeInteger(Number(stamp)))throw Error('Invalid signing fields');
 validateOriginalPath(path);
 return Buffer.from(JSON.stringify([1,deviceId,epoch,stamp,nonce,purpose,method,path,hash]),'utf8');
}
function signDeviceRequest({deviceId,epoch,time=Date.now(),nonce=randomUUID(),purpose='renderer',method,path,body=Buffer.alloc(0),privateKey}){
 if(body.length>MAX_BODY_BYTES)throw Error('Request body exceeds the private gateway limit');
 const hash=bodySha256(body),fields={deviceId,epoch,time,nonce,purpose,method,path,bodySha256:hash};
 return {'x-rm-device-id':deviceId,'x-rm-epoch':epoch,'x-rm-time':String(time),'x-rm-nonce':nonce,'x-rm-purpose':purpose,'x-rm-body-sha256':hash,'x-rm-signature':sign(null,canonicalSigningData(fields),privateKey).toString('base64')};
}
module.exports={CENTRAL_PREFIX,MAX_BODY_BYTES,DEVICE_ID,bodySha256,canonicalSigningData,signDeviceRequest,validateOriginalPath};
