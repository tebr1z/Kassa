/* Electron's main entry is deliberately CommonJS. */
/* eslint-disable @typescript-eslint/no-require-imports */
const {app,BrowserWindow,Menu,dialog,shell,ipcMain,Notification,powerMonitor,safeStorage}=require('electron');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const menuLabels=require('./menu-language.cjs');
const updateLabels=require('./update-labels.cjs');
const {createDesktopUpdater}=require('./updates.cjs');
const {stopServer}=require('./update-lifecycle.cjs');
const maintenanceLabels=require('./maintenance-labels.cjs');
const {createDesktopMaintenance}=require('./maintenance.cjs');
const {DesktopUpdateClient,verifyInstallerFile}=require('./update-client.cjs');
const desktopToken=randomBytes(32).toString('hex');
const desktopAccessToken=randomBytes(32).toString('hex');
const staffEntry='/heyet-g7m4q9x2k8';
let language='az',pollTimer,pollAbort,updater,maintenance;
const labels=()=>menuLabels(language);
let database,server,closing=false,requestRestore,operationBusy=()=>false;
const backupArgument=args=>args.find(value=>typeof value==='string'&&path.isAbsolute(value)&&!value.startsWith('\\\\')&&!/[\r\n\0]/.test(value)&&value.toLowerCase().endsWith('.birkassa'));
let pendingRestore=backupArgument(process.argv);
app.setName('RestaMarket');
if(process.platform==='win32')app.setAppUserModelId('az.birkassa.desktop');
const profile=process.env.BIRKASSA_DATA_DIR?path.join(process.env.BIRKASSA_DATA_DIR,'electron-profile'):path.join(app.getPath('appData'),'BirKassa');
require('node:fs').mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(async()=>{
 try{
 const root=app.isPackaged?path.join(process.resourcesPath,'application'):path.resolve(__dirname,'..');
 const dataRoot=process.env.BIRKASSA_DATA_DIR||path.join(app.getPath('userData'),'local-data');
 const smoke=process.argv.includes('--smoke');
 const centralMode=process.env.BIRKASSA_STORAGE_MODE==='central'||app.isPackaged&&!smoke;
 await require('node:fs/promises').mkdir(dataRoot,{recursive:true,mode:0o700});
 let central,win;
 const port=Number(process.env.BIRKASSA_PORT||5760),url=`http://127.0.0.1:${port}`;
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Yanlış kassa portu.');
 await new Promise((resolve,reject)=>{const probe=require('node:net').createServer();probe.once('error',()=>reject(new Error(port+' portu istifadə olunur. Əvvəlki kassa pəncərəsini bağlayın.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 if(centralMode){
  const {createCentralClient,downloadCentralBackup}=require('./central-client.cjs');
  central=await createCentralClient({dataRoot,safeStorage,accessToken:desktopAccessToken,nativeToken:desktopToken,port});server=central.server;
  const centralBackup=async file=>{
   if(!win||win.isDestroyed())throw Error('Baş rəhbər hesabına daxil olun.');
   const cookies=await win.webContents.session.cookies.get({url}),cookie=cookies.map(item=>item.name+'='+item.value).join('; ');
   const response=await central.request('/api/central-backup?fileName='+encodeURIComponent(path.basename(file)),{purpose:'native',headers:{Cookie:cookie,Origin:url},signal:AbortSignal.timeout(180000)});
   return downloadCentralBackup(response,file);
  };
  database={backupData:centralBackup,backupForUpdate:centralBackup,close:async()=>{},closeForUpdate:async()=>{},restoreData:async()=>{throw Error('Mərkəzi bazanın bərpası bu kompüterdən bağlıdır.');}};
 }else{
 const {openLocalDatabase}=await import('./local-database.mjs');database=await openLocalDatabase(dataRoot,root,{port:Number(process.env.BIRKASSA_PG_PORT||55432)});
 const args=app.isPackaged?[path.join(root,'server.js')]:[path.join(root,'node_modules','next','dist','bin','next'),'start','--hostname','127.0.0.1','--port',String(port)];
 const serverLog=require('node:fs').openSync(path.join(dataRoot,'server.log'),'a');
 try{server=spawn(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DATABASE_URL:database.url,BIRKASSA_DATA_DIR:dataRoot,BIRKASSA_LOCAL:'1',BIRKASSA_DESKTOP_TOKEN:desktopToken,HOSTNAME:'127.0.0.1',PORT:String(port),NODE_ENV:'production'},stdio:['ignore',serverLog,serverLog]});}finally{require('node:fs').closeSync(serverLog);}
 }
 let ready=false;for(let attempt=0;attempt<(centralMode?3:90);attempt++){if(server.exitCode!==null)throw Error('Kassa serveri açılmadı. Əvvəlcə npm run build işlədin.');try{const response=await fetch(url+'/api/auth',{headers:centralMode?{'x-restamarket-desktop-access':desktopAccessToken}:{},signal:AbortSignal.timeout(15000)});if(response.ok&&typeof (await response.json()).authenticated==='boolean'){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}if(!ready)throw Error(centralMode?'Mərkəzlə bağlantı və ya kompüter icazəsi yoxdur. Kompüterin açıq qeydiyyat faylı: '+central.identity.registration:'Kassa serverinin açılması vaxt aşımına düşdü.');
 let working=false,restorePrompt=false,updateAttempt=false,updateStopped=false;
 operationBusy=()=>working&&!closing;
 const access=async()=>{if(!win||win.isDestroyed())return null;const response=await win.webContents.session.fetch(url+'/api/auth',{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000),headers:centralMode?{'x-restamarket-desktop-access':desktopAccessToken}:{}});if(!response.ok)return null;const d=await response.json();return {admin:d.local===true&&d.authenticated===true&&d.user?.role==='admin',fresh:d.local===true&&!d.authenticated&&d.users?.length>0&&d.users.every(u=>!u.hasPin&&!u.hasPassword)};};
 const updateAccess=async()=>{if(!win||win.isDestroyed())return false;const response=await win.webContents.session.fetch(url+'/api/auth',{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000),headers:centralMode?{'x-restamarket-desktop-access':desktopAccessToken}:{}});if(!response.ok)return false;const result=await response.json();return result.local===true&&result.authenticated===true&&result.user?.role==='admin';};
 const backup=async()=>{if(working||closing||updater?.isInstalling())return;try{if(!(await access())?.admin){dialog.showErrorBox(labels()[10],labels()[16]);return;}const result=await dialog.showSaveDialog({title:labels()[8],defaultPath:path.join(app.getPath('documents'),`RestaMarket-${new Date().toISOString().slice(0,10)}.birkassa`),filters:[{name:'RestaMarket backup',extensions:['birkassa']}]});if(result.canceled||!result.filePath||working||closing||updater?.isInstalling())return;working=true;try{await database.backupData(result.filePath);dialog.showMessageBox({message:labels()[9]});}finally{working=false;}}catch(error){dialog.showErrorBox(labels()[10],error.message);}};
 const restore=async suggested=>{
  if(centralMode){dialog.showErrorBox(labels()[12],'Məlumatlar vahid serverdədir. Mərkəzi bazanın bərpası kassadan bağlıdır.');return;}
  if(working||restorePrompt||closing||updater?.isInstalling())return;
  restorePrompt=true;
  try{
  const allowed=await access();
  if(!allowed?.admin&&!allowed?.fresh){dialog.showErrorBox(labels()[12],labels()[16]);return;}
  const selected=typeof suggested==='string'?{canceled:false,filePaths:[suggested]}:await dialog.showOpenDialog({title:labels()[12],properties:['openFile'],filters:[{name:'BirKassa backup',extensions:['birkassa','dump']}]});if(selected.canceled)return;
  const item=await require('node:fs/promises').lstat(selected.filePaths[0]);if(!item.isFile()||item.isSymbolicLink())throw Error('Yanlış ehtiyat faylı.');
  const confirm=await dialog.showMessageBox({type:'warning',title:labels()[12],message:labels()[13],detail:maintenanceLabels(language).restore,buttons:[labels()[14],labels()[15]],defaultId:1,cancelId:1});if(confirm.response!==0)return;
  const stillAllowed=await access();if(!stillAllowed?.admin&&!stillAllowed?.fresh){dialog.showErrorBox(labels()[12],labels()[16]);return;}
  if(working||closing||updater?.isInstalling())return;
  working=true;win.setEnabled(false);
  try{clearInterval(pollTimer);pollAbort?.abort();await stopServer(server);await database.restoreData(selected.filePaths[0]);}
  catch(error){dialog.showErrorBox(labels()[12],error.message);}
  finally{working=false;app.relaunch();app.quit();}
  }finally{restorePrompt=false;}
 };
 const setMenu=()=>{const l=labels();Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'RestaMarket',submenu:[{label:l[0],click:backup},{label:l[12],enabled:!centralMode,click:()=>void restore().catch(error=>dialog.showErrorBox(l[12],error.message))},{label:maintenanceLabels(language).transfer,enabled:!centralMode,click:()=>void maintenance?.exportTransfer().then(result=>{if(result&&!result.ok&&!result.canceled)dialog.showErrorBox(l[10],result.error);})},{label:l[1],click:()=>shell.openPath(dataRoot)},{type:'separator'},{label:updateLabels(language).menu,click:()=>void updater?.open()},{type:'separator'},{role:'quit',label:l[2]}]},{label:l[3],submenu:[{role:'reload',label:l[4]},{role:'togglefullscreen',label:l[5]},{role:'zoomIn',label:l[6]},{role:'zoomOut',label:l[7]}]}]));};setMenu();
 win=new BrowserWindow({show:!smoke,width:1440,height:960,minWidth:900,minHeight:650,title:centralMode?'RestaMarket — Mərkəzi kassa':'RestaMarket — Lokal kassa',icon:path.join(__dirname,'assets','restamarket.ico'),backgroundColor:'#f5f8f5',webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:[centralMode?'--restamarket-storage=central':'--restamarket-storage=local'],nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 if(centralMode)win.webContents.session.webRequest.onBeforeSendHeaders({urls:[url+'/*']},(details,callback)=>{const headers={...details.requestHeaders};for(const name of Object.keys(headers))if(name.toLowerCase()==='x-restamarket-desktop-access')delete headers[name];if(details.webContentsId===win.webContents.id||details.webContentsId===undefined)headers['x-restamarket-desktop-access']=desktopAccessToken;callback({requestHeaders:headers});});
 win.on('close',event=>{if(working&&!closing)event.preventDefault();});
 requestRestore=file=>{if(win.isMinimized())win.restore();win.show();win.focus();void restore(file).catch(error=>dialog.showErrorBox(labels()[12],error.message));};
 const nativeRequest=async(method,body)=>{const response=await win.webContents.session.fetch(url+'/api/sales-period',{method,credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:url,'Content-Type':'application/json',...((centralMode||method==='POST')?{Authorization:'Bearer '+desktopToken}:{}),...(centralMode?{'x-restamarket-desktop-access':desktopAccessToken}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||maintenanceLabels(language).failed),{code:data.code,resetPolicy:data.resetPolicy});return data;};
 maintenance=createDesktopMaintenance({ipcMain,parent:win,origin:url,getLanguage:()=>language,isAdmin:updateAccess,available:()=>!working&&!closing&&!updater?.isInstalling(),
  run:async task=>{if(working||closing||updater?.isInstalling())throw Error('Busy');working=true;win.setEnabled(false);pollAbort?.abort();try{return await task();}finally{working=false;if(!win.isDestroyed())win.setEnabled(true);}},
  exportTransfer:async()=>{
   if(centralMode)return {ok:false,error:'Məlumatlar vahid serverdədir. Yeni kompüterə ayrıca giriş icazəsi verilməlidir.'};
   const words=maintenanceLabels(language),confirmed=await dialog.showMessageBox(win,{type:'warning',title:words.transfer,message:words.transferWarning,buttons:[words.continue,words.cancel],defaultId:1,cancelId:1,noLink:true});if(confirmed.response!==0)return {ok:false,canceled:true};
   const selected=await dialog.showOpenDialog(win,{title:words.choose,defaultPath:app.getPath('documents'),properties:['openDirectory','createDirectory']});if(selected.canceled||!selected.filePaths[0])return {ok:false,canceled:true};
   if(!await updateAccess())return {ok:false,error:words.admin};
   const trust=require('./update-trust.json'),client=new DesktopUpdateClient({feedUrl:trust.feedUrl,publicKey:trust.publicKey,currentVersion:app.getVersion(),cacheDir:path.join(dataRoot,'.private','transfer-installer')});
   await client.check();const downloaded=await client.downloadForTransfer();await verifyInstallerFile(downloaded.file,downloaded.manifest);
   if(!await updateAccess())return {ok:false,error:words.admin};
   const prepared=path.join(dataRoot,'.private','transfer-installer','prepared-'+randomUUID()),installer=path.join(prepared,`RestaMarket-Setup-${downloaded.manifest.version}.exe`);await require('node:fs/promises').mkdir(prepared,{mode:0o700});await require('node:fs/promises').copyFile(downloaded.file,installer);await verifyInstallerFile(installer,downloaded.manifest);
   let stopped=false;try{
    clearInterval(pollTimer);pollAbort?.abort();await stopServer(server);stopped=true;
    const {createTransferPackage}=await import('./transfer-package.mjs');
    const result=await createTransferPackage({dataRoot,installer,version:downloaded.manifest.version,outputParent:selected.filePaths[0],pgBin:app.isPackaged?path.join(process.resourcesPath,'postgres','bin'):undefined});
    await dialog.showMessageBox(win,{type:'info',title:words.transfer,message:words.ready,buttons:['OK'],noLink:true});await shell.openPath(result.output);return {ok:true};
   }finally{if(path.dirname(prepared)===path.join(dataRoot,'.private','transfer-installer'))await require('node:fs/promises').rm(prepared,{recursive:true,force:true});if(stopped){working=false;app.relaunch();app.quit();}}
  },
  resetSalesPeriod:async value=>{
   const words=maintenanceLabels(language),preview=await nativeRequest('GET');if(!preview.resetPolicy?.master)return {ok:false,error:'Bu əməliyyat yalnız təyin edilmiş baş rəhbər üçündür.',code:'MASTER_REQUIRED',resetPolicy:preview.resetPolicy};if(preview.resetPolicy.exhausted||preview.resetPolicy.remaining===0)return {ok:false,error:'Üç xüsusi sıfırlama imkanı istifadə edilib.',code:'RESET_LIMIT_EXHAUSTED',resetPolicy:preview.resetPolicy};if(preview.openShiftCount)return {ok:false,error:words.shifts};
   const confirmed=await dialog.showMessageBox(win,{type:'warning',title:words.reset,message:words.resetWarning,detail:String(preview.sales.receipts)+' '+words.retained,buttons:[words.continue,words.cancel],defaultId:1,cancelId:1,noLink:true});if(confirmed.response!==0)return {ok:false,canceled:true};
   if(!await updateAccess())return {ok:false,error:words.admin};
   const selected=await dialog.showOpenDialog(win,{title:words.chooseBackup,defaultPath:app.getPath('documents'),properties:['openDirectory','createDirectory']});if(selected.canceled||!selected.filePaths[0])return {ok:false,canceled:true};
   const externalParent=await require('node:fs/promises').realpath(selected.filePaths[0]),realDataRoot=await require('node:fs/promises').realpath(dataRoot),relative=path.relative(realDataRoot,externalParent);if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))return {ok:false,error:words.failed};
   if(!await updateAccess())return {ok:false,error:words.admin};
   const fileName='pre-sales-period-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.birkassa',file=path.join(dataRoot,'backups',fileName);await database.backupForUpdate(file);
   const hash=createHash('sha256');for await(const part of require('node:fs').createReadStream(file))hash.update(part);const size=(await require('node:fs/promises').stat(file)).size;
   const sha256=hash.digest('hex'),external=path.join(externalParent,'RestaMarket-Ehtiyat-'+randomUUID());await require('node:fs/promises').mkdir(external,{mode:0o700});const {protectData}=await import('./protect-data.mjs');await protectData(external);const exported=path.join(external,fileName);await require('node:fs/promises').copyFile(file,exported,require('node:fs').constants.COPYFILE_EXCL);const externalHash=createHash('sha256');for await(const part of require('node:fs').createReadStream(exported))externalHash.update(part);if((await require('node:fs/promises').stat(exported)).size!==size||externalHash.digest('hex')!==sha256)throw Error(words.failed);
   if(!await updateAccess())return {ok:false,error:words.admin};
   await nativeRequest('POST',{...value,backup:{fileName,sha256,bytes:size}});return {ok:true};
  },
 });
 ipcMain.on('desktop-language',(event,next)=>{if(event.sender===win.webContents&&['az','en','ru','zh','tr'].includes(next)){language=next;setMenu();updater?.changeLanguage();}});
 let polling=false;const poll=async()=>{if(polling||closing||working)return;polling=true;pollAbort=new AbortController();try{const response=await fetch(url+'/api/desktop-poll',{method:'POST',headers:{Authorization:'Bearer '+desktopToken},signal:AbortSignal.any([AbortSignal.timeout(120000),pollAbort.signal])});if(response.ok){const result=await response.json();const events=Number(result.received||0)+Number(result.updated||0)+Number(result.supportReceived||0)+Number(result.supportUpdated||0)+Number(result.catalogChanged||0);if(events>0&&Notification.isSupported()&&!smoke)new Notification({title:'RestaMarket',body:labels()[11]+': '+events}).show();}}catch{}finally{polling=false;pollAbort=null;}};
 if(!centralMode){pollTimer=setInterval(()=>void poll(),30000);void poll();}
 updater=createDesktopUpdater({app,BrowserWindow,dialog,ipcMain,parent:win,dataRoot,getLanguage:()=>language,isAdmin:updateAccess,enabled:app.isPackaged&&process.platform==='win32'&&process.arch==='x64'&&!smoke,
  onAvailable:version=>{if(Notification.isSupported()){const notice=new Notification({title:'RestaMarket',body:updateLabels(language).menu+' · v'+version});notice.on('click',()=>void updater.open());notice.show();}},
  prepareInstall:async version=>{
   if(working||closing)throw Error('Another operation is running');
   const installation=path.dirname(app.getPath('exe')),relative=path.relative(installation,path.resolve(dataRoot));
   if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Data directory must be outside the installation');
   updateAttempt=true;working=true;win.setEnabled(false);clearInterval(pollTimer);pollAbort?.abort();updateStopped=true;
   await stopServer(server);
   await database.backupForUpdate(path.join(dataRoot,'backups',`pre-update-${version}-${new Date().toISOString().replace(/[:.]/g,'-')}.birkassa`));
   await database.closeForUpdate();closing=true;
  },recoverAfterFailure:async()=>{
   if(!updateAttempt)return;
   if(updateStopped){dialog.showErrorBox(updateLabels(language).errorTitle,updateLabels(language).recoveryMessage);app.relaunch();closing=false;app.quit();}
   else{working=false;updateAttempt=false;win.setEnabled(true);pollTimer=setInterval(()=>void poll(),30000);}
  }});
 let locking=false;
 const lock=async()=>{if(locking||closing||working)return;locking=true;try{await win.webContents.session.fetch(url+'/api/desktop-lock',{method:'POST',credentials:'include',headers:{Authorization:'Bearer '+desktopToken,...(centralMode?{'x-restamarket-desktop-access':desktopAccessToken}:{})},signal:AbortSignal.timeout(5000)});if(!win.isDestroyed())await win.loadURL(url+staffEntry);}catch{}finally{locking=false;}};
 powerMonitor.on('lock-screen',()=>void lock());powerMonitor.on('suspend',()=>void lock());
 let idleLocked=false;const idleTimer=setInterval(()=>{const idle=powerMonitor.getSystemIdleTime();if(idle>=600&&!idleLocked){idleLocked=true;void lock();}if(idle<60)idleLocked=false;},10000);app.once('before-quit',()=>clearInterval(idleTimer));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,target)=>{if(new URL(target).origin!==url)event.preventDefault();});
 await win.loadURL(url+staffEntry);
 if(!centralMode)try{await database.backupData(path.join(dataRoot,'backups',`automatic-${new Date().toISOString().slice(0,10)}.birkassa`));}catch(error){if(smoke)throw error;dialog.showErrorBox(labels()[10],error.message);}
 if(smoke){const bridge=await win.webContents.executeJavaScript("typeof window.birkassaDesktop?.setLanguage==='function'");if(!bridge)throw new Error('Desktop preload bridge did not load.');console.log('PASS: Electron window loaded local POS; language bridge available; automatic backup created.');app.quit();}
 else if(pendingRestore){const file=pendingRestore;pendingRestore=null;requestRestore(file);}
 }catch(error){if(process.argv.includes('--smoke')){console.error(error.message);if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}if(database)await database.close().catch(()=>{});app.exit(1);return;}dialog.showErrorBox('RestaMarket açılmadı',error.message);app.quit();}
});
app.on('second-instance',(_event,args)=>{const file=backupArgument(args);if(file){if(requestRestore)requestRestore(file);else pendingRestore=file;}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(updater?.isInstalling()||operationBusy()){event.preventDefault();return;}if(closing)return;event.preventDefault();closing=true;clearInterval(pollTimer);pollAbort?.abort();updater?.dispose();maintenance?.dispose();(async()=>{await stopServer(server);if(database)await database.close();})().catch(error=>console.error(error)).finally(()=>app.quit());});
