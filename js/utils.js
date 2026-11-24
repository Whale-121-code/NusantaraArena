export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const formatTime = (s) => {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};
export const roundRect = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

export const polylineLength = (pts) => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return total;
};

export const pointOnPolyline = (pts, t) => {
  t = clamp(t, 0, 1);
  const total = polylineLength(pts);
  let target = total * t;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = dist(a[0], a[1], b[0], b[1]);
    if (target <= seg || i === pts.length - 1) {
      const k = seg === 0 ? 0 : target / seg;
      return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), angle: angleTo(a[0], a[1], b[0], b[1]) };
    }
    target -= seg;
  }
  const last = pts[pts.length - 1];
  return { x: last[0], y: last[1], angle: 0 };
};

export const distToPolyline = (px, py, pts) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1];
    const bx = pts[i][0], by = pts[i][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
    t = clamp(t, 0, 1);
    const qx = ax + dx * t, qy = ay + dy * t;
    best = Math.min(best, dist(px, py, qx, qy));
  }
  return best;
};

export const mulberry32 = (seed) => {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const shortNum = (n) => {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k';
  return String(Math.round(n));
};
