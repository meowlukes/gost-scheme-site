/**
 * Интерфейс: редактор кода, лист со схемой, правка мышью, обозначения, экспорт.
 * Вся геометрия и размеры приходят из оформления (gost): здесь нет размеров символов.
 */
import { EXAMPLES } from '../core/examples.js';
import { isSameProgram, withoutExampleNames } from '../core/names.js';
import { CALL_SYMBOLS, CASE_STYLES, COLUMN_HEIGHT_RANGE, IO_SYMBOLS, MERGE_RANGE, defaultOptions, normalizeOptions } from '../core/options.js';
import { parsePascal } from '../core/parser.js';
import { autoCommentText, buildGeometry, buildProject, collectNames, commentHeight, geomBounds, makeComment, newId, renumber } from '../core/project.js';
import { checkGeometry } from '../core/validate.js';
import { GOST, TEXTS } from '../gost/index.js';
import { canvasBlob } from '../render/canvas.js';
import { buildScene } from '../render/scene.js';
import { escapeXml as esc, sceneToSvg } from '../render/svg.js';
import { createTextEngine } from '../render/text.js';
import { EXPORT, STORAGE_KEY, STATE_VERSION, TIMING, UNDO_DEPTH, ZOOM } from './config.js';
import { canBeTransparent, createExporter, exportLook, isRaster, loadVendor } from './export.js';
import { highlight } from './highlight.js';
import { cleanPts, moveEnd, moveSegment, moveVertex, snap } from './polyline.js';
import { sanitizeState } from './state.js';

const gost = GOST;
const M = gost.metrics;
const SYM = gost.symbols;
/** Шаги привязки при правке мышью: узел сетки, точный шаг (с Shift), полшага для изломов. */
const GRID = M.unit, FINE = M.unit / 5, HALF = M.unit / 2;
/** Допуски попадания, мм. */
const TOL = { boundary: 0.06, port: M.unit / 2, portDrag: 0.36 * M.unit, dragStart: 0.18 * M.unit, dblClick: 0.4 * M.unit, coord: 1e-6 };
const CSS_PX_PER_MM = 96 / 25.4;

const $ = s => document.querySelector(s);
const codeEl = $('#code'), hlEl = $('#hl'), gutterEl = $('#gutter'), board = $('#board'), boardWrap = $('#boardWrap');
const sideEl = $('#side');

// ---------- измерение текста шрифтом схемы ----------
const measureCtx = document.createElement('canvas').getContext('2d');
const plainWidths = new Map();
const MEASURE_PX = 100;
function measurePlain(str, pt) {
  let w = plainWidths.get(str);
  if (w === undefined) { measureCtx.font = `${MEASURE_PX}px ${M.font.css}`; w = measureCtx.measureText(str).width / MEASURE_PX; plainWidths.set(str, w); }
  return w * pt * M.pt;
}
const text = createTextEngine(gost, measurePlain);
const measureMarkup = text.measure;
function resetMeasureCache() { plainWidths.clear(); text.reset(); }

const S = {
  code: '', exId: EXAMPLES[0].id, names: {}, edits: {}, ifopts: {}, manual: {}, active: null,
  opts: defaultOptions(gost),
  ui: { grid: true, zoom: null, side: 'props' },
  exp: { fmt: EXPORT.formats[0], bg: 'white', fill: 'white', dpi: EXPORT.defaultDpi, caption: false }
};
let project = null, geoms = {}, sel = null, tool = 'select', draft = null, drag = null;
let undoStack = [], redoStack = [];
let lastLineClick = null;
const env = () => ({ names: S.names, opts: S.opts, edits: S.edits, ifopts: S.ifopts, measure: measureMarkup, gost });
const clone = o => structuredClone(o);

// ---------- сохранение ----------
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STATE_VERSION, code: S.code, exId: S.exId, names: S.names, edits: S.edits, ifopts: S.ifopts, manual: S.manual, opts: S.opts, ui: S.ui, exp: S.exp, active: S.active })); } catch { /* хранилище недоступно или переполнено */ }
  }, TIMING.saveDelay);
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    Object.assign(S, sanitizeState(JSON.parse(raw), S, gost));
    return true;
  } catch { return false; /* повреждённое сохранение — начинаем с примера */ }
}
function snapshot() { return JSON.stringify({ names: S.names, edits: S.edits, ifopts: S.ifopts, manual: S.manual }); }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > UNDO_DEPTH) undoStack.shift(); redoStack = []; updUndo(); }
function restore(snap) { const d = JSON.parse(snap); S.names = d.names; S.edits = d.edits; S.ifopts = d.ifopts; S.manual = d.manual; sel = null; rebuild(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); updUndo(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); updUndo(); }
function updUndo() { $('#undoBtn').disabled = !undoStack.length; $('#redoBtn').disabled = !redoStack.length; }

// ---------- уведомления ----------
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), TIMING.toast); }

// ---------- редактор кода ----------
let errLines = new Set();
function refreshEditor() {
  hlEl.innerHTML = highlight(codeEl.value);
  const n = codeEl.value.split('\n').length;
  let g = ''; for (let i = 1; i <= n; i++) g += (errLines.has(i) ? `<span class="err">${i}</span>` : i) + '\n';
  gutterEl.innerHTML = g;
  syncScroll();
}
function syncScroll() { hlEl.scrollTop = codeEl.scrollTop; hlEl.scrollLeft = codeEl.scrollLeft; gutterEl.scrollTop = codeEl.scrollTop; }
codeEl.addEventListener('scroll', syncScroll);
let buildT = null;
codeEl.addEventListener('input', () => {
  S.code = codeEl.value; refreshEditor(); save();
  if (S.opts.autoBuild) { clearTimeout(buildT); buildT = setTimeout(() => rebuild(), TIMING.buildDelay); }
});
codeEl.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); const s = codeEl.selectionStart, en = codeEl.selectionEnd; codeEl.setRangeText('  ', s, en, 'end'); codeEl.dispatchEvent(new Event('input')); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rebuild(); }
});
/** Сколько строк оставить над строкой, к которой переходим. */
const CONTEXT_LINES = 5;
const MAX_MESSAGES = 12;
const MAX_NOTES = 40;
function gotoLine(line) {
  const lines = codeEl.value.split('\n'); let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  codeEl.focus(); codeEl.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
  const lineH = parseFloat(getComputedStyle(codeEl).lineHeight) || 0;
  codeEl.scrollTop = Math.max(0, (line - CONTEXT_LINES) * lineH);
}

// ---------- построение ----------
function diagById(id) { return project && project.diagrams.find(d => d.id === id); }
function visibleDiags() { return project ? project.diagrams.filter(d => !d.empty) : []; }
function G() { if (!S.active) return null; return S.manual[S.active] || geoms[S.active] || null; }
function isManual() { return !!(S.active && S.manual[S.active]); }
function regen(id) { const d = diagById(id); if (!d || d.empty) return; geoms[id] = buildGeometry(d, env()); syncManualTexts(id); }
function syncManualTexts(id) {
  const M = S.manual[id], A = geoms[id]; if (!M || !A) return;
  const byKey = {}; A.items.forEach(i => { if (i.type === 'block' && i.key) byKey[i.key] = i; });
  M.items.forEach(i => {
    if (i.type !== 'block' || !i.key || i.userText) return;
    const a = byKey[i.key]; if (a && i.text === i.autoText && a.autoText !== i.autoText) { i.text = a.text; i.autoText = a.autoText; }
  });
  const ac = A.items.find(i => i.type === 'comment'), mc = M.items.find(i => i.type === 'comment');
  if (ac && mc && !mc.userText) mc.text = ac.text;
}
/** Разобранный пример — для сравнения с текущей программой. */
const exampleProgs = new Map();
function exampleProg(ex) {
  if (!exampleProgs.has(ex.id)) exampleProgs.set(ex.id, parsePascal(ex.code));
  return exampleProgs.get(ex.id);
}
/**
 * Если вместо примера теперь другая программа, описания обозначений из примера ей не
 * принадлежат: они убираются. Возвращает true, если что-то убрано.
 */
function detachExample() {
  const ex = S.exId && EXAMPLES.find(e => e.id === S.exId);
  if (!ex || !project || !project.prog || isSameProgram(project.prog, exampleProg(ex))) return false;
  S.exId = '';
  const kept = withoutExampleNames(S.names, ex.names);
  const changed = Object.keys(kept).length !== Object.keys(S.names).length;
  S.names = kept;
  return changed;
}
function rebuild() {
  clearTimeout(buildT);
  try { project = buildProject(S.code, env()); if (detachExample()) project = buildProject(S.code, env()); }
  catch (e) { project = { diagrams: [], notes: [], errors: [{ line: 1, msg: 'Не удалось разобрать программу: ' + e.message }] }; }
  geoms = {};
  for (const d of project.diagrams) if (!d.empty) { try { geoms[d.id] = buildGeometry(d, env()); } catch (e) { d.empty = true; project.errors.push({ line: d.line, msg: 'не удалось построить схему: ' + e.message }); } }
  syncAll();
  const vis = visibleDiags();
  if (!vis.find(d => d.id === S.active)) S.active = vis.length ? vis[0].id : null;
  for (const id of Object.keys(S.manual)) if (!diagById(id)) delete S.manual[id];
  if (sel && G() && !G().items.find(i => i.id === sel)) sel = null;
  renderTabs(); renderMsgs(); renderBoard(); renderSide(); save();
}
/** Состав автоматической схемы: по нему видно, что программа изменилась по существу. */
const structureOf = g => g.items.filter(i => i.type === 'block' && i.key).map(i => i.key + ':' + i.shape).sort().join('|');
/**
 * Сверяет ручные схемы с программой. Ручная раскладка хранит геометрию на момент правки;
 * если после этого изменился состав блоков, схема помечается как устаревшая, чтобы
 * пользователь не сохранил рисунок, не соответствующий коду.
 */
function syncAll() {
  for (const id in S.manual) {
    syncManualTexts(id);
    const man = S.manual[id], auto = geoms[id];
    if (!man || !auto) continue;
    const now = structureOf(auto);
    if (man.autoStructure === undefined) man.autoStructure = now; // сохранение прежней версии сайта
    man.stale = man.autoStructure !== now;
  }
}

// ---------- сообщения ----------
function renderMsgs() {
  const box = $('#msgs'); errLines = new Set();
  const errs = (project && project.errors) || [];
  let h = '';
  for (const e of errs.slice(0, MAX_MESSAGES)) { errLines.add(e.line); h += `<div class="msg"><button type="button" data-line="${e.line}">строка ${e.line}</button><span>${esc(e.msg)}</span></div>`; }
  if (errs.length > MAX_MESSAGES) h += `<div class="msg info">и ещё ${errs.length - MAX_MESSAGES}</div>`;
  const skipped = project ? project.diagrams.filter(d => d.empty) : [];
  if (skipped.length) h += `<div class="msg info">Без схемы (нет действий, влияющих на алгоритм): ${skipped.map(d => esc(d.R ? d.R.short : 'основная программа')).join(', ')}</div>`;
  if (project && !project.diagrams.length && S.code.trim()) h += `<div class="msg info">В тексте не найдено ни основной программы, ни подпрограмм с телом begin…end.</div>`;
  // что из программы не попало на схему или показано упрощённо
  const notes = (project && project.notes) || [];
  if (notes.length) {
    h += `<details class="notes"><summary>Показано не всё: ${notes.length}</summary>`;
    for (const n of notes.slice(0, MAX_NOTES)) h += `<div class="msg info"><button type="button" data-line="${n.line}">строка ${n.line}</button><span>${esc(n.msg)}</span></div>`;
    if (notes.length > MAX_NOTES) h += `<div class="msg info">и ещё ${notes.length - MAX_NOTES}</div>`;
    h += '</details>';
  }
  box.innerHTML = h;
  box.querySelectorAll('button[data-line]').forEach(b => b.onclick = () => gotoLine(+b.dataset.line));
  refreshEditor();
}

// ---------- вкладки схем ----------
function figNo(id) { return visibleDiags().findIndex(d => d.id === id) + 1; }
function captionOf(d) { const e = S.edits[d.id]; return (e && e.caption) || `Рисунок ${figNo(d.id)} – ${d.title}`; }
function renderTabs() {
  const box = $('#tabs'); const vis = visibleDiags();
  const stale = d => !!(S.manual[d.id] && S.manual[d.id].stale);
  box.innerHTML = vis.map((d, i) => `<button class="tab${stale(d) ? ' stale' : ''}" role="tab" type="button" data-id="${esc(d.id)}" aria-selected="${d.id === S.active}"${stale(d) ? ' title="Ручная схема не соответствует программе"' : ''}><small>Рисунок ${i + 1}</small><span>${esc(d.title)}</span></button>`).join('');
  box.querySelectorAll('.tab').forEach(b => b.onclick = () => { S.active = b.dataset.id; sel = null; draft = null; S.ui.zoom = null; renderTabs(); renderBoard(); renderSide(); save(); });
}

// ---------- доска ----------
let frame = null, zoom = 1;
/** Поле вокруг листа на экране (место для размерных линий), мм. */
const PAD = 3.2 * M.unit;
/** Масштаб «по ширине»: лист целиком по ширине; мелкие схемы не растягиваются сверх ZOOM.fitMax. */
function fitZoom(b) {
  const w = boardWrap.clientWidth - ZOOM.fitInsetPx, h = boardWrap.clientHeight - ZOOM.fitInsetPx;
  const zw = w / ((b.W + 2 * PAD) * CSS_PX_PER_MM), zh = h / ((b.H + 2 * PAD) * CSS_PX_PER_MM);
  const fit = zh < ZOOM.readable ? zw : Math.max(zh, Math.min(zw, ZOOM.fitMax));
  return Math.max(ZOOM.fitMin, Math.min(ZOOM.fitLimit, Math.min(zw, fit)));
}
let boardFrame = 0;
/** Перерисовка листа не чаще одного раза за кадр (при перетаскивании). */
function scheduleBoard() { if (!boardFrame) boardFrame = requestAnimationFrame(() => { boardFrame = 0; renderBoard(); }); }
function renderBoard() {
  const g = G(); const empty = $('#emptyState');
  if (!g) {
    board.innerHTML = ''; board.setAttribute('width', 0); board.setAttribute('height', 0);
    empty.hidden = false;
    empty.innerHTML = S.code.trim() ? '<div>Схема пока не построена.<br>Проверьте сообщения под кодом или нажмите «Построить схему».</div>' : '<div>Вставьте текст программы слева<br>или выберите пример — схема появится здесь.</div>';
    $('#status').innerHTML = ''; return;
  }
  empty.hidden = true;
  renumber(g, gost);
  const b = (drag && drag.frozen) ? drag.frozen : geomBounds(g, measureMarkup, gost); frame = b;
  if (S.ui.zoom == null) zoom = fitZoom(b); else zoom = S.ui.zoom;
  $('#zoomVal').textContent = Math.round(zoom * 100) + '%';
  const vb = [b.x0 - PAD, b.y0 - PAD, b.W + 2 * PAD, b.H + 2 * PAD];
  const pxmm = CSS_PX_PER_MM * zoom;
  board.setAttribute('viewBox', vb.join(' '));
  board.setAttribute('width', Math.round(vb[2] * pxmm)); board.setAttribute('height', Math.round(vb[3] * pxmm));
  const scene = buildScene(g, gost, text);
  const r = { body: sceneToSvg(scene, gost, { interactive: true }), overflow: scene.overflow };
  const maxH = S.opts.maxH;
  // миллиметровая сетка: шаг FINE, узлы GRID, двойной шаг выделен
  const cell = (id, size, inner, cls) => `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${inner ? `<rect width="${size}" height="${size}" fill="url(#${inner})"/>` : ''}<path class="${cls}" d="M${size} 0H0V${size}"/></pattern>`;
  let s = `<defs>${cell('gridFine', FINE, null, 'grid-fine')}${cell('gridUnit', GRID, 'gridFine', 'grid-unit')}${cell('gridMajor', 2 * GRID, 'gridUnit', 'grid-major')}</defs>`;
  s += `<rect class="sheet" x="${b.x0}" y="${b.y0}" width="${b.W}" height="${b.H}"/>`;
  if (S.ui.grid) s += `<rect x="${b.x0}" y="${b.y0}" width="${b.W}" height="${b.H}" fill="url(#gridMajor)" pointer-events="none"/>`;
  s += `<g id="content">${r.body}</g>`;
  s += overlay(g, r.overflow);
  s += dims(b, maxH);
  board.innerHTML = s;
  boardWrap.dataset.tool = tool.startsWith('add') ? 'add' : tool;
  renderStatus(g, b, r.overflow);
  lastOverflow = r.overflow;
}
let lastOverflow = [];
/** Размерные линии листа: ширина и высота в мм, красным — если лист больше страницы. */
function dims(b, maxH) {
  const pageW = M.page.width;
  const badW = b.W > pageW, badH = b.H > maxH;
  const off = 1.4 * M.unit, ext = 0.3 * M.unit, tick = 0.4 * M.unit, textGap = 0.28 * M.unit;
  const arrow = { len: 0.52 * M.unit, half: 0.11 * M.unit };
  const y = b.y0 - off, x = b.x0 - off;
  const tri = (px, py, dx, dy) => `<path class="dim-arrow" d="M${px} ${py}L${px - dx * arrow.len - dy * arrow.half} ${py - dy * arrow.len - dx * arrow.half}L${px - dx * arrow.len + dy * arrow.half} ${py - dy * arrow.len + dx * arrow.half}Z"/>`;
  let s = `<g class="dims${badW ? ' bad' : ''}" pointer-events="none">`;
  s += `<path class="dim-line" d="M${b.x0} ${b.y0 - ext}V${y - tick}M${b.x0 + b.W} ${b.y0 - ext}V${y - tick}M${b.x0} ${y}H${b.x0 + b.W}"/>`;
  s += tri(b.x0, y, -1, 0) + tri(b.x0 + b.W, y, 1, 0);
  s += `<text x="${b.x0 + b.W / 2}" y="${y - textGap}" text-anchor="middle">${b.W}${badW ? ' > ' + pageW : ''}</text></g>`;
  s += `<g class="dims${badH ? ' bad' : ''}" pointer-events="none">`;
  s += `<path class="dim-line" d="M${b.x0 - ext} ${b.y0}H${x - tick}M${b.x0 - ext} ${b.y0 + b.H}H${x - tick}M${x} ${b.y0}V${b.y0 + b.H}"/>`;
  s += tri(x, b.y0, 0, -1) + tri(x, b.y0 + b.H, 0, 1);
  s += `<text transform="translate(${x - textGap} ${b.y0 + b.H / 2}) rotate(-90)" text-anchor="middle">${b.H}${badH ? ' > ' + maxH : ''}</text>`;
  return s + '</g>';
}
/** Рамка вокруг прямоугольной области с отступом. */
const frameRect = (cls, x, y, w, h, pad) => `<rect class="${cls}" x="${x - pad}" y="${y - pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" pointer-events="none"/>`;
function commentWidth(it) { return Math.max(...String(it.text).split('\n').map(l => measureMarkup(l, it.size || M.font.commentPt))); }
/** Служебный слой: выделение, ручки линии, отметки переполнения, черновик новой линии. */
function overlay(g, overflow) {
  const pad = { mark: 0.2 * M.unit, select: 0.32 * M.unit, label: 0.16 * M.unit, comment: 0.24 * M.unit };
  const handle = 0.22 * M.unit;
  let s = '<g id="overlay">';
  for (const id of overflow) { const b = g.items.find(i => i.id === id); if (b) { const [hw, hh] = SYM.half(b.shape); s += frameRect('ov-overflow', b.x - hw, b.y - hh, 2 * hw, 2 * hh, pad.mark); } }
  const it = sel && g.items.find(i => i.id === sel);
  if (it) {
    if (it.type === 'block') { const [hw, hh] = SYM.half(it.shape); s += frameRect('ov-select', it.x - hw, it.y - hh, 2 * hw, 2 * hh, pad.select); }
    else if (it.type === 'line') {
      s += `<polyline class="ov-line" points="${it.pts.map(p => p.join(',')).join(' ')}" pointer-events="none"/>`;
      for (let k = 0; k + 1 < it.pts.length; k++) {
        const [ax, ay] = it.pts[k], [bx, by] = it.pts[k + 1];
        s += `<line class="ov-seg ${Math.abs(ax - bx) < TOL.coord ? 'v' : 'h'}" data-id="${esc(it.id)}" data-part="s:${k}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`;
      }
      it.pts.forEach((p, k) => { s += `<rect class="ov-handle" data-id="${esc(it.id)}" data-part="v:${k}" x="${p[0] - handle}" y="${p[1] - handle}" width="${2 * handle}" height="${2 * handle}"/>`; });
    } else if (it.type === 'label') s += frameRect('ov-select thin', it.x, it.y - M.label.halfHeight, measureMarkup(it.text, M.font.labelPt), 2 * M.label.halfHeight, pad.label);
    else if (it.type === 'comment') s += frameRect('ov-select', it.bx, it.by - it.h / 2, commentWidth(it) + M.comment.textGap, it.h, pad.comment);
  }
  if (draft && draft.pts.length) {
    const pts = draft.pts.concat(draft.hover ? [draft.hover] : []);
    s += `<polyline class="ov-draft" points="${pts.map(p => p.join(',')).join(' ')}" pointer-events="none"/>`;
    pts.forEach(p => { s += `<circle class="ov-draft-dot" cx="${p[0]}" cy="${p[1]}" r="${0.14 * M.unit}" pointer-events="none"/>`; });
  }
  return s + '</g>';
}
function renderStatus(g, b, overflow) {
  const n = g.items.filter(i => i.type === 'block' && SYM.get(i.shape).identified).length;
  const cols = g.cols || 1;
  const maxH = S.opts.maxH;
  const parts = [`<span class="${b.W > M.page.width || b.H > maxH ? 'bad' : ''}">Холст ${b.W} × ${b.H} мм</span>`, `<span>Блоков: ${n}</span>`];
  if (cols > 1) parts.push(`<span>Колонок: ${cols}, есть перенос</span>`);
  if (overflow.length) parts.push(`<span class="bad">Текст не помещается: ${overflow.length}</span>`);
  if (tool === 'line') parts.push('<span>Линия: щёлкайте по точкам; двойной щелчок или Enter — завершить, Esc — отменить</span>');
  else if (tool.startsWith('add')) parts.push('<span>Щёлкните на листе, чтобы поставить элемент</span>');
  if (isManual() && g.stale) parts.push('<span class="manual bad" id="staleNote">Программа изменилась — ручная схема ей больше не соответствует <button type="button" class="linkbtn" id="resetManual">построить заново</button></span>');
  else if (isManual()) parts.push('<span class="manual">Схема правилась вручную <button type="button" class="linkbtn" id="resetManual">вернуть автоматическую раскладку</button></span>');
  $('#status').innerHTML = parts.join('');
  const rb = $('#resetManual'); if (rb) rb.onclick = resetManual;
}

// ---------- ручной режим ----------
function ensureManual() {
  if (!S.active) return null;
  if (!S.manual[S.active]) { const g = clone(geoms[S.active]); g.manual = true; g.autoStructure = structureOf(geoms[S.active]); g.stale = false; S.manual[S.active] = g; }
  return S.manual[S.active];
}
function confirmRelayout() {
  if (!isManual()) return true;
  if (!confirm('Схема правилась вручную. Перестроить её автоматически? Ручные перемещения на этой схеме будут потеряны.')) return false;
  delete S.manual[S.active]; return true;
}
function resetManual() { if (!confirm('Вернуть автоматическую раскладку? Ручные перемещения на этой схеме будут потеряны, правки текста сохранятся.')) return; pushUndo(); delete S.manual[S.active]; sel = null; regen(S.active); renderBoard(); renderSide(); save(); }

// ---------- координаты ----------
function svgPoint(ev) { const pt = board.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const p = pt.matrixTransform(board.getScreenCTM().inverse()); return [p.x, p.y]; }
/** Точки присоединения линий к символу: середины сторон (п. 4.2.4). */
function ports(b) { const p = SYM.ports(b.shape, b.x, b.y); return [p.top, p.bottom, p.left, p.right]; }
function onBoundary(b, p) { return SYM.onBoundary(b.shape, p[0] - b.x, p[1] - b.y, TOL.boundary); }
function nearestPort(g, x, y, r) {
  let best = null, bd = r || TOL.port;
  for (const b of g.items) if (b.type === 'block') for (const q of ports(b)) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = q; } }
  return best;
}
// ---------- указатель ----------
board.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  const g = G(); if (!g) return;
  const [mx, my] = svgPoint(ev);
  if (tool === 'line') {
    ev.preventDefault();
    const now = performance.now(); const lc = lastLineClick;
    const dbl = lc && now - lc.t < TIMING.doubleClick && Math.hypot(lc.x - mx, lc.y - my) < TOL.dblClick;
    lastLineClick = { t: now, x: mx, y: my };
    lineClick(mx, my, dbl); return;
  }
  if (tool.startsWith('add:')) { ev.preventDefault(); addAt(tool.slice(4), mx, my); setTool('select'); return; }
  const t = ev.target.closest('[data-id]');
  if (!t) { select(null); if (ev.pointerType === 'touch') return; drag = { pan: true, sx: ev.clientX, sy: ev.clientY, sl: boardWrap.scrollLeft, st: boardWrap.scrollTop }; board.setPointerCapture(ev.pointerId); return; }
  const id = t.getAttribute('data-id'), part = t.getAttribute('data-part');
  const it = g.items.find(i => i.id === id); if (!it) return;
  if (sel !== id) select(id);
  drag = { id, part, start: [mx, my], moved: false };
  if (it.type === 'line' && !part) {
    let best = 0, bd = Infinity;
    for (let k = 0; k + 1 < it.pts.length; k++) { const d = segDist([mx, my], it.pts[k], it.pts[k + 1]); if (d < bd) { bd = d; best = k; } }
    drag.part = 's:' + best;
  }
  board.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
board.addEventListener('pointermove', ev => {
  if (tool === 'line' && draft) { const [mx, my] = svgPoint(ev); draft.hover = lineNext(mx, my); scheduleBoard(); return; }
  if (!drag) return;
  if (drag.pan) { boardWrap.scrollLeft = drag.sl - (ev.clientX - drag.sx); boardWrap.scrollTop = drag.st - (ev.clientY - drag.sy); return; }
  const [mx, my] = svgPoint(ev); const dx = mx - drag.start[0], dy = my - drag.start[1];
  if (!drag.moved) { if (Math.hypot(dx, dy) < TOL.dragStart) return; beginDrag(); }
  applyDrag(dx, dy, ev.shiftKey);
  scheduleBoard();
});
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);
board.addEventListener('dblclick', ev => {
  if (tool === 'line') { finishLine(); return; }
  const t = ev.target.closest('[data-id]'); if (!t) return;
  S.ui.side = 'props'; renderSide();
  const ta = sideEl.querySelector('textarea, input[type=text]'); if (ta) { ta.focus(); ta.select(); }
});
function beginDrag() {
  pushUndo(); drag.frozen = frame; if (S.ui.zoom == null) S.ui.zoom = zoom;
  const g = ensureManual(); drag.moved = true;
  const it = g.items.find(i => i.id === drag.id); drag.orig = clone(it);
  if (it.type === 'block') {
    drag.att = [];
    for (const l of g.items) if (l.type === 'line') {
      const n = l.pts.length;
      const a0 = onBoundary(it, l.pts[0]), a1 = onBoundary(it, l.pts[n - 1]);
      if (a0 && a1) drag.att.push({ id: l.id, both: true, pts: clone(l.pts) });
      else if (a0) drag.att.push({ id: l.id, end: 0, pts: clone(l.pts) });
      else if (a1) drag.att.push({ id: l.id, end: 1, pts: clone(l.pts) });
    }
    drag.owned = g.items.filter(o => (o.type === 'label' || o.type === 'comment') && o.owner === it.id).map(o => ({ id: o.id, o: clone(o) }));
    drag.tj = collectTJ(g, drag.att.map(a => a.id));
  } else if (it.type === 'line') drag.tj = collectTJ(g, [it.id]);
}
// Т-образные примыкания: концы других линий, лежащие на перемещаемой линии, следуют за ней
function onSegment(p, a, b) {
  const e = TOL.boundary;
  if (Math.abs(a[0] - b[0]) < 1e-6) return Math.abs(p[0] - a[0]) < e && p[1] >= Math.min(a[1], b[1]) - e && p[1] <= Math.max(a[1], b[1]) + e;
  if (Math.abs(a[1] - b[1]) < 1e-6) return Math.abs(p[1] - a[1]) < e && p[0] >= Math.min(a[0], b[0]) - e && p[0] <= Math.max(a[0], b[0]) + e;
  return false;
}
function collectTJ(g, hostIds) {
  const res = []; const hs = new Set(hostIds);
  for (const hid of hostIds) {
    const H = g.items.find(i => i.id === hid); if (!H) continue;
    const A = H.pts, n = A.length;
    for (const L of g.items) {
      if (L.type !== 'line' || hs.has(L.id)) continue;
      [0, L.pts.length - 1].forEach((ei, idx) => {
        const p = L.pts[ei];
        if (Math.hypot(p[0] - A[0][0], p[1] - A[0][1]) < TOL.boundary || Math.hypot(p[0] - A[n - 1][0], p[1] - A[n - 1][1]) < TOL.boundary) return;
        for (let k = 0; k + 1 < n; k++) if (onSegment(p, A[k], A[k + 1])) {
          const vert = Math.abs(A[k][0] - A[k + 1][0]) < 1e-6;
          res.push({ id: L.id, end: idx, pts: clone(L.pts), host: hid, vert, coord: vert ? A[k][0] : A[k][1], other: vert ? p[1] : p[0] });
          break;
        }
      });
    }
  }
  return res;
}
function updateTJ(g) {
  for (const t of drag.tj || []) {
    const H = g.items.find(i => i.id === t.host), L = g.items.find(i => i.id === t.id); if (!H || !L) continue;
    let best = null;
    for (let k = 0; k + 1 < H.pts.length; k++) {
      const a = H.pts[k], b = H.pts[k + 1]; const vert = Math.abs(a[0] - b[0]) < 1e-6;
      if (vert !== t.vert) continue;
      const lo = Math.min(t.vert ? a[1] : a[0], t.vert ? b[1] : b[0]) - TOL.boundary, hi = Math.max(t.vert ? a[1] : a[0], t.vert ? b[1] : b[0]) + TOL.boundary;
      if (t.other < lo || t.other > hi) continue;
      const c = t.vert ? a[0] : a[1];
      if (best === null || Math.abs(c - t.coord) < Math.abs(best - t.coord)) best = c;
    }
    if (best === null) { L.pts = clone(t.pts); continue; }
    const d = best - t.coord;
    L.pts = Math.abs(d) < 1e-9 ? clone(t.pts) : moveEnd(t.pts, t.end, t.vert ? d : 0, t.vert ? 0 : d, HALF);
  }
}
function applyDrag(dx, dy, fine) {
  const g = G(); const it = g.items.find(i => i.id === drag.id); if (!it) return;
  const o = drag.orig;
  if (it.type === 'block') {
    const st = fine ? FINE : GRID; const sx = snap(dx, st), sy = snap(dy, st);
    it.x = o.x + sx; it.y = o.y + sy;
    for (const a of drag.att) {
      const l = g.items.find(i => i.id === a.id); if (!l) continue;
      l.pts = a.both ? a.pts.map(p => [p[0] + sx, p[1] + sy]) : moveEnd(a.pts, a.end === 0 ? 0 : 1, sx, sy, HALF);
    }
    for (const w of drag.owned) { const ob = g.items.find(i => i.id === w.id); if (!ob) continue; if (ob.type === 'label') { ob.x = w.o.x + sx; ob.y = w.o.y + sy; } else { ob.bx = w.o.bx + sx; ob.by = w.o.by + sy; } }
    updateTJ(g);
  } else if (it.type === 'label') { it.x = o.x + snap(dx, M.label.step); it.y = o.y + snap(dy, M.label.step); }
  else if (it.type === 'comment') { it.bx = o.bx + snap(dx, M.label.step); it.by = o.by + snap(dy, M.label.step); }
  else if (it.type === 'line') {
    const st = fine ? FINE : GRID;
    const [kind, ks] = (drag.part || '').split(':'); const k = +ks;
    if (kind === 'v') { const q = [snap(o.pts[k][0] + dx, st), snap(o.pts[k][1] + dy, st)]; const port = nearestPort(g, o.pts[k][0] + dx, o.pts[k][1] + dy, TOL.portDrag); it.pts = moveVertex(o.pts, k, port || q); }
    else if (kind === 's') it.pts = moveSegment(o.pts, k, snap(dx, st), snap(dy, st));
    updateTJ(g);
  }
}
function endDrag() {
  if (!drag) return;
  if (drag.moved) {
    const g = G(); const it = g && g.items.find(i => i.id === drag.id);
    if (it && it.type === 'line') { it.pts = cleanPts(it.pts); if (drag.part && drag.part.startsWith('s')) sel = it.id; }
    if (it && it.type === 'block') for (const a of drag.att || []) { const l = g.items.find(i => i.id === a.id); if (l) l.pts = cleanPts(l.pts); }
    for (const t of drag.tj || []) { const l = g.items.find(i => i.id === t.id); if (l) l.pts = cleanPts(l.pts); }
    save(); renderBoard(); renderSide();
  }
  drag = null;
}
function select(id) { sel = id; renderBoard(); renderSide(); }

// ---------- добавление элементов ----------
/** Текст нового символа, поставленного вручную. */
const DEFAULT_TEXT = { term: TEXTS.end, rect: 'Действие', data: TEXTS.input + ' x', predef: 'Подпрограмма', dia: 'Условие', lbeg: TEXTS.loop + ' A\n1 ≤ i ≤ n', lend: TEXTS.loop + ' A\ni', conn: 'A' };
/** В каком радиусе новая подпись ищет «Решение», к которому относится. */
const OWNER_SEARCH_RADIUS = 6 * M.unit;
function nearestCol(g, x) { let best = 0, bd = Infinity; for (const b of g.items) if (b.type === 'block') { const d = Math.abs(b.x - x); if (d < bd) { bd = d; best = b.col || 0; } } return best; }
function addAt(kind, x, y) {
  pushUndo(); const g = ensureManual();
  if (kind === 'label') {
    const it = { id: newId('t'), type: 'label', x: snap(x, M.label.step), y: snap(y, M.label.step), text: TEXTS.yes, owner: null };
    let best = null, bd = OWNER_SEARCH_RADIUS; for (const b of g.items) if (b.type === 'block' && b.shape === 'dia') { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
    if (best) it.owner = best.id;
    g.items.push(it); sel = it.id;
  } else {
    const it = { id: newId('b'), type: 'block', shape: kind, x: snap(x, GRID), y: snap(y, GRID), text: DEFAULT_TEXT[kind], size: null, key: null, kind: null, col: nearestCol(g, x) };
    g.items.push(it); sel = it.id;
  }
  save(); renderBoard(); renderSide();
  const ta = sideEl.querySelector('textarea, input[type=text]'); if (ta) { ta.focus(); ta.select(); }
}
function lineNext(x, y) {
  const g = G(); const port = nearestPort(g, x, y);
  let q = port || [snap(x, GRID), snap(y, GRID)];
  if (draft && draft.pts.length) {
    const l = draft.pts[draft.pts.length - 1];
    if (Math.abs(q[0] - l[0]) >= Math.abs(q[1] - l[1])) q = [q[0], l[1]]; else q = [l[0], q[1]];
  }
  return q;
}
function lineClick(x, y, dbl) {
  if (!draft) { const g = G(); const port = nearestPort(g, x, y); draft = { pts: [port || [snap(x, GRID), snap(y, GRID)]] }; renderBoard(); return; }
  const q = lineNext(x, y); const l = draft.pts[draft.pts.length - 1];
  if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-6) draft.pts.push(q);
  const g = G(); const port = nearestPort(g, x, y);
  if (dbl || (port && draft.pts.length > 1 && Math.hypot(port[0] - q[0], port[1] - q[1]) < 1e-6)) finishLine(); else renderBoard();
}
function finishLine() {
  if (draft && draft.pts.length >= 2) {
    pushUndo(); const g = ensureManual();
    const it = { id: newId('l'), type: 'line', pts: cleanPts(draft.pts), arrow: 'auto', col: nearestCol(g, draft.pts[0][0]) };
    g.items.push(it); sel = it.id; save();
  }
  draft = null; setTool('select'); renderBoard(); renderSide();
}
function setTool(t) {
  tool = t; if (t !== 'line') draft = null;
  document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  renderBoard();
}
document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool === tool && tool !== 'select' ? 'select' : b.dataset.tool));

// ---------- удаление и сдвиг ----------
const HIDEABLE = new Set(['in', 'out', 'proc', 'call', 'err']);
function deleteSelected() {
  const g = G(); if (!g || !sel) return;
  const it = g.items.find(i => i.id === sel); if (!it) return;
  if (!isManual() && it.type === 'block' && it.key && HIDEABLE.has(it.kind) && it.key !== 'err') { hideBlock(it); return; }
  pushUndo(); const m = ensureManual();
  m.items = m.items.filter(i => i.id !== sel && !(it.type === 'block' && (i.type === 'label' || i.type === 'comment') && i.owner === it.id));
  sel = null; save(); renderBoard(); renderSide();
}
function nudge(dx, dy) {
  const g = G(); if (!g || !sel) return;
  const it = g.items.find(i => i.id === sel); if (!it || it.type === 'line') return;
  drag = { id: sel, start: [0, 0], moved: false }; beginDrag(); applyDrag(dx, dy, true); drag = null; save(); renderBoard();
}
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'textarea' || tag === 'input' || tag === 'select';
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (typing) return;
  if (e.key === 'Escape') { if (draft) { draft = null; renderBoard(); } else if (tool !== 'select') setTool('select'); else select(null); }
  else if (e.key === 'Enter' && draft) finishLine();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М') setTool('select');
  else if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') setTool('line');
  else if (sel && e.key.startsWith('Arrow')) {
    e.preventDefault(); const st = e.shiftKey ? FINE : GRID;
    nudge(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0);
  }
});

// ---------- структурные правки ----------
function edits() { return (S.edits[S.active] = S.edits[S.active] || {}); }
function hideBlock(b) {
  pushUndo();
  const E = edits();
  if (b.key.includes('+')) { const [base, idx] = b.key.split('+'); const arr = (E.inserted || {})[base]; if (arr) { arr.splice(+idx, 1); if (!arr.length) delete E.inserted[base]; } }
  else { E.hidden = E.hidden || {}; E.hidden[b.key] = true; }
  sel = null; regen(S.active); renderBoard(); renderSide(); save();
}
function insertAfter(b) {
  if (!confirmRelayout()) return; pushUndo();
  const E = edits(); E.inserted = E.inserted || {};
  let key = b.key; if (key.includes('+')) key = key.split('+')[0];
  if (key.endsWith(':b')) { toast('Добавьте действие после первого блока тела цикла'); return; }
  (E.inserted[key] = E.inserted[key] || []).push(TEXTS.newAction);
  regen(S.active);
  const nb = G().items.find(i => i.type === 'block' && i.key === key + '+' + (E.inserted[key].length - 1));
  sel = nb ? nb.id : null; renderBoard(); renderSide(); save();
  const ta = sideEl.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); }
}
function flipIf(b, what) {
  if (!confirmRelayout()) return; pushUndo();
  const d = diagById(S.active);
  const node = findIfNode(d.ir, b.key); if (!node) return;
  const io = (S.ifopts[S.active] = S.ifopts[S.active] || {});
  const cur = io[b.key] || { inv: node.inv, mode: node.mode };
  const nx = { inv: cur.inv, mode: cur.mode };
  if (what === 'inv') nx.inv = !cur.inv; else nx.mode = cur.mode === 'right' ? 'down' : 'right';
  io[b.key] = nx;
  if (what === 'inv' && S.edits[S.active] && S.edits[S.active].text) delete S.edits[S.active].text[b.key];
  regen(S.active); renderBoard(); renderSide(); save();
}
function findIfNode(ir, key) {
  let f = null;
  (function walk(seq) { for (const it of seq) { if (f) return; if (it.t === 'if') { if (it.key === key) { f = it; return; } walk(it.yes); walk(it.no); } else if (it.t === 'casc') { it.arms.forEach(a => walk(a.body)); if (it.els) walk(it.els); } else if (it.body) walk(it.body); } })(ir);
  return f;
}
function setBlockText(b, text, size) {
  const g = G(); const it = g.items.find(i => i.id === b.id); if (!it) return;
  if (text !== undefined) it.text = text;
  if (size !== undefined) it.size = size;
  if (it.key && it.autoText !== undefined) {
    const E = edits(); E.text = E.text || {};
    const cur = E.text[it.key] || { orig: it.autoText };
    cur.orig = it.autoText;
    if (text !== undefined) { cur.text = text === it.autoText ? null : text; it.userText = cur.text != null; }
    if (size !== undefined) cur.size = size;
    if (cur.text == null && !cur.size) delete E.text[it.key]; else E.text[it.key] = cur;
  }
  if (!isManual()) { regen(S.active); }
  renderBoard(); save();
}
function setComment(text) {
  const E = edits(); E.comment = text;
  const g = G(); const c = g.items.find(i => i.type === 'comment');
  if (isManual()) { if (c) { c.text = text; c.userText = true; c.h = commentHeight(text, gost); } else if (text.trim()) { const owner = g.items.find(i => i.id === sel && i.type === 'block') || g.items.find(i => i.type === 'block' && i.kind === 'in'); if (owner) g.items.push(makeComment(owner, text, gost)); } }
  else regen(S.active);
  renderBoard(); save();
}
function commentFor(b) {
  pushUndo(); const E = edits();
  if (isManual()) {
    const g = G(); g.items = g.items.filter(i => i.type !== 'comment');
    const txt = E.comment || autoCommentText(diagById(S.active), env()) || 'x – …';
    const c = makeComment(b, txt, gost); c.userText = true; g.items.push(c); E.comment = txt; sel = c.id;
  } else {
    E.commentOwner = b.key; if (!E.comment && !autoCommentText(diagById(S.active), env())) E.comment = 'x – …';
    regen(S.active); const c = G().items.find(i => i.type === 'comment'); sel = c ? c.id : sel;
  }
  renderBoard(); renderSide(); save();
  const ta = sideEl.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); }
}

// ---------- боковая панель ----------
document.querySelectorAll('.side-tabs button').forEach(b => b.onclick = () => { S.ui.side = b.dataset.side; renderSide(); save(); });
const KIND_NAME = { in: 'ввод', out: 'вывод', err: 'вывод сообщения об ошибке', proc: 'вычисление', call: 'вызов подпрограммы', cond: 'проверка условия', loop: 'цикл со счётчиком', term: '' };
/** Кегли, которые можно задать тексту символа вручную. */
const FONT_SIZES = [7, 7.5, 8, 8.5, 9, 9.5, 10, 11, 12];
function renderSide() {
  document.querySelectorAll('.side-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.side === S.ui.side)));
  if (S.ui.side === 'names') return renderNames();
  if (S.ui.side === 'export') return renderExport();
  const g = G();
  if (!g) { sideEl.innerHTML = '<p class="help">Здесь появятся свойства выбранного блока и проверка схемы по чек-листу.</p>'; return; }
  const it = sel && g.items.find(i => i.id === sel);
  if (!it) return renderDiagramProps(g);
  let h = '';
  if (it.type === 'block') {
    const def = SYM.get(it.shape);
    const title = `${def.title} (п. ${def.clause})` + (it.num ? `, блок ${it.num}` : '');
    const kn = KIND_NAME[it.kind] || '';
    h += `<h3>${esc(title)}</h3>${kn ? `<p class="hint" style="margin-top:-4px">${esc(kn)}</p>` : ''}`;
    h += `<label class="field">Текст в блоке<textarea id="pText" rows="3">${esc(it.text)}</textarea></label>`;
    if (it.shape !== 'conn') {
      h += `<label class="field">Размер шрифта<select id="pSize"><option value="">Автоматически</option>${FONT_SIZES.map(v => `<option value="${v}" ${it.size === v ? 'selected' : ''}>${String(v).replace('.', ',')} pt</option>`).join('')}</select></label>`;
    }
    if (lastOverflow.includes(it.id)) h += `<p class="hint" style="color:var(--red)">Текст не помещается даже мелким шрифтом. Сократите формулировку, перенесите часть в комментарий или разбейте на строки.</p>`;
    h += `<div class="actions">`;
    if (it.ctl === 'if') {
      h += `<button class="btn" id="aInv" type="button">Поменять «Да» и «Нет» местами</button>`;
      h += `<button class="btn" id="aMode" type="button">Ветвь «Да» — ${isRightMode(it) ? 'вниз' : 'вправо'}</button>`;
    }
    if (it.key && HIDEABLE.has(it.kind) && it.key !== 'err' && !isManual()) h += `<button class="btn" id="aHide" type="button">Убрать блок из схемы</button>`;
    if (it.key && !isManual() && it.shape !== 'dia' && it.key !== 'stop' && !String(it.key).startsWith('conn') && it.key !== 'err' && !String(it.key).endsWith(':b')) h += `<button class="btn" id="aIns" type="button">Добавить действие ниже</button>`;
    if (it.shape !== 'conn') h += `<button class="btn" id="aCmt" type="button">Комментарий к этому блоку</button>`;
    if (isManual() || !it.key) h += `<button class="btn danger" id="aDel" type="button">Удалить с листа</button>`;
    h += `</div>`;
    h += markupHelp();
  } else if (it.type === 'line') {
    h += `<h3>Соединительная линия</h3>`;
    h += `<label class="field">Стрелка<select id="pArrow"><option value="auto" ${it.arrow === 'auto' || !it.arrow ? 'selected' : ''}>По правилу (справа налево и снизу вверх)</option><option value="end" ${it.arrow === 'end' ? 'selected' : ''}>В конце линии</option><option value="none" ${it.arrow === 'none' ? 'selected' : ''}>Без стрелки</option></select></label>`;
    const lens = []; for (let k = 0; k + 1 < it.pts.length; k++) lens.push(Math.round(Math.hypot(it.pts[k + 1][0] - it.pts[k][0], it.pts[k + 1][1] - it.pts[k][1]) * 100) / 100);
    const offGrid = v => Math.abs(v / GRID - Math.round(v / GRID)) > TOL.boundary;
    h += `<p class="hint">Длины отрезков, мм: ${lens.map(v => `<span class="${offGrid(v) ? 'bad' : ''}">${String(v).replace('.', ',')}</span>`).join(', ')}</p>`;
    h += `<div class="actions"><button class="btn danger" id="aDel" type="button">Удалить линию</button></div>`;
    h += `<div class="help" style="margin-top:14px"><p>Тяните отрезок, чтобы сдвинуть его параллельно себе, или квадратик в изломе — чтобы переставить точку. Шаг ${GRID} мм, с Shift — ${FINE} мм.</p></div>`;
  } else if (it.type === 'label') {
    h += `<h3>Подпись ветви</h3><label class="field">Текст<input type="text" id="pLab" value="${esc(it.text)}"></label>`;
    h += `<div class="actions"><button class="btn" id="aYN" type="button">Заменить на «${it.text === TEXTS.yes ? TEXTS.no : TEXTS.yes}»</button><button class="btn danger" id="aDel" type="button">Удалить подпись</button></div>`;
  } else if (it.type === 'comment') {
    h += `<h3>Комментарий</h3><label class="field">Текст комментария<textarea id="pCmt" rows="4">${esc(it.text)}</textarea></label>`;
    h += `<p class="hint">Пояснения к обозначениям удобнее заполнять на вкладке «Обозначения» — комментарий соберётся сам.</p>`;
    h += `<div class="actions"><button class="btn danger" id="aDelC" type="button">Убрать комментарий</button></div>` + markupHelp();
  }
  sideEl.innerHTML = h;
  const on = (id, ev, fn) => { const el = sideEl.querySelector('#' + id); if (el) el.addEventListener(ev, fn); };
  let typedOnce = false;
  const onceUndo = () => { if (!typedOnce) { pushUndo(); typedOnce = true; } };
  on('pText', 'input', e => { onceUndo(); setBlockText(it, e.target.value); });
  on('pSize', 'change', e => { pushUndo(); setBlockText(it, undefined, e.target.value ? +e.target.value : null); });
  on('aInv', 'click', () => flipIf(it, 'inv'));
  on('aMode', 'click', () => flipIf(it, 'mode'));
  on('aHide', 'click', () => hideBlock(it));
  on('aIns', 'click', () => insertAfter(it));
  on('aCmt', 'click', () => commentFor(it));
  on('aDel', 'click', () => { const m = ensureManual(); if (m) { pushUndo(); m.items = m.items.filter(i => i.id !== it.id && !(it.type === 'block' && i.owner === it.id)); sel = null; save(); renderBoard(); renderSide(); } });
  on('pArrow', 'change', e => { pushUndo(); const m = ensureManual(); const l = m.items.find(i => i.id === it.id); l.arrow = e.target.value; save(); renderBoard(); });
  on('pLab', 'input', e => { onceUndo(); const m = ensureManual(); const l = m.items.find(i => i.id === it.id); l.text = e.target.value; save(); renderBoard(); });
  on('aYN', 'click', () => { pushUndo(); const m = ensureManual(); const l = m.items.find(i => i.id === it.id); l.text = l.text === TEXTS.yes ? TEXTS.no : TEXTS.yes; save(); renderBoard(); renderSide(); });
  on('pCmt', 'input', e => { onceUndo(); setComment(e.target.value); });
  on('aDelC', 'click', () => { pushUndo(); edits().comment = ''; if (isManual()) { const m = G(); m.items = m.items.filter(i => i.type !== 'comment'); } else regen(S.active); sel = null; renderBoard(); renderSide(); save(); });
}
function isRightMode(b) {
  const d = diagById(S.active); const node = d && findIfNode(d.ir, b.key); if (!node) return false;
  const o = (S.ifopts[S.active] || {})[b.key]; return (o ? o.mode : node.mode) === 'right';
}
function markupHelp() {
  return `<div class="help" style="margin-top:16px"><p><b>Запись формул</b></p><p><span class="kbd">x_i</span> индекс, <span class="kbd">a_{i-1}</span> длинный индекс, <span class="kbd">x^2</span> степень, <span class="kbd">√{a+b}</span> корень. Символы ≤ ≥ ≠ π · – можно вставлять прямо в текст.</p><p>Новая строка в блоке — Enter.</p></div>`;
}
function renderDiagramProps(g) {
  const d = diagById(S.active);
  const b = geomBounds(g, measureMarkup, gost);
  const checks = checkGeometry(g, b, lastOverflow.length, S.opts.maxH, gost);
  let h = `<h3>${esc(d.title)}</h3>`;
  h += `<label class="field">Подпись под рисунком в отчёте<input type="text" id="pCap" value="${esc(captionOf(d))}"></label>`;
  h += `<h4>Проверка по ГОСТ 19.701-90</h4><ul class="check">${checks.map(c => `<li class="${c.ok ? '' : 'no'}"><span>${esc(c.text)} <small>${/^\d/.test(c.clause) ? 'п. ' : ''}${esc(c.clause)}</small></span></li>`).join('')}</ul>`;
  h += `<p class="hint" style="margin-top:8px">Вставляйте рисунок в отчёт без масштабирования: у PNG записано разрешение, поэтому Word покажет его в натуральную величину ${b.W} × ${b.H} мм.</p>`;
  h += `<h4>Как править</h4><div class="help">
    <p>Щёлкните по блоку — здесь появится его текст. Правки текста сохраняются и после перестроения схемы.</p>
    <p>Перетаскивайте блоки, отрезки линий и подписи мышью: связанные линии следуют за блоком. Шаг ${GRID} мм, с Shift — ${FINE} мм. Стрелки на клавиатуре двигают выделенное.</p>
    <p>Панель над листом добавляет символы схемы программы: терминатор, процесс, данные, предопределённый процесс, решение, границы цикла, соединитель, а также подпись выхода и линию.</p>
    <p><span class="kbd">Del</span> удалить, <span class="kbd">Ctrl</span>+<span class="kbd">Z</span> отменить, <span class="kbd">Esc</span> снять выделение.</p></div>`;
  sideEl.innerHTML = h;
  const cap = sideEl.querySelector('#pCap');
  cap.addEventListener('change', e => { pushUndo(); const E = edits(); E.caption = e.target.value.trim() || null; save(); });
}

// ---------- обозначения ----------
let namesT = null;
function renderNames() {
  if (!project) { sideEl.innerHTML = ''; return; }
  const rows = collectNames(project);
  const groups = [['routine', 'Подпрограммы'], ['comp', 'Элементы формы'], ['var', 'Переменные и параметры']];
  let h = `<h3>Обозначения на схеме</h3><p class="help">Схема не зависит от языка, поэтому длинным именам можно дать короткие обозначения, а подпрограммам — русские имена. Пояснения собираются в комментарий к блоку ввода (к первому блоку в схеме функции).</p>`;
  h += `<table class="names"><colgroup><col style="width:30%"><col style="width:26%"><col></colgroup>`;
  for (const [k, title] of groups) {
    const list = rows.filter(r => r.kind === k); if (!list.length) continue;
    h += `<tr><th colspan="3">${title}</th></tr><tr><td></td><td class="hint">на схеме</td><td class="hint">пояснение</td></tr>`;
    for (const r of list) {
      const e = S.names[r.lc] || {};
      h += `<tr><td title="${esc(r.name)}">${esc(r.name)}</td><td${k === 'routine' ? ' colspan="2"' : ''}><input class="disp" data-lc="${esc(r.lc)}" data-f="disp" value="${esc(e.disp || '')}" placeholder="${esc(r.lc === 'result' ? 'имя функции' : k === 'routine' ? 'русское имя, например Проверка' : r.name)}" aria-label="Обозначение для ${esc(r.name)}"></td>` +
        (k === 'routine' ? '' : `<td><input data-lc="${esc(r.lc)}" data-f="desc" value="${esc(e.desc || '')}" placeholder="${r.lc === 'result' ? 'результат функции' : ''}" aria-label="Пояснение для ${esc(r.name)}"></td>`) + `</tr>`;
    }
  }
  h += `</table>`;
  if (!rows.length) h += '<p class="hint">Постройте схему — здесь появятся имена из программы.</p>';
  sideEl.innerHTML = h;
  let pushed = false;
  sideEl.querySelectorAll('table.names input').forEach(inp => inp.addEventListener('input', () => {
    if (!pushed) { pushUndo(); pushed = true; }
    const lc = inp.dataset.lc; const e = (S.names[lc] = S.names[lc] || {});
    e[inp.dataset.f] = inp.value;
    if (!e.disp && !e.desc) delete S.names[lc];
    clearTimeout(namesT); namesT = setTimeout(rebuildKeepSide, TIMING.namesDelay);
  }));
}
function rebuildKeepSide() {
  project = buildProject(S.code, env());
  geoms = {}; for (const d of project.diagrams) if (!d.empty) geoms[d.id] = buildGeometry(d, env());
  syncAll(); renderTabs(); renderBoard(); save();
}

// ---------- экспорт ----------
const exporter = createExporter(gost, text);
function renderExport() {
  const g = G();
  if (!g) { sideEl.innerHTML = '<p class="help">Сначала постройте схему.</p>'; return; }
  const E = S.exp; const b = geomBounds(g, measureMarkup, gost);
  const { bg } = exportLook(E);
  const H = b.H + (E.caption ? M.caption.height : 0);
  const px = [Math.round(b.W / 25.4 * E.dpi), Math.round(H / 25.4 * E.dpi)];
  const seg = (name, val, opts) => `<div class="seg" data-k="${name}">${opts.map(([v, t, dis]) => `<button type="button" data-v="${v}" aria-pressed="${String(val) === String(v)}" ${dis ? 'disabled' : ''}>${t}</button>`).join('')}</div>`;
  let h = `<h3>Сохранить изображение</h3>`;
  h += `<div class="exprow"><div>Формат</div>${seg('fmt', E.fmt, EXPORT.formats.map(f => [f, EXPORT.labels[f]]))}</div>`;
  h += `<div class="exprow"><div>Фон</div>${seg('bg', bg, [['white', 'Белый'], ['transparent', 'Прозрачный', !canBeTransparent(E.fmt)]])}</div>`;
  if (bg === 'transparent') h += `<div class="exprow"><div>Заливка блоков на прозрачном фоне</div>${seg('fill', E.fill, [['white', 'Белая'], ['none', 'Без заливки']])}</div>`;
  if (isRaster(E.fmt)) h += `<div class="exprow"><div>Разрешение</div>${seg('dpi', E.dpi, EXPORT.dpi.map(d => [d, d + ' dpi']))}</div>`;
  h += `<label class="setrow start"><input type="checkbox" id="eCap" ${E.caption ? 'checked' : ''}> Добавить подпись «${esc(captionOf(diagById(S.active)).slice(0, EXPORT.captionPreview))}…» под схемой</label>`;
  h += `<div class="expinfo">Размер ${b.W} × ${H} мм${isRaster(E.fmt) && E.fmt !== 'pdf' ? `, ${px[0]} × ${px[1]} пикселей` : ''}. ${E.fmt === 'svg' ? 'Векторный файл: текст остаётся текстом, шрифт Times New Roman.' : E.fmt === 'pdf' ? 'Страница PDF точно по размеру схемы.' : 'Разрешение записано в файл — Word вставит рисунок в масштабе 1:1.'}</div>`;
  h += `<div class="actions"><button class="btn primary" id="eSave" type="button">Скачать ${EXPORT.labels[E.fmt]}</button>`;
  h += `<button class="btn" id="eAll" type="button">Скачать все схемы одним архивом ZIP</button>`;
  h += `<button class="btn" id="eCopy" type="button">Копировать PNG в буфер обмена</button></div>`;
  h += `<p class="hint gap">На экспортируемом рисунке нет сетки, выделения и подсказок — только сама схема.</p>`;
  sideEl.innerHTML = h;
  sideEl.querySelectorAll('.seg[data-k] button').forEach(btn => btn.onclick = () => {
    const k = btn.parentElement.dataset.k; let v = btn.dataset.v; if (k === 'dpi') v = +v;
    S.exp[k] = v; save(); renderExport();
  });
  sideEl.querySelector('#eCap').onchange = e => { S.exp.caption = e.target.checked; save(); renderExport(); };
  sideEl.querySelector('#eSave').onclick = () => exportCurrent();
  sideEl.querySelector('#eAll').onclick = () => exportAll();
  sideEl.querySelector('#eCopy').onclick = () => copyPng();
}
function saveBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, TIMING.revokeUrl);
  toast('Файл сохранён: ' + name);
}
async function exportCurrent() {
  try { const f = await exporter.makeFile(G(), S.exp, captionOf(diagById(S.active))); saveBlob(f.name, f.blob); }
  catch (e) { toast(e.message || 'Не удалось сохранить файл'); }
}
async function exportAll() {
  try {
    const JSZip = await loadVendor('zip');
    const zip = new JSZip();
    for (const d of visibleDiags()) {
      const g = S.manual[d.id] || geoms[d.id]; if (!g) continue; renumber(g, gost);
      const f = await exporter.makeFile(g, S.exp, captionOf(d)); zip.file(f.name, f.blob);
    }
    saveBlob(EXPORT.archiveName, await zip.generateAsync({ type: 'blob' }));
  } catch (e) { toast(e.message || 'Не удалось собрать архив'); }
}
async function copyPng() {
  try {
    const g = G(); const b = geomBounds(g, measureMarkup, gost);
    const E = { ...S.exp, fmt: 'png' };
    const blob = await canvasBlob(exporter.rasterCanvas(g, b, E, S.exp.caption ? captionOf(diagById(S.active)) : null), 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Схема скопирована — вставьте её в документ');
  } catch { toast('Браузер не разрешил доступ к буферу обмена — скачайте PNG'); }
}

// ---------- масштаб и прочее ----------
const clampZoom = z => Math.max(ZOOM.min, Math.min(ZOOM.max, z));
$('#zoomIn').onclick = () => { S.ui.zoom = clampZoom((S.ui.zoom || zoom) * ZOOM.step); renderBoard(); };
$('#zoomOut').onclick = () => { S.ui.zoom = clampZoom((S.ui.zoom || zoom) / ZOOM.step); renderBoard(); };
$('#zoomFit').onclick = () => { S.ui.zoom = null; renderBoard(); };
$('#zoom1').onclick = () => { S.ui.zoom = 1; renderBoard(); };
$('#gridBtn').onclick = () => { S.ui.grid = !S.ui.grid; $('#gridBtn').setAttribute('aria-pressed', String(S.ui.grid)); renderBoard(); save(); };
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
boardWrap.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); S.ui.zoom = clampZoom((S.ui.zoom || zoom) * (e.deltaY < 0 ? ZOOM.wheelStep : 1 / ZOOM.wheelStep)); scheduleBoard(); }, { passive: false });
let rsT = null; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (S.ui.zoom == null) renderBoard(); }, TIMING.resizeDelay); });

$('#buildBtn').onclick = () => {
  const manualIds = Object.keys(S.manual);
  if (manualIds.length && confirm('Некоторые схемы правились вручную. Перестроить и их по новому коду? «Отмена» — перестроить только остальные.')) { pushUndo(); S.manual = {}; }
  rebuild(); toast('Схема построена');
};
// примеры
const exSel = $('#exampleSel');
exSel.innerHTML = '<option value="">Пример программы…</option>' + EXAMPLES.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
exSel.onchange = () => {
  const ex = EXAMPLES.find(e => e.id === exSel.value); exSel.value = '';
  if (!ex) return;
  if (S.code.trim() && S.code !== (EXAMPLES.find(e => e.id === S.exId) || {}).code && !confirm('Заменить текущий код примером? Правки схем для текущего кода будут сброшены.')) return;
  loadExample(ex);
};
function loadExample(ex) {
  S.code = ex.code; S.exId = ex.id; S.names = clone(ex.names || {}); S.edits = {}; S.ifopts = {}; S.manual = {}; S.active = null; sel = null;
  undoStack = []; redoStack = []; updUndo();
  codeEl.value = S.code; codeEl.scrollTop = 0; refreshEditor(); rebuild();
}
$('#openBtn').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const buf = await f.arrayBuffer();
  let txt = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (txt.includes('\uFFFD')) { try { txt = new TextDecoder('windows-1251').decode(buf); } catch { /* кодировка не поддерживается — оставить utf-8 */ } }
  S.code = txt; S.edits = {}; S.ifopts = {}; S.manual = {}; S.active = null; sel = null;
  codeEl.value = txt; refreshEditor(); rebuild(); e.target.value = ''; toast('Открыт файл ' + f.name);
};
// настройки
const SYMBOL_OPTION_TEXT = {
  ioSymbol: { process: '«Процесс» (как в методичке)', data: '«Данные» (параллелограмм)' },
  callSymbol: { predefined: '«Предопределённый процесс»', process: '«Процесс»' },
  caseStyle: { multi: 'Одно «Решение» с несколькими выходами', cascade: 'Цепочка «Решений» Да/Нет' },
};
const SYMBOL_OPTION_VALUES = { ioSymbol: IO_SYMBOLS, callSymbol: CALL_SYMBOLS, caseStyle: CASE_STYLES };
function applyOptions(patch) { S.opts = normalizeOptions({ ...S.opts, ...patch }, gost); renderSettings(); rebuild(); }
function renderSettings() {
  document.querySelectorAll('#setMerge button').forEach(b => { b.hidden = +b.dataset.v < MERGE_RANGE.min || +b.dataset.v > MERGE_RANGE.max; b.setAttribute('aria-pressed', String(+b.dataset.v === S.opts.mergeN)); b.onclick = () => applyOptions({ mergeN: +b.dataset.v }); });
  const c = $('#setCollapse'); c.checked = S.opts.collapseIO; c.onchange = () => applyOptions({ collapseIO: c.checked });
  const m = $('#setMaxH'); m.min = COLUMN_HEIGHT_RANGE.min; m.max = COLUMN_HEIGHT_RANGE.max; m.step = GRID; m.value = S.opts.maxH; m.onchange = () => applyOptions({ maxH: +m.value });
  const a = $('#setAuto'); a.checked = S.opts.autoBuild; a.onchange = () => { S.opts.autoBuild = a.checked; save(); };
  const sp = $('#setSplit'); sp.checked = S.opts.splitLongBranches; sp.onchange = () => applyOptions({ splitLongBranches: sp.checked });
  for (const [key, values] of Object.entries(SYMBOL_OPTION_VALUES)) {
    const el = $('#set-' + key);
    el.innerHTML = values.map(v => `<option value="${v}">${esc(SYMBOL_OPTION_TEXT[key][v])}</option>`).join('');
    el.value = S.opts[key];
    el.onchange = () => applyOptions({ [key]: el.value });
  }
}

// ---------- запуск ----------
const had = load();
if (!had || !S.code) { const ex = EXAMPLES[0]; S.code = ex.code; S.exId = ex.id; S.names = clone(ex.names || {}); }
codeEl.value = S.code; refreshEditor(); renderSettings(); updUndo();
$('#gridBtn').setAttribute('aria-pressed', String(S.ui.grid));
rebuild();
const fontsDone = () => { resetMeasureCache(); rebuild(); };
if (document.fonts && document.fonts.load) {
  const probes = M.font.family.map(f => document.fonts.load(`12px "${f}"`));
  Promise.all(probes).then(() => document.fonts.ready).then(fontsDone).catch(fontsDone);
}
