'use strict';

const { BrowserWindow, screen, desktopCapturer } = require('electron');
const path = require('path');

let active = null;   // { win, display, resolve }

const isCapturing = () => !!active;

/**
 * 打开全屏框选遮罩。用户框选完成返回 { rect, display }，
 * 按 Esc 或右键取消返回 null。
 */
function startCapture() {
  if (active) return Promise.resolve(null);

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    active = { win, display, resolve };
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(__dirname, '..', 'renderer', 'capture.html'));
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('closed', () => { if (active && active.win === win) finish(null); });
  });
}

/** rect 为相对遮罩窗口的 CSS 像素；传 null 表示取消 */
function finish(rect) {
  const current = active;
  active = null;
  if (!current) return;
  if (current.win && !current.win.isDestroyed()) current.win.destroy();
  current.resolve(rect ? { rect, display: current.display } : null);
}

/** 抓取指定屏幕区域，返回 nativeImage */
async function captureRegion(display, rect) {
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    },
  });

  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取屏幕画面');

  const shot = source.thumbnail;
  const size = shot.getSize();
  // 缩略图可能被系统缩放，按比例换算裁剪区域
  const rx = size.width / display.size.width;
  const ry = size.height / display.size.height;

  const x = Math.max(0, Math.round(rect.x * rx));
  const y = Math.max(0, Math.round(rect.y * ry));
  const width = Math.min(size.width - x, Math.round(rect.width * rx));
  const height = Math.min(size.height - y, Math.round(rect.height * ry));
  if (width < 2 || height < 2) throw new Error('框选区域太小');

  return shot.crop({ x, y, width, height });
}

module.exports = { startCapture, finish, captureRegion, isCapturing };
