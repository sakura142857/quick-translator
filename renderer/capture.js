'use strict';

const $ = (id) => document.getElementById(id);

const dim = $('dim');
const box = $('selection');
const badge = $('badge');
const hint = $('hint');

let start = null;
let dragging = false;
let done = false;

function clamp(v, max) { return Math.max(0, Math.min(v, max)); }

function rectFrom(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x: clamp(x, innerWidth),
    y: clamp(y, innerHeight),
    width: clamp(Math.abs(b.x - a.x), innerWidth - clamp(x, innerWidth)),
    height: clamp(Math.abs(b.y - a.y), innerHeight - clamp(y, innerHeight)),
  };
}

function paint(rect) {
  box.style.left = rect.x + 'px';
  box.style.top = rect.y + 'px';
  box.style.width = rect.width + 'px';
  box.style.height = rect.height + 'px';

  badge.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  // 尺寸提示贴在选区下方，超出屏幕就翻到上方
  const below = rect.y + rect.height + 8;
  badge.style.left = rect.x + 'px';
  badge.style.top = (below + 24 > innerHeight ? Math.max(4, rect.y - 28) : below) + 'px';
}

function submit(rect) {
  if (done) return;
  done = true;
  window.qt.captureSubmit(rect);
}

function cancel() {
  if (done) return;
  done = true;
  window.qt.captureCancel();
}

document.addEventListener('mousedown', (e) => {
  if (e.button === 2) { cancel(); return; }
  if (e.button !== 0) return;
  dragging = true;
  start = { x: e.clientX, y: e.clientY };
  dim.hidden = true;
  hint.hidden = true;
  box.hidden = false;
  badge.hidden = false;
  paint({ x: start.x, y: start.y, width: 0, height: 0 });
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  paint(rectFrom(start, { x: e.clientX, y: e.clientY }));
});

document.addEventListener('mouseup', (e) => {
  if (!dragging || e.button !== 0) return;
  dragging = false;
  const rect = rectFrom(start, { x: e.clientX, y: e.clientY });
  // 太小的选区多半是误点，直接取消
  if (rect.width < 6 || rect.height < 6) { cancel(); return; }
  submit(rect);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancel();
});

// 防止遮罩上出现右键菜单
document.addEventListener('contextmenu', (e) => e.preventDefault());
