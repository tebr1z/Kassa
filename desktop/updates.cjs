/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const {DesktopUpdateClient}=require('./update-client.cjs');
const labels=require('./update-labels.cjs');

// Kept separate from the web renderer: no IPC caller supplies URLs, paths,
// versions, commands, trust keys or installer arguments.
function installerArguments(directory){
 if(!path.isAbsolute(directory)||/[\r\n"\x00]/.test(directory))throw Error('Invalid installation directory');
 return ['--updated','/S','--force-run','/D='+directory];
}
function launchInstaller(file,directory,spawnImpl=spawn){
 return new Promise((resolve,reject)=>{
  const child=spawnImpl(file,installerArguments(directory),{shell:false,detached:true,stdio:'ignore',windowsHide:true,windowsVerbatimArguments:true});
  child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
 });
}

function createDesktopUpdater({app,BrowserWindow,dialog,ipcMain,parent,dataRoot,getLanguage,isAdmin,prepareInstall,recoverAfterFailure,onAvailable=()=>{},enabled=app.isPackaged&&process.platform==='win32'&&process.arch==='x64',clientFactory=options=>new DesktopUpdateClient(options),launch=launchInstaller}){
 const trust=require('./update-trust.json');
 const localPage=path.join(__dirname,'update-window.html'),pageUrl=pathToFileURL(localPage).href;
 let window=null,busy=false,disposed=false,backgroundTimer,interval,downloaded=false,installing=false,notes={},notifiedVersion;
 let state={phase:'idle',currentVersion:app.getVersion(),language:getLanguage(),enabled};
 const client=clientFactory({feedUrl:trust.feedUrl,publicKey:trust.publicKey,currentVersion:app.getVersion(),cacheDir:path.join(dataRoot,'.private','updates'),onProgress:progress=>{if(state.phase==='downloading')set({progress:progress.percent});}});
 const words=()=>labels(getLanguage());
 function set(patch){state={...state,...patch,language:getLanguage()};if(window&&!window.isDestroyed())window.webContents.send('update:state-changed',{...state});return {...state};}
 async function authorized(){try{return Boolean(await isAdmin());}catch{return false;}}
 function allowed(event){return !disposed&&window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame?.url===pageUrl;}
 function errorText(error){
  if(error?.code==='UPDATE_ADMIN_REQUIRED')return words().adminRequired;
  // Do not expose stack traces, local paths, secrets or server response text.
  return words().recoveryMessage;
 }
 async function check(manual=true){
  if(!enabled||disposed||busy||installing||downloaded)return {...state};
  const previous={...state};busy=true;
  try{
   if(manual&&!await authorized())return set({phase:'error',error:words().adminRequired});
   if(disposed)return {...state};
   if(manual)set({phase:'checking',error:undefined,progress:0});
   const result=await client.check();notes=result.manifest.releaseNotes;
   if(result.available&&notifiedVersion!==result.manifest.version){notifiedVersion=result.manifest.version;try{onAvailable(result.manifest.version);}catch{/* Notification failure never affects the POS. */}}
   return set({phase:result.available?'available':'current',version:result.manifest.version,notes:notes[getLanguage()]||notes.az,error:undefined,progress:0});}
  catch(error){if(!manual)return set(previous);return set({phase:error?.code==='UPDATE_CANCELLED'?'idle':'error',error:error?.code==='UPDATE_CANCELLED'?undefined:errorText(error)});}
  finally{busy=false;}
 }
 async function download(){
  if(!enabled||disposed||busy||installing||downloaded||state.phase!=='available')return {...state};
  busy=true;
  try{
   if(!await authorized())return set({phase:'error',error:words().adminRequired});
   if(disposed)return {...state};
   set({phase:'downloading',progress:0,error:undefined});
   const result=await client.download();downloaded=true;return set({phase:'downloaded',version:result.manifest.version,progress:100});}
  catch(error){return set({phase:error?.code==='UPDATE_CANCELLED'?'available':'error',error:error?.code==='UPDATE_CANCELLED'?undefined:errorText(error),progress:0});}
  finally{busy=false;}
 }
 async function install(){
  if(!enabled||disposed||busy||installing||!downloaded||state.phase!=='downloaded')return {...state};
  busy=true;let preparationStarted=false;
  try{
   if(!await authorized())throw Object.assign(Error(),{code:'UPDATE_ADMIN_REQUIRED'});
   if(disposed)return {...state};
   const answer=await dialog.showMessageBox(window||parent,{type:'warning',title:words().confirmTitle,message:words().confirmMessage,buttons:[words().install,words().cancel],defaultId:1,cancelId:1,noLink:true});
   if(answer.response!==0)return {...state};
   // Native confirmation can remain open across a session expiration.
   if(!await authorized())throw Object.assign(Error(),{code:'UPDATE_ADMIN_REQUIRED'});
   if(disposed)return {...state};
   let result=await client.revalidateDownloaded();
   installing=true;set({phase:'installing',error:undefined});
   preparationStarted=true;await prepareInstall(result.manifest.version);
   result=await client.revalidateDownloaded();
   await launch(result.file,path.dirname(app.getPath('exe')));
   app.exit(0);return {...state};
  }catch(error){
   installing=false;downloaded=false;set({phase:'error',error:errorText(error)});
   if(preparationStarted)await recoverAfterFailure();
   return {...state};
  }finally{busy=false;}
 }
 const handlers={
  'update:state':()=>({...state,language:getLanguage()}),
  'update:check':()=>check(true),'update:download':download,'update:install':install,
  'update:cancel':()=>{if(!installing)client.cancel();return {...state};},
 };
 for(const [channel,handler]of Object.entries(handlers))ipcMain.handle(channel,(event,...args)=>{if(!allowed(event)||args.length)throw Error('Update operation not allowed');return handler();});
 async function open(){
  if(!enabled||disposed)return;
  if(!await authorized()){dialog.showErrorBox(words().errorTitle,words().adminRequired);return;}
  if(disposed)return;
  if(window&&!window.isDestroyed()){window.show();window.focus();return;}
  window=new BrowserWindow({parent,show:false,width:720,height:690,minWidth:570,minHeight:610,title:words().windowTitle,backgroundColor:'#f3f7f4',autoHideMenuBar:true,resizable:true,webPreferences:{preload:path.join(__dirname,'update-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,target)=>{if(target!==pageUrl)event.preventDefault();});
  window.on('close',event=>{if(installing)event.preventDefault();});
  window.on('closed',()=>{window=null;});
  await window.loadFile(localPage);window.show();
  if(!downloaded)void check(true);
 }
 function changeLanguage(){if(window&&!window.isDestroyed())window.setTitle(words().windowTitle);set({notes:notes[getLanguage()]||notes.az});}
 function dispose(){disposed=true;client.cancel();clearTimeout(backgroundTimer);clearInterval(interval);for(const channel of Object.keys(handlers))ipcMain.removeHandler(channel);}
 if(enabled){backgroundTimer=setTimeout(()=>void check(false),30000);backgroundTimer.unref?.();interval=setInterval(()=>void check(false),6*60*60*1000);interval.unref?.();}
 app.on('before-quit',()=>{if(!installing)dispose();});
 return {open,changeLanguage,dispose,isInstalling:()=>installing};
}
module.exports={createDesktopUpdater,installerArguments,launchInstaller};
