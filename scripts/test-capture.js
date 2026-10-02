'use strict';

// 验证框选遮罩的创建/销毁，以及选区到截图像素的换算是否正确。
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { startCapture, finish, captureRegion, isCapturing } = require('../src/screenshot');

app.on('window-all-closed', () => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  // 1. 打开遮罩
  assert.equal(isCapturing(), false, '初始不应处于截图状态');
  const pending = startCapture();
  await wait(800);
  assert.equal(isCapturing(), true, '遮罩应已创建');
  assert.equal(BrowserWindow.getAllWindows().length, 1, '应只有一个遮罩窗口');

  // 2. 提交选区，遮罩应立刻销毁
  const rect = { x: 120, y: 90, width: 240, height: 160 };
  finish(rect);
  const shot = await pending;
  await wait(200);
  assert.ok(shot, '应返回选区信息');
  assert.deepEqual(shot.rect, rect, '选区应原样返回');
  assert.equal(isCapturing(), false, '提交后应退出截图状态');
  assert.equal(BrowserWindow.getAllWindows().length, 0, '遮罩窗口应被销毁');

  // 3. 裁剪尺寸要按屏幕缩放换算
  const image = await captureRegion(shot.display, shot.rect);
  assert.ok(!image.isEmpty(), '截取到的图像不应为空');
  const size = image.getSize();
  const scale = shot.display.scaleFactor || 1;
  assert.ok(Math.abs(size.width - rect.width * scale) <= 2,
    `宽度换算错误：期望约 ${Math.round(rect.width * scale)}，实际 ${size.width}`);
  assert.ok(Math.abs(size.height - rect.height * scale) <= 2,
    `高度换算错误：期望约 ${Math.round(rect.height * scale)}，实际 ${size.height}`);

  // 4. 取消路径
  const pending2 = startCapture();
  await wait(700);
  finish(null);
  assert.equal(await pending2, null, '取消应返回 null');
  await wait(200);
  assert.equal(BrowserWindow.getAllWindows().length, 0, '取消后遮罩也要销毁');

  // 5. 过小的选区应被拒绝
  const pending3 = startCapture();
  await wait(700);
  finish({ x: 10, y: 10, width: 0, height: 0 });
  const tiny = await pending3;
  await assert.rejects(captureRegion(tiny.display, tiny.rect), /太小/);

  console.log(`截图框选、裁剪换算与取消路径测试通过（缩放 ${scale}x）`);
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
