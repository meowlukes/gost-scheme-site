// ===================== ПРИЛОЖЕНИЕ =====================
(function () {
'use strict';
const LS_KEY = 'gost-pascal-scheme-v1';
const $ = s => document.querySelector(s);
const codeEl = $('#code'), hlEl = $('#hl'), gutterEl = $('#gutter'), board = $('#board'), boardWrap = $('#boardWrap');
const sideEl = $('#side');

const S = {
  code: '', exId: 'lr3', names: {}, edits: {}, ifopts: {}, manual: {}, active: null,
  opts: { mergeN: 3, collapseIO: true, maxH: 245, autoBuild: true },
  ui: { grid: true, zoom: null, side: 'props' },
  exp: { fmt: 'png', bg: 'white', fill: 'white', dpi: 300, caption: false }
};
let project = null, geoms = {}, sel = null, tool = 'select', draft = null, drag = null, lastFit = 1;
let undoStack = [], redoStack = [];
let lastLineClick = null;
const env = () => ({ names: S.names, opts: S.opts, edits: S.edits, ifopts: S.ifopts, measure: measureMarkup });
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- сохранение ----------
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ code: S.code, exId: S.exId, names: S.names, edits: S.edits, ifopts: S.ifopts, manual: S.manual, opts: S.opts, ui: S.ui, exp: S.exp, active: S.active })); } catch (e) { /* хранилище недоступно */ }
  }, 300);
}
function load() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) { const d = JSON.parse(raw); Object.assign(S, d, { opts: Object.assign(S.opts, d.opts || {}), ui: Object.assign(S.ui, d.ui || {}), exp: Object.assign(S.exp, d.exp || {}) }); return true; } } catch (e) { /* пусто */ }
  return false;
}
function snapshot() { return JSON.stringify({ names: S.names, edits: S.edits, ifopts: S.ifopts, manual: S.manual }); }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); redoStack = []; updUndo(); }
function restore(snap) { const d = JSON.parse(snap); S.names = d.names; S.edits = d.edits; S.ifopts = d.ifopts; S.manual = d.manual; sel = null; rebuild(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); updUndo(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); updUndo(); }
function updUndo() { $('#undoBtn').disabled = !undoStack.length; $('#redoBtn').disabled = !redoStack.length; }

// ---------- уведомления ----------
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

// ---------- редактор кода ----------
function highlight(src) {
  const re = /(\{[\s\S]*?(?:\}|$)|\(\*[\s\S]*?(?:\*\)|$)|\/\/[^\n]*)|('(?:[^'\n]|'')*'?|#\$?[0-9A-Fa-f]+)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\$[0-9A-Fa-f]+)|([A-Za-z_\u0400-\u04FF][\w\u0400-\u04FF]*)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="n">${esc(m[3])}</span>`;
    else if (m[4]) out += RESERVED.has(m[4].toLowerCase()) ? `<span class="k">${esc(m[4])}</span>` : esc(m[4]);
    last = re.lastIndex;
    if (m[0].length === 0) re.lastIndex++;
  }
  return out + esc(src.slice(last)) + '\n';
}
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
  if (S.opts.autoBuild) { clearTimeout(buildT); buildT = setTimeout(() => rebuild(), 700); }
});
codeEl.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); const s = codeEl.selectionStart, en = codeEl.selectionEnd; codeEl.setRangeText('  ', s, en, 'end'); codeEl.dispatchEvent(new Event('input')); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rebuild(); }
});
function gotoLine(line) {
  const lines = codeEl.value.split('\n'); let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  codeEl.focus(); codeEl.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
  codeEl.scrollTop = Math.max(0, (line - 5) * 20);
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
function rebuild() {
  clearTimeout(buildT);
  try { project = buildProject(S.code, env()); }
  catch (e) { project = { diagrams: [], errors: [{ line: 1, msg: 'Не удалось разобрать программу: ' + e.message }] }; }
  geoms = {};
  for (const d of project.diagrams) if (!d.empty) { try { geoms[d.id] = buildGeometry(d, env()); } catch (e) { d.empty = true; project.errors.push({ line: d.line, msg: 'не удалось построить схему: ' + e.message }); } }
  syncAll();
  const vis = visibleDiags();
  if (!vis.find(d => d.id === S.active)) S.active = vis.length ? vis[0].id : null;
  for (const id of Object.keys(S.manual)) if (!diagById(id)) delete S.manual[id];
  if (sel && G() && !G().items.find(i => i.id === sel)) sel = null;
  renderTabs(); renderMsgs(); renderBoard(); renderSide(); save();
}
function syncAll() { for (const id in S.manual) syncManualTexts(id); }

// ---------- сообщения ----------
function renderMsgs() {
  const box = $('#msgs'); errLines = new Set();
  const errs = (project && project.errors) || [];
  let h = '';
  for (const e of errs.slice(0, 12)) { errLines.add(e.line); h += `<div class="msg"><button type="button" data-line="${e.line}">строка ${e.line}</button><span>${esc(e.msg)}</span></div>`; }
  if (errs.length > 12) h += `<div class="msg info">и ещё ${errs.length - 12}</div>`;
  const skipped = project ? project.diagrams.filter(d => d.empty) : [];
  if (skipped.length) h += `<div class="msg info">Без схемы (нет действий, влияющих на алгоритм): ${skipped.map(d => esc(d.R ? d.R.short : 'основная программа')).join(', ')}</div>`;
  if (project && !project.diagrams.length && S.code.trim()) h += `<div class="msg info">В тексте не найдено ни основной программы, ни подпрограмм с телом begin…end.</div>`;
  box.innerHTML = h;
  box.querySelectorAll('button[data-line]').forEach(b => b.onclick = () => gotoLine(+b.dataset.line));
  refreshEditor();
}

// ---------- вкладки схем ----------
function figNo(id) { return visibleDiags().findIndex(d => d.id === id) + 1; }
function captionOf(d) { const e = S.edits[d.id]; return (e && e.caption) || `Рисунок ${figNo(d.id)} – ${d.title}`; }
function renderTabs() {
  const box = $('#tabs'); const vis = visibleDiags();
  box.innerHTML = vis.map((d, i) => `<button class="tab" role="tab" type="button" data-id="${esc(d.id)}" aria-selected="${d.id === S.active}"><small>Рисунок ${i + 1}</small><span>${esc(d.title)}</span></button>`).join('');
  box.querySelectorAll('.tab').forEach(b => b.onclick = () => { S.active = b.dataset.id; sel = null; draft = null; S.ui.zoom = null; renderTabs(); renderBoard(); renderSide(); save(); });
}

// ---------- доска ----------
let frame = null, zoom = 1;
const PAD = 16;
function fitZoom(b) {
  const w = boardWrap.clientWidth - 24, h = boardWrap.clientHeight - 24;
  const pxmm = 96 / 25.4;
  const zw = w / ((b.W + 2 * PAD) * pxmm), zh = h / ((b.H + 2 * PAD) * pxmm);
  return Math.max(0.3, Math.min(3, Math.min(zw, zh < 0.55 ? zw : Math.max(zh, Math.min(zw, 1.2)))));
}
function renderBoard() {
  const g = G(); const empty = $('#emptyState');
  if (!g) {
    board.innerHTML = ''; board.setAttribute('width', 0); board.setAttribute('height', 0);
    empty.hidden = false;
    empty.innerHTML = S.code.trim() ? '<div>Схема пока не построена.<br>Проверьте сообщения под кодом или нажмите «Построить схему».</div>' : '<div>Вставьте текст программы слева<br>или выберите пример — схема появится здесь.</div>';
    $('#status').innerHTML = ''; return;
  }
  empty.hidden = true;
  renumber(g);
  const b = (drag && drag.frozen) ? drag.frozen : geomBounds(g, measureMarkup); frame = b;
  if (S.ui.zoom == null) zoom = fitZoom(b); else zoom = S.ui.zoom;
  $('#zoomVal').textContent = Math.round(zoom * 100) + '%';
  const vb = [b.x0 - PAD, b.y0 - PAD, b.W + 2 * PAD, b.H + 2 * PAD];
  const pxmm = 96 / 25.4 * zoom;
  board.setAttribute('viewBox', vb.join(' '));
  board.setAttribute('width', Math.round(vb[2] * pxmm)); board.setAttribute('height', Math.round(vb[3] * pxmm));
  const r = renderSVG(g, { interactive: true });
  const maxH = S.opts.maxH || 245;
  let s = `<defs>
    <pattern id="gm1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#E4A27A" stroke-width="0.035" opacity=".55"/></pattern>
    <pattern id="gm5" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#gm1)"/><path d="M5 0H0V5" fill="none" stroke="#E4A27A" stroke-width="0.07" opacity=".8"/></pattern>
    <pattern id="gm10" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="url(#gm5)"/><path d="M10 0H0V10" fill="none" stroke="#DA8B5B" stroke-width="0.12" opacity=".75"/></pattern>
  </defs>`;
  s += `<rect x="${b.x0}" y="${b.y0}" width="${b.W}" height="${b.H}" fill="#fff" stroke="#9aa39c" stroke-width="0.15"/>`;
  if (S.ui.grid) s += `<rect x="${b.x0}" y="${b.y0}" width="${b.W}" height="${b.H}" fill="url(#gm10)" pointer-events="none"/>`;
  s += `<g id="content">${r.body}</g>`;
  s += overlay(g, r.overflow);
  s += dims(b, maxH);
  board.innerHTML = s;
  boardWrap.dataset.tool = tool.startsWith('add') ? 'add' : tool;
  renderStatus(g, b, r.overflow);
  lastOverflow = r.overflow;
}
let lastOverflow = [];
function dims(b, maxH) {
  const badW = b.W > 170, badH = b.H > maxH;
  const cw = badW ? '#BF3328' : '#5A635E', ch = badH ? '#BF3328' : '#5A635E';
  const y = b.y0 - 7, x = b.x0 - 7, sw = 0.18;
  const tri = (px, py, dx, dy, c) => `<path d="M${px} ${py}L${px - dx * 2.6 - dy * 0.55} ${py - dy * 2.6 - dx * 0.55}L${px - dx * 2.6 + dy * 0.55} ${py - dy * 2.6 + dx * 0.55}Z" fill="${c}"/>`;
  let s = `<g class="dims" pointer-events="none">`;
  s += `<path d="M${b.x0} ${b.y0 - 1.5}V${y - 2}M${b.x0 + b.W} ${b.y0 - 1.5}V${y - 2}M${b.x0} ${y}H${b.x0 + b.W}" stroke="${cw}" stroke-width="${sw}" fill="none"/>`;
  s += tri(b.x0, y, -1, 0, cw) + tri(b.x0 + b.W, y, 1, 0, cw);
  s += `<text x="${b.x0 + b.W / 2}" y="${y - 1.4}" text-anchor="middle" font-size="3.6" fill="${cw}">${b.W}${badW ? ' > 170' : ''}</text>`;
  s += `<path d="M${b.x0 - 1.5} ${b.y0}H${x - 2}M${b.x0 - 1.5} ${b.y0 + b.H}H${x - 2}M${x} ${b.y0}V${b.y0 + b.H}" stroke="${ch}" stroke-width="${sw}" fill="none"/>`;
  s += tri(x, b.y0, 0, -1, ch) + tri(x, b.y0 + b.H, 0, 1, ch);
  s += `<text transform="translate(${x - 1.4} ${b.y0 + b.H / 2}) rotate(-90)" text-anchor="middle" font-size="3.6" fill="${ch}">${b.H}${badH ? ' > ' + maxH : ''}</text>`;
  return s + '</g>';
}
function overlay(g, overflow) {
  let s = '<g id="overlay">';
  for (const id of overflow) { const b = g.items.find(i => i.id === id); if (b) { const [hw, hh] = shapeHalf(b); s += `<rect x="${b.x - hw - 1}" y="${b.y - hh - 1}" width="${2 * hw + 2}" height="${2 * hh + 2}" fill="none" stroke="#BF3328" stroke-width="0.35" stroke-dasharray="1.2 0.8" pointer-events="none"/>`; } }
  const it = sel && g.items.find(i => i.id === sel);
  if (it) {
    const blue = '#2447B5';
    if (it.type === 'block') { const [hw, hh] = shapeHalf(it); s += `<rect x="${it.x - hw - 1.6}" y="${it.y - hh - 1.6}" width="${2 * hw + 3.2}" height="${2 * hh + 3.2}" fill="none" stroke="${blue}" stroke-width="0.4" stroke-dasharray="1.4 0.9" pointer-events="none"/>`; }
    else if (it.type === 'line') {
      s += `<polyline points="${it.pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${blue}" stroke-width="1" opacity=".3" pointer-events="none"/>`;
      for (let k = 0; k + 1 < it.pts.length; k++) {
        const [ax, ay] = it.pts[k], [bx, by] = it.pts[k + 1];
        s += `<line data-id="${it.id}" data-part="s:${k}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="transparent" stroke-width="2.4" style="cursor:${Math.abs(ax - bx) < 1e-6 ? 'ew-resize' : 'ns-resize'}"/>`;
      }
      it.pts.forEach((p, k) => { s += `<rect data-id="${it.id}" data-part="v:${k}" x="${p[0] - 1.1}" y="${p[1] - 1.1}" width="2.2" height="2.2" fill="#fff" stroke="${blue}" stroke-width="0.35" style="cursor:move"/>`; });
    } else if (it.type === 'label') { const w = measureMarkup(it.text, 9); s += `<rect x="${it.x - 0.8}" y="${it.y - 2.4}" width="${w + 1.6}" height="4.8" fill="none" stroke="${blue}" stroke-width="0.35" stroke-dasharray="1 0.7" pointer-events="none"/>`; }
    else if (it.type === 'comment') { const lines = String(it.text).split('\n'); const w = Math.max(...lines.map(l => measureMarkup(l, it.size || 8.5))); s += `<rect x="${it.bx - 1.2}" y="${it.by - it.h / 2 - 1.2}" width="${w + 6.4}" height="${it.h + 2.4}" fill="none" stroke="${blue}" stroke-width="0.35" stroke-dasharray="1.4 0.9" pointer-events="none"/>`; }
  }
  if (draft && draft.pts.length) {
    const pts = draft.pts.concat(draft.hover ? [draft.hover] : []);
    s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#2447B5" stroke-width="0.45" stroke-dasharray="1.2 0.8" pointer-events="none"/>`;
    pts.forEach(p => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="0.7" fill="#2447B5" pointer-events="none"/>`; });
  }
  return s + '</g>';
}
function renderStatus(g, b, overflow) {
  const n = g.items.filter(i => i.type === 'block' && i.shape !== 'conn').length;
  const cols = g.cols || 1;
  const maxH = S.opts.maxH || 245;
  const parts = [`<span class="${b.W > 170 || b.H > maxH ? 'bad' : ''}">Холст ${b.W} × ${b.H} мм</span>`, `<span>Блоков: ${n}</span>`];
  if (cols > 1) parts.push(`<span>Колонок: ${cols}, есть перенос</span>`);
  if (overflow.length) parts.push(`<span class="bad">Текст не помещается: ${overflow.length}</span>`);
  if (tool === 'line') parts.push('<span>Линия: щёлкайте по точкам; двойной щелчок или Enter — завершить, Esc — отменить</span>');
  else if (tool.startsWith('add')) parts.push('<span>Щёлкните на листе, чтобы поставить элемент</span>');
  if (isManual()) parts.push('<span class="manual">Схема правилась вручную <button type="button" class="linkbtn" id="resetManual">вернуть автоматическую раскладку</button></span>');
  $('#status').innerHTML = parts.join('');
  const rb = $('#resetManual'); if (rb) rb.onclick = resetManual;
}

// ---------- ручной режим ----------
function ensureManual() {
  if (!S.active) return null;
  if (!S.manual[S.active]) { const g = clone(geoms[S.active]); g.manual = true; S.manual[S.active] = g; }
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
const snap = (v, st) => Math.round(v / st) * st;
function ports(b) {
  const [hw, hh] = shapeHalf(b);
  return [[b.x, b.y - hh], [b.x, b.y + hh], [b.x - hw, b.y], [b.x + hw, b.y]];
}
function onBoundary(b, p) {
  const [hw, hh] = shapeHalf(b); const [x, y] = p; const e = 0.06;
  if (b.shape === 'dia') return ports(b).some(q => Math.abs(q[0] - x) < e && Math.abs(q[1] - y) < e);
  if (b.shape === 'conn') return Math.abs(Math.hypot(x - b.x, y - b.y) - 5) < e;
  const inX = x >= b.x - hw - e && x <= b.x + hw + e, inY = y >= b.y - hh - e && y <= b.y + hh + e;
  return (inX && (Math.abs(y - (b.y - hh)) < e || Math.abs(y - (b.y + hh)) < e)) || (inY && (Math.abs(x - (b.x - hw)) < e || Math.abs(x - (b.x + hw)) < e));
}
function nearestPort(g, x, y, r) {
  let best = null, bd = r || 2.5;
  for (const b of g.items) if (b.type === 'block') for (const q of ports(b)) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = q; } }
  return best;
}
function cleanPts(pts) {
  let res = [];
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
function moveEnd(orig, end, dx, dy) {
  const pts = orig.map(p => p.slice()); const n = pts.length;
  const k = end === 0 ? 0 : n - 1, nb = end === 0 ? 1 : n - 2;
  const vert = Math.abs(orig[k][0] - orig[nb][0]) < 1e-6;
  const p = [orig[k][0] + dx, orig[k][1] + dy];
  if (n === 2) {
    const other = orig[nb].slice();
    if ((vert && Math.abs(dx) < 1e-6) || (!vert && Math.abs(dy) < 1e-6)) { pts[k] = p; return pts; }
    let mid;
    if (vert) { const my = snap((p[1] + other[1]) / 2, 2.5); mid = [[p[0], my], [other[0], my]]; }
    else { const mx = snap((p[0] + other[0]) / 2, 2.5); mid = [[mx, p[1]], [mx, other[1]]]; }
    return end === 0 ? [p, ...mid, other] : [other, ...mid.reverse(), p];
  }
  pts[k] = p;
  if (vert) pts[nb][0] = orig[nb][0] + dx; else pts[nb][1] = orig[nb][1] + dy;
  return pts;
}
function moveVertex(orig, k, q) {
  let pts = orig.map(p => p.slice()); const n = pts.length;
  pts[k] = q.slice();
  const fix = (j, before) => {
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
function moveSegment(orig, k, dx, dy) {
  const n = orig.length;
  const vert = Math.abs(orig[k][0] - orig[k + 1][0]) < 1e-6;
  const off = vert ? [dx, 0] : [0, dy];
  if (n === 2) return orig.map(p => [p[0] + off[0], p[1] + off[1]]);
  const mv = p => [p[0] + off[0], p[1] + off[1]];
  if (k > 0 && k + 1 < n - 1) { const pts = orig.map(p => p.slice()); pts[k] = mv(orig[k]); pts[k + 1] = mv(orig[k + 1]); return pts; }
  const jog = (A, B) => { // A — закреплённый конец, B — следующая точка
    const len = vert ? B[1] - A[1] : B[0] - A[0];
    const s = Math.sign(len) * Math.min(5, Math.abs(len) / 2);
    const J1 = vert ? [A[0], A[1] + s] : [A[0] + s, A[1]];
    return [A, J1, mv(J1), mv(B)];
  };
  if (k === 0) { const head = jog(orig[0], orig[1]); return head.concat(orig.slice(2).map(p => p.slice())); }
  const rev = orig.slice().reverse(); const head = jog(rev[0], rev[1]);
  return head.concat(rev.slice(2).map(p => p.slice())).reverse();
}

// ---------- указатель ----------
board.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  const g = G(); if (!g) return;
  const [mx, my] = svgPoint(ev);
  if (tool === 'line') {
    ev.preventDefault();
    const now = performance.now(); const lc = lastLineClick;
    const dbl = lc && now - lc.t < 400 && Math.hypot(lc.x - mx, lc.y - my) < 2;
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
  if (tool === 'line' && draft) { const [mx, my] = svgPoint(ev); draft.hover = lineNext(mx, my); renderBoard(); return; }
  if (!drag) return;
  if (drag.pan) { boardWrap.scrollLeft = drag.sl - (ev.clientX - drag.sx); boardWrap.scrollTop = drag.st - (ev.clientY - drag.sy); return; }
  const [mx, my] = svgPoint(ev); const dx = mx - drag.start[0], dy = my - drag.start[1];
  if (!drag.moved) { if (Math.hypot(dx, dy) < 0.9) return; beginDrag(); }
  applyDrag(dx, dy, ev.shiftKey, [mx, my]);
  renderBoard();
});
board.addEventListener('pointerup', ev => endDrag());
board.addEventListener('pointercancel', ev => endDrag());
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
  const e = 0.06;
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
        if (Math.hypot(p[0] - A[0][0], p[1] - A[0][1]) < 0.06 || Math.hypot(p[0] - A[n - 1][0], p[1] - A[n - 1][1]) < 0.06) return;
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
      const lo = Math.min(t.vert ? a[1] : a[0], t.vert ? b[1] : b[0]) - 0.06, hi = Math.max(t.vert ? a[1] : a[0], t.vert ? b[1] : b[0]) + 0.06;
      if (t.other < lo || t.other > hi) continue;
      const c = t.vert ? a[0] : a[1];
      if (best === null || Math.abs(c - t.coord) < Math.abs(best - t.coord)) best = c;
    }
    if (best === null) { L.pts = clone(t.pts); continue; }
    const d = best - t.coord;
    L.pts = Math.abs(d) < 1e-9 ? clone(t.pts) : moveEnd(t.pts, t.end, t.vert ? d : 0, t.vert ? 0 : d);
  }
}
function applyDrag(dx, dy, fine, mp) {
  const g = G(); const it = g.items.find(i => i.id === drag.id); if (!it) return;
  const o = drag.orig;
  if (it.type === 'block') {
    const st = fine ? 1 : 5; const sx = snap(dx, st), sy = snap(dy, st);
    it.x = o.x + sx; it.y = o.y + sy;
    for (const a of drag.att) {
      const l = g.items.find(i => i.id === a.id); if (!l) continue;
      l.pts = a.both ? a.pts.map(p => [p[0] + sx, p[1] + sy]) : moveEnd(a.pts, a.end === 0 ? 0 : 1, sx, sy);
    }
    for (const w of drag.owned) { const ob = g.items.find(i => i.id === w.id); if (!ob) continue; if (ob.type === 'label') { ob.x = w.o.x + sx; ob.y = w.o.y + sy; } else { ob.bx = w.o.bx + sx; ob.by = w.o.by + sy; } }
    updateTJ(g);
  } else if (it.type === 'label') { it.x = o.x + snap(dx, 0.5); it.y = o.y + snap(dy, 0.5); }
  else if (it.type === 'comment') { it.bx = o.bx + snap(dx, 0.5); it.by = o.by + snap(dy, 0.5); }
  else if (it.type === 'line') {
    const st = fine ? 1 : 5;
    const [kind, ks] = (drag.part || '').split(':'); const k = +ks;
    if (kind === 'v') { const q = [snap(o.pts[k][0] + dx, st), snap(o.pts[k][1] + dy, st)]; const port = nearestPort(g, o.pts[k][0] + dx, o.pts[k][1] + dy, 1.8); it.pts = moveVertex(o.pts, k, port || q); }
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
const DEFAULT_TEXT = { term: 'Конец', rect: 'Действие', dia: 'Условие', lbeg: 'Цикл A\n1 ≤ i ≤ n', lend: 'Цикл A\ni', conn: 'A' };
function nearestCol(g, x) { let best = 0, bd = Infinity; for (const b of g.items) if (b.type === 'block') { const d = Math.abs(b.x - x); if (d < bd) { bd = d; best = b.col || 0; } } return best; }
function addAt(kind, x, y) {
  pushUndo(); const g = ensureManual();
  if (kind === 'label') {
    const it = { id: newId('t'), type: 'label', x: snap(x, 0.5), y: snap(y, 0.5), text: 'Да', owner: null };
    let best = null, bd = 30; for (const b of g.items) if (b.type === 'block' && b.shape === 'dia') { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
    if (best) it.owner = best.id;
    g.items.push(it); sel = it.id;
  } else {
    const it = { id: newId('b'), type: 'block', shape: kind, x: snap(x, 5), y: snap(y, 5), text: DEFAULT_TEXT[kind], size: null, key: null, kind: null, col: nearestCol(g, x) };
    g.items.push(it); sel = it.id;
  }
  save(); renderBoard(); renderSide();
  const ta = sideEl.querySelector('textarea, input[type=text]'); if (ta) { ta.focus(); ta.select(); }
}
function lineNext(x, y) {
  const g = G(); const port = nearestPort(g, x, y, 2.5);
  let q = port || [snap(x, 5), snap(y, 5)];
  if (draft && draft.pts.length) {
    const l = draft.pts[draft.pts.length - 1];
    if (Math.abs(q[0] - l[0]) >= Math.abs(q[1] - l[1])) q = [q[0], l[1]]; else q = [l[0], q[1]];
  }
  return q;
}
function lineClick(x, y, dbl) {
  if (!draft) { const g = G(); const port = nearestPort(g, x, y, 2.5); draft = { pts: [port || [snap(x, 5), snap(y, 5)]] }; renderBoard(); return; }
  const q = lineNext(x, y); const l = draft.pts[draft.pts.length - 1];
  if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-6) draft.pts.push(q);
  const g = G(); const port = nearestPort(g, x, y, 2.5);
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
const HIDEABLE = new Set(['in', 'out', 'proc', 'err']);
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
    e.preventDefault(); const st = e.shiftKey ? 1 : 5;
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
  (E.inserted[key] = E.inserted[key] || []).push('Новое действие');
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
  if (isManual()) { if (c) { c.text = text; c.userText = true; const nl = String(text).split('\n').length; c.h = Math.max(22, Math.ceil((nl * 8.5 * PT * 1.5 + 4) / 2) * 2); } else if (text.trim()) { const owner = g.items.find(i => i.id === sel) || g.items.find(i => i.type === 'block' && i.kind === 'in'); if (owner) g.items.push(makeComment(owner, text, measureMarkup)); } }
  else regen(S.active);
  renderBoard(); save();
}
function commentFor(b) {
  pushUndo(); const E = edits();
  if (isManual()) {
    const g = G(); g.items = g.items.filter(i => i.type !== 'comment');
    const txt = E.comment || autoCommentText(diagById(S.active), env()) || 'x – …';
    const c = makeComment(b, txt, measureMarkup); c.userText = true; g.items.push(c); E.comment = txt; sel = c.id;
  } else {
    E.commentOwner = b.key; if (!E.comment && !autoCommentText(diagById(S.active), env())) E.comment = 'x – …';
    regen(S.active); const c = G().items.find(i => i.type === 'comment'); sel = c ? c.id : sel;
  }
  renderBoard(); renderSide(); save();
  const ta = sideEl.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); }
}

// ---------- боковая панель ----------
document.querySelectorAll('.side-tabs button').forEach(b => b.onclick = () => { S.ui.side = b.dataset.side; renderSide(); save(); });
const SHAPE_NAME = { term: 'Начало / конец', rect: 'Процесс', dia: 'Условие', lbeg: 'Начало цикла', lend: 'Конец цикла', conn: 'Перенос' };
const KIND_NAME = { in: 'ввод', out: 'вывод', err: 'вывод сообщения об ошибке', proc: 'вычисление', cond: 'проверка условия', loop: 'цикл со счётчиком', term: '' };
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
    const title = SHAPE_NAME[it.shape] + (it.num ? `, блок ${it.num}` : '');
    const kn = KIND_NAME[it.kind] || '';
    h += `<h3>${esc(title)}</h3>${kn ? `<p class="hint" style="margin-top:-4px">${esc(kn)}</p>` : ''}`;
    h += `<label class="field">Текст в блоке<textarea id="pText" rows="3">${esc(it.text)}</textarea></label>`;
    if (it.shape !== 'conn') {
      h += `<label class="field">Размер шрифта<select id="pSize"><option value="">Автоматически</option>${[7, 7.5, 8, 8.5, 9, 9.5, 10, 11, 12].map(v => `<option value="${v}" ${it.size === v ? 'selected' : ''}>${String(v).replace('.', ',')} pt</option>`).join('')}</select></label>`;
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
    h += `<p class="hint">Длины отрезков, мм: ${lens.map(v => `<span style="color:${Math.abs(v / 5 - Math.round(v / 5)) > 0.02 ? 'var(--red)' : 'inherit'}">${String(v).replace('.', ',')}</span>`).join(', ')}</p>`;
    h += `<div class="actions"><button class="btn danger" id="aDel" type="button">Удалить линию</button></div>`;
    h += `<div class="help" style="margin-top:14px"><p>Тяните отрезок, чтобы сдвинуть его параллельно себе, или квадратик в изломе — чтобы переставить точку. Шаг 5 мм, с Shift — 1 мм.</p></div>`;
  } else if (it.type === 'label') {
    h += `<h3>Подпись ветви</h3><label class="field">Текст<input type="text" id="pLab" value="${esc(it.text)}"></label>`;
    h += `<div class="actions"><button class="btn" id="aYN" type="button">Заменить на «${it.text === 'Да' ? 'Нет' : 'Да'}»</button><button class="btn danger" id="aDel" type="button">Удалить подпись</button></div>`;
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
  on('aYN', 'click', () => { pushUndo(); const m = ensureManual(); const l = m.items.find(i => i.id === it.id); l.text = l.text === 'Да' ? 'Нет' : 'Да'; save(); renderBoard(); renderSide(); });
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
  const b = geomBounds(g, measureMarkup);
  const checks = checkGeometry(g, b, lastOverflow.length, S.opts.maxH || 245);
  let h = `<h3>${esc(d.title)}</h3>`;
  h += `<label class="field">Подпись под рисунком в отчёте<input type="text" id="pCap" value="${esc(captionOf(d))}"></label>`;
  h += `<h4>Проверка по чек-листу</h4><ul class="check">${checks.map(c => `<li class="${c.ok ? '' : 'no'}">${esc(c.text)}</li>`).join('')}</ul>`;
  h += `<p class="hint" style="margin-top:8px">Вставляйте рисунок в отчёт без масштабирования: у PNG записано разрешение, поэтому Word покажет его в натуральную величину ${b.W} × ${b.H} мм.</p>`;
  h += `<h4>Как править</h4><div class="help">
    <p>Щёлкните по блоку — здесь появится его текст. Правки текста сохраняются и после перестроения схемы.</p>
    <p>Перетаскивайте блоки, отрезки линий и подписи мышью: связанные линии следуют за блоком. Шаг 5 мм, с Shift — 1 мм. Стрелки на клавиатуре двигают выделенное.</p>
    <p>Панель над листом добавляет элементы из презентации: начало и конец, процесс, условие, блоки цикла, перенос, подпись, линию.</p>
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
    clearTimeout(namesT); namesT = setTimeout(() => { rebuildKeepSide(); }, 350);
  }));
}
function rebuildKeepSide() {
  project = buildProject(S.code, env());
  geoms = {}; for (const d of project.diagrams) if (!d.empty) geoms[d.id] = buildGeometry(d, env());
  syncAll(); renderTabs(); renderBoard(); save();
}

// ---------- экспорт ----------
let dlNs = null;
const dlReady = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').then(ns => { dlNs = ns; return ns; }).catch(() => null) : Promise.resolve(null);
function renderExport() {
  const g = G();
  if (!g) { sideEl.innerHTML = '<p class="help">Сначала постройте схему.</p>'; return; }
  const E = S.exp; const b = geomBounds(g, measureMarkup);
  const raster = E.fmt === 'png' || E.fmt === 'jpg' || E.fmt === 'webp' || E.fmt === 'pdf';
  const canTransparent = E.fmt === 'png' || E.fmt === 'svg' || E.fmt === 'webp';
  const bg = canTransparent ? E.bg : 'white';
  const H = b.H + (E.caption ? CAPTION_H : 0);
  const px = [Math.round(b.W / 25.4 * E.dpi), Math.round(H / 25.4 * E.dpi)];
  const seg = (name, val, opts) => `<div class="seg" data-k="${name}">${opts.map(([v, t, dis]) => `<button type="button" data-v="${v}" aria-pressed="${String(val) === String(v)}" ${dis ? 'disabled' : ''}>${t}</button>`).join('')}</div>`;
  let h = `<h3>Сохранить изображение</h3>`;
  h += `<div class="exprow"><div>Формат</div>${seg('fmt', E.fmt, [['png', 'PNG'], ['svg', 'SVG'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['pdf', 'PDF']])}</div>`;
  h += `<div class="exprow"><div>Фон</div>${seg('bg', bg, [['white', 'Белый'], ['transparent', 'Прозрачный', !canTransparent]])}</div>`;
  if (bg === 'transparent') h += `<div class="exprow"><div>Заливка блоков на прозрачном фоне</div>${seg('fill', E.fill, [['white', 'Белая'], ['none', 'Без заливки']])}</div>`;
  if (raster) h += `<div class="exprow"><div>Разрешение</div>${seg('dpi', E.dpi, [[150, '150 dpi'], [300, '300 dpi'], [600, '600 dpi']])}</div>`;
  h += `<label class="setrow" style="justify-content:flex-start"><input type="checkbox" id="eCap" ${E.caption ? 'checked' : ''}> Добавить подпись «${esc(captionOf(diagById(S.active)).slice(0, 40))}…» под схемой</label>`;
  h += `<div class="expinfo">Размер ${b.W} × ${H} мм${raster && E.fmt !== 'pdf' ? `, ${px[0]} × ${px[1]} пикселей` : ''}. ${E.fmt === 'svg' ? 'Векторный файл: текст остаётся текстом, шрифт Times New Roman.' : E.fmt === 'pdf' ? 'Страница PDF точно по размеру схемы.' : 'Разрешение записано в файл — Word вставит рисунок в масштабе 1:1.'}</div>`;
  h += `<div class="actions"><button class="btn primary" id="eSave" type="button">Скачать ${E.fmt.toUpperCase()}</button>`;
  h += `<button class="btn" id="eAll" type="button">Скачать все схемы одним архивом ZIP</button>`;
  h += `<button class="btn" id="eCopy" type="button">Копировать PNG в буфер обмена</button></div>`;
  h += `<p class="hint" style="margin-top:12px">На экспортируемом рисунке нет сетки, выделения и подсказок — только сама схема.</p>`;
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
function safeName(s) { return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/–/g, '-').slice(0, 120); }
async function makeFile(d, g, E) {
  const b = geomBounds(g, measureMarkup);
  const canTransparent = E.fmt === 'png' || E.fmt === 'svg' || E.fmt === 'webp';
  const bg = canTransparent ? E.bg : 'white';
  const fill = bg === 'transparent' ? E.fill : 'white';
  const caption = E.caption ? captionOf(d) : null;
  const base = safeName(captionOf(d));
  if (E.fmt === 'svg') return { name: base + '.svg', blob: new Blob([exportSVGString(g, b, { bg, fill, caption })], { type: 'image/svg+xml' }) };
  const dpi = E.dpi || 300;
  const cv = drawCanvas(g, b, { dpi, bg, fill, caption });
  if (E.fmt === 'png') { const bl = await canvasBlob(cv, 'image/png'); return { name: base + '.png', blob: new Blob([pngWithDpi(await bl.arrayBuffer(), dpi)], { type: 'image/png' }) }; }
  if (E.fmt === 'jpg') { const bl = await canvasBlob(cv, 'image/jpeg', 0.95); return { name: base + '.jpg', blob: new Blob([jpegWithDpi(await bl.arrayBuffer(), dpi)], { type: 'image/jpeg' }) }; }
  if (E.fmt === 'webp') { const bl = await canvasBlob(cv, 'image/webp', 0.97); return { name: base + '.webp', blob: bl }; }
  if (E.fmt === 'pdf') {
    if (!window.jspdf) throw new Error('Модуль PDF ещё не загрузился — попробуйте через пару секунд.');
    const H = b.H + (caption ? CAPTION_H : 0);
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: [b.W, H], orientation: b.W > H ? 'l' : 'p', compress: true });
    doc.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, b.W, H, undefined, 'FAST');
    return { name: base + '.pdf', blob: doc.output('blob') };
  }
}
async function saveBlob(name, blob) {
  const ns = dlNs || await Promise.race([dlReady, new Promise(r => setTimeout(() => r(null), 1500))]);
  if (ns) {
    try { const r = await ns.save({ filename: name, data: blob }); if (!r || r.status !== 'delivered') toast('Файл сохранён: ' + name); }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') toast('Сохранение отменено');
      else if (c === 'rate_limited') toast('Окно сохранения уже открыто — подтвердите или закройте его');
      else if (c === 'too_large') toast('Файл слишком большой — уменьшите разрешение');
      else if (c === 'rejected_extension' || c === 'extension_not_enabled') toast('Этот формат здесь сохранить нельзя — выберите PNG');
      else toast('Сохранение файлов в этом окне недоступно');
    }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Файл сохранён: ' + name);
}
async function exportCurrent() {
  try { const d = diagById(S.active); const f = await makeFile(d, G(), S.exp); await saveBlob(f.name, f.blob); }
  catch (e) { toast(e.message || 'Не удалось сохранить файл'); }
}
async function exportAll() {
  try {
    if (!window.JSZip) throw new Error('Модуль ZIP ещё не загрузился — попробуйте через пару секунд.');
    const zip = new window.JSZip();
    for (const d of visibleDiags()) {
      const g = S.manual[d.id] || geoms[d.id]; if (!g) continue; renumber(g);
      const f = await makeFile(d, g, S.exp); zip.file(f.name, f.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    await saveBlob('Схемы_программы.zip', blob);
  } catch (e) { toast(e.message || 'Не удалось собрать архив'); }
}
async function copyPng() {
  try {
    const g = G(); const b = geomBounds(g, measureMarkup);
    const bg = S.exp.bg === 'transparent' ? 'transparent' : 'white';
    const cv = drawCanvas(g, b, { dpi: S.exp.dpi || 300, bg, fill: bg === 'transparent' ? S.exp.fill : 'white', caption: S.exp.caption ? captionOf(diagById(S.active)) : null });
    const blob = await canvasBlob(cv, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Схема скопирована — вставьте её в документ');
  } catch (e) { toast('Браузер не разрешил доступ к буферу обмена — скачайте PNG'); }
}

// ---------- масштаб и прочее ----------
$('#zoomIn').onclick = () => { S.ui.zoom = Math.min(4, (S.ui.zoom || zoom) * 1.2); renderBoard(); };
$('#zoomOut').onclick = () => { S.ui.zoom = Math.max(0.25, (S.ui.zoom || zoom) / 1.2); renderBoard(); };
$('#zoomFit').onclick = () => { S.ui.zoom = null; renderBoard(); };
$('#zoom1').onclick = () => { S.ui.zoom = 1; renderBoard(); };
$('#gridBtn').onclick = () => { S.ui.grid = !S.ui.grid; $('#gridBtn').setAttribute('aria-pressed', String(S.ui.grid)); renderBoard(); save(); };
$('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
boardWrap.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); S.ui.zoom = Math.max(0.25, Math.min(4, (S.ui.zoom || zoom) * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); renderBoard(); }, { passive: false });
let rsT = null; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (S.ui.zoom == null) renderBoard(); }, 150); });

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
  if (txt.includes('\uFFFD')) { try { txt = new TextDecoder('windows-1251').decode(buf); } catch (er) { /* оставить utf-8 */ } }
  S.code = txt; S.exId = ''; S.edits = {}; S.ifopts = {}; S.manual = {}; S.active = null; sel = null;
  codeEl.value = txt; refreshEditor(); rebuild(); e.target.value = ''; toast('Открыт файл ' + f.name);
};
// настройки
function renderSettings() {
  document.querySelectorAll('#setMerge button').forEach(b => { b.setAttribute('aria-pressed', String(+b.dataset.v === S.opts.mergeN)); b.onclick = () => { S.opts.mergeN = +b.dataset.v; renderSettings(); rebuild(); }; });
  const c = $('#setCollapse'); c.checked = S.opts.collapseIO !== false; c.onchange = () => { S.opts.collapseIO = c.checked; rebuild(); };
  const m = $('#setMaxH'); m.value = S.opts.maxH; m.onchange = () => { const v = Math.max(120, Math.min(400, Math.round((+m.value || 245) / 5) * 5)); S.opts.maxH = v; m.value = v; rebuild(); };
  const a = $('#setAuto'); a.checked = !!S.opts.autoBuild; a.onchange = () => { S.opts.autoBuild = a.checked; save(); };
}

// ---------- запуск ----------
const had = load();
if (!had || !S.code) { const ex = EXAMPLES[0]; S.code = ex.code; S.exId = ex.id; S.names = clone(ex.names); }
codeEl.value = S.code; refreshEditor(); renderSettings(); updUndo();
$('#gridBtn').setAttribute('aria-pressed', String(S.ui.grid));
rebuild();
const fontsDone = () => { resetMeasureCache(); rebuild(); };
if (document.fonts && document.fonts.load) {
  Promise.all([document.fonts.load('12px Tinos'), document.fonts.load('12px "Times New Roman"'), document.fonts.load('13px "PT Mono"')]).then(() => document.fonts.ready).then(fontsDone).catch(fontsDone);
}
})();
