'use strict';

const $ = (id) => document.getElementById(id);

const LANGS = [
  ['auto', '自动检测'],
  ['zh-CN', '中文(简体)'],
  ['zh-TW', '中文(繁体)'],
  ['en', '英语'],
  ['ja', '日语'],
  ['ko', '韩语'],
  ['fr', '法语'],
  ['de', '德语'],
  ['es', '西班牙语'],
  ['ru', '俄语'],
];

const PRESETS = [
  { name: 'VibeAPI 中转站', baseUrl: 'https://www.vibeapi.cn/v1', model: '' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '通义千问（阿里云）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '自定义', baseUrl: '', model: '' },
];

const COLOR_PRESETS = [
  { name: '纯白', value: '#ffffff' },
  { name: '浅灰', value: '#f1f2f6' },
  { name: '米色', value: '#f7f3ea' },
  { name: '淡紫', value: '#f4f1ff' },
  { name: '雾蓝', value: '#edf3fa' },
  { name: '深灰', value: '#242733' },
  { name: '纯黑', value: '#101216' },
];

const MOD_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'OS'];const KEY_ALIAS = {
  ' ': 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Enter: 'Return', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete',
  Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

let cfg = null;
let savedTimer = null;

/* ------------------------------ 提示 -------------------------------- */

/** 把 Electron accelerator 转成用户友好的显示形式 */
function formatAccel(accel) {
  return String(accel || '')
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Command|Cmd/g, 'Ctrl')
    .replace(/Super/g, 'Win')
    .replace(/Return/g, 'Enter');
}

function flashSaved() {
  const el = $('savedTip');
  el.textContent = '已保存 ✓';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

async function save(patch, silent) {
  cfg = await window.qt.saveConfig(patch);
  if (!silent) flashSaved();
  return cfg;
}

/* ------------------------------ 填充 -------------------------------- */

function fillLangs() {
  for (const [v, n] of LANGS) $('from').append(new Option(n, v));
  for (const [v, n] of LANGS) if (v !== 'auto') $('to').append(new Option(n, v));
}

function fillPresets() {
  for (const p of PRESETS) $('preset').append(new Option(p.name, p.name));
}

/* ------------------------------ 窗口配色 ------------------------------ */

function normalizeHex(input) {
  const s = String(input || '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return /^[0-9a-f]{6}$/i.test(full) ? '#' + full.toLowerCase() : null;
}

function renderSwatches() {
  const box = $('swatches');
  box.innerHTML = '';
  for (const p of COLOR_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = p.value;
    b.title = p.name;
    b.style.background = p.value;
    // 浅色块上用深色对勾，否则白色对勾看不见
    const n = parseInt(p.value.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    b.style.setProperty('--swatch-check', lum < 0.55 ? '#ffffff' : '#1f2430');
    b.addEventListener('click', () => setWindowColor(p.value));
    box.appendChild(b);
  }
}

function markSwatches(color) {
  document.querySelectorAll('.swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.color === color);
  });
}

async function setWindowColor(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return;
  $('colorPicker').value = norm;
  $('colorHex').value = norm;
  markSwatches(norm);
  await save({ windowColor: norm });
}

function renderEngine() {
  document.querySelectorAll('#engineSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.engine === cfg.engine);
  });
  $('llmBox').hidden = cfg.engine !== 'llm';
  $('engineTip').textContent = cfg.engine === 'llm'
    ? '使用你配置的大模型翻译，质量最好，适合长句、专业术语与语境理解。'
    : '使用免费公共接口，开箱即用、无需配置；偶发限流时会自动切换备用源。';
}

function renderOcr() {
  document.querySelectorAll('#ocrSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.ocr === (cfg.ocrEngine || 'windows'));
  });
  const vision = cfg.ocrEngine === 'vision';
  $('ocrLangRow').hidden = vision;
  $('ocrTip').textContent = vision
    ? '把截图直接交给支持看图的模型识别并翻译。准确率最高，能应付字幕、艺术字和复杂排版，但需要配置大模型 API，每次会消耗 token。'
    : '使用 Windows 自带的离线识别，免费、不联网、速度快。小字号或复杂背景下识别率一般，遇到不准可以切到「AI 视觉识别」。';
}

function syncUI() {
  if (recorders.shortcut) recorders.shortcut.accel = cfg.shortcut || '';
  if (recorders.captureShortcut) recorders.captureShortcut.accel = cfg.captureShortcut || '';
  $('shortcut').value = formatAccel(cfg.shortcut);
  $('captureShortcut').value = formatAccel(cfg.captureShortcut);
  $('ocrLang').value = cfg.ocrLang || 'zh-Hans-CN';
  $('from').value = cfg.from || 'auto';
  $('to').value = cfg.to || 'zh-CN';
  $('autoSwap').checked = cfg.autoSwap !== false;
  $('autoHide').checked = cfg.autoHide !== false;
  $('baseUrl').value = (cfg.llm && cfg.llm.baseUrl) || '';
  $('apiKey').value = (cfg.llm && cfg.llm.apiKey) || '';
  $('model').value = (cfg.llm && cfg.llm.model) || '';

  const matched = PRESETS.find((p) => p.baseUrl && p.baseUrl === $('baseUrl').value);
  $('preset').value = matched ? matched.name : '自定义';

  const wc = normalizeHex(cfg.windowColor) || '#ffffff';
  $('colorPicker').value = wc;
  $('colorHex').value = wc;
  markSwatches(wc);

  renderEngine();
  renderOcr();
}

/* ---------------------------- 快捷键录制 ----------------------------- */

const recorders = {};

function showWarn(id, text) {
  const el = $(id);
  el.hidden = false;
  el.textContent = text;
}

/** id: 输入框；key: 配置字段名；warnId: 提示元素 */
function bindShortcutRecorder(id, key, warnId) {
  const el = $(id);
  const state = { accel: '' };
  recorders[id] = state;

  el.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (MOD_KEYS.includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Super');

    if (!parts.length) {
      showWarn(warnId, '请至少搭配一个修饰键（Ctrl / Alt / Shift）。');
      return;
    }

    let k = e.key;
    if (KEY_ALIAS[k]) k = KEY_ALIAS[k];
    else if (k.length === 1) k = k.toUpperCase();

    const accel = parts.concat(k).join('+');
    state.accel = accel;
    el.value = formatAccel(accel);
    el.blur();
    $(warnId).hidden = true;

    save({ [key]: accel }).then((c) => {
      const errField = key === 'shortcut' ? 'shortcutError' : 'captureShortcutError';
      if (c && c[errField]) {
        showWarn(warnId, '该快捷键注册失败，可能已被其他程序占用，请换一个。');
      }
    });
  });

  el.addEventListener('focus', () => { el.value = ''; el.placeholder = '请按下组合键…'; });
  el.addEventListener('blur', () => {
    el.placeholder = '点击后按下组合键';
    if (!el.value) el.value = formatAccel(state.accel);
  });
}

/* ---------------------------- 事件绑定 ------------------------------- */

function bind() {
  bindShortcutRecorder('shortcut', 'shortcut', 'shortcutWarn');
  bindShortcutRecorder('captureShortcut', 'captureShortcut', 'captureShortcutWarn');

  document.querySelectorAll('#ocrSeg button').forEach((b) => {
    b.addEventListener('click', async () => {
      cfg = await save({ ocrEngine: b.dataset.ocr });
      renderOcr();
    });
  });
  $('ocrLang').addEventListener('change', () => save({ ocrLang: $('ocrLang').value }));

  document.querySelectorAll('#engineSeg button').forEach((b) => {
    b.addEventListener('click', async () => {
      cfg = await save({ engine: b.dataset.engine });
      renderEngine();
    });
  });

  $('preset').addEventListener('change', async () => {
    const p = PRESETS.find((x) => x.name === $('preset').value);
    if (!p || !p.baseUrl) return;
    $('baseUrl').value = p.baseUrl;
    $('model').value = p.model;
    $('model').placeholder = p.model || '填入你在 VibeAPI 控制台可用的模型 ID';
    await save({ llm: { baseUrl: p.baseUrl, model: p.model } });
  });

  const llmSave = async () => {
    await save({
      llm: {
        baseUrl: $('baseUrl').value.trim(),
        apiKey: $('apiKey').value.trim(),
        model: $('model').value.trim(),
      },
    });
    const matched = PRESETS.find((p) => p.baseUrl && p.baseUrl === $('baseUrl').value.trim());
    $('preset').value = matched ? matched.name : '自定义';
  };
  ['baseUrl', 'apiKey', 'model'].forEach((id) => $(id).addEventListener('change', llmSave));

  $('btnTest').addEventListener('click', async () => {
    const r = $('testResult');
    r.className = 'test-result';
    r.textContent = '测试中…';
    try {
      await llmSave();
      const res = await window.qt.translate({
        text: 'Hello, world!',
        from: 'en',
        to: 'zh-CN',
        engine: 'llm',
      });
      r.className = 'test-result ok';
      r.textContent = '连接成功 → ' + res.text;
    } catch (e) {
      r.className = 'test-result bad';
      r.textContent = '失败：' + (e && e.message ? e.message : e);
    }
  });

  $('from').addEventListener('change', () => save({ from: $('from').value }));
  $('to').addEventListener('change', () => save({ to: $('to').value }));
  $('colorPicker').addEventListener('input', () => setWindowColor($('colorPicker').value));
  $('colorHex').addEventListener('change', () => {
    const norm = normalizeHex($('colorHex').value);
    if (norm) setWindowColor(norm);
    else $('colorHex').value = normalizeHex(cfg.windowColor) || '#ffffff';
  });
  $('autoSwap').addEventListener('change', () => save({ autoSwap: $('autoSwap').checked }));
  $('autoHide').addEventListener('change', () => save({ autoHide: $('autoHide').checked }));
  $('autostart').addEventListener('change', async () => {
    const on = await window.qt.setAutostart($('autostart').checked);
    $('autostart').checked = on;
    flashSaved();
  });

  $('btnQuit').addEventListener('click', () => window.qt.quit());
  $('btnClose').addEventListener('click', () => window.close());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });
}

/* ------------------------------ 启动 -------------------------------- */

(async function start() {
  cfg = await window.qt.getConfig();
  fillLangs();
  fillPresets();
  renderSwatches();
  syncUI();
  bind();
  $('autostart').checked = await window.qt.getAutostart();
})();
