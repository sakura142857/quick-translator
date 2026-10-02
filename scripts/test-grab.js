'use strict';

/**
 * 划词抓取链路测试（模拟 Ctrl+C + 剪贴板还原）
 *   node_modules/electron/dist/electron.exe scripts/test-grab.js
 *
 * 运行前可先随便选中一段文字，以验证 hadSelection: true。
 */

const { app, clipboard } = require('electron');
const path = require('path');
const { grabSelectedText, dispose } = require(path.join(__dirname, '..', 'src', 'selection.js'));

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const backup = '备份内容-' + Date.now();
  clipboard.writeText(backup);
  console.log('预先写入剪贴板:', backup);
  console.log('');

  // 冷启动（首次，需拉起 PowerShell）
  let t = Date.now();
  let r1;
  try { r1 = await grabSelectedText(); } catch (e) { console.log('异常:', e.message); app.quit(); return; }
  const cold = Date.now() - t;

  await wait(300);

  // 热路径（复用常驻进程）
  t = Date.now();
  const r2 = await grabSelectedText();
  const hot = Date.now() - t;

  console.log('冷启动耗时:', cold, 'ms');
  console.log('热路径耗时:', hot, 'ms');
  console.log('');
  console.log('抓取结果:', JSON.stringify(r2));
  console.log('剪贴板是否已还原:', clipboard.readText() === backup);
  console.log('');
  console.log(hot < 500 ? '✓ 热路径性能达标（<500ms）' : '⚠ 热路径仍偏慢，需继续优化');

  dispose();
  app.quit();
});
