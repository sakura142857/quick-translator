'use strict';

// 在真实前台窗口里模拟按住快捷键触发全局快捷键，验证：
// 1) 新默认 Alt+W 能注册且能抓到选中文字
// 2) 旧组合 Ctrl+Shift+D 仍可用（回归）
// 3) 按键未松开时不会误发 Ctrl+Shift+C，也不会拿旧剪贴板冒充选区
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, BrowserWindow, clipboard, globalShortcut } = require('electron');
const { grabSelectedText, dispose } = require('../src/selection');

app.on('window-all-closed', () => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const COMBOS = [
  { accel: 'Alt+W', mods: [0x12], key: 0x57, label: '新默认 Alt+W' },
  { accel: 'CommandOrControl+Shift+D', mods: [0x11, 0x10], key: 0x44, label: '旧组合 Ctrl+Shift+D' },
];

function typeShortcut(mods, key) {
  const down = mods.map((m) => `keybd_event(${m},0,0,UIntPtr.Zero);`).join(' ');
  const up = mods.slice().reverse().map((m) => `keybd_event(${m},0,2,UIntPtr.Zero);`).join(' ');
  const script = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Threading;',
    'public class ShortcutTest {',
    '[DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,UIntPtr p);',
    `public static void Send() { ${down} keybd_event(${key},0,0,UIntPtr.Zero); Thread.Sleep(250);`,
    `keybd_event(${key},0,2,UIntPtr.Zero); ${up} }}`,
  ].join(' ');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Add-Type -TypeDefinition '${script}'; [ShortcutTest]::Send()`],
    { windowsHide: true, timeout: 8000 }, (err) => err ? reject(err) : resolve());
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 250 });
  await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent('<textarea style="width:100%;height:100px">Shortcut selection capture works</textarea>'));
  win.show(); win.focus();

  for (const combo of COMBOS) {
    // 每次都要重新确保窗口在前台，否则模拟的按键会打到别处
    win.show();
    win.focus();
    await wait(400);
    assert.ok(win.isFocused(), '测试窗口必须在前台，否则按键会落空');

    await win.webContents.executeJavaScript('document.querySelector("textarea").focus();document.querySelector("textarea").select()');
    await wait(400);
    clipboard.writeText('Old text must never be used');

    let called = 0, result;
    const ok = globalShortcut.register(combo.accel, () => {
      called++;
      grabSelectedText().then((r) => { result = r; }).catch((e) => { console.error(e); });
    });
    assert.ok(ok, `${combo.label} 注册失败：可能被其它程序占用`);

    await typeShortcut(combo.mods, combo.key);
    for (let i = 0; i < 90 && !result; i++) await wait(80);

    assert.equal(called, 1, `${combo.label} 应触发一次`);
    assert.deepEqual(result, { text: 'Shortcut selection capture works', hadSelection: true },
      `${combo.label} 应抓到选中文字，实际 ${JSON.stringify(result)}`);
    assert.equal(clipboard.readText(), 'Old text must never be used', `${combo.label} 之后剪贴板应还原`);

    globalShortcut.unregisterAll();
    console.log(`${combo.label}：注册、抓取、剪贴板还原均通过`);
  }

  dispose(); win.destroy(); app.quit();
}).catch((e) => { console.error(e); globalShortcut.unregisterAll(); dispose(); app.exit(1); });
