'use strict';

/**
 * 打包后精简 Electron 运行时。
 * 体积几乎全在 Electron 上，我们自己的代码只有几十 KB，所以只能从运行时里省。
 */
const fs = require('fs');
const path = require('path');

// 只保留中文和英文界面资源，其余 50 多个语言包可以删掉（缺失时会回退到 en-US）
const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak']);

// 纯法律文本，运行时用不到
const DROP_FILES = ['LICENSES.chromium.html'];

// Electron 自带的示例应用，打包后不会被加载
const DROP_RELATIVE = [path.join('resources', 'default_app.asar')];

function sizeOf(target) {
  try {
    const st = fs.statSync(target);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const name of fs.readdirSync(target)) total += sizeOf(path.join(target, name));
    return total;
  } catch (_) {
    return 0;
  }
}

function remove(target) {
  const before = sizeOf(target);
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return before;
  } catch (_) {
    return 0;
  }
}

const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';

module.exports = async function afterPack(context) {
  const root = context.appOutDir;
  let saved = 0;
  const notes = [];

  // 1. 语言包
  const localesDir = path.join(root, 'locales');
  if (fs.existsSync(localesDir)) {
    let dropped = 0;
    for (const file of fs.readdirSync(localesDir)) {
      if (KEEP_LOCALES.has(file)) continue;
      saved += remove(path.join(localesDir, file));
      dropped++;
    }
    notes.push(`语言包 -${dropped} 个`);
  }

  // 2. 大块无用文件
  for (const rel of DROP_FILES) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) {
      saved += remove(p);
      notes.push(`删除 ${rel}`);
    }
  }

  // 3. 示例应用
  for (const rel of DROP_RELATIVE) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) {
      saved += remove(p);
      notes.push(`删除 ${rel}`);
    }
  }

  console.log(`[afterPack] 精简运行时：释放 ${mb(saved)}（${notes.join('、')}）`);
};
