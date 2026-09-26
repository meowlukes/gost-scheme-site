// ===================== ПРОЕКТ: СПИСОК СХЕМ И ГЕОМЕТРИЯ ДЛЯ РЕДАКТОРА =====================
function routineTitle(d, env, counts) {
  const nm = r => { const e = env.names && env.names[r.short.toLowerCase()]; return (e && e.disp) ? e.disp.replace(/\\(.)/g, '$1') : r.short; };
  if (d.kind === 'program') return 'Схема программы';
  if (d.kind === 'handler') return (counts.main === 0 && counts.handler === 1) ? 'Схема программы' : 'Схема обработчика ' + d.R.short;
  if (d.kind === 'function') return 'Схема функции ' + nm(d.R);
  if (d.R.kind === 'constructor' || d.R.kind === 'destructor') return 'Схема метода ' + nm(d.R);
  return 'Схема процедуры ' + nm(d.R);
}

function buildProject(code, env) {
  const prog = parsePascal(code);
  const out = [];
  const isHandler = r => r.cls && isFormClass(prog, r.cls) && r.params.some(pp => /^sender$/i.test(pp.name) || /tobject/.test(pp.type));
  prog.mains.forEach((m, i) => out.push({ id: 'main' + (i ? i + 1 : ''), kind: 'program', R: null, body: m.body, line: m.line }));
  const withBody = prog.routines.filter(r => r.body);
  withBody.filter(isHandler).forEach(r => out.push({ id: 'r:' + r.name.toLowerCase(), kind: 'handler', R: r, body: r.body, line: r.line }));
  withBody.filter(r => !isHandler(r)).forEach(r => out.push({ id: 'r:' + r.name.toLowerCase(), kind: r.isFunc ? 'function' : 'procedure', R: r, body: r.body, line: r.line }));
  const seen = {};
  for (const d of out) { if (seen[d.id]) d.id += '#' + (++seen[d.id]); else seen[d.id] = 1; }
  for (const d of out) {
    try {
      const t = transformRoutine(prog, d.R, d.body, env);
      d.ir = t.ir; d.used = t.used; d.ctx = t.ctx;
    } catch (e) {
      d.ir = []; d.used = new Map(); d.failed = String(e && e.message || e);
      prog.errors.push({ line: d.line, msg: 'не удалось разобрать подпрограмму: ' + d.failed });
    }
    d.empty = !d.ir.length;
  }
  const counts = { main: out.filter(d => d.kind === 'program').length, handler: out.filter(d => d.kind === 'handler' && !d.empty).length };
  for (const d of out) d.title = routineTitle(d, env, counts);
  return { prog, diagrams: out, errors: prog.errors };
}

// список обозначений (для таблицы «Обозначения»)
function collectNames(project) {
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

function autoCommentText(d, env) {
  const parts = [];
  const seen = new Set();
  const pushEnt = (lc, name) => {
    if (seen.has(lc)) return; seen.add(lc);
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
  const plen = t => t.replace(/\\(.)/g, '$1').replace(/[_^{}]/g, '').length;
  const lines = []; let cur = '';
  parts.forEach((p, i) => {
    const piece = p + (i < parts.length - 1 ? ',' : '');
    if (!cur || plen(cur + ' ' + piece) <= 40) { cur = cur ? cur + ' ' + piece : piece; return; }
    lines.push(cur); cur = '';
    if (plen(piece) <= 40) { cur = piece; return; }
    for (const w of piece.split(' ')) { if (cur && plen(cur + ' ' + w) > 40) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  });
  if (cur) lines.push(cur);
  return lines.join('\n');
}

let _gid = 0;
const newId = p => (p || 'e') + (++_gid).toString(36) + Math.random().toString(36).slice(2, 5);

function buildGeometry(d, env) {
  const L = layoutDiagram(d, env);
  const edits = (env.edits && env.edits[d.id]) || {};
  const tov = edits.text || {};
  const items = [];
  const keyToId = {};
  let li = 0; const labCount = {};
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
      items.push({ id: 'l' + (li++), type: 'line', pts: e.pts.map(p => [p[0], p[1]]), col: e.col, arrow: 'auto' });
    }
  }
  for (const e of L.els) if (e.k === 't') items.push({ id: 't:' + e.owner + ':' + (labCount[e.owner] = (labCount[e.owner] || 0) + 1), type: 'label', x: e.x, y: e.y, text: e.text, owner: keyToId[e.owner] || null, ownerKey: e.owner, col: e.col });
  // комментарий
  const auto = autoCommentText(d, env);
  const ctext = edits.comment != null ? edits.comment : auto;
  if (ctext && ctext.trim()) {
    const blocks = items.filter(i => i.type === 'block');
    let target = d.kind === 'function' || d.kind === 'procedure'
      ? blocks.find(b => b.shape !== 'term' && b.shape !== 'conn')
      : (blocks.find(b => b.kind === 'in') || blocks.find(b => b.shape !== 'term' && b.shape !== 'conn'));
    if (edits.commentOwner) { const t2 = blocks.find(b => b.key === edits.commentOwner); if (t2) target = t2; }
    if (target) items.push(makeComment(target, ctext, env.measure));
  }
  const G = { id: d.id, items, cols: L.cols, loops: L.loops, tooTall: L.tooTall };
  return G;
}
function makeComment(target, text, measure) {
  const nLines = String(text).split('\n').length;
  const h = Math.max(22, Math.ceil((nLines * 8.5 * 0.3528 * 1.5 + 4) / 2) * 2);
  const hw = target.shape === 'conn' ? 5 : 20;
  return { id: 'cm', type: 'comment', owner: target.id, ownerKey: target.key, bx: target.x + hw + 7, by: target.y, h, text, size: 8.5, dx: 7 };
}

// габариты (мм) для холста
function shapeHalf(b) { if (b.shape === 'term') return [20, 5]; if (b.shape === 'conn') return [5, 5]; return [20, 10]; }
function geomBounds(G, measure) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const it of G.items) {
    if (it.type === 'block') {
      const [hw, hh] = shapeHalf(it); add(it.x - hw, it.y - hh); add(it.x + hw, it.y + hh);
      if (it.shape !== 'conn') add(it.x - hw, it.y - hh - 3.6);
    } else if (it.type === 'line') it.pts.forEach(p => add(p[0], p[1]));
    else if (it.type === 'label') { add(it.x, it.y - 2); add(it.x + measure(it.text, 9), it.y + 2); }
    else if (it.type === 'comment') {
      const lines = String(it.text).split('\n');
      const w = Math.max(...lines.map(l => measure(l, it.size || 8.5)));
      add(it.bx, it.by - it.h / 2); add(it.bx + 4 + w, it.by + it.h / 2);
      const ow = G.items.find(o => o.id === it.owner); if (ow) add(ow.x, it.by);
    }
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, W: 60, H: 40 };
  const ox = x0 < 2 ? Math.floor((x0 - 5) / 5) * 5 : 0, oy = y0 < 1 ? Math.floor((y0 - 3) / 5) * 5 : 0;
  return { x0: ox, y0: oy, W: r5(x1 + 5 - ox), H: r5(y1 + 5 - oy), cx0: x0, cy0: y0, cx1: x1, cy1: y1 };
}

// автонумерация по положению (для ручного режима)
function renumber(G) {
  const blocks = G.items.filter(i => i.type === 'block' && i.shape !== 'conn');
  const top = b => b.y - shapeHalf(b)[1];
  blocks.sort((a, b) => (a.col || 0) - (b.col || 0) || Math.round((top(a) - top(b)) * 100) || a.x - b.x);
  blocks.forEach((b, i) => { b.num = i + 1; });
}

// стрелки по правилу: только справа налево и снизу вверх, одна на линию
function autoArrows(line) {
  const pts = line.pts; if (!pts || pts.length < 2) return [];
  const mode = line.arrow || 'auto';
  if (mode === 'none') return [];
  const n = pts.length;
  const last = [pts[n - 2], pts[n - 1]];
  if (mode === 'end') return [{ at: last[1], dir: [Math.sign(last[1][0] - last[0][0]), Math.sign(last[1][1] - last[0][1])] }];
  if (last[1][0] < last[0][0] - 1e-6 && Math.abs(last[1][1] - last[0][1]) < 1e-6) return [{ at: last[1], dir: [-1, 0] }];
  let best = null;
  for (let k = 0; k + 1 < n; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    if (Math.abs(ax - bx) < 1e-6 && by < ay - 1e-6) { const len = ay - by; if (!best || len > best.len) best = { len, x: ax, top: by, bot: ay }; }
  }
  if (best) { const yh = best.top + (best.bot - best.top) * 0.45; return [{ at: [best.x, yh], dir: [0, -1] }]; }
  for (let k = n - 2; k >= 0; k--) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    if (Math.abs(ay - by) < 1e-6 && bx < ax - 1e-6) return [{ at: [bx, by], dir: [-1, 0] }];
  }
  return [];
}

// проверки по чек-листу методики
function checkGeometry(G, bounds, overflowCount, maxH) {
  const res = [];
  const lines = G.items.filter(i => i.type === 'line');
  let bad = 0;
  for (const l of lines) for (let k = 0; k + 1 < l.pts.length; k++) {
    const len = Math.hypot(l.pts[k + 1][0] - l.pts[k][0], l.pts[k + 1][1] - l.pts[k][1]);
    if (len > 1e-6 && Math.abs(len / 5 - Math.round(len / 5)) > 0.02) bad++;
  }
  res.push({ ok: bad === 0, text: bad ? `Отрезков не кратных 5 мм: ${bad}` : 'Все отрезки линий кратны 5 мм' });
  const dias = G.items.filter(i => i.type === 'block' && i.shape === 'dia');
  const noLab = dias.filter(d => G.items.filter(l => l.type === 'label' && l.owner === d.id).length < 2).length;
  res.push({ ok: noLab === 0, text: noLab ? `Ромбов без подписей «Да»/«Нет»: ${noLab}` : 'У каждого ромба подписаны обе ветви' });
  res.push({ ok: overflowCount === 0, text: overflowCount ? `Текст не помещается в блоках: ${overflowCount}` : 'Текст помещается в блоки' });
  const okSize = bounds.W <= 170 && bounds.H <= maxH;
  res.push({ ok: okSize, text: `Холст ${bounds.W} × ${bounds.H} мм ` + (okSize ? '— умещается на листе А4' : `— больше 170 × ${maxH} мм`) });
  const up = lines.filter(l => l.arrow && l.arrow !== 'auto').length;
  res.push({ ok: up === 0, text: up ? `Линий со стрелками, заданными вручную: ${up}` : 'Стрелки расставлены по правилу' });
  return res;
}
