/* eslint-disable @typescript-eslint/no-require-imports */
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('birkassaDesktop',Object.freeze({
  setLanguage:language=>{if(['az','en','ru','zh','tr'].includes(language))ipcRenderer.send('desktop-language',language);}
}));
