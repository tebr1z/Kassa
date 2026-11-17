import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {NextRequest} from 'next/server.js';
import ts from 'typescript';

// Actual authorization/route code with in-memory adapters only. No SQL client,
// database, installed profile, network request or production secret is opened.
const require=createRequire(import.meta.url),keys=['BIRKASSA_CENTRAL','BIRKASSA_DESKTOP_ACCESS_TOKEN','BIRKASSA_DESKTOP_TOKEN','BIRKASSA_LOCAL','DATABASE_URL'];
const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const access='a'.repeat(64),native='b'.repeat(64),token='central-access-fixture-session',actor='10000000-0000-4000-8000-000000000001';
let connections=0,cookieReads=0,delegated=0,handled=0,queries=[],cookieWrites=[];
async function load(file,mocks={}){
 const compiled=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
class FakeNextResponse extends Response{
 constructor(...args){super(...args);this.cookies={set:(...value)=>cookieWrites.push(value)};}
 static next(options={}){const response=new FakeNextResponse(null,{status:200,headers:{'x-middleware-next':'1'}});response.forwardedHeaders=options.request?.headers;return response;}
 static json(value,options={}){return new FakeNextResponse(JSON.stringify(value),{...options,headers:{'content-type':'application/json',...options.headers}});}
 static redirect(url,status=307){return new FakeNextResponse(null,{status,headers:{location:String(url)}});}
}
const sql={async unsafe(query,params=[]){queries.push({query,params});if(query.includes('from auth_sessions s join users u'))return [{id:actor,role:'admin',authentication_method:'password',active:true}];if(query.startsWith('delete from auth_sessions'))return [];assert.fail('Unexpected SQL: '+query);},async end(){},async begin(){assert.fail('A forbidden central restore must never enter a transaction');}};
const database={storeDb:()=>{connections++;return sql;}},cookies={cookies:async()=>{cookieReads++;return {get:()=>({value:token})};}};
function request(path='/api/products',{method='GET',device,staff=true,bearer,body}={}){
 return new Request('http://127.0.0.1:5760'+path,{method,headers:{host:'127.0.0.1:5760',origin:'http://127.0.0.1:5760',...(device!==undefined?{'x-restamarket-desktop-access':device}:{}),...(staff?{cookie:'birkassa_session='+token}:{}),...(bearer?{authorization:'Bearer '+bearer}:{}),...(body?{'content-type':'application/json'}:{}),'x-birkassa-user-id':'forged-id','x-birkassa-role':'admin'},...(body?{body:JSON.stringify(body)}:{})});
}
try{
 process.env.BIRKASSA_LOCAL='1';process.env.DATABASE_URL='postgres://central-access.invalid/never-connected';process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN=access;process.env.BIRKASSA_DESKTOP_TOKEN=native;
 const central=await load('lib/central-access.ts'),inventory=await load('lib/inventory-mode.ts'),roles=await load('lib/staff-access.ts'),security=await load('lib/admin-security.ts'),portal=await load('lib/staff-portal.ts');
 for(const value of [undefined,'0','true','yes']){if(value===undefined)delete process.env.BIRKASSA_CENTRAL;else process.env.BIRKASSA_CENTRAL=value;assert.equal(central.hasCentralDesktopAccess(request()),true,'Existing non-central web/local behavior remains unchanged');}
 process.env.BIRKASSA_CENTRAL='1';
 const guard=await load('lib/require-admin.ts',{'@/lib/central-access':central,'@/lib/store-db':database,'@/lib/admin-security':security,'@/lib/staff-access':roles,'@/lib/inventory-mode':inventory});
 const guarded=guard.withAdminSession(value=>{handled++;return Response.json({id:value.headers.get('x-birkassa-user-id')});});
 const proxy=await load('proxy.ts',{'next/server':{NextResponse:FakeNextResponse},postgres:()=>{connections++;return sql;},'./lib/log-error':{logSystemError:async()=>assert.fail('Unexpected authorization database error')},'./lib/central-access':central,'./lib/admin-security':security,'./lib/staff-access':roles,'./lib/staff-portal':portal,'./lib/inventory-mode':inventory});
 const auth=await load('app/api/auth/route.ts',{'next/server':{NextResponse:FakeNextResponse},'next/headers':cookies,'@/lib/store-db':database,'@/lib/central-access':central,'@/lib/desktop-auth':Object.fromEntries(['desktopAuthGet','desktopAuthPost','desktopActivity'].map(name=>[name,async()=>{delegated++;return Response.json({delegated:true});}]))});
 const lock=await load('app/api/desktop-lock/route.ts',{'@/lib/store-db':database,'@/lib/central-access':central});
 const snapshots=await load('lib/system-snapshot.ts');
 const system=await load('app/api/system/route.ts',{'next/server':{NextResponse:FakeNextResponse},'@/lib/require-admin':guard,'@/lib/log-error':{logSystemError:async()=>assert.fail('No SQL error is expected for a denied restore')},postgres:()=>{connections++;return sql;},'@/lib/system-snapshot':snapshots,'node:child_process':{spawn:()=>assert.fail('No backup process may start for a forbidden restore')}});
 for(const device of [undefined,'',access.slice(1),'A'.repeat(64),'c'.repeat(64),access+'x','é'.repeat(64),'a'.repeat(63)+'é']){
  const before={connections,cookieReads,delegated,handled,queries:queries.length};
  for(const path of ['/api/products','/api/sales-period','/api/system','/api/auth',portal.staffPortalPath(),'/mehsullar/fixture/']){
   const response=await proxy.proxy(new NextRequest(request(path,{device,bearer:native})));assert.equal(response.status,403);assert.equal((await response.json()).code,'DESKTOP_DEVICE_REQUIRED');assert.match(response.headers.get('cache-control'),/no-store/);
  }
  let response=await guarded(request('/api/products',{device,bearer:native}));assert.equal(response.status,403);assert.equal((await response.json()).code,'DESKTOP_DEVICE_REQUIRED');
  for(const method of ['GET','POST','PATCH','DELETE']){response=await auth[method](request('/api/auth',{method,device,bearer:native}));assert.equal(response.status,403);assert.equal((await response.json()).code,'DESKTOP_DEVICE_REQUIRED');}
  response=await lock.POST(request('/api/desktop-lock',{method:'POST',device,bearer:native}));assert.equal(response.status,403);
  assert.deepEqual({connections,cookieReads,delegated,handled,queries:queries.length},before,'Unknown device must be denied before any database connection, cookie read, login or business handler');
 }
 for(const configured of [undefined,'',access.slice(1),'invalid']){if(configured===undefined)delete process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN;else process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN=configured;assert.equal(central.hasCentralDesktopAccess(request('/api/products',{device:access})),false,'Unconfigured/malformed central gate fails closed');}
 process.env.BIRKASSA_DESKTOP_ACCESS_TOKEN=access;
 assert.equal((await guarded(request('/api/products',{device:access,staff:false,bearer:native}))).status,401,'Device access never replaces staff authentication');
 let response=await guarded(request('/api/products',{device:access}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:actor},'Identity still comes from actual session SQL, not request headers');assert.equal(handled,1);
 response=await proxy.proxy(new NextRequest(request('/api/products',{device:access})));assert.equal(response.status,200);assert.equal(response.forwardedHeaders.get('x-birkassa-user-id'),actor);
 for(const method of ['GET','POST','PATCH'])assert.equal((await auth[method](request('/api/auth',{method,device:access}))).status,200);assert.equal(delegated,3);
 const beforeLock=queries.length;
 for(const bearer of [undefined,'c'.repeat(64),native+'x'])assert.equal((await lock.POST(request('/api/desktop-lock',{method:'POST',device:access,bearer}))).status,401);
 assert.equal(queries.length,beforeLock,'Native lock requires both device authority and native bearer');
 assert.equal((await lock.POST(request('/api/desktop-lock',{method:'POST',device:access,bearer:native}))).status,200);
 assert.deepEqual(queries.at(-1),{query:'delete from auth_sessions where token_hash=$1',params:[createHash('sha256').update(token).digest('hex')]},'Locking one central EXE deletes ONLY its own session, never every cash register session');
 const afterSingleLock=queries.length;assert.equal((await lock.POST(request('/api/desktop-lock',{method:'POST',device:access,bearer:native,staff:false}))).status,200);assert.equal(queries.length,afterSingleLock,'No cookie must not trigger a broad session deletion');
 assert.equal((await auth.DELETE(request('/api/auth',{method:'DELETE',device:access}))).status,200);assert.equal(cookieWrites.length,1);
 const beforeRestore=queries.length;
 response=await system.POST(request('/api/system',{method:'POST',device:access,body:{action:'restore',confirm:'BƏRPA',backupId:actor}}));assert.equal(response.status,403);assert.equal((await response.json()).code,'CENTRAL_RESTORE_DISABLED');
 assert.equal(queries.length,beforeRestore+1,'Only session authorization SQL runs; no backup read, backup creation, table restoration or audit mutation');assert.match(queries.at(-1).query,/from auth_sessions s join users u/);
 await assert.rejects(snapshots.restoreSnapshot({begin:()=>assert.fail('Direct helper must reject before SQL')},{version:2,tables:{}},actor,actor),/Mərkəzi bazanın bərpası/,'Direct helper is protected even without API/Proxy');
 // Execute the actual native lock closure with mocks. Global fetch would lose
 // the Electron session cookie and previously could sign out unrelated tills.
 const main=await readFile('desktop/main.cjs','utf8'),ast=ts.createSourceFile('desktop/main.cjs',main,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);let nativeLock;
 (function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='lock')nativeLock=node.initializer.getText(ast);ts.forEachChild(node,visit);})(ast);
 assert.ok(nativeLock);const calls=[];
 const win={webContents:{session:{fetch:async(...args)=>{calls.push(args);return Response.json({ok:true});}}},isDestroyed:()=>false,loadURL:async value=>calls.push(['load',value])};
 const runLock=new Function('environment','const {win,url,desktopToken,centralMode,desktopAccessToken,staffEntry}=environment;let locking=false,closing=false,working=false;return ('+nativeLock+');')({win,url:'http://127.0.0.1:5760',desktopToken:native,centralMode:true,desktopAccessToken:access,staffEntry:portal.staffPortalPath()});
 await runLock();assert.equal(calls[0][0],'http://127.0.0.1:5760/api/desktop-lock');assert.equal(calls[0][1].credentials,'include');assert.equal(calls[0][1].headers.Authorization,'Bearer '+native);assert.equal(calls[0][1].headers['x-restamarket-desktop-access'],access);assert.equal(calls[1][1],'http://127.0.0.1:5760'+portal.staffPortalPath());
 console.log('PASS: actual central gate rejects unauthorized devices before any DB/login/cookie/business work, staff/native authority remains separate, malformed configuration fails closed, central EXE lock scopes one session, native session-cookie transport and API/direct-helper restore disablement. Pure mocks only.');
}finally{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
