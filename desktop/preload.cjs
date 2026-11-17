/* eslint-disable @typescript-eslint/no-require-imports */
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('birkassaDesktop',Object.freeze({
  storageMode:process.argv.includes('--restamarket-storage=central')?'central':'local',
  setLanguage:language=>{if(['az','en','ru','zh','tr'].includes(language))ipcRenderer.send('desktop-language',language);},
  exportTransfer:()=>ipcRenderer.invoke('maintenance:transfer'),
  resetSalesPeriod:value=>ipcRenderer.invoke('maintenance:sales-period',value),
}));
