'use strict';

const { spawn, execFile } = require('child_process');
const { clipboard } = require('electron');

const SENTINEL = '\u200b__QT_NO_SELECTION__\u200b';
const DONE_MARK = '__QT_DONE__';
const CMD_TIMEOUT = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let psProc = null;
let psBuf = '';
let pending = null;
let booted = false;

// 全局快捷键 Ctrl+Shift+D 的回调发生时按键往往仍被按住。此时直接
// SendKeys('^c') 等于 Ctrl+Shift+C（浏览器里甚至会打开开发者工具）。
// 必须等 Ctrl / Shift / Alt / D 都弹起后，才发送全新的 Ctrl+C。
const WIN_KEYS = [
  'using System; using System.Runtime.InteropServices; using System.Threading;',
  'public class QuickTranslateKeys {',
  '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);',
  '  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);',
  '  public static bool Copy() {',
  '    int[] keys = new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, 0x44 };',
  '    for (int n = 0; n < 160; n++) {',
  '      bool down = false;',
  '      foreach (int key in keys) if ((GetAsyncKeyState(key) & 0x8000) != 0) { down = true; break; }',
  '      if (!down) break;',
  '      Thread.Sleep(15);',
  '    }',
  '    foreach (int key in keys) if ((GetAsyncKeyState(key) & 0x8000) != 0) return false;',
  '    keybd_event(0x11, 0, 0, UIntPtr.Zero);',
  '    keybd_event(0x43, 0, 0, UIntPtr.Zero);',
  '    keybd_event(0x43, 0, 2, UIntPtr.Zero);',
  '    keybd_event(0x11, 0, 2, UIntPtr.Zero);',
  '    return true;',
  '  }',
  '}',
].join(' ');

function launchPs() {
  if (psProc && !psProc.killed) return psProc;

  psBuf = '';
  booted = false;
  psProc = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', '-'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });

  psProc.stdout.setEncoding('utf8');
  psProc.stdout.on('data', (chunk) => {
    psBuf += chunk;
    const match = psBuf.match(new RegExp(`${DONE_MARK}:(true|false)`, 'i'));
    if (match) {
      psBuf = psBuf.slice(psBuf.indexOf(match[0]) + match[0].length);
      const fn = pending;
      pending = null;
      if (fn) fn(match[1].toLowerCase() === 'true');
    }
    if (psBuf.length > 8192) psBuf = psBuf.slice(-200);
  });

  const onDead = () => {
    const fn = pending;
    pending = null;
    psProc = null;
    booted = false;
    if (fn) fn(false);
  };
  psProc.on('exit', onDead);
  psProc.on('error', onDead);
  psProc.stdin.on('error', onDead);

  // `-Command -` 接受每一行独立命令；用单行 TypeDefinition 避免解析器等待闭合。
  const escaped = WIN_KEYS.replace(/'/g, "''");
  psProc.stdin.write(`Add-Type -TypeDefinition '${escaped}'\n`);
  return psProc;
}

function sendCopyKeyHot() {
  return new Promise((resolve) => {
    const p = launchPs();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    pending = finish;
    try {
      p.stdin.write(`Write-Output ('${DONE_MARK}:' + [QuickTranslateKeys]::Copy())\n`);
    } catch (_) {
      pending = null;
      finish(false);
      return;
    }
    setTimeout(() => {
      if (pending === finish) pending = null;
      finish(false);
    }, CMD_TIMEOUT);
  });
}

function sendCopyKeyCold() {
  return new Promise((resolve) => {
    const escaped = WIN_KEYS.replace(/'/g, "''");
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Add-Type -TypeDefinition '${escaped}'; [QuickTranslateKeys]::Copy()`,
    ], { windowsHide: true, timeout: 7000 }, (err, stdout) => {
      resolve(!err && /true/i.test(stdout));
    });
  });
}

async function sendCopyKey() {
  let ok = await sendCopyKeyHot();
  if (ok) booted = true;
  else {
    dispose();
    ok = await sendCopyKeyCold();
  }
  return ok;
}

/** 关闭常驻 PowerShell，打包版退出时不留下后台进程。 */
function dispose() {
  const p = psProc;
  psProc = null;
  pending = null;
  booted = false;
  if (p && !p.killed) {
    try { p.kill(); } catch (_) { /* ignore */ }
  }
}

/** 还原常见剪贴板格式；没有抓到选中文字时不再拿旧内容冒充新选择。 */
function backupClipboard() {
  const formats = clipboard.availableFormats();
  return {
    text: clipboard.readText(),
    html: formats.includes('text/html') ? clipboard.readHTML() : '',
    rtf: formats.includes('text/rtf') ? clipboard.readRTF() : '',
    image: formats.some((f) => /image|bitmap|dib/i.test(f)) ? clipboard.readImage() : null,
  };
}

function restoreClipboard(saved) {
  const data = {};
  if (saved.text) data.text = saved.text;
  if (saved.html) data.html = saved.html;
  if (saved.rtf) data.rtf = saved.rtf;
  if (saved.image && !saved.image.isEmpty()) data.image = saved.image;
  if (Object.keys(data).length) clipboard.write(data);
  else clipboard.clear();
}

/**
 * 必须在原应用仍是前台窗口时调用；主窗口显示之前抓取。
 * @returns {Promise<{text:string, hadSelection:boolean}>}
 */
async function grabSelectedText() {
  const saved = backupClipboard();
  clipboard.writeText(SENTINEL);

  try {
    const sent = await sendCopyKey();
    if (!sent) return { text: '', hadSelection: false };
    // 复制由目标应用异步执行，短轮询而非固定等待，避免读到旧的哨兵值。
    for (let i = 0; i < 12; i++) {
      await sleep(55);
      const copied = clipboard.readText();
      if (copied && copied !== SENTINEL && copied.trim()) {
        return { text: copied.trim(), hadSelection: true };
      }
    }
    return { text: '', hadSelection: false };
  } finally {
    restoreClipboard(saved);
  }
}

module.exports = { grabSelectedText, dispose };
