'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const config = { from: 'auto', to: 'zh-CN', engine: 'free', llm: { apiKey: '' } };
ipcMain.handle('config:get', () => config);
ipcMain.handle('window:resize-start', () => true);
ipcMain.handle('window:resize-move', () => {});
ipcMain.handle('window:resize-end', () => {});
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 460, height: 400, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  for (const [w, h] of [[460, 400], [360, 300], [860, 680]]) {
    win.setSize(w, h);
    const result = await win.webContents.executeJavaScript(`(() => {
      const s = document.querySelector('.shell').getBoundingClientRect();
      const c = document.querySelector('.card').getBoundingClientRect();
      const input = document.querySelector('.source-input').getBoundingClientRect();
      const out = document.querySelector('.result').getBoundingClientRect();
      const foot = document.querySelector('.actionbar').getBoundingClientRect();
      return { viewport: [innerWidth, innerHeight], shell: [s.width,s.height], card: [c.top,c.bottom], input: [input.top,input.bottom], result: [out.top,out.bottom], footer: [foot.top,foot.bottom] };
    })()`);
    assert.ok(Math.abs(result.viewport[0] - w) <= 2, 'Windows DPI 会引入 1-2px 的取整误差');
    assert.ok(Math.abs(result.viewport[1] - h) <= 2, 'Windows DPI 会引入 1-2px 的取整误差');
    console.log(`${w}x${h}:`, JSON.stringify(result));
    assert.ok(result.input[1] <= result.result[0], '原文不能覆盖译文');
    assert.ok(result.result[1] <= result.footer[0] + 1, '译文不能覆盖按钮');
    assert.ok(result.footer[1] <= h, '按钮必须在窗口内');
    console.log(`${w}x${h}: 布局完整，译文与操作栏未被裁切`);
  }
  win.destroy();
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
