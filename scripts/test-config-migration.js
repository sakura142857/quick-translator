'use strict';

// 快捷键默认值从 Ctrl+Shift+D 改为 Alt+W，需要平滑升级老配置，
// 且绝不能覆盖用户自己设定的组合。
const assert = require('node:assert/strict');
const { migrate, DEFAULTS, CONFIG_VERSION } = require('../src/config');

const OLD = 'CommandOrControl+Shift+D';
const NEW = 'Alt+W';

assert.equal(DEFAULTS.shortcut, NEW, '默认值应为 Alt+W');

// 1. 全新用户（无配置文件）
let out = migrate({});
assert.equal(out.shortcut, NEW, '全新用户应拿到新默认值');
assert.equal(out.configVersion, CONFIG_VERSION);

// 2. 老配置里存着旧默认值、且没有版本号 -> 升级
out = migrate({ shortcut: OLD, engine: 'llm', windowColor: '#101216' });
assert.equal(out.shortcut, NEW, '沿用旧默认值的用户应被升级到 Alt+Q');
assert.equal(out.engine, 'llm', '其它设置必须原样保留');
assert.equal(out.windowColor, '#101216');

// 3. 用户自己改过快捷键 -> 一律不动
out = migrate({ shortcut: 'CommandOrControl+Alt+T' });
assert.equal(out.shortcut, 'CommandOrControl+Alt+T', '不能覆盖用户自定义的快捷键');

// 4. 用户手动把快捷键设回旧默认值，但配置已是新版 -> 尊重用户选择
out = migrate({ configVersion: CONFIG_VERSION, shortcut: OLD });
assert.equal(out.shortcut, OLD, '已升级过的配置不应被再次改写');

// 5. 幂等：重复迁移结果稳定
const once = migrate({ shortcut: OLD });
const twice = migrate(once);
assert.deepEqual(twice, once, '迁移必须幂等');

console.log('快捷键默认值迁移测试通过（升级旧默认、保留用户自定义、幂等）');
