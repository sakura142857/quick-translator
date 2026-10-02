'use strict';

// 自动化复现：在 Electron 窗口选中文本，然后执行与全局快捷键相同的抓取逻辑。
const { app, BrowserWindow, clipboard } = require('electron');
const { grabSelectedText, dispose } = require('../src/selection');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 520, height: 230 });
  await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent('<textarea id="text" style="width:95%;height:100px">Selection capture works across windows</textarea>'));
  win.show();
  win.focus();
  await win.webContents.executeJavaScript('document.querySelector("textarea").focus();document.querySelector("textarea").select()');
  await wait(300);
  clipboard.writeText('Original clipboard content');
  const result = await grabSelectedText();
  const restored = clipboard.readText() === 'Original clipboard content';
  console.log(JSON.stringify({ result, restored }));
  dispose();
  win.destroy();
  app.quit();
  if (result.text !== 'Selection capture works across windows' || !restored) process.exitCode = 1;
}).catch((e) => { console.error(e); dispose(); app.quit(); process.exitCode = 1; });
