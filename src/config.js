'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_VERSION = 2;

// v1 的默认快捷键是 Ctrl+Shift+D，三键跨度过大，已改为更顺手的 Alt+W
// （实测本机 Alt+Q / Alt+Z / Alt+` 已被其它常驻软件占用，故不选）
const LEGACY_DEFAULT_SHORTCUT = 'CommandOrControl+Shift+D';

const DEFAULTS = {
  configVersion: CONFIG_VERSION,
  shortcut: 'Alt+W',
  captureShortcut: 'Alt+S',    // 截图翻译
  ocrEngine: 'windows',        // 'windows' 离线免费 | 'vision' 视觉模型更准
  ocrLang: 'zh-Hans-CN',
  engine: 'free',              // 'free' | 'llm'
  from: 'auto',
  to: 'zh-CN',
  autoSwap: true,              // 原文已是中文时自动改翻英文
  autoHide: true,              // 失焦自动隐藏
  speak: true,                 // 译文旁显示朗读按钮
  windowColor: '#ffffff',      // 浮窗背景色
  opacity: 1,
  fontSize: 15,
  llm: {
    baseUrl: 'https://www.vibeapi.cn/v1',
    apiKey: '',
    model: '',
  },
};

/**
 * 升级旧配置。只在用户**没有改过**快捷键时才替换默认值，
 * 避免覆盖用户自己设定的组合。
 */
function migrate(disk) {
  const out = Object.assign({}, disk || {});
  const untouched = !out.shortcut || out.shortcut === LEGACY_DEFAULT_SHORTCUT;
  if (!out.configVersion && untouched) out.shortcut = DEFAULTS.shortcut;
  out.configVersion = CONFIG_VERSION;
  return out;
}

let cachePath = null;
let cache = null;

function configPath() {
  if (!cachePath) cachePath = path.join(app.getPath('userData'), 'config.json');
  return cachePath;
}

function write(cfg) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('保存配置失败:', e.message);
  }
}

function get() {
  if (cache) return cache;
  let disk = {};
  try {
    disk = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (_) { disk = {}; }

  const migrated = migrate(disk);
  cache = Object.assign({}, DEFAULTS, migrated);
  cache.llm = Object.assign({}, DEFAULTS.llm, migrated.llm || {});

  // 版本升过级就落盘，避免每次启动重算
  if (disk.configVersion !== CONFIG_VERSION) write(cache);
  return cache;
}

function save(patch) {
  const cfg = get();
  if (patch) {
    const previousLlm = cfg.llm;
    Object.assign(cfg, patch);
    if (patch.llm) cfg.llm = Object.assign({}, previousLlm, patch.llm);
  }
  cfg.configVersion = CONFIG_VERSION;
  write(cfg);
  return cfg;
}

module.exports = { get, save, migrate, DEFAULTS, CONFIG_VERSION, configPath };
