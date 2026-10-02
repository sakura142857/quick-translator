'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chatCompletionsUrl, langName, detectLang } = require('./translator');

/**
 * 打包后代码在 app.asar 里，而 powershell.exe 无法读取 asar 虚拟路径，
 * 所以 ocr.ps1 通过 asarUnpack 解包到 app.asar.unpacked 下。
 *
 * 注意：Electron 的 fs 对 asar 内的路径同样返回 exists=true，
 * 因此**必须把解包路径排在前面**，否则会选中 PowerShell 读不了的那个。
 */
function ocrScriptCandidates() {
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'ocr.ps1')
    : '';
  const dev = path.join(__dirname, '..', 'scripts', 'ocr.ps1');
  return unpacked ? [unpacked, dev] : [dev];
}

function resolveOcrScript() {
  const candidates = ocrScriptCandidates();
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
  }
  return candidates[0];
}

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
// 除了 CJK 标点区，还要覆盖间隔号(·)、破折号、省略号、中英文引号等
const CJK_PUNCT = '\\u00b7\\u2010-\\u2027\\u2030-\\u205e\\u3000-\\u303f\\uff00-\\uffef';

/**
 * Windows OCR 会把中文逐字拆开并插入空格（「快 捷 翻 译」），
 * 这里把汉字之间、汉字与中文标点之间的空格去掉。
 */
function normalizeOcrText(raw) {
  let t = String(raw || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < 5; i++) {
    const before = t;
    t = t.replace(new RegExp(`([${CJK}])[ \\t]+([${CJK}${CJK_PUNCT}])`, 'g'), '$1$2');
    t = t.replace(new RegExp(`([${CJK_PUNCT}])[ \\t]+([${CJK}])`, 'g'), '$1$2');
    if (t === before) break;
  }
  return t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------------- Windows 自带 OCR（离线免费） ---------------------- */

function runWindowsOcr(imagePath, lang) {
  // WinRT 的 GetFileFromPathAsync 不接受正斜杠，必须用平台原生分隔符
  const image = path.resolve(String(imagePath || ''));
  const outFile = path.join(os.tmpdir(), `qt-ocr-${process.pid}-${Date.now()}.json`);
  const script = resolveOcrScript();

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-ImagePath', image,
      '-OutFile', outFile,
      '-Lang', lang || 'zh-Hans-CN',
    ], { windowsHide: true, timeout: 25000 }, (err) => {
      let data = null;
      try { data = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (_) { /* ignore */ }
      try { fs.unlinkSync(outFile); } catch (_) { /* ignore */ }

      if (data && data.ok) {
        return resolve({
          text: normalizeOcrText(data.text),
          engine: `Windows OCR (${data.engine})`,
        });
      }
      reject(new Error((data && data.error) || (err && err.message) || 'OCR 识别失败'));
    });
  });
}

/* ------------------------ 视觉模型（更准，走 API） ------------------------ */

function buildVisionPrompt(to, autoSwap) {
  const target = langName(to);
  return [
    '这是一张屏幕截图。请完成两件事：',
    `1. 识别图中所有可见文字，保留原有换行；代码、命令、函数名、URL、专有名词原样保留。`,
    `2. 把这些文字翻译成${target}。` +
      (autoSwap ? `如果图中文字本身已经是${target}，就翻译成英文。` : ''),
    '若图中没有文字，text 与 translation 都返回空字符串。',
    '',
    '只输出一个 JSON 对象，不要 Markdown 代码块、不要额外说明：',
    '{"text":"识别到的原文","translation":"译文"}',
  ].join('\n');
}

function parseVisionReply(reply) {
  const raw = String(reply || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;
  const braced = /\{[\s\S]*\}/.exec(candidate);
  if (braced) {
    try {
      const obj = JSON.parse(braced[0]);
      if (obj && typeof obj === 'object') {
        return {
          text: String(obj.text || '').trim(),
          translation: String(obj.translation || obj.trans || '').trim(),
        };
      }
    } catch (_) { /* 落到下面的兜底 */ }
  }
  // 模型没按格式返回时，把整段当作译文，至少不让功能失效
  return { text: '', translation: raw };
}

async function visionTranslate(imagePath, llm, to, autoSwap) {
  if (!llm || !llm.apiKey) throw new Error('视觉识别需要先配置大模型 API Key');
  if (!String(llm.model || '').trim()) throw new Error('请在设置中填写支持看图的模型 ID');

  const base64 = fs.readFileSync(imagePath).toString('base64');
  const res = await fetch(chatCompletionsUrl(llm.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llm.apiKey}`,
    },
    body: JSON.stringify({
      model: llm.model.trim(),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildVisionPrompt(to, autoSwap !== false) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
        ],
      }],
      temperature: 0,
      stream: false,
    }),
    signal: AbortSignal.timeout(llm.timeout || 60000),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = (err.error && err.error.message) || err.message || detail;
    } catch (_) { /* ignore */ }
    throw new Error(detail);
  }

  const data = await res.json();
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) throw new Error('模型未返回内容');

  const parsed = parseVisionReply(content);
  if (!parsed.translation && !parsed.text) throw new Error('图中没有识别到文字');
  return Object.assign(parsed, { engine: `AI 视觉 · ${llm.model.trim()}` });
}

/** 视觉模式下没走 OCR，用译文/原文猜一下源语言用于展示 */
function guessSource(text, fallback) {
  return detectLang(text) || fallback;
}

module.exports = {
  runWindowsOcr, visionTranslate, normalizeOcrText, parseVisionReply, guessSource,
  resolveOcrScript, ocrScriptCandidates,
};
