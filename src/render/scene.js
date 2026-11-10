/**
 * Сцена — список графических примитивов схемы в миллиметрах, не зависящий от способа вывода.
 * Из одной сцены получаются и SVG (экран, файл), и растровое изображение (Canvas), поэтому
 * экспорт всегда совпадает с тем, что на экране.
 *
 * Примитивы:
 *   { t: 'path', d, fill }            контур символа
 *   { t: 'poly', pts, dash?, cap? }   ломаная (линия потока, стрелка, скоба комментария)
 *   { t: 'text', s, x, y, size }      отрезок текста (x — левый край, y — базовая линия)
 *   { t: 'rule', x0, x1, y, width }   черта (знак корня)
 * Примитивы сгруппированы по элементам схемы: { id, cls, prims, hit? }.
 */
import { autoArrows } from '../core/project.js';

/** Концы «усов» стрелки. */
function arrowWings(arrow, m) {
  const [dx, dy] = arrow.dir, [x, y] = arrow.at;
  const L = m.arrow.length, W = m.arrow.halfWidth;
  return [[x - dx * L - dy * W, y - dy * L + dx * W], [x, y], [x - dx * L + dy * W, y - dy * L - dx * W]];
}

/** Геометрия символа «Комментарий» (п. 3.4.3): скоба и пунктир к символу. */
export function commentGeometry(c, owner, gost) {
  const m = gost.metrics;
  const top = c.by - c.h / 2, bot = c.by + c.h / 2;
  let dash = null;
  if (owner) {
    const [ax, ay] = gost.symbols.ports(owner.shape, owner.x, owner.y).right;
    const inset = m.unit / 5;
    const ty = Math.min(bot - inset, Math.max(top + inset, ay));
    dash = ty === ay ? [[ax, ay], [c.bx, ay]] : [[ax, ay], [c.bx - m.comment.elbow, ay], [c.bx - m.comment.elbow, ty], [c.bx, ty]];
  }
  return { bracket: [[c.bx + m.comment.shelf, top], [c.bx, top], [c.bx, bot], [c.bx + m.comment.shelf, bot]], dash };
}

/**
 * @param {{items:object[], numbering?:boolean}} G геометрия схемы
 * @param {object} gost оформление
 * @param {ReturnType<import('./text.js').createTextEngine>} text
 * @param {{fill?: 'white'|'none'}} [opts]
 * @returns {{groups:object[], overflow:string[]}}
 */
export function buildScene(G, gost, text, opts = {}) {
  const m = gost.metrics;
  const sym = gost.symbols;
  const fill = opts.fill === 'none' ? null : '#fff';
  const groups = [];
  const overflow = [];
  const byId = new Map(G.items.map((i) => [i.id, i]));

  const runs = (L, x0, baseY, out) => {
    for (const r of L.runs) out.push({ t: 'text', s: r.s, x: x0 + r.x, y: baseY + r.dy, size: r.size });
    for (const o of L.overs) out.push({ t: 'rule', x0: x0 + o.x0, x1: x0 + o.x1, y: baseY + o.y, width: m.font.overlineRatio * o.size * m.pt });
  };

  for (const it of G.items) {
    if (it.type !== 'line') continue;
    const prims = [{ t: 'poly', pts: it.pts, cap: 'square' }];
    for (const a of autoArrows(it)) prims.push({ t: 'poly', pts: arrowWings(a, m) });
    groups.push({ id: it.id, cls: 'ln', prims, hit: { pts: it.pts } });
  }
  for (const it of G.items) {
    if (it.type !== 'comment') continue;
    const g = commentGeometry(it, byId.get(it.owner), gost);
    const prims = [];
    if (g.dash) prims.push({ t: 'poly', pts: g.dash, dash: m.stroke.dash });
    prims.push({ t: 'poly', pts: g.bracket });
    const size = it.size || m.font.commentPt;
    const lines = String(it.text).split('\n');
    const step = text.lineStep(size);
    let width = 0;
    lines.forEach((ln, k) => {
      const L = text.layoutLine(ln, size);
      width = Math.max(width, L.w);
      runs(L, it.bx + m.comment.textGap, it.by + (k - (lines.length - 1) / 2) * step + text.baseline(size), prims);
    });
    groups.push({ id: it.id, cls: 'cm', prims, hit: { rect: [it.bx - m.unit / 5, it.by - it.h / 2, width + m.comment.textGap + m.comment.shelf, it.h] } });
  }
  for (const it of G.items) {
    if (it.type === 'block') {
      const def = sym.get(it.shape);
      const prims = [{ t: 'path', d: def.path(it.x, it.y), fill }];
      const fit = text.fitText(it.text, it.shape, it.size);
      if (fit.overflow) overflow.push(it.id);
      fit.lines.forEach((L, k) => runs(L, it.x - L.w / 2, it.y + fit.offs[k] + text.baseline(fit.size), prims));
      if (def.identified && it.num != null && G.numbering !== false) {
        // идентификатор символа — слева над символом (п. 4.1.5)
        prims.push({ t: 'text', s: String(it.num), x: it.x - def.w / 2, y: it.y - def.h / 2 - m.identifier.gap, size: m.font.identifierPt });
      }
      groups.push({ id: it.id, cls: 'bk', prims });
    } else if (it.type === 'label') {
      const prims = [];
      runs(text.layoutLine(it.text, m.font.labelPt), it.x, it.y + text.baseline(m.font.labelPt), prims);
      groups.push({ id: it.id, cls: 'lb', prims });
    }
  }
  return { groups, overflow };
}

/** Подпись под рисунком: один отрезок текста по центру кадра. */
export function captionPrimitive(caption, frame, gost, text) {
  const m = gost.metrics;
  const size = m.font.captionPt;
  const w = text.measure(caption, size);
  return { t: 'text', s: caption, x: frame.x0 + frame.W / 2 - w / 2, y: frame.y0 + frame.H + m.caption.offset + text.baseline(size), size };
}
