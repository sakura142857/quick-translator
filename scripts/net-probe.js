'use strict';

/** 网络与免费翻译接口连通性探测 */

const TARGETS = [
  ['百度首页', 'https://www.baidu.com/'],
  ['有道翻译(免key)', 'https://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i=hello'],
  ['有道智云demo', 'https://aidemo.youdao.com/trans?q=hello&from=Auto&to=Auto'],
  ['MyMemory', 'https://api.mymemory.translated.net/get?q=hello&langpair=en|zh-CN'],
  ['Google gtx', 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&dj=1&q=hello'],
  ['Bing 首页', 'https://cn.bing.com/'],
];

(async () => {
  for (const [name, url] of TARGETS) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      const body = await res.text();
      const ms = Date.now() - t0;
      console.log(`[${res.status}] ${name}  ${ms}ms  ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
    } catch (e) {
      console.log(`[ERR] ${name}  ${Date.now() - t0}ms  ${e.message}`);
    }
  }
})();
