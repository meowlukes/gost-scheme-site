/**
 * Проект: список схем программы и геометрия каждой схемы для редактора и экспорта.
 */
import { GOST } from '../gost/index.js';
import { approximateMeasure, plainText } from '../render/text.js';
import { layoutDiagram } from './layout.js';
import { parsePascal } from './parser.js';
import { isFormClass, transformRoutine } from './transform.js';

/** Наибольшая длина строки автоматического комментария, знаков. */
const COMMENT_LINE_CHARS = 40;

function routineTitle(d, env, counts) {
  const name = (r) => { const e = env.names && env.names[r.short.toLowerCase()]; return (e && e.disp) ? plainText(e.disp) : r.short; };
  if (d.kind === 'program') return 'Схема программы';
  if (d.kind === 'handler') return (counts.main === 0 && counts.handler === 1) ? 'Схема программы' : 'Схема обработчика ' + d.R.short;
  if (d.kind === 'function') return 'Схема функции ' + name(d.R);
  if (d.R.kind === 'constructor' || d.R.kind === 'destructor') return 'Схема метода ' + name(d.R);
  return 'Схема процедуры ' + name(d.R);
}

/**
 * Разбирает программу и строит логическую модель каждой схемы:
 * основная программа, обработчики формы, затем остальные подпрограммы.
 */
export function buildProject(code, env) {
  const prog = parsePascal(code);
  const out = [];
  const isHandler = (r) => r.cls && isFormClass(prog, r.cls) && r.params.some((pp) => /^sender$/i.test(pp.name) || /tobject/.test(pp.type));
  prog.mains.forEach((m, i) => out.push({ id: 'main' + (i ? i + 1 : ''), kind: 'program', R: null, body: m.body, line: m.line }));
  const withBody = prog.routines.filter((r) => r.body);
  const routineDiagram = (r, kind) => ({ id: 'r:' + r.name.toLowerCase(), kind, R: r, body: r.body, line: r.line });
  withBody.filter(isHandler).forEach((r) => out.push(routineDiagram(r, 'handler')));
  withBody.filter((r) => !isHandler(r)).forEach((r) => out.push(routineDiagram(r, r.isFunc ? 'function' : 'procedure')));
  const seen = {};
  for (const d of out) { if (seen[d.id]) d.id += '#' + (++seen[d.id]); else seen[d.id] = 1; }
  for (const d of out) {
    try {
      const t = transformRoutine(prog, d.R, d.body, env);
      d.ir = t.ir; d.used = t.used; d.ctx = t.ctx; d.notes = t.notes;
    } catch (e) {
      d.ir = []; d.used = new Map(); d.failed = String((e && e.message) || e);
      prog.errors.push({ line: d.line, msg: 'не удалось разобрать подпрограмму: ' + d.failed });
    }
    d.empty = !d.ir.length;
  }
  const counts = { main: out.filter((d) => d.kind === 'program').length, handler: out.filter((d) => d.kind === 'handler' && !d.empty).length };
  for (const d of out) d.title = routineTitle(d, env, counts);
  // замечания: что из программы не попало на схему или показано упрощённо
  const seenNotes = new Set();
  const notes = out.flatMap((d) => d.notes || []).filter((n) => { const k = n.line + '|' + n.msg; if (seenNotes.has(k)) return false; seenNotes.add(k); return true; }).sort((a, b) => a.line - b.line);
  return { prog, diagrams: out, errors: prog.errors, notes };
}

/** Имена из программы для таблицы «Обозначения». */
export function collectNames(project) {
  const map = new Map();
  for (const d of project.diagrams) {
    if (d.empty) continue;
    for (const [lc, u] of d.used) {
      if (u.kind === 'func') continue;
      if (!map.has(lc)) map.set(lc, { lc, name: u.name, kind: u.kind, diags: new Set() });
      map.get(lc).diags.add(d.id);
    }
    if (d.R && d.R.isFunc && !map.has('result')) map.set('result', { lc: 'result', name: 'Result', kind: 'var', diags: new Set([d.id]), note: 'результат функции' });
  }
  const order = { routine: 0, comp: 1, var: 2 };
  return [...map.values()].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
}

/** Текст комментария с пояснениями обозначений (собирается из таблицы «Обозначения»). */
export function autoCommentText(d, env) {
  const parts = [];
  const seen = new Set();
  const pushEnt = (lc, name) => {
    if (seen.has(lc)) return;
    seen.add(lc);
    const e = env.names && env.names[lc];
    if (!e || !e.desc || !e.desc.trim()) return;
    let disp = e.disp && e.disp.trim() ? e.disp : name.replace(/_/g, '\\_');
    if (lc === 'result' && !(e.disp && e.disp.trim()) && d.R) disp = (env.names[d.R.short.toLowerCase()] || {}).disp || d.R.short;
    parts.push(disp + ' – ' + e.desc.trim());
  };
  if (d.R) for (const pp of d.R.params) pushEnt(pp.name.toLowerCase(), pp.name);
  for (const [lc, u] of d.used) if (u.kind !== 'routine' && u.kind !== 'func') pushEnt(lc, u.name);
  if (d.R && d.R.isFunc) pushEnt('result', 'Result');
  if (!parts.length) return '';
  const len = (t) => plainText(t).length;
  const lines = [];
  let cur = '';
  parts.forEach((p, i) => {
    const piece = p + (i < parts.length - 1 ? ',' : '');
    if (!cur || len(cur + ' ' + piece) <= COMMENT_LINE_CHARS) { cur = cur ? cur + ' ' + piece : piece; return; }
    lines.push(cur); cur = '';
    if (len(piece) <= COMMENT_LINE_CHARS) { cur = piece; return; }
    for (const w of piece.split(' ')) { if (cur && len(cur + ' ' + w) > COMMENT_LINE_CHARS) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  });
  if (cur) lines.push(cur);
  return lines.join('\n');
}

let idCounter = 0;
/** Идентификатор элемента, добавленного вручную. */
export const newId = (prefix = 'e') => prefix + (++idCounter).toString(36) + Math.random().toString(36).slice(2, 5);

/** Высота скобки комментария по числу строк текста. */
export function commentHeight(text, gost = GOST) {
  const m = gost.metrics;
  const lines = String(text).split('\n').length;
  const textH = lines * m.font.commentPt * m.pt * m.font.lineHeight + m.comment.pad;
  const step = m.comment.heightStep;
  return Math.max(m.comment.minHeight, Math.ceil(textH / step) * step);
}

/** Символ «Комментарий» (п. 3.4.3), привязанный пунктиром к блоку target. */
export function makeComment(target, text, gost = GOST) {
  const m = gost.metrics;
  const right = gost.symbols.ports(target.shape, target.x, target.y).right[0];
  return { id: 'cm', type: 'comment', owner: target.id, ownerKey: target.key, bx: right + m.comment.offset, by: target.y, h: commentHeight(text, gost), text, size: m.font.commentPt };
}

/** Элементы схемы с координатами: символы, линии, подписи выходов, комментарий. */
export function buildGeometry(d, env) {
  const gost = env.gost || GOST;
  const L = layoutDiagram(d, env);
  const edits = (env.edits && env.edits[d.id]) || {};
  const tov = edits.text || {};
  const items = [];
  const keyToId = {};
  let lineNo = 0;
  const labelCount = {};
  for (const e of L.els) {
    if (e.k === 'b') {
      const id = 'b:' + e.key;
      let text = e.text, size = null, userText = false;
      const o = tov[e.key];
      if (o && o.orig === e.text) { if (o.text != null) { text = o.text; userText = true; } if (o.size) size = o.size; }
      else if (o && o.size && o.text == null) size = o.size;
      items.push({ id, type: 'block', shape: e.shape, x: e.x, y: e.y, num: e.num, text, autoText: e.text, userText, size, key: e.key, kind: e.kind || null, ctl: e.ctl || null, col: e.col, warn: !!e.warn });
      if (e.key) keyToId[e.key] = id;
    } else if (e.k === 'l') {
      items.push({ id: 'l' + (lineNo++), type: 'line', pts: e.pts.map((p) => [p[0], p[1]]), col: e.col, arrow: 'auto' });
    }
  }
  for (const e of L.els) {
    if (e.k !== 't') continue;
    labelCount[e.owner] = (labelCount[e.owner] || 0) + 1;
    items.push({ id: 't:' + e.owner + ':' + labelCount[e.owner], type: 'label', x: e.x, y: e.y, text: e.text, owner: keyToId[e.owner] || null, ownerKey: e.owner, col: e.col });
  }
  const auto = autoCommentText(d, env);
  const ctext = edits.comment != null ? edits.comment : auto;
  if (ctext && ctext.trim()) {
    const blocks = items.filter((i) => i.type === 'block');
    const firstAction = () => blocks.find((b) => b.shape !== 'term' && b.shape !== 'conn');
    let target = d.kind === 'function' || d.kind === 'procedure' ? firstAction() : (blocks.find((b) => b.kind === 'in') || firstAction());
    if (edits.commentOwner) { const t2 = blocks.find((b) => b.key === edits.commentOwner); if (t2) target = t2; }
    if (target) items.push(makeComment(target, ctext, gost));
  }
  return { id: d.id, items, cols: L.cols, loops: L.loops, tooTall: L.tooTall };
}

/** Габариты холста, мм (кратны модулю сетки). */
export function geomBounds(G, measure, gost = GOST) {
  const m = gost.metrics;
  const sym = gost.symbols;
  const u = m.unit;
  const width = measure || approximateMeasure(m.pt);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const byId = new Map(G.items.map((i) => [i.id, i]));
  for (const it of G.items) {
    if (it.type === 'block') {
      const [hw, hh] = sym.half(it.shape);
      add(it.x - hw, it.y - hh); add(it.x + hw, it.y + hh);
      if (sym.get(it.shape).identified) add(it.x - hw, it.y - hh - m.identifier.height);
    } else if (it.type === 'line') { for (const p of it.pts) add(p[0], p[1]); }
    else if (it.type === 'label') { add(it.x, it.y - m.label.halfHeight); add(it.x + width(it.text, m.font.labelPt), it.y + m.label.halfHeight); }
    else if (it.type === 'comment') {
      const w = Math.max(...String(it.text).split('\n').map((l) => width(l, it.size || m.font.commentPt)));
      add(it.bx, it.by - it.h / 2); add(it.bx + m.comment.textGap + w, it.by + it.h / 2);
      const owner = byId.get(it.owner);
      if (owner) add(owner.x, it.by);
    }
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, W: 12 * u, H: 8 * u };
  const down = (v) => Math.floor(v / u) * u;
  const ox = x0 < 0.4 * u ? down(x0 - u) : 0;
  const oy = y0 < 0.2 * u ? down(y0 - 0.6 * u) : 0;
  return { x0: ox, y0: oy, W: m.snapUp(x1 + m.page.margin - ox), H: m.snapUp(y1 + m.page.margin - oy), cx0: x0, cy0: y0, cx1: x1, cy1: y1 };
}

/** Перенумерация идентификаторов символов по положению (после ручной правки). */
export function renumber(G, gost = GOST) {
  const sym = gost.symbols;
  const blocks = G.items.filter((i) => i.type === 'block' && sym.get(i.shape).identified);
  const top = (b) => b.y - sym.half(b.shape)[1];
  blocks.sort((a, b) => (a.col || 0) - (b.col || 0) || Math.round((top(a) - top(b)) * 100) || a.x - b.x);
  blocks.forEach((b, i) => { b.num = i + 1; });
}

const COORD_EPS = 1e-6;
/** Доля длины восходящего отрезка, на которой ставится стрелка (чуть выше середины). */
const UP_ARROW_AT = 0.45;

/**
 * Стрелки на линии. Стандартное направление потока — слева направо и сверху вниз;
 * стрелка обязательна там, где поток идёт иначе (п. 4.2.1). Режим 'auto' ставит одну
 * стрелку на линию: в конце, если линия приходит справа налево, иначе — на самом длинном
 * восходящем отрезке. 'end' — стрелка в конце линии, 'none' — без стрелки.
 * @returns {{at:number[], dir:number[]}[]}
 */
export function autoArrows(line) {
  const pts = line.pts;
  if (!pts || pts.length < 2) return [];
  const mode = line.arrow || 'auto';
  if (mode === 'none') return [];
  const n = pts.length;
  const a = pts[n - 2], b = pts[n - 1];
  if (mode === 'end') return [{ at: b, dir: [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])] }];
  if (b[0] < a[0] - COORD_EPS && Math.abs(b[1] - a[1]) < COORD_EPS) return [{ at: b, dir: [-1, 0] }];
  let best = null;
  for (let k = 0; k + 1 < n; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    if (Math.abs(ax - bx) < COORD_EPS && by < ay - COORD_EPS && (!best || ay - by > best.len)) best = { len: ay - by, x: ax, top: by, bot: ay };
  }
  if (best) return [{ at: [best.x, best.top + (best.bot - best.top) * UP_ARROW_AT], dir: [0, -1] }];
  for (let k = n - 2; k >= 0; k--) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    if (Math.abs(ay - by) < COORD_EPS && bx < ax - COORD_EPS) return [{ at: [bx, by], dir: [-1, 0] }];
  }
  return [];
}
