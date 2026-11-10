/**
 * Правка ломаных линий схемы: только вертикальные и горизонтальные отрезки.
 * Чистые функции без обращения к странице — проверяются тестами в Node.js.
 */
export const snap = (v, step) => Math.round(v / step) * step;

/** Убирает совпадающие точки и лишние точки на прямых участках. */
export function cleanPts(pts) {
  const res = [];
  for (const p of pts) { const l = res[res.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-6) res.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]); }
  let changed = true;
  while (changed && res.length > 2) {
    changed = false;
    for (let k = 1; k + 1 < res.length; k++) {
      const a = res[k - 1], b = res[k], c = res[k + 1];
      if ((Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(b[0] - c[0]) < 1e-6) || (Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(b[1] - c[1]) < 1e-6)) { res.splice(k, 1); changed = true; break; }
    }
  }
  return res;
}
/** Перенос конца линии: соседний отрезок тянется следом, прямая линия получает излом. */
export function moveEnd(orig, end, dx, dy, half) {
  const pts = orig.map(p => p.slice()); const n = pts.length;
  const k = end === 0 ? 0 : n - 1, nb = end === 0 ? 1 : n - 2;
  const vert = Math.abs(orig[k][0] - orig[nb][0]) < 1e-6;
  const p = [orig[k][0] + dx, orig[k][1] + dy];
  if (n === 2) {
    const other = orig[nb].slice();
    if ((vert && Math.abs(dx) < 1e-6) || (!vert && Math.abs(dy) < 1e-6)) { pts[k] = p; return pts; }
    let mid;
    if (vert) { const my = snap((p[1] + other[1]) / 2, half); mid = [[p[0], my], [other[0], my]]; }
    else { const mx = snap((p[0] + other[0]) / 2, half); mid = [[mx, p[1]], [mx, other[1]]]; }
    return end === 0 ? [p, ...mid, other] : [other, ...mid.reverse(), p];
  }
  pts[k] = p;
  if (vert) pts[nb][0] = orig[nb][0] + dx; else pts[nb][1] = orig[nb][1] + dy;
  return pts;
}
/** Перенос излома линии с сохранением прямых углов. */
export function moveVertex(orig, k, q) {
  const pts = orig.map(p => p.slice()); const n = pts.length;
  pts[k] = q.slice();
  const fix = (j) => {
    const vert = Math.abs(orig[j][0] - orig[k][0]) < 1e-6;
    const isEnd = j === 0 || j === n - 1;
    if (!isEnd) { if (vert) pts[j][0] = q[0]; else pts[j][1] = q[1]; return null; }
    if ((vert && Math.abs(pts[j][0] - q[0]) < 1e-6) || (!vert && Math.abs(pts[j][1] - q[1]) < 1e-6)) return null;
    return vert ? [pts[j][0], q[1]] : [q[0], pts[j][1]];
  };
  const ea = k > 0 ? fix(k - 1) : null, eb = k < n - 1 ? fix(k + 1) : null;
  const res = [];
  for (let i = 0; i < n; i++) { if (i === k && ea) res.push(ea); res.push(pts[i]); if (i === k && eb) res.push(eb); }
  return res;
}
/** Параллельный перенос отрезка; у крайних отрезков появляется ступенька длиной не больше grid. */
export function moveSegment(orig, k, dx, dy, grid) {
  const n = orig.length;
  const vert = Math.abs(orig[k][0] - orig[k + 1][0]) < 1e-6;
  const off = vert ? [dx, 0] : [0, dy];
  if (n === 2) return orig.map(p => [p[0] + off[0], p[1] + off[1]]);
  const mv = p => [p[0] + off[0], p[1] + off[1]];
  if (k > 0 && k + 1 < n - 1) { const pts = orig.map(p => p.slice()); pts[k] = mv(orig[k]); pts[k + 1] = mv(orig[k + 1]); return pts; }
  const jog = (A, B) => { // A — закреплённый конец, B — следующая точка
    const len = vert ? B[1] - A[1] : B[0] - A[0];
    const s = Math.sign(len) * Math.min(grid, Math.abs(len) / 2);
    const J1 = vert ? [A[0], A[1] + s] : [A[0] + s, A[1]];
    return [A, J1, mv(J1), mv(B)];
  };
  if (k === 0) { const head = jog(orig[0], orig[1]); return head.concat(orig.slice(2).map(p => p.slice())); }
  const rev = orig.slice().reverse(); const head = jog(rev[0], rev[1]);
  return head.concat(rev.slice(2).map(p => p.slice())).reverse();
}
