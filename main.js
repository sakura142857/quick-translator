'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain,
  clipboard, shell, nativeImage, screen,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const config = require('./src/config');
const { translate, detectLang, langName } = require('./src/translator');
const { grabSelectedText, dispose: disposeSelection } = require('./src/selection');
const {
  startCapture, finish: finishCapture, captureRegion, isCapturing,
} = require('./src/screenshot');
const { runWindowsOcr, visionTranslate } = require('./src/ocr');

const ICON = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');

let mainWin = null;
let settingsWin = null;
let tray = null;
let busy = false;
let resizeDrag = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------- 诊断入口：--selftest-ocr=<图片路径> ------------------- */

const selftestArg = process.argv.find((a) => a.startsWith('--selftest-ocr='));

async function runOcrSelftest(imagePath) {
  try {
    const { resolveOcrScript, runWindowsOcr } = require('./src/ocr');
    console.log('打包状态:', app.isPackaged);
    console.log('OCR 脚本:', resolveOcrScript());
    const r = await runWindowsOcr(imagePath, config.get().ocrLang);
    console.log('识别引擎:', r.engine);
    console.log('识别结果:', JSON.stringify(r.text.slice(0, 200)));
    console.log('SELFTEST OK');
  } catch (err) {
    console.error('SELFTEST FAIL:', err.message);
  }
  app.exit(0);
}

/* ----------------------------- 单实例锁 ----------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.quicktranslator.app');
}

/* ----------------------------- 主窗口 ------------------------------- */

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: Math.max(config.get().windowWidth || 460, 360),
    height: Math.max(config.get().windowHeight || 400, 300),
    minWidth: 360,
    minHeight: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWin.setAlwaysOnTop(true, 'screen-saver');
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 失焦自动隐藏
  mainWin.on('blur', () => {
    setTimeout(() => {
      if (!mainWin || mainWin.isDestroyed()) return;
      if (!config.get().autoHide) return;
      if (mainWin.webContents.isDevToolsOpened()) return;
      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isFocused()) return;
      if (mainWin.isVisible() && !mainWin.isFocused()) mainWin.hide();
    }, 150);
  });

  let saveSizeTimer;
  mainWin.on('resize', () => {
    clearTimeout(saveSizeTimer);
    saveSizeTimer = setTimeout(() => {
      if (!mainWin || mainWin.isDestroyed()) return;
      const [windowWidth, windowHeight] = mainWin.getSize();
      config.save({ windowWidth, windowHeight });
    }, 400);
  });
  mainWin.on('closed', () => { clearTimeout(saveSizeTimer); mainWin = null; });
}

function positionMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;
  let [w, h] = mainWin.getSize();
  // 旧版本留下的异常尺寸、屏幕缩放变化或小屏幕，都要限制在工作区内。
  w = Math.min(w, Math.max(360, area.width - 16));
  h = Math.min(h, Math.max(300, area.height - 16));
  if (w !== mainWin.getSize()[0] || h !== mainWin.getSize()[1]) mainWin.setSize(w, h);

  let x = Math.round(cursor.x - w / 2);
  let y = Math.round(cursor.y + 24);
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - w - 8));
  if (y + h > area.y + area.height - 8) y = Math.round(cursor.y - h - 24);
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - h - 8));
  mainWin.setPosition(x, y);
}

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) createMainWindow();
  if (!mainWin.isVisible()) positionMainWindow();
  mainWin.show();
  mainWin.focus();
}

function sendToRenderer(channel, payload) {
  if (!mainWin || mainWin.isDestroyed()) return;
  const doSend = () => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send(channel, payload);
  if (mainWin.webContents.isLoading()) mainWin.webContents.once('did-finish-load', doSend);
  else doSend();
}

/* ---------------------------- 划词 -> 翻译 --------------------------- */

async function triggerGrab() {
  if (busy) return;
  busy = true;
  try {
    // 若窗口正显示，先让出焦点，保证 Ctrl+C 发到用户原本的应用
    if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
      mainWin.hide();
      await sleep(90);
    }

    const { text, hadSelection } = await grabSelectedText();

    showMainWindow();
    if (text) {
      sendToRenderer('do-translate', { text, fromSelection: hadSelection });
    } else {
      sendToRenderer('focus-input', {});
    }
  } catch (err) {
    showMainWindow();
    sendToRenderer('app-error', { message: err.message });
  } finally {
    busy = false;
  }
}

/* ------------------------------ 托盘 -------------------------------- */

const fmtAccel = (a) => String(a || '').replace(/CommandOrControl/g, 'Ctrl');

function trayTooltip(cfg) {
  return [
    '快捷翻译',
    `划词翻译：${fmtAccel(cfg.shortcut)}`,
    `截图翻译：${fmtAccel(cfg.captureShortcut)}`,
  ].join('\n');
}

function trayMenu() {
  const cfg = config.get();
  return Menu.buildFromTemplate([
    { label: `截图翻译…\t${fmtAccel(cfg.captureShortcut)}`, click: () => triggerCapture() },
    { label: `抓取选中文字并翻译\t${fmtAccel(cfg.shortcut)}`, click: () => triggerGrab() },
    { label: '翻译剪贴板内容', click: () => translateClipboard() },
    { type: 'separator' },
    { label: '显示翻译窗口', click: () => showMainWindow() },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  let img = nativeImage.createFromPath(TRAY_ICON);
  if (img.isEmpty()) img = nativeImage.createFromPath(ICON);
  tray = new Tray(img);
  tray.setToolTip(trayTooltip(config.get()));
  tray.setContextMenu(trayMenu());
  tray.on('click', () => {
    if (mainWin && mainWin.isVisible()) mainWin.hide();
    else showMainWindow();
  });
  tray.on('right-click', () => tray.setContextMenu(trayMenu()));
}

async function translateClipboard() {
  const text = clipboard.readText().trim();
  showMainWindow();
  if (text) sendToRenderer('do-translate', { text, fromSelection: false });
  else sendToRenderer('focus-input', {});
}

/* ---------------------------- 设置窗口 ------------------------------ */

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 580,
    height: 660,
    title: '快捷翻译 · 设置',
    icon: ICON,
    resizable: true,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

/* --------------------------- 全局快捷键 ----------------------------- */

function registerShortcuts(cfg) {
  globalShortcut.unregisterAll();
  const results = {};

  const bind = (accel, handler) => {
    if (!accel) return true;
    try {
      const ok = globalShortcut.register(accel, handler);
      if (!ok) console.warn('[快捷键] 注册失败，可能已被占用:', accel);
      return ok;
    } catch (err) {
      console.error('[快捷键] 无效:', err.message);
      return false;
    }
  };

  results.shortcut = bind(cfg.shortcut, () => triggerGrab());
  results.capture = bind(cfg.captureShortcut, () => triggerCapture());
  return results;
}

/* ----------------------------- 截图翻译 ----------------------------- */

async function triggerCapture() {
  if (busy || isCapturing()) return;
  busy = true;
  const cfg = config.get();

  try {
    // 遮罩期间主窗口要让开，免得挡住要截的内容
    if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) mainWin.hide();

    const shot = await startCapture();
    if (!shot) return;                       // 用户按 Esc / 右键取消

    // 必须等遮罩真正从屏幕上消失，否则会把遮罩自己截进去
    await sleep(240);

    let image;
    try {
      image = await captureRegion(shot.display, shot.rect);
    } catch (err) {
      showMainWindow();
      sendToRenderer('capture-error', { message: err.message });
      return;
    }

    const tmp = path.join(os.tmpdir(), `qt-shot-${process.pid}-${Date.now()}.png`);
    fs.writeFileSync(tmp, image.toPNG());

    showMainWindow();
    sendToRenderer('capture-status', { message: '正在识别截图中的文字…' });

    try {
      if (cfg.ocrEngine === 'vision') {
        const v = await visionTranslate(tmp, cfg.llm, cfg.to, cfg.autoSwap);
        const src = v.text ? detectLang(v.text) : null;
        sendToRenderer('capture-result', {
          text: v.text,
          result: {
            text: v.translation,
            engine: v.engine,
            from: src, to: cfg.to,
            fromName: src ? langName(src) : '截图',
            toName: langName(cfg.to),
          },
        });
      } else {
        const ocr = await runWindowsOcr(tmp, cfg.ocrLang);
        if (!ocr.text.trim()) {
          sendToRenderer('capture-empty', {});
          return;
        }
        const result = await translate({
          text: ocr.text,
          from: cfg.from,
          to: cfg.to,
          engine: cfg.engine,
          autoSwap: cfg.autoSwap,
          llm: cfg.llm,
        });
        result.engine = `${ocr.engine} → ${result.engine}`;
        sendToRenderer('capture-result', { text: ocr.text, result });
      }
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    }
  } catch (err) {
    showMainWindow();
    sendToRenderer('capture-error', { message: err.message });
  } finally {
    busy = false;
  }
}

/* ------------------------------ IPC -------------------------------- */

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function registerIpc() {
  ipcMain.handle('translate', async (_e, opts) => {
    const cfg = config.get();
    return translate({
      text: opts.text,
      from: opts.from || cfg.from,
      to: opts.to || cfg.to,
      engine: opts.engine || cfg.engine,
      autoSwap: cfg.autoSwap,
      llm: cfg.llm,
    });
  });

  ipcMain.handle('config:get', () => config.get());

  ipcMain.handle('config:save', (_e, patch) => {
    const prev = config.get();
    const shortcutChanged = patch && (
      (patch.shortcut && patch.shortcut !== prev.shortcut) ||
      (patch.captureShortcut && patch.captureShortcut !== prev.captureShortcut)
    );
    const saved = config.save(patch);
    // 返回副本，避免把运行期状态写进持久化配置
    const out = Object.assign({}, saved);

    if (shortcutChanged) {
      const r = registerShortcuts(saved);
      if (!r.shortcut) out.shortcutError = true;
      if (!r.capture) out.captureShortcutError = true;
    }
    if (tray) tray.setToolTip(trayTooltip(saved));
    broadcast('config:changed', out);
    return out;
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });

  ipcMain.handle('window:hide', () => { if (mainWin && !mainWin.isDestroyed()) mainWin.hide(); });
  ipcMain.handle('window:show', () => showMainWindow());

  ipcMain.handle('window:resize-start', (_e, edge) => {
    if (!mainWin || mainWin.isDestroyed() || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return false;
    const bounds = mainWin.getBounds();
    const display = screen.getDisplayMatching(bounds);
    resizeDrag = { edge, bounds, area: display.workArea };
    return true;
  });
  ipcMain.handle('window:resize-move', (_e, dx, dy) => {
    if (!mainWin || mainWin.isDestroyed() || !resizeDrag) return;
    const { edge, bounds: b, area: a } = resizeDrag;
    dx = Math.round(Number(dx) || 0);
    dy = Math.round(Number(dy) || 0);
    const minW = 360, minH = 300;
    let left = b.x, top = b.y, right = b.x + b.width, bottom = b.y + b.height;
    if (edge.includes('w')) left = Math.max(a.x + 4, Math.min(b.x + dx, right - minW));
    if (edge.includes('e')) right = Math.min(a.x + a.width - 4, Math.max(b.x + minW, right + dx));
    if (edge.includes('n')) top = Math.max(a.y + 4, Math.min(b.y + dy, bottom - minH));
    if (edge.includes('s')) bottom = Math.min(a.y + a.height - 4, Math.max(b.y + minH, bottom + dy));
    mainWin.setBounds({ x: left, y: top, width: right - left, height: bottom - top });
  });
  ipcMain.handle('window:resize-end', () => { resizeDrag = null; });

  ipcMain.handle('grab', () => grabSelectedText());
  ipcMain.handle('grab:translate', () => triggerGrab());

  ipcMain.handle('capture:submit', (_e, rect) => { finishCapture(rect); return true; });
  ipcMain.handle('capture:cancel', () => { finishCapture(null); return true; });
  ipcMain.handle('capture:translate', () => triggerCapture());
  ipcMain.handle('settings:open', () => { openSettings(); });
  ipcMain.handle('app:quit', () => { app.isQuitting = true; app.quit(); });
  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('autostart:set', (_e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on });
    return app.getLoginItemSettings().openAtLogin;
  });
}

/* ----------------------------- 生命周期 ----------------------------- */

app.whenReady().then(() => {
  if (selftestArg) return runOcrSelftest(selftestArg.split('=')[1]);

  registerIpc();
  createMainWindow();
  createTray();
  registerShortcuts(config.get());

  // 手动启动时把窗口亮出来（开机自启则安静驻留托盘）。
  let openedAtLogin = false;
  try { openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin; } catch (_) { /* ignore */ }
  if (!openedAtLogin) {
    mainWin.webContents.once('did-finish-load', () => setTimeout(showMainWindow, 250));
  }

  app.on('activate', () => showMainWindow());
});

app.on('window-all-closed', () => {
  // 常驻托盘，不随窗口关闭而退出
});

app.on('before-quit', () => { app.isQuitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  disposeSelection();
  finishCapture(null);   // 关掉可能还开着的框选遮罩
});
