'use strict';

/**
 * 零依赖图标生成器：手写 PNG 编码器 + 4x 超采样抗锯齿
 * 输出 assets/icon.png (256) 与 assets/tray.png (32)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------ PNG 编码 ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ 几何工具 ------------------------------ */

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/* ------------------------------- 绘制 -------------------------------- */

// 品牌渐变：#6366F1 -> #8B5CF6
const C1 = [99, 102, 241];
const C2 = [139, 92, 246];

function drawIcon(size) {
  const S = 4;                 // 超采样倍率
  const W = size * S;
  const out = Buffer.alloc(size * size * 4);
  const acc = new Float32Array(size * size * 4);

  const radius = W * 0.23;     // 圆角半径
  const lineW = W * 0.075;     // 箭头线宽

  // ⇄ 归一化坐标（0..1）
  const upY = 0.365, dnY = 0.635;
  const xL = 0.32, xR = 0.68;

  for (let sy = 0; sy < W; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const x = sx + 0.5;
      const y = sy + 0.5;

      // 圆角矩形遮罩
      const cx = Math.min(Math.max(x, radius), W - radius);
      const cy = Math.min(Math.max(y, radius), W - radius);
      const dx = x - cx, dy = y - cy;
      const inside = dx * dx + dy * dy <= radius * radius;
      if (!inside) continue;

      // 背景渐变
      const t = (x + y) / (2 * W);
      let r = C1[0] + (C2[0] - C1[0]) * t;
      let g = C1[1] + (C2[1] - C1[1]) * t;
      let b = C1[2] + (C2[2] - C1[2]) * t;

      // 白色 ⇄ 图案
      const white =
        distToSegment(x, y, xL * W, upY * W, xR * W, upY * W) <= lineW / 2 ||
        distToSegment(x, y, xL * W, dnY * W, xR * W, dnY * W) <= lineW / 2 ||
        inTriangle(x, y, 0.29 * W, upY * W, 0.44 * W, (upY - 0.105) * W, 0.44 * W, (upY + 0.105) * W) ||
        inTriangle(x, y, 0.71 * W, dnY * W, 0.56 * W, (dnY - 0.105) * W, 0.56 * W, (dnY + 0.105) * W);

      if (white) { r = 255; g = 255; b = 255; }

      // 累加到目标像素
      const px = (sy / S) | 0;
      const py = (sx / S) | 0;
      const i = (px * size + py) * 4;
      acc[i] += r; acc[i + 1] += g; acc[i + 2] += b; acc[i + 3] += 255;
    }
  }

  const n = S * S;
  for (let i = 0; i < size * size; i++) {
    const a = acc[i * 4 + 3] / n;
    if (a <= 0) continue;
    // 以覆盖率为权重的平均色
    const cover = acc[i * 4 + 3] / 255;
    out[i * 4]     = Math.round(acc[i * 4]     / cover);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / cover);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / cover);
    out[i * 4 + 3] = Math.round(a);
  }
  return encodePNG(size, size, out);
}

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });

for (const [name, size] of [['icon.png', 256], ['tray.png', 32], ['tray@2x.png', 64]]) {
  const buf = drawIcon(size);
  fs.writeFileSync(path.join(dir, name), buf);
  console.log(`生成 ${name}  ${size}x${size}  ${buf.length} bytes`);
}

// Windows ICO 容器可以直接嵌入 PNG 数据（256x256）。
const png = fs.readFileSync(path.join(dir, 'icon.png'));
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2); // type: icon
icoHeader.writeUInt16LE(1, 4); // one image
icoHeader.writeUInt16LE(1, 10); // one color plane
icoHeader.writeUInt16LE(32, 12); // 32-bit RGBA
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([icoHeader, png]));
console.log('生成 icon.ico  256x256');
