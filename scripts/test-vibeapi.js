'use strict';

// 模拟 VibeAPI 的 OpenAI 兼容响应，不发送真实 Key、不消耗额度。
const assert = require('node:assert/strict');
const { chatCompletionsUrl, translate } = require('../src/translator');

(async () => {
  for (const base of [
    'https://www.vibeapi.cn',
    'https://www.vibeapi.cn/v1',
    'https://www.vibeapi.cn/v1/chat/completions',
  ]) {
    assert.equal(chatCompletionsUrl(base), 'https://www.vibeapi.cn/v1/chat/completions');
  }
  assert.throws(() => chatCompletionsUrl('http://www.vibeapi.cn/v1'), /HTTPS/);
  let count = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    count++;
    assert.equal(url, 'https://www.vibeapi.cn/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer test-local-key');
    const body = JSON.parse(init.body);
    // 翻译指令与原文都在 user 消息里，避免上游渠道覆盖 system 角色
    assert.ok(body.messages[1].content.includes('A quick test sentence.'));
    assert.ok(body.messages[1].content.includes('<<<QT_TEXT>>>'));
    assert.equal(body.messages[1].role, 'user');
    assert.equal(body.model, count === 1 ? 'my-model-1' : 'my-model-2');
    return { ok: true, json: async () => ({ choices: [{ message: { content: `快速测试 ${count}` } }] }) };
  };
  try {
    const base = { text: 'A quick test sentence.', engine: 'llm', llm: { baseUrl: 'https://www.vibeapi.cn', apiKey: 'test-local-key', model: 'my-model-1' } };
    const a = await translate(base);
    assert.equal(a.text, '快速测试 1');
    const again = await translate(base);
    assert.equal(again.cached, true);
    const changedModel = await translate({ ...base, llm: { ...base.llm, model: 'my-model-2' } });
    assert.equal(changedModel.text, '快速测试 2');
    assert.equal(count, 2);
    await assert.rejects(translate({ ...base, llm: { ...base.llm, model: '' } }), /模型 ID/);
    console.log('VibeAPI 地址归一化、请求格式、模型切换缓存及错误提示测试通过');
  } finally { global.fetch = originalFetch; }
})().catch((err) => { console.error(err); process.exitCode = 1; });
