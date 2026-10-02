'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_EVENTS = [
  'do-translate', 'focus-input', 'config:changed', 'app-error',
  'capture-status', 'capture-result', 'capture-empty', 'capture-error',
];

contextBridge.exposeInMainWorld('qt', {
  translate: (opts) => ipcRenderer.invoke('translate', opts),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),

  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),

  hide: () => ipcRenderer.invoke('window:hide'),
  show: () => ipcRenderer.invoke('window:show'),
  resizeStart: (edge) => ipcRenderer.invoke('window:resize-start', edge),
  resizeMove: (dx, dy) => ipcRenderer.invoke('window:resize-move', dx, dy),
  resizeEnd: () => ipcRenderer.invoke('window:resize-end'),

  grab: () => ipcRenderer.invoke('grab'),
  grabTranslate: () => ipcRenderer.invoke('grab:translate'),

  captureSubmit: (rect) => ipcRenderer.invoke('capture:submit', rect),
  captureCancel: () => ipcRenderer.invoke('capture:cancel'),
  captureTranslate: () => ipcRenderer.invoke('capture:translate'),

  openSettings: () => ipcRenderer.invoke('settings:open'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),

  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (on) => ipcRenderer.invoke('autostart:set', on),

  on: (channel, cb) => {
    if (!ALLOWED_EVENTS.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
