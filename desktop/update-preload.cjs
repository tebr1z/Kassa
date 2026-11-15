/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep this bridge specific to the local updater window. Never expose IPC itself
// or its event object to the renderer.
contextBridge.exposeInMainWorld('restaUpdate', Object.freeze({
  getState: () => ipcRenderer.invoke('update:state'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  cancel: () => ipcRenderer.invoke('update:cancel'),
  onState(callback) {
    if (typeof callback !== 'function') throw new TypeError('A state callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state-changed', listener);
    return () => ipcRenderer.removeListener('update:state-changed', listener);
  },
}));
