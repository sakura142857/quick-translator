'use strict';

// 逐个尝试注册候选全局快捷键，找出本机真正空闲的组合。
//   node_modules/electron/dist/electron.exe scripts/probe-shortcuts.js
const { app, globalShortcut } = require('electron');

const CANDIDATES = [
  'Alt+Q', 'Alt+W', 'Alt+E', 'Alt+A', 'Alt+S', 'Alt+X', 'Alt+C', 'Alt+Z',
  'Alt+1', 'Alt+2', 'Alt+3', 'Alt+`',
  'Ctrl+Q', 'Ctrl+Alt+Q', 'Ctrl+Shift+Q', 'Alt+Shift+Q',
  'Ctrl+Alt+W', 'Ctrl+Alt+S', 'Ctrl+Alt+X', 'Ctrl+Alt+C',
  'F7', 'F8', 'F9', 'F10',
];

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  const free = [], taken = [];
  for (const accel of CANDIDATES) {
    let ok = false;
    try { ok = globalShortcut.register(accel, () => {}); } catch (_) { ok = false; }
    (ok ? free : taken).push(accel);
    if (ok) globalShortcut.unregister(accel);
  }
  console.log('可用：' + free.join('  '));
  console.log('被占用：' + taken.join('  '));
  globalShortcut.unregisterAll();
  app.quit();
});
