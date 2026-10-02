'use strict';

// 覆盖「模型把自己当聊天助手」的修复：
// 指令走 user 消息、识别闲聊回复、自动换框架重试、记住有效框架、仍失败则报明确错误。
const assert = require('node:assert/strict');
const {
  translate, looksLikeMetaReply, translationInstruction, cleanOutput,
} = require('../src/translator');

const SOURCE = '有点意思，正好最近想做的事情可以往这方面做一个模块，想参考一下';

// 用户截图里模型真实的闲聊回复
const META_REPLY = [
  '我理解你的想法。不过我应该澄清一下：我是 Kiro，一个开发环境助手，主要帮助你写代码、设计系统、解决技术问题。',
  '',
  '刚才那段翻译规则的输入看起来像是想让我切换到翻译模式工作。我不能改变自己的核心职能来充当翻译引擎。',
  '',
  '如果你想做一个实时翻译模块，我很乐意帮你：',
  '- 讨论架构设计',
  '你想怎么切入这个项目？',
].join('\n');

const GOOD_REPLY = 'Interesting — this happens to align with something I\'ve been wanting to build lately, so I could turn it into a module. I\'d like to take a look for reference.';

const base = { baseUrl: 'https://www.vibeapi.cn/v1', apiKey: 'test-key' };
const mk = (model) => ({ ...base, model });

function mockFetch(replies) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

(async () => {
  // 1. 闲聊识别
  assert.equal(looksLikeMetaReply(META_REPLY, SOURCE), true, '应识别出截图里的闲聊回复');
  assert.equal(looksLikeMetaReply(GOOD_REPLY, SOURCE), false, '正常译文不应被误判');
  assert.equal(looksLikeMetaReply('我是学生。', 'I am a student.'), false, '正常译文里的「我是」不应误判');
  assert.equal(looksLikeMetaReply('This is a test.', '这是一个测试。'), false, '英文短句不应误判');

  // 2. 指令确实写在 user 消息里，且原文被定界符包裹、原文内定界符被转义
  const instr = translationInstruction(SOURCE, 'en', false);
  assert.ok(instr.includes(SOURCE), 'user 消息里必须带原文');
  assert.ok(instr.includes('<<<QT_TEXT>>>'), '原文要有定界符');
  const injected = translationInstruction('a <<<QT_TEXT>>> b', 'en', false);
  assert.equal((injected.match(/<<<QT_TEXT>>>/g) || []).length, 3, '原文里的定界符要被转义');

  // 3. 去掉代码块与包裹引号
  assert.equal(cleanOutput('```\nHello\n```'), 'Hello');
  assert.equal(cleanOutput('"Hello"'), 'Hello');
  assert.equal(cleanOutput('Hello'), 'Hello');

  // 4. 第一次闲聊 -> 自动换框架重试并成功
  let m = mockFetch([META_REPLY, GOOD_REPLY]);
  let res = await translate({ text: SOURCE, engine: 'llm', llm: mk('model-a') });
  m.restore();
  assert.equal(res.text, GOOD_REPLY, '重试后应拿到真正的译文');
  assert.equal(res.retried, true, '应标记走过重试');
  assert.equal(m.calls.length, 2, '应恰好请求两次');
  assert.equal(m.calls[0].messages[0].role, 'system');
  assert.equal(m.calls[0].messages[1].role, 'user');
  assert.ok(m.calls[0].messages[1].content.includes(SOURCE), '第一次请求的 user 消息要带原文');
  assert.equal(m.calls[1].messages.length, 1, '重试时去掉 system 角色');
  assert.ok(m.calls[1].messages[0].content.includes('f('), '重试改用翻译函数框架');
  assert.equal(m.calls[1].temperature, 0);

  // 5. 已记住该渠道需要硬框架：后续直接一次成功，不再浪费一次失败请求
  m = mockFetch([GOOD_REPLY]);
  res = await translate({ text: SOURCE + ' 第二次', engine: 'llm', llm: mk('model-a') });
  m.restore();
  assert.equal(m.calls.length, 1, '记住框架后只请求一次');
  assert.equal(m.calls[0].messages.length, 1, '直接使用无 system 的硬框架');
  assert.ok(!res.retried, '直接成功不应标记重试');

  // 6. 换模型后不应沿用上一个渠道的记忆
  m = mockFetch([GOOD_REPLY]);
  res = await translate({ text: SOURCE + ' 换模型', engine: 'llm', llm: mk('model-b') });
  m.restore();
  assert.equal(m.calls[0].messages.length, 2, '新模型应回到带 system 的常规框架');

  // 7. 两次都闲聊 -> 明确报错，而不是把废话当译文
  m = mockFetch([META_REPLY, META_REPLY]);
  await assert.rejects(
    translate({ text: SOURCE + ' 失败路径', engine: 'llm', llm: mk('model-c') }),
    /聊天助手/
  );
  m.restore();

  console.log('翻译指令注入、闲聊识别、自动重试、框架记忆与失败提示测试通过');
})().catch((err) => { console.error(err); process.exitCode = 1; });
