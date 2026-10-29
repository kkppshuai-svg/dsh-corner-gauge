/**
 * 拖动层
 * ------------------------------------------------------------------
 * 面板可自由拖动，位置写进 localStorage；窗口缩放时重新钳制到视口内。
 */

/** 把坐标钳制在视口内。 */
BADGE.clampPos = function clampPos(left, top, el) {
  const w = el ? el.offsetWidth : BADGE.config.size.width;
  const h = el ? el.offsetHeight : BADGE.config.size.height;
  const pad = 6;
  return {
    left: Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - w - pad)),
    top: Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - h - pad)),
  };
};

/** 写入位置（同时清掉默认的 right/bottom 锚点）。 */
BADGE.setPos = function setPos(root, pos) {
  const p = BADGE.clampPos(pos.left, pos.top, root);
  root.style.left = `${p.left}px`;
  root.style.top = `${p.top}px`;
  root.style.right = 'auto';
  root.style.bottom = 'auto';
};

/** 从 localStorage 恢复上次拖到的位置。 */
BADGE.restorePos = function restorePos(root) {
  try {
    const raw = localStorage.getItem(BADGE.POS_KEY);
    if (!raw) return;
    const pos = JSON.parse(raw);
    if (typeof pos.left === 'number' && typeof pos.top === 'number') {
      BADGE.setPos(root, pos);
    }
  } catch {
    /* 坏数据直接忽略 */
  }
};

/** 绑定指针拖动。 */
BADGE.attachDrag = function attachDrag(root) {
  let dragging = false;
  let pointerId = null;
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = root.getBoundingClientRect();
    dragging = true;
    pointerId = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    ox = r.left;
    oy = r.top;
    root.classList.add('g-dragging');
    try { root.setPointerCapture(pointerId); } catch { /* 忽略 */ }
    e.preventDefault();
  });

  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    BADGE.setPos(root, { left: ox + (e.clientX - sx), top: oy + (e.clientY - sy) });
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('g-dragging');
    try { if (pointerId !== null) root.releasePointerCapture(pointerId); } catch { /* 忽略 */ }
    pointerId = null;
    const r = root.getBoundingClientRect();
    try {
      localStorage.setItem(BADGE.POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
    } catch { /* 忽略 */ }
  };

  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);

  window.addEventListener('resize', () => {
    const r = root.getBoundingClientRect();
    if (root.style.left) BADGE.setPos(root, { left: r.left, top: r.top });
  });
};
