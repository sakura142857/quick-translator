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

let cfg = null;
let lastResult = null;
let inflight = 0;

/* ------------------------------ 窗口配色 ------------------------------ */

function hexToRgb(hex) {
  const s = String(hex || '').trim().replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** 按背景色亮度挑一套可读的前景/描边色，深色底自动切浅色字 */
function paletteFor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.55) {
    return {
      '--card-border': 'rgba(255,255,255,.18)',
      '--card-shadow': '0 2px 12px rgba(0,0,0,.45)',
      '--text': '#f0f2f8',
      '--muted': '#adb2c4',
      '--faint': '#828899',
      '--border': 'rgba(255,255,255,.15)',
      '--border-strong': 'rgba(255,255,255,.30)',
      '--soft': 'rgba(255,255,255,.10)',
      '--field-bg': 'rgba(255,255,255,.07)',
      '--result-bg': 'rgba(255,255,255,.05)',
      '--pill-bg': 'rgba(255,255,255,.12)',
      '--pill-border': 'rgba(255,255,255,.22)',
      '--scroll-thumb': 'rgba(255,255,255,.24)',
      '--grip': 'rgba(255,255,255,.50)',
      '--hover-danger': 'rgba(255,120,120,.20)',
      '--danger': '#ff9b9b',
    };
  }
  return {
    '--card-border': 'rgba(20,24,48,.14)',
    '--card-shadow': '0 2px 10px rgba(20,24,48,.08)',
    '--text': '#1f2430',
    '--muted': '#6b7280',
    '--faint': '#a3a9b8',
    '--border': 'rgba(20,24,48,.10)',
    '--border-strong': 'rgba(20,24,48,.22)',
    '--soft': 'rgba(20,24,48,.05)',
    '--field-bg': 'rgba(20,24,48,.035)',
    '--result-bg': 'rgba(20,24,48,.025)',
    '--pill-bg': 'rgba(99,102,241,.10)',
    '--pill-border': 'rgba(99,102,241,.22)',
    '--scroll-thumb': 'rgba(20,24,48,.16)',
    '--grip': 'rgba(20,24,48,.28)',
    '--hover-danger': 'rgba(220,76,76,.14)',
    '--danger': '#dc4c4c',
  };
}

function applyTheme() {
  const bg = (cfg && cfg.windowColor) || '#ffffff';
  const root = document.documentElement;
  root.style.setProperty('--card-bg', bg);
  const palette = paletteFor(bg);
  for (const key of Object.keys(palette)) root.style.setProperty(key, palette[key]);
}

/* ------------------------------ 初始化 ------------------------------ */

function fillLangs() {
  const fromSel = $('selFrom');
  const toSel = $('selTo');
  for (const [v, n] of LANGS) fromSel.append(new Option(n, v));
  for (const [v, n] of LANGS) if (v !== 'auto') toSel.append(new Option(n, v));
}

function syncUI() {
  $('selFrom').value = cfg.from || 'auto';
  $('selTo').value = cfg.to || 'zh-CN';
  $('enginePill').textContent =
    cfg.engine === 'llm' ? `AI · ${(cfg.llm && cfg.llm.model) || 'llm'}` : '免费接口';
  $('enginePill').title = '当前引擎，点击切换';
}

/* ------------------------------ 窗口拉伸 ------------------------------ */

function bindResizeHandles() {
  for (const grip of document.querySelectorAll('.resize-edge')) {
    grip.addEventListener('pointerdown', async (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.screenX, startY = event.screenY;
      // 必须在同步的 pointerdown 中捕获指针，异步 IPC 之后才捕获会丢失拖拽。
      grip.setPointerCapture(event.pointerId);
      const accepted = await window.qt.resizeStart(grip.dataset.edge);
      if (!accepted) { grip.releasePointerCapture(event.pointerId); return; }
      const move = (e) => window.qt.resizeMove(e.screenX - startX, e.screenY - startY);
      const stop = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', stop);
        grip.removeEventListener('pointercancel', stop);
        window.qt.resizeEnd();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', stop);
      grip.addEventListener('pointercancel', stop);
    });
  }
}

/* ------------------------------ 渲染 -------------------------------- */

function setLoading(on) {
  $('btnTranslate').disabled = on;
  $('btnTranslate').textContent = on ? '翻译中…' : '翻译';
  if (on) $('meta').textContent = '翻译中…';
}

function renderResult(res) {
  const box = $('result');
  box.textContent = res.text;
  $('meta').textContent =
    `${res.engine} · ${res.fromName} → ${res.toName}` +
    (res.cached ? ' · 缓存' : '') +
    (res.retried ? ' · 已自动重试' : '');
}

function renderError(msg) {
  const box = $('result');
  box.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'err';
  d.textContent = '⚠ ' + msg;
  box.appendChild(d);
  $('meta').textContent = '翻译失败';
}

function showPlaceholder(msg) {
  const box = $('result');
  box.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'placeholder';
  d.textContent = msg || '译文会显示在这里';
  box.appendChild(d);
  $('meta').textContent = '';
}

/* ------------------------------ 翻译 -------------------------------- */

async function doTranslate(text) {
  const src = (text !== undefined ? text : $('source').value).trim();
  if (!src) {
    showPlaceholder('请输入文字，或选中任意位置文字后按快捷键抓取');
    return;
  }
  const my = ++inflight;
  setLoading(true);
  try {
    const res = await window.qt.translate({
      text: src,
      from: $('selFrom').value,
      to: $('selTo').value,
      engine: cfg.engine,
    });
    if (my !== inflight) return;
    lastResult = res;
    renderResult(res);
  } catch (err) {
    if (my !== inflight) return;
    renderError(err && err.message ? err.message : String(err));
  } finally {
    if (my === inflight) setLoading(false);
  }
}

/* ------------------------------ 功能按钮 ----------------------------- */

async function copyResult() {
  if (!lastResult || !lastResult.text) return;
  await window.qt.writeClipboard(lastResult.text);
  const btn = $('btnCopy');
  const old = btn.textContent;
  btn.textContent = '已复制 ✓';
  setTimeout(() => { btn.textContent = old; }, 1200);
}

function speakResult() {
  if (!lastResult || !lastResult.text) return;
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(lastResult.text);
  const lang = (lastResult.to || 'en').toLowerCase();
  u.lang = lang.startsWith('zh') ? 'zh-CN' : lang.slice(0, 2) + '-' + lang.slice(0, 2).toUpperCase();
  const voice = speechSynthesis.getVoices().find(
    (v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2))
  );
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

async function pasteFromClipboard() {
  const text = await window.qt.readClipboard();
  if (text) {
    $('source').value = text;
    doTranslate(text);
  }
}

function clearAll() {
  inflight++;                    // 让仍在途的翻译结果作废
  lastResult = null;
  $('source').value = '';
  showPlaceholder('译文会显示在这里');
  $('source').focus();
}

async function swapLangs() {
  const from = $('selFrom').value;
  const to = $('selTo').value;
  if (from === 'auto') {
    $('selFrom').value = to;
    $('selTo').value = to.startsWith('zh') ? 'en' : 'zh-CN';
  } else {
    $('selFrom').value = to;
    $('selTo').value = from;
  }
  cfg = await window.qt.saveConfig({ from: $('selFrom').value, to: $('selTo').value });
}

async function toggleEngine() {
  const next = cfg.engine === 'llm' ? 'free' : 'llm';
  if (next === 'llm' && (!cfg.llm || !cfg.llm.apiKey)) {
    renderError('还没有配置大模型 API Key，已为你打开设置。填好后即可切换到 AI 翻译。');
    window.qt.openSettings();
    return;
  }
  cfg = await window.qt.saveConfig({ engine: next });
  syncUI();
  if (lastResult) doTranslate();
}

/* ------------------------------ 事件绑定 ----------------------------- */

function bind() {
  $('btnTranslate').addEventListener('click', () => doTranslate());
  $('btnCapture').addEventListener('click', () => window.qt.captureTranslate());
  $('btnCopy').addEventListener('click', copyResult);
  $('btnSpeak').addEventListener('click', speakResult);
  $('btnPaste').addEventListener('click', pasteFromClipboard);
  $('btnClear').addEventListener('click', clearAll);
  $('btnSwap').addEventListener('click', swapLangs);
  $('btnSettings').addEventListener('click', () => window.qt.openSettings());
  $('btnClose').addEventListener('click', () => window.qt.hide());
  $('enginePill').addEventListener('click', toggleEngine);

  $('selFrom').addEventListener('change', async () => {
    cfg = await window.qt.saveConfig({ from: $('selFrom').value });
  });
  $('selTo').addEventListener('change', async () => {
    cfg = await window.qt.saveConfig({ to: $('selTo').value });
  });

  $('source').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doTranslate();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.qt.hide();
  });

  // 主进程推送
  window.qt.on('do-translate', ({ text }) => {
    $('source').value = text || '';
    showPlaceholder('正在翻译…');
    doTranslate(text);
  });
  window.qt.on('focus-input', () => {
    $('source').value = '';
    showPlaceholder('没有抓到选中文字 —— 请先选中文字再按快捷键，或直接在此输入');
    $('source').focus();
  });
  window.qt.on('config:changed', (c) => { cfg = c; syncUI(); applyTheme(); });
  window.qt.on('app-error', ({ message }) => renderError(message));

  // 截图翻译
  window.qt.on('capture-status', ({ message }) => {
    setLoading(true);
    $('meta').textContent = message || '处理中…';
  });
  window.qt.on('capture-result', ({ text, result }) => {
    setLoading(false);
    if (text) $('source').value = text;
    if (result) { lastResult = result; renderResult(result); }
  });
  window.qt.on('capture-empty', () => {
    setLoading(false);
    showPlaceholder('截图里没识别到文字，换个区域再试一次');
  });
  window.qt.on('capture-error', ({ message }) => {
    setLoading(false);
    renderError(message);
  });

  bindResizeHandles();
}

/* ------------------------------ 启动 -------------------------------- */

(async function start() {
  cfg = await window.qt.getConfig();
  applyTheme();
  fillLangs();
  syncUI();
  bind();
  $('source').focus();
})();
