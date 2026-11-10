/**
 * Проверка готовой геометрии схемы на соответствие правилам ГОСТ 19.701-90.
 * Используется и в интерфейсе (чек-лист), и в тестах — как формальное определение того,
 * что значит «схема выполнена по стандарту».
 */
import { GOST } from '../gost/index.js';

const EPS = 0.02;
const near = (a, b) => Math.abs(a - b) < EPS;
const samePoint = (p, q) => near(p[0], q[0]) && near(p[1], q[1]);

function segmentsOf(lines) {
  const out = [];
  for (const line of lines) {
    for (let k = 0; k + 1 < line.pts.length; k++) {
      const a = line.pts[k], b = line.pts[k + 1];
      const vertical = near(a[0], b[0]), horizontal = near(a[1], b[1]);
      if (vertical && horizontal) continue;
      out.push({ line, k, a, b, vertical, horizontal,
        x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
    }
  }
  return out;
}

/** Сторона символа, на середине которой лежит точка, либо 'edge' (на контуре не по центру), либо null. */
function sideAt(sym, block, p) {
  if (!sym.onBoundary(block.shape, p[0] - block.x, p[1] - block.y, EPS)) return null;
  const ports = sym.ports(block.shape, block.x, block.y);
  for (const side of ['top', 'bottom', 'left', 'right']) if (samePoint(ports[side], p)) return side;
  return 'edge';
}

/** Проходит ли отрезок через внутренность символа. */
function crossesSymbol(sym, block, s) {
  const def = sym.get(block.shape);
  const hh = def.h / 2;
  if (s.horizontal) {
    const dy = s.a[1] - block.y;
    if (Math.abs(dy) >= hh - EPS) return false;
    const [l, r] = def.span(dy);
    return s.x1 > block.x + l + EPS && s.x0 < block.x + r - EPS;
  }
  if (!s.vertical) return false;
  const dx = s.a[0] - block.x;
  const SAMPLES = 16;
  for (let i = 1; i < SAMPLES; i++) {
    const v = -hh + (2 * hh * i) / SAMPLES;
    const y = block.y + v;
    if (y <= s.y0 + EPS || y >= s.y1 - EPS) continue;
    const [l, r] = def.span(v);
    if (dx > l + EPS && dx < r - EPS) return true;
  }
  return false;
}

/**
 * Разбор геометрии: возвращает найденные нарушения по каждому правилу.
 * @param {{items:object[]}} G
 */
export function analyzeGeometry(G, gost = GOST) {
  const { metrics: m, symbols: sym } = gost;
  const blocks = G.items.filter((i) => i.type === 'block');
  const lines = G.items.filter((i) => i.type === 'line');
  const labels = G.items.filter((i) => i.type === 'label');
  const segs = segmentsOf(lines);
  const res = { offGrid: [], oblique: [], crossings: [], overlaps: [], throughSymbols: [], unshiftedMerges: [], badExits: [], badEntries: [], offCenter: [], unlabeledDecisions: [], connectorPairs: [], loopPairs: [], manualArrows: 0 };

  // отрезки: только горизонтальные и вертикальные, длиной кратной модулю сетки (оформление)
  for (const line of lines) {
    for (let k = 0; k + 1 < line.pts.length; k++) {
      const a = line.pts[k], b = line.pts[k + 1];
      if (!near(a[0], b[0]) && !near(a[1], b[1])) { res.oblique.push({ line: line.id, k }); continue; }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > EPS && Math.abs(len / m.unit - Math.round(len / m.unit)) > EPS) res.offGrid.push({ line: line.id, k, len });
    }
  }

  // п. 4.2.2 — пересечения; наложения параллельных отрезков разных линий
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i], q = segs[j];
      if (p.line === q.line && Math.abs(p.k - q.k) <= 1) continue;
      if (p.horizontal && q.vertical || p.vertical && q.horizontal) {
        const hz = p.horizontal ? p : q, vt = p.horizontal ? q : p;
        const x = vt.a[0], y = hz.a[1];
        if (x > hz.x0 + EPS && x < hz.x1 - EPS && y > vt.y0 + EPS && y < vt.y1 - EPS) res.crossings.push({ a: hz.line.id, b: vt.line.id, at: [x, y] });
      } else if (p.line !== q.line) {
        if (p.horizontal && q.horizontal && near(p.a[1], q.a[1]) && Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > EPS) res.overlaps.push({ a: p.line.id, b: q.line.id });
        if (p.vertical && q.vertical && near(p.a[0], q.a[0]) && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > EPS) res.overlaps.push({ a: p.line.id, b: q.line.id });
      }
    }
  }

  // п. 4.2.3 — место слияния смещено: в одной точке не сходятся линии с четырёх сторон
  // (иначе слияние неотличимо от пересечения)
  const seenPoints = new Set();
  for (const line of lines) {
    for (const p of [line.pts[0], line.pts[line.pts.length - 1]]) {
      const key = p[0].toFixed(2) + ',' + p[1].toFixed(2);
      if (seenPoints.has(key)) continue;
      seenPoints.add(key);
      const dirs = new Set();
      for (const s of segs) {
        if (s.vertical && near(s.a[0], p[0]) && p[1] >= s.y0 - EPS && p[1] <= s.y1 + EPS) { if (p[1] > s.y0 + EPS) dirs.add('up'); if (p[1] < s.y1 - EPS) dirs.add('down'); }
        if (s.horizontal && near(s.a[1], p[1]) && p[0] >= s.x0 - EPS && p[0] <= s.x1 + EPS) { if (p[0] > s.x0 + EPS) dirs.add('left'); if (p[0] < s.x1 - EPS) dirs.add('right'); }
      }
      if (dirs.size === 4) res.unshiftedMerges.push({ at: p });
    }
  }

  // линия не проходит сквозь символ
  for (const s of segs) for (const b of blocks) if (crossesSymbol(sym, b, s)) res.throughSymbols.push({ line: s.line.id, block: b.id });

  // п. 4.2.4 — вход сверху или слева, выход снизу или справа, линия направлена к центру
  for (const line of lines) {
    const first = line.pts[0], last = line.pts[line.pts.length - 1];
    for (const b of blocks) {
      const out = sideAt(sym, b, first);
      if (out === 'edge') res.offCenter.push({ line: line.id, block: b.id });
      else if (out && out !== 'bottom' && out !== 'right') res.badExits.push({ line: line.id, block: b.id, side: out });
      const inn = sideAt(sym, b, last);
      if (inn === 'edge') res.offCenter.push({ line: line.id, block: b.id });
      else if (inn && inn !== 'top' && inn !== 'left') res.badEntries.push({ line: line.id, block: b.id, side: inn });
    }
    if (line.arrow && line.arrow !== 'auto') res.manualArrows++;
  }

  // пп. 3.2.2.4, 4.3.1.2 — каждый выход «Решения» подписан
  for (const b of blocks) {
    if (b.shape !== 'dia') continue;
    if (labels.filter((l) => l.owner === b.id).length < 2) res.unlabeledDecisions.push(b.id);
  }

  // п. 3.4.1 — парные соединители с одним уникальным обозначением
  const connCount = new Map();
  for (const b of blocks) if (b.shape === 'conn') connCount.set(b.text, (connCount.get(b.text) || 0) + 1);
  for (const [text, count] of connCount) if (count !== 2) res.connectorPairs.push({ text, count });

  // п. 3.2.2.6 — обе части «Границы цикла» имеют один идентификатор, у разных циклов он разный
  const loopId = (b) => String(b.text).split('\n')[0];
  const begins = new Map(), ends = new Map();
  for (const b of blocks) {
    if (b.shape === 'lbeg') begins.set(loopId(b), (begins.get(loopId(b)) || 0) + 1);
    if (b.shape === 'lend') ends.set(loopId(b), (ends.get(loopId(b)) || 0) + 1);
  }
  for (const id of new Set([...begins.keys(), ...ends.keys()])) {
    if (begins.get(id) !== 1 || ends.get(id) !== 1) res.loopPairs.push({ id, begins: begins.get(id) || 0, ends: ends.get(id) || 0 });
  }
  return res;
}

/**
 * Чек-лист для интерфейса: правило, пункт стандарта (или «оформление»), результат.
 * @returns {{ok:boolean, text:string, clause:string}[]}
 */
export function checkGeometry(G, bounds, overflowCount, maxH, gost = GOST) {
  const m = gost.metrics;
  const a = analyzeGeometry(G, gost);
  const item = (clause, bad, okText, badText) => ({ ok: !bad, clause, text: bad ? badText : okText });
  const flow = a.badEntries.length + a.badExits.length + a.offCenter.length;
  const okSize = bounds.W <= m.page.width && bounds.H <= maxH;
  return [
    item('4.2.4', flow, 'Линии входят сверху или слева, выходят снизу или справа, к центру символа', `Линий, подведённых к символу не по правилу: ${flow}`),
    item('4.2.2', a.crossings.length, 'Пересечений линий нет', `Пересечений линий: ${a.crossings.length}`),
    item('4.2.3', a.unshiftedMerges.length, 'Места слияния линий смещены', `Слияний линий в одной точке с четырёх сторон: ${a.unshiftedMerges.length}`),
    item('оформление', a.overlaps.length + a.throughSymbols.length, 'Линии не накладываются и не проходят сквозь символы', `Наложений линий и проходов сквозь символы: ${a.overlaps.length + a.throughSymbols.length}`),
    item('4.3.1.2', a.unlabeledDecisions.length, 'У каждого «Решения» подписаны выходы', `«Решений» без подписей выходов: ${a.unlabeledDecisions.length}`),
    item('3.4.1', a.connectorPairs.length, 'Соединители парные, обозначения не повторяются', `Соединителей без пары или с повтором обозначения: ${a.connectorPairs.length}`),
    item('3.2.2.6', a.loopPairs.length, 'У начала и конца каждого цикла один идентификатор', `Циклов с несогласованным идентификатором: ${a.loopPairs.length}`),
    item('4.1.4', overflowCount, 'Текст помещается в символы', `Текст не помещается в символах: ${overflowCount}`),
    item('оформление', a.offGrid.length + a.oblique.length, `Все отрезки линий кратны ${m.unit} мм`, `Отрезков не по сетке ${m.unit} мм: ${a.offGrid.length + a.oblique.length}`),
    item('оформление', !okSize, `Холст ${bounds.W} × ${bounds.H} мм — умещается на листе`, `Холст ${bounds.W} × ${bounds.H} мм — больше ${m.page.width} × ${maxH} мм`),
    item('4.2.1', a.manualArrows, 'Стрелки расставлены по правилу', `Линий со стрелками, заданными вручную: ${a.manualArrows}`),
  ];
}
