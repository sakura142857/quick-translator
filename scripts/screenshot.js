'use strict';

/**
 * 界面截图工具（独立进程，不影响正在运行的实例）
 *   node_modules/electron/dist/electron.exe scripts/screenshot.js
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'preview');

const mockCfg = {
  shortcut: 'Alt+W',
  captureShortcut: 'Alt+S',
  engine: 'free',
  from: 'auto',
  to: 'zh-CN',
  autoSwap: true,
  autoHide: true,
  windowColor: '#ffffff',
  ocrEngine: 'windows',
  ocrLang: 'zh-Hans-CN',
  llm: { baseUrl: 'https://www.vibeapi.cn/v1', apiKey: '', model: 'claude-haiku-4-5-20251001' },
};

const noop = () => {};
const handlers = {
  'config:get': () => mockCfg,
  'config:save': (_e, p) => Object.assign(mockCfg, p),
  'window:resize-start': () => true,
  'window:resize-move': noop,
  'window:resize-end': noop,
  'window:hide': noop,
  'window:show': noop,
  'clipboard:read': () => '',
  'clipboard:write': () => true,
  'settings:open': noop,
  'app:quit': noop,
  'shell:open': noop,
  'grab': () => ({ text: '', hadSelection: false }),
  'grab:translate': noop,
  'autostart:get': () => false,
  'autostart:set': () => false,
  'translate': async (_e, opts) => {
    const { translate } = require(path.join(ROOT, 'src', 'translator.js'));
    return translate({
      text: opts.text,
      from: opts.from || mockCfg.from,
      to: opts.to || mockCfg.to,
      engine: opts.engine || 'free',
      autoSwap: mockCfg.autoSwap,
      llm: mockCfg.llm,
    });
  },
};

for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, fn);

// 阻止「窗口全部关闭即退出」的默认行为，否则截完第一张进程就结束了
app.on('window-all-closed', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(name, file, width, height, after, winBg) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: winBg || '#e9ebf2',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const target = path.join(ROOT, 'renderer', file);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await win.loadFile(target);
      break;
    } catch (e) {
      if (attempt === 3) { console.log(`跳过 ${name}: ${e.message}`); win.destroy(); return; }
      await wait(600);
    }
  }

  await wait(1000);
  if (after) { await after(win); await wait(2500); }

  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('已保存 preview/' + name);

  win.destroy();
  await wait(700);
}

app.whenReady().then(async () => {
  try {
    const SENTENCE = 'Pull requests let you tell others about changes you have pushed to a branch in a repository on GitHub.';

    // 1. 主窗口：空状态
    await shoot('popup-empty.png', 'index.html', 460, 500, null);

    // 2. 主窗口：句子翻译
    await shoot('popup-result.png', 'index.html', 460, 500, async (win) => {
      win.webContents.send('do-translate', { text: SENTENCE });
    });

    // 3. 主窗口：单词翻译
    await shoot('popup-word.png', 'index.html', 460, 500, async (win) => {
      win.webContents.send('do-translate', { text: 'asynchronous' });
    });

    // 4. 纯白桌面：检查窗口边缘不再有半透明灰边
    await shoot('popup-on-white.png', 'index.html', 460, 500, async (win) => {
      win.webContents.send('do-translate', { text: SENTENCE });
    }, '#ffffff');

    // 5. 深色窗口配色
    mockCfg.windowColor = '#101216';
    await shoot('popup-dark.png', 'index.html', 460, 500, async (win) => {
      win.webContents.send('do-translate', { text: SENTENCE });
    }, '#2b2f3a');
    mockCfg.windowColor = '#ffffff';

    // 6. 设置页
    await shoot('settings.png', 'settings.html', 600, 980, null);

    // 7. 框选遮罩（模拟拖拽到一半的状态）
    await shootCaptureOverlay();
  } catch (e) {
    console.error('截图失败:', e.message);
  }
  app.quit();
});

async function shootCaptureOverlay() {
  const win = new BrowserWindow({
    width: 800, height: 480, show: false, frame: false,
    backgroundColor: '#cfd6e4',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'capture.html'));
  await wait(600);
  const result = await win.webContents.executeJavaScript(`(function () {
    try {
      var dim = document.getElementById('dim');
      var hint = document.getElementById('hint');
      var box = document.getElementById('selection');
      var badge = document.getElementById('badge');
      if (!dim || !hint || !box || !badge) return 'missing elements';
      dim.hidden = true;
      hint.hidden = true;
      box.hidden = false;
      box.style.left = '170px'; box.style.top = '140px';
      box.style.width = '430px'; box.style.height = '185px';
      badge.hidden = false;
      badge.textContent = '430 x 185';
      badge.style.left = '170px'; badge.style.top = '333px';
      return 'ok';
    } catch (e) { return 'ERR: ' + e.message; }
  })()`);
  console.log('遮罩状态:', result);
  await wait(400);
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'capture-overlay.png'), img.toPNG());
  console.log('已保存 preview/capture-overlay.png');
  win.destroy();
  await wait(500);
}
