/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Real hidden, sandboxed Electron windows; generated fixture keys, isolated
// profile and loopback HTTP only. Never read the installed app, DPAPI key or DB.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {randomUUID,generateKeyPairSync,createHash}=require('node:crypto');
const ts=require('typescript');
const {app,BrowserWindow,session}=require('electron');
const {createCentralClient,downloadCentralBackup,DEFAULT_CENTRAL_ORIGIN}=require('../desktop/central-client.cjs');
const {stopServer}=require('../desktop/update-lifecycle.cjs');
const root=path.resolve(__dirname,'..'),fixtureRoot=path.join(root,'.local-desktop-data','central-capability-fixture-'+randomUUID()),profile=path.join(fixtureRoot,'profile');
app.setName('RestaMarket central capability fixture');app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'session'));app.setPath('crashDumps',path.join(fixtureRoot,'crashes'));app.setAppLogsPath(path.join(fixtureRoot,'logs'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
const access='a'.repeat(64),native='b'.repeat(64),serverAccess='c'.repeat(64),serverNative='d'.repeat(64),records=[],localRecords=[],foreignRecords=[],networkFailures=[],requestIds=[];
const servers=new Set(),windows=[];let client,timeout,failed=false;
async function listen(server){servers.add(server);server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
async function stop(server){if(!server?.listening)return;await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});servers.delete(server);}
function extract(source){
 const ast=ts.createSourceFile('main.cjs',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);let listener,filter,backup;
 (function visit(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='onBeforeSendHeaders'){assert.equal(listener,undefined);filter=node.arguments[0].getText(ast);listener=node.arguments[1].getText(ast);}
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='centralBackup')backup=node.initializer.getText(ast);
  ts.forEachChild(node,visit);
 })(ast);assert.ok(listener&&filter&&backup,'Actual main.cjs capability hook and direct backup closure must exist');return {listener,filter,backup};
}
function record(req,rows){const row={path:req.url,headers:{...req.headers}};rows.push(row);return row;}
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
app.whenReady().then(async()=>{
 timeout=setTimeout(()=>{console.error('FAIL: central capability fixture timed out');app.exit(1);},60000);
 try{
  await fs.mkdir(profile,{recursive:true});const {createCentralGateway}=await import('../desktop/central-gateway.mjs');
  const fixtureKeys=generateKeyPairSync('ed25519'),identity={id:randomUUID(),privateKey:fixtureKeys.privateKey,publicKeyPem:fixtureKeys.publicKey.export({type:'spki',format:'pem'})},registryFile=path.join(fixtureRoot,'devices.json');
  await fs.writeFile(registryFile,JSON.stringify({schema:1,devices:[{id:identity.id,publicKeyPem:identity.publicKeyPem,active:true}]}),{mode:0o600});
  const backupBytes=Buffer.from('Isolated central capability fixture archive, not business data.');
  const backend=http.createServer(async(req,res)=>{
   record(req,records);for await(const chunk of req)assert.ok(Buffer.isBuffer(chunk)); // Complete body before replying.
   if(req.headers['x-restamarket-desktop-access']!==serverAccess)return json(res,403,{error:'fixture capability missing'});
   if(req.url==='/native-fixture'||req.url==='/api/sales-period'){
    if(req.headers.authorization!=='Bearer '+serverNative)return json(res,403,{error:'fixture native missing'});return json(res,200,{ok:true});
   }
   if(req.url.startsWith('/api/central-backup?')){
    if(req.headers.authorization!=='Bearer '+serverNative||!req.headers.cookie?.includes('birkassa_session=fixture-session'))return json(res,403,{error:'fixture native session missing'});
    const fileName=new URL(req.url,'http://fixture.invalid').searchParams.get('fileName');res.writeHead(200,{'Content-Type':'application/x-birkassa-backup','Content-Length':String(backupBytes.length),'X-RestaMarket-Backup-Name':fileName,'X-RestaMarket-Backup-Bytes':String(backupBytes.length),'X-RestaMarket-Backup-Sha256':createHash('sha256').update(backupBytes).digest('hex')});res.end(backupBytes);return;
   }
   if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><html><head><title>Capability fixture</title></head><body>Isolated capability fixture</body></html>');return;}
   json(res,200,{ok:true});
  });
  const backendOrigin=await listen(backend),portProbe=http.createServer();await listen(portProbe);const port=portProbe.address().port;await stop(portProbe);
  const url='http://127.0.0.1:'+port,gateway=createCentralGateway({registryFile,backendOrigin,accessToken:serverAccess,nativeToken:serverNative,desktopOrigin:url}),gatewayOrigin=await listen(gateway);
  client=await createCentralClient({identity,accessToken:access,nativeToken:native,port,fetchImpl:(target,options)=>{assert.equal(new URL(target).origin,DEFAULT_CENTRAL_ORIGIN);return fetch(gatewayOrigin+new URL(target).pathname+new URL(target).search,options);}});
  client.server.prependListener('request',req=>record(req,localRecords));
  const foreign=http.createServer((req,res)=>{
   record(req,foreignRecords);res.setHeader('Access-Control-Allow-Origin','*');
   if(req.url.startsWith('/frame')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script>fetch('+JSON.stringify(url+'/foreign-subframe')+', {mode:"no-cors"}).then(()=>parent.postMessage("fixture-subframe-finished","*")).catch(()=>parent.postMessage("fixture-subframe-finished","*"));</script>');return;}
   json(res,200,{ok:true});
  }),foreignOrigin=await listen(foreign);
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(details,callback)=>{
   const allowed=[url,foreignOrigin].includes(new URL(details.url).origin);if(!allowed)networkFailures.push(new URL(details.url).origin);callback({cancel:!allowed});
  });
  const win=new BrowserWindow({show:false,width:900,height:650,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});windows.push(win);
  const actual=extract(await fs.readFile(path.join(root,'desktop','main.cjs'),'utf8'));
  const listener=new Function('win','desktopAccessToken','return ('+actual.listener+');')(win,access),filter=new Function('url','return ('+actual.filter+');')(url);
  win.webContents.session.webRequest.onBeforeSendHeaders(filter,(details,callback)=>{requestIds.push({id:details.webContentsId,path:new URL(details.url).pathname});listener(details,callback);});
  await win.loadURL(url+'/');
  const preferences=win.webContents.getLastWebPreferences();assert.equal(preferences.sandbox,true);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.webSecurity,true);
  const first=records.find(row=>row.path==='/');assert.ok(first,'Initial page navigation reached the real private gateway/backend');assert.equal(first.headers.authorization,undefined);assert.equal(localRecords.find(row=>row.path==='/').headers['x-restamarket-desktop-access'],access);
  const parent=await win.webContents.executeJavaScript("fetch('/parent-fixture').then(async r=>({status:r.status,body:await r.json()}))");assert.equal(parent.status,200);
  assert.equal(records.find(row=>row.path==='/parent-fixture').headers.authorization,undefined,'The actual generic hook never adds the privileged bearer');
  const beforeBrowser=records.length;assert.equal((await fetch(url+'/ordinary-browser')).status,403);assert.equal(records.length,beforeBrowser);
  assert.equal((await fetch(url+'/api/sales-period',{method:'POST',headers:{Authorization:'Bearer '+native},body:'{}'})).status,403,'A native bearer without the local capability cannot access the local signing proxy');
  await session.defaultSession.cookies.set({url,name:'birkassa_session',value:'fixture-session',httpOnly:true,sameSite:'strict',path:'/'});
  const nativeResponse=await win.webContents.session.fetch(url+'/api/sales-period',{method:'POST',credentials:'include',headers:{Origin:url,'Content-Type':'application/json',Authorization:'Bearer '+native,'x-restamarket-desktop-access':access},body:'{}'});
  assert.equal(nativeResponse.status,200,'Actual Electron session.fetch must retain/inject local capability even without a renderer webContentsId');await nativeResponse.arrayBuffer();
  const nativeRecord=records.findLast(row=>row.path==='/api/sales-period');assert.equal(nativeRecord.headers.authorization,'Bearer '+serverNative);assert.match(nativeRecord.headers.cookie,/birkassa_session=fixture-session/);
  const unprivileged=await win.webContents.executeJavaScript("fetch('/api/sales-period',{method:'POST',body:'{}'}).then(r=>r.status)");assert.equal(unprivileged,403,'Renderer request never receives native privilege from the generic hook');
  const other=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});windows.push(other);
  await other.loadURL(url+'/');const otherResult=await other.webContents.executeJavaScript("fetch('/untrusted-window').then(r=>r.status)");assert.equal(otherResult,403,'Another window cannot use the parent window capability');
  await win.webContents.executeJavaScript('fetch('+JSON.stringify(foreignOrigin+'/foreign-fetch')+').then(r=>r.json()).then(()=>true)');
  await win.webContents.executeJavaScript('new Promise(resolve=>{window.addEventListener("message",event=>{if(event.data==="fixture-subframe-finished")resolve(true);},{once:true});const frame=document.createElement("iframe");frame.src='+JSON.stringify(foreignOrigin+'/frame')+';document.body.appendChild(frame);})');
  for(const row of foreignRecords){assert.equal(row.headers['x-restamarket-desktop-access'],undefined,'Capability must never be sent to a foreign origin');assert.equal(row.headers.authorization,undefined,'Native bearer must never be sent to a foreign origin');}
  assert.equal(records.some(row=>row.path==='/foreign-subframe'),false,'Foreign subframe cannot cross the actual local origin/site gate into the private backend');
  assert.equal(await win.webContents.executeJavaScript('typeof window.require'), 'undefined');
  // Execute the actual updater backup closure after the local proxy is closed.
  // Electron cookies remain available and the signed direct path must still work.
  const centralBackup=new Function('environment','const {win,url,central,downloadCentralBackup,path}=environment;return ('+actual.backup+');')({win,url,central:client,downloadCentralBackup,path});
  await stopServer(client.server,2000);assert.equal(client.server.exitCode,0);
  const destination=path.join(fixtureRoot,'backups','pre-update-fixture.birkassa');await centralBackup(destination);assert.deepEqual(await fs.readFile(destination),backupBytes);
  assert.ok(records.some(row=>row.path.startsWith('/api/central-backup?')&&row.headers.authorization==='Bearer '+serverNative&&row.headers.cookie?.includes('birkassa_session=fixture-session')));
  assert.deepEqual(networkFailures,[]);
  const nativeIds=requestIds.filter(row=>row.path==='/api/sales-period').map(row=>row.id===undefined?'undefined':String(row.id));
  console.log('PASS: actual main.cjs hook in hidden sandboxed Electron; navigation/renderer capability only, native session.fetch bearer+HttpOnly cookie, ordinary browser/other-window/foreign-subframe denied, no capability or native bearer to foreign origin; actual updater backup after local proxy closes. Native webContentsId values: '+[...new Set(nativeIds)].join(', ')+'. No real profile, DB, server or external network.');
 }catch(error){failed=true;console.error('FAIL: central capability fixture:',error.stack||error.message);}
 finally{
  clearTimeout(timeout);for(const win of windows)if(!win.isDestroyed())win.destroy();if(client?.server.listening)await stopServer(client.server,2000).catch(()=>{});
  for(const server of [...servers])await stop(server);
  if(path.dirname(fixtureRoot)!==path.join(root,'.local-desktop-data')||!path.basename(fixtureRoot).startsWith('central-capability-fixture-'))throw Error('Unexpected fixture profile path');
  // Electron can still hold Chromium files until process exit; keep this private
  // isolated fixture profile if Windows refuses cleanup, never touch other paths.
  await fs.rm(fixtureRoot,{recursive:true,force:true}).catch(()=>{});
  if(failed)app.exit(1);else app.quit();
 }
});
