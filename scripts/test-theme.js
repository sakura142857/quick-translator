'use strict';

// 验证：卡片无投影（白底下不再出现灰边）、窗口配色可切换、清空按钮可用。
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.join(__dirname, '..');
const cfg = {
  shortcut: 'CommandOrControl+Shift+D',
  engine: 'free',
  from: 'auto',
  to: 'zh-CN',
  autoSwap: true,
  autoHide: true,
  windowColor: '#ffffff',
  llm: { baseUrl: 'https://www.vibeapi.cn/v1', apiKey: '', model: '' },
};

const noop = () => {};
for (const [ch, fn] of Object.entries({
  'config:get': () => cfg,
  'config:save': (_e, p) => {
    Object.assign(cfg, p);
    // 真实主进程会 broadcast，这里照样模拟，否则浮窗收不到配色变更
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('config:changed', cfg);
    return cfg;
  },
  'window:resize-start': () => true,
  'window:resize-move': noop,
  'window:resize-end': noop,
  'window:hide': noop,
  'window:show': noop,
  'clipboard:read': () => 'clip',
  'clipboard:write': () => true,
  'settings:open': noop,
  'app:quit': noop,
  'shell:open': noop,
  'grab': () => ({ text: '', hadSelection: false }),
  'grab:translate': noop,
  'autostart:get': () => false,
  'autostart:set': () => false,
  'translate': async () => ({ text: 'TRANSLATED', engine: 'test', fromName: '英语', toName: '中文(简体)' }),
})) ipcMain.handle(ch, fn);

app.on('window-all-closed', () => {});

const read = (win, expr) => win.webContents.executeJavaScript(expr);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 460, height: 420, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await wait(600);

  // 1. 边界感：要有可见描边，且投影必须贴身（模糊半径小、透明度低），
  //    否则白底上会糊成一圈明显的灰晕（旧版 0 14px 44px 就是这个问题）。
  const shadow = await read(win, "getComputedStyle(document.querySelector('.card')).boxShadow");
  const nums = (shadow.match(/-?\d+(?:\.\d+)?px/g) || []).map(parseFloat);
  assert.ok(nums.length >= 3, `应有投影，实际为 ${shadow}`);
  const blur = nums[2];
  // Chromium 计算值是「颜色 偏移 模糊 扩散」，颜色在前
  const alpha = Number((/rgba\([^)]*,\s*([\d.]+)\)/.exec(shadow) || [])[1] ?? 1);
  assert.ok(blur <= 16, `投影应贴身，模糊半径需 <=16px，实际 ${blur}px`);
  assert.ok(alpha <= 0.12, `投影应很轻，透明度需 <=0.12，实际 ${alpha}`);

  const borderW = await read(win, "getComputedStyle(document.querySelector('.card')).borderTopWidth");
  const borderC = await read(win, "getComputedStyle(document.querySelector('.card')).borderTopColor");
  // 150% 这类分数缩放会让 1px 计算成 0.67px，只要求描边确实存在
  assert.ok(parseFloat(borderW) > 0, `卡片应有描边，实际宽度 ${borderW}`);
  const borderAlpha = Number((/rgba\([^)]*,\s*([\d.]+)\)/.exec(borderC) || [])[1] ?? 1);
  assert.ok(borderAlpha >= 0.1, `描边要能看见，透明度需 >=0.1，实际 ${borderAlpha}`);

  // 2. 默认纯白主题：白底 + 深色文字
  let card = await read(win, "getComputedStyle(document.querySelector('.card')).backgroundColor");
  let text = await read(win, "getComputedStyle(document.querySelector('.card')).color");
  assert.equal(card, 'rgb(255, 255, 255)');
  assert.equal(text, 'rgb(31, 36, 48)', '浅色底应使用深色文字');

  // 3. 切换到深色：文字必须变浅，否则读不了
  await read(win, "window.qt.saveConfig({ windowColor: '#101216' })");
  await wait(300);
  card = await read(win, "getComputedStyle(document.querySelector('.card')).backgroundColor");
  text = await read(win, "getComputedStyle(document.querySelector('.card')).color");
  assert.equal(card, 'rgb(16, 18, 22)', '窗口背景应跟随配置');
  assert.equal(text, 'rgb(240, 242, 248)', '深色底应自动切换浅色文字');

  // 4. 自定义中间色也能正确判定
  await read(win, "window.qt.saveConfig({ windowColor: '#f4f1ff' })");
  await wait(300);
  card = await read(win, "getComputedStyle(document.querySelector('.card')).backgroundColor");
  text = await read(win, "getComputedStyle(document.querySelector('.card')).color");
  assert.equal(card, 'rgb(244, 241, 255)');
  assert.equal(text, 'rgb(31, 36, 48)', '浅紫底应使用深色文字');

  // 5. 清空按钮：原文与译文一起清掉
  await read(win, "document.querySelector('#source').value='待翻译内容'");
  await read(win, "document.querySelector('#btnTranslate').click()");
  await wait(400);
  assert.equal(await read(win, "document.querySelector('#source').value"), '待翻译内容');
  assert.equal(await read(win, "document.querySelector('#result').textContent"), 'TRANSLATED');
  await read(win, "document.querySelector('#btnClear').click()");
  await wait(200);
  assert.equal(await read(win, "document.querySelector('#source').value"), '', '清空后原文应为空');
  assert.ok(
    (await read(win, "document.querySelector('#result').textContent")).includes('译文会显示在这里'),
    '清空后译文区应回到占位提示'
  );

  console.log('描边+贴身投影、窗口配色切换、深色自动反色、清空按钮测试通过');
  win.destroy();
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
