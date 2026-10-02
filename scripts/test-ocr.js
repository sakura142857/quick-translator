'use strict';

// OCR 文本清洗、视觉回复解析，以及真实 Windows OCR 端到端。
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { normalizeOcrText, parseVisionReply, runWindowsOcr, resolveOcrScript, ocrScriptCandidates } = require('../src/ocr');

/* ---------- 0. 脚本定位 ---------- */

const scriptPath = resolveOcrScript();
assert.ok(fs.existsSync(scriptPath), `OCR 脚本不存在：${scriptPath}`);
// 打包后若选中 asar 内的路径，PowerShell 读不到，OCR 会整个失效
assert.ok(!/[\\/]app\.asar[\\/]/.test(scriptPath),
  `不能把 asar 内的路径交给 PowerShell：${scriptPath}`);
// 解包路径必须排在开发路径前面，否则打包版会选中读不了的 asar 路径
const candidates = ocrScriptCandidates();
assert.ok(candidates.length >= 1);
if (process.resourcesPath) {
  assert.ok(candidates[0].includes('app.asar.unpacked'), '解包路径必须优先');
}

/* ---------- 1. 中文逐字空格清理 ---------- */

assert.equal(normalizeOcrText('快 捷 翻 译 · 设 置'), '快捷翻译·设置');
assert.equal(normalizeOcrText('中 文 〔 简 体 ）'), '中文〔简体）');
assert.equal(normalizeOcrText('使 用 npm 安 装 依 赖'), '使用 npm 安装依赖',
  '中英之间的空格要保留，否则英文单词会被粘在一起');
assert.equal(normalizeOcrText('Hello World'), 'Hello World', '纯英文不应被改动');
assert.equal(normalizeOcrText('npm install express --save'), 'npm install express --save');
assert.equal(normalizeOcrText('第一行\n\n\n\n第二行'), '第一行\n\n第二行', '多余空行要压缩');
assert.equal(normalizeOcrText('  '), '');

/* ---------- 2. 视觉模型回复解析 ---------- */

assert.deepEqual(
  parseVisionReply('{"text":"Hello","translation":"你好"}'),
  { text: 'Hello', translation: '你好' }
);
assert.deepEqual(
  parseVisionReply('```json\n{"text":"Hi","translation":"嗨"}\n```'),
  { text: 'Hi', translation: '嗨' },
  '要能剥掉 Markdown 代码块'
);
assert.deepEqual(
  parseVisionReply('模型不听话，直接给了译文'),
  { text: '', translation: '模型不听话，直接给了译文' },
  '格式不符时应兜底成译文，而不是报错'
);
assert.deepEqual(
  parseVisionReply('{"translation":"只给译文"}'),
  { text: '', translation: '只给译文' }
);

/* ---------- 3. 真实 Windows OCR ---------- */

(async () => {
  const sample = path.join(__dirname, '..', 'preview', 'settings.png');
  if (!fs.existsSync(sample)) {
    console.log('跳过真实 OCR：缺少 preview/settings.png');
    console.log('文本清洗与视觉解析测试通过');
    return;
  }

  const t0 = Date.now();
  const { text, engine } = await runWindowsOcr(sample, 'zh-Hans-CN');
  const cost = Date.now() - t0;

  assert.ok(text.length > 20, `识别结果太短：${JSON.stringify(text)}`);
  assert.ok(text.includes('快捷翻译'), `应识别出「快捷翻译」，实际：${text.slice(0, 120)}`);
  assert.ok(!/[\u4e00-\u9fff] [\u4e00-\u9fff]/.test(text), '中文之间不应残留空格');
  assert.ok(/Windows OCR/.test(engine), `引擎标识异常：${engine}`);

  // WinRT 的 GetFileFromPathAsync 不接受正斜杠，必须被归一化掉
  const forward = sample.split(path.sep).join('/');
  assert.ok(forward.includes('/'), '构造的正斜杠路径无效');
  const slashRun = await runWindowsOcr(forward, 'zh-Hans-CN');
  assert.ok(slashRun.text.includes('快捷翻译'), '正斜杠路径也要能识别');

  console.log(`真实 OCR 通过（${cost}ms，引擎 ${engine}，识别 ${text.length} 字）`);
  console.log('文本清洗与视觉解析测试通过');
})().catch((err) => { console.error(err); process.exitCode = 1; });
