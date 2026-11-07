/* Electron's main entry is deliberately CommonJS. */
/* eslint-disable @typescript-eslint/no-require-imports */
const {app,BrowserWindow,Menu,dialog,shell,ipcMain,Notification,powerMonitor}=require('electron');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const menuLabels=require('./menu-language.cjs');
const desktopToken=randomBytes(32).toString('hex');
const staffEntry='/heyet-g7m4q9x2k8';
let language='az',pollTimer;
const labels=()=>menuLabels(language);
let database,server,closing=false;
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
 const {openLocalDatabase}=await import('./local-database.mjs');database=await openLocalDatabase(dataRoot,root,{port:Number(process.env.BIRKASSA_PG_PORT||55432)});
 const port=Number(process.env.BIRKASSA_PORT||5760),url=`http://127.0.0.1:${port}`;
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Yanlış kassa portu.');
 await new Promise((resolve,reject)=>{const probe=require('node:net').createServer();probe.once('error',()=>reject(new Error(port+' portu istifadə olunur. Əvvəlki kassa pəncərəsini bağlayın.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 const args=app.isPackaged?[path.join(root,'server.js')]:[path.join(root,'node_modules','next','dist','bin','next'),'start','--hostname','127.0.0.1','--port',String(port)];
 const serverLog=require('node:fs').openSync(path.join(dataRoot,'server.log'),'a');
 try{server=spawn(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DATABASE_URL:database.url,BIRKASSA_DATA_DIR:dataRoot,BIRKASSA_LOCAL:'1',BIRKASSA_DESKTOP_TOKEN:desktopToken,HOSTNAME:'127.0.0.1',PORT:String(port),NODE_ENV:'production'},stdio:['ignore',serverLog,serverLog]});}finally{require('node:fs').closeSync(serverLog);}
 let ready=false;for(let attempt=0;attempt<90;attempt++){if(server.exitCode!==null)throw Error('Kassa serveri açılmadı. Əvvəlcə npm run build işlədin.');try{const response=await fetch(url+'/api/auth');if(response.ok&&typeof (await response.json()).authenticated==='boolean'){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}if(!ready)throw Error('Kassa serverinin açılması vaxt aşımına düşdü.');
 let win,working=false;
 const access=async()=>win&&!win.isDestroyed()?win.webContents.executeJavaScript("fetch('/api/auth').then(r=>r.json()).then(d=>({admin:d.authenticated&&d.user?.role==='admin',fresh:d.local&&!d.authenticated&&d.users?.length>0&&d.users.every(u=>!u.hasPin&&!u.hasPassword)}))"):null;
 const backup=async()=>{if(!(await access())?.admin){dialog.showErrorBox(labels()[10],labels()[16]);return;}const result=await dialog.showSaveDialog({title:labels()[8],defaultPath:path.join(app.getPath('documents'),`RestaMarket-${new Date().toISOString().slice(0,10)}.birkassa`),filters:[{name:'RestaMarket backup',extensions:['birkassa']}]});if(!result.canceled&&result.filePath){try{await database.backupData(result.filePath);dialog.showMessageBox({message:labels()[9]});}catch(error){dialog.showErrorBox(labels()[10],error.message);}}};
 const restore=async()=>{
  if(working)return;
  const allowed=await access();
  if(!allowed?.admin&&!allowed?.fresh){dialog.showErrorBox(labels()[12],labels()[16]);return;}
  const selected=await dialog.showOpenDialog({title:labels()[12],properties:['openFile'],filters:[{name:'BirKassa backup',extensions:['birkassa','dump']}]});if(selected.canceled)return;
  const confirm=await dialog.showMessageBox({type:'warning',title:labels()[12],message:labels()[13],buttons:[labels()[14],labels()[15]],defaultId:1,cancelId:1});if(confirm.response!==0)return;
  working=true;win.setEnabled(false);
  try{if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}await database.restoreData(selected.filePaths[0]);}
  catch(error){dialog.showErrorBox(labels()[12],error.message);}
  finally{app.relaunch();app.quit();}
 };
 const setMenu=()=>{const l=labels();Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'RestaMarket',submenu:[{label:l[0],click:backup},{label:l[12],click:restore},{label:l[1],click:()=>shell.openPath(dataRoot)},{type:'separator'},{role:'quit',label:l[2]}]},{label:l[3],submenu:[{role:'reload',label:l[4]},{role:'togglefullscreen',label:l[5]},{role:'zoomIn',label:l[6]},{role:'zoomOut',label:l[7]}]}]));};setMenu();
 const smoke=process.argv.includes('--smoke');
 win=new BrowserWindow({show:!smoke,width:1440,height:960,minWidth:900,minHeight:650,title:'RestaMarket — Lokal kassa',icon:path.join(__dirname,'assets','restamarket.ico'),backgroundColor:'#f5f8f5',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 ipcMain.on('desktop-language',(event,next)=>{if(event.sender===win.webContents&&['az','en','ru','zh','tr'].includes(next)){language=next;setMenu();}});
 let polling=false;const poll=async()=>{if(polling||closing)return;polling=true;try{const response=await fetch(url+'/api/desktop-poll',{method:'POST',headers:{Authorization:'Bearer '+desktopToken},signal:AbortSignal.timeout(25000)});if(response.ok){const result=await response.json();if(result.received>0&&Notification.isSupported()&&!smoke)new Notification({title:'BirKassa',body:labels()[11]+': '+result.received}).show();}}catch{}finally{polling=false;}};
 pollTimer=setInterval(()=>void poll(),30000);void poll();
 let locking=false;
 const lock=async()=>{if(locking||closing)return;locking=true;try{await fetch(url+'/api/desktop-lock',{method:'POST',headers:{Authorization:'Bearer '+desktopToken},signal:AbortSignal.timeout(5000)});if(!win.isDestroyed())await win.loadURL(url+staffEntry);}catch{}finally{locking=false;}};
 powerMonitor.on('lock-screen',()=>void lock());powerMonitor.on('suspend',()=>void lock());
 let idleLocked=false;const idleTimer=setInterval(()=>{const idle=powerMonitor.getSystemIdleTime();if(idle>=600&&!idleLocked){idleLocked=true;void lock();}if(idle<60)idleLocked=false;},10000);app.once('before-quit',()=>clearInterval(idleTimer));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,target)=>{if(new URL(target).origin!==url)event.preventDefault();});
 await win.loadURL(url+staffEntry);
 try{await database.backupData(path.join(dataRoot,'backups',`automatic-${new Date().toISOString().slice(0,10)}.birkassa`));}catch(error){if(smoke)throw error;dialog.showErrorBox(labels()[10],error.message);}
 if(smoke){const bridge=await win.webContents.executeJavaScript("typeof window.birkassaDesktop?.setLanguage==='function'");if(!bridge)throw new Error('Desktop preload bridge did not load.');console.log('PASS: Electron window loaded local POS; language bridge available; automatic backup created.');app.quit();}
 }catch(error){if(process.argv.includes('--smoke')){console.error(error.message);if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}if(database)await database.close().catch(()=>{});app.exit(1);return;}dialog.showErrorBox('RestaMarket açılmadı',error.message);app.quit();}
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(closing)return;event.preventDefault();closing=true;clearInterval(pollTimer);(async()=>{if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}if(database)await database.close();})().catch(error=>console.error(error)).finally(()=>app.quit());});
