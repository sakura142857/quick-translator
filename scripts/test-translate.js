'use strict';

/**
 * 翻译引擎自测脚本（不依赖 Electron）
 *   node scripts/test-translate.js
 */

const { translate, detectLang } = require('../src/translator');

const CASES = [
  { label: '英 -> 中（句子）', opts: { text: 'Pull requests let you tell others about changes you have pushed to a branch in a repository on GitHub.', engine: 'free' } },
  { label: '英 -> 中（单词）', opts: { text: 'asynchronous', engine: 'free' } },
  { label: '中 -> 英（自动反向）', opts: { text: '这个函数的返回值可能为空，记得做判空处理。', engine: 'free' } },
];

(async () => {
  console.log('语言检测自测:');
  for (const t of ['hello', '你好世界', 'こんにちは', '안녕하세요']) {
    console.log(`  "${t}" -> ${detectLang(t)}`);
  }
  console.log('');

  for (const c of CASES) {
    process.stdout.write(`[${c.label}] ... `);
    try {
      const r = await translate(c.opts);
      console.log(`\n  引擎: ${r.engine} | ${r.fromName} -> ${r.toName}`);
      console.log(`  译文: ${r.text}\n`);
    } catch (e) {
      console.log(`失败 -> ${e.message}\n`);
    }
  }
})();
