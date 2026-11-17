/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const labels=require('./maintenance-labels.cjs');
function resetInput(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join(',')!=='confirm,preview,reason')return null;
 if(value.confirm!=='YENİ DÖVR'||typeof value.reason!=='string'||value.reason.trim().length<3||value.reason.length>500||/[\x00-\x1f\x7f]/.test(value.reason)||typeof value.preview!=='string'||value.preview.length<50||value.preview.length>200)return null;
 return {confirm:value.confirm,reason:value.reason.trim(),preview:value.preview};
}
// Native authority, destinations and backup paths never come from the renderer.
function createDesktopMaintenance({ipcMain,parent,origin,getLanguage,isAdmin,available,run,exportTransfer,resetSalesPeriod}){
 let busy=false,disposed=false;
 const words=()=>labels(getLanguage());
 const allowed=event=>{
  if(disposed||!parent||parent.isDestroyed()||event.sender!==parent.webContents||event.senderFrame!==parent.webContents.mainFrame)return false;
  try{const url=new URL(event.senderFrame.url);return url.origin===origin&&(url.pathname==='/heyet-g7m4q9x2k8'||url.pathname.startsWith('/heyet-g7m4q9x2k8/'));}catch{return false;}
 };
 async function perform(action,value){
  if(disposed||busy||!available())return {ok:false,error:words().busy};busy=true;
  try{
   if(!await isAdmin())return {ok:false,error:words().admin};
   return await run(async()=>{
    if(!await isAdmin())return {ok:false,error:words().admin};
    return action==='transfer'?exportTransfer():resetSalesPeriod(value);
   });
  }catch(error){if(['MASTER_REQUIRED','RESET_LIMIT_EXHAUSTED','RESET_POLICY_NOT_CONFIGURED','CENTRAL_BACKUP_REQUIRED'].includes(error?.code))return {ok:false,error:error.message,code:error.code,...(error.resetPolicy?{resetPolicy:error.resetPolicy}:{})};return {ok:false,error:words().failed};}finally{busy=false;}
 }
 ipcMain.handle('maintenance:transfer',(event,...args)=>{if(!allowed(event)||args.length)throw Error('Maintenance operation not allowed');return perform('transfer');});
 ipcMain.handle('maintenance:sales-period',(event,...args)=>{const value=args.length===1?resetInput(args[0]):null;if(!allowed(event)||!value)throw Error('Maintenance operation not allowed');return perform('reset',value);});
 return {exportTransfer:()=>perform('transfer'),isBusy:()=>busy,dispose(){disposed=true;ipcMain.removeHandler('maintenance:transfer');ipcMain.removeHandler('maintenance:sales-period');}};
}
module.exports={createDesktopMaintenance,resetInput};
