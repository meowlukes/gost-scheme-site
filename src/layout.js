// ===================== РАЗМЕЩЕНИЕ СХЕМЫ ПО ГОСТ 19.701-90 И МЕТОДИКЕ =====================
const BA = 40, BB = 20, BHT = 10, GAP = 5;
const Y_TOP = 5;               // верх блока «Начало»; все координаты кратны 5 мм
const r5 = v => Math.ceil(v / 5 - 1e-9) * 5;

function frag() { return { h: 0, top: 'edge', bot: 'edge', L: 20, R: 20, dead: false, els: [], jumps: [], slots: [], lanes: [], first: null, empty: false }; }
function moveEl(e, dx, dy) { return e.k === 'l' ? Object.assign({}, e, { pts: e.pts.map(([x, y]) => [x + dx, y + dy]) }) : Object.assign({}, e, { x: e.x + dx, y: e.y + dy }); }
function put(dst, src, dx, dy) {
  for (const e of src.els) dst.els.push(moveEl(e, dx, dy));
  for (const j of src.jumps) dst.jumps.push(Object.assign({}, j, { x: j.x + dx, y: j.y + dy }));
  for (const s of src.slots) dst.slots.push(Object.assign({}, s, { x: s.x + dx, y: s.y + dy }));
  for (const l of src.lanes) dst.lanes.push(Object.assign({}, l, { x: l.x + dx, y0: l.y0 + dy, y1: l.y1 + dy }));
}
const LN = (...pts) => ({ k: 'l', pts });
const LAB = (x, y, text, owner) => ({ k: 't', x, y, text, owner });

function makeLayout(diag, env) {
  const P = diag.ctx.P;
  const measure = env.measure || ((s, pt) => String(s).length * pt * 0.3528 * 0.5);
  const ifopts = (env.ifopts && env.ifopts[diag.id]) || {};
  const condText = (c) => P.pr(c).s;

  function blockFrag(it) {
    const shape = it.shape || (it.kind === 'term' ? 'term' : 'rect');
    const f = frag(); const h = shape === 'term' ? BHT : BB; f.h = h;
    f.els.push({ k: 'b', shape, x: 0, y: h / 2, text: it.lines.join('\n'), key: it.key, kind: it.kind, warn: it.warn });
    f.first = { shape }; return f;
  }
  function expand(items) {
    const out = [];
    for (const it of items) {
      if (it.t === 'for') {
        out.push({ t: 'blk', shape: 'lbeg', kind: 'loop', key: it.key + ':b', lines: ['Цикл ' + it.name, it.range] });
        const body = it.body.slice(); if (body.length && body[body.length - 1].t === 'jump') body.pop();
        out.push(...expand(body));
        if (it.used.continue) out.push({ t: 'slot', name: 'cont:' + it.key });
        out.push({ t: 'blk', shape: 'lend', kind: 'loop', key: it.key + ':e', lines: ['Цикл ' + it.name, it.vName] });
        if (it.used.break) out.push({ t: 'slot', name: 'brk:' + it.key });
      } else out.push(it);
    }
    return out;
  }
  function layItem(it) {
    switch (it.t) {
      case 'blk': return blockFrag(it);
      case 'slot': { const f = frag(); f.h = 0; f.top = f.bot = 'point'; f.L = f.R = 0; f.slots.push({ name: it.name, x: 0, y: 0 }); return f; }
      case 'spacer': { const f = frag(); f.h = 20; f.top = f.bot = 'point'; f.L = f.R = 0; f.els.push(LN([0, 0], [0, 20])); f.spacer = true; return f; }
      case 'if': return fIf(it);
      case 'casc': return fCasc(it);
      case 'while': return fWhile(it);
      case 'repeat': return fRepeat(it);
    }
    return frag();
  }
  function fSeq(items) {
    const f = frag(); f.L = 0; f.R = 0; f.top = 'point'; f.bot = 'point';
    const content = []; let jump = null;
    for (const it of items) { if (it.t === 'jump') { jump = it; break; } content.push(it); }
    const ex = expand(content);
    let y = 0, prev = null;
    for (const it of ex) {
      const c = layItem(it);
      if (prev) { f.els.push(LN([0, y], [0, y + GAP])); y += GAP; }
      else { f.top = c.top; f.first = c.first; }
      put(f, c, 0, y); y += c.h; prev = c;
      f.L = Math.max(f.L, c.L); f.R = Math.max(f.R, c.R);
    }
    f.h = y; if (prev) f.bot = prev.bot;
    f.empty = !prev;
    f.single = ex.length === 1 && ex[0].t === 'blk';
    if (jump) {
      f.dead = true;
      if (!prev) f.pureJump = jump.target;
      else if (f.single && (ex[0].shape || 'rect') === 'rect') f.jumps.push({ x: 20, y: 10, dir: 'right', target: jump.target });
      else f.jumps.push({ x: 0, y, dir: 'down', target: jump.target });
    } else if (prev && prev.dead) f.dead = true;
    return f;
  }
  function fIf(it) {
    const o = ifopts[it.key] || { inv: it.inv, mode: it.mode };
    const cond = o.inv ? negate(it.cond) : it.cond;
    const yes = o.inv ? it.no : it.yes, no = o.inv ? it.yes : it.no;
    const right = o.mode === 'right';
    const f = frag(); f.first = { shape: 'dia' };
    f.els.push({ k: 'b', shape: 'dia', x: 0, y: 10, text: condText(cond), key: it.key, kind: 'cond', ctl: 'if' });
    const D = fSeq(right ? no : yes), S = fSeq(right ? yes : no);
    const downLab = right ? 'Нет' : 'Да', sideLab = right ? 'Да' : 'Нет';
    let downBot = 20, R = Math.max(28, D.R), Lx = Math.max(20, D.L);
    if (!D.empty) { f.els.push(LN([0, 20], [0, 25])); put(f, D, 0, 25); downBot = 25 + D.h; }
    else if (D.pureJump) f.jumps.push({ x: 0, y: 20, dir: 'down', target: D.pureJump });
    const downLive = !D.dead;
    let sideLive = true, xs = null, sideBot = 20;
    if (!S.empty) {
      const beside = right && S.top === 'edge';
      xs = r5(Math.max(20, D.R) + 15 + Math.max(20, S.L));
      const sTop = beside ? 0 : 25;
      if (beside) f.els.push(LN([20, 10], [xs - 20, 10])); else f.els.push(LN([20, 10], [xs, 10], [xs, 25]));
      put(f, S, xs, sTop); sideBot = sTop + S.h; R = Math.max(R, xs + S.R);
      sideLive = !S.dead;
    } else if (S.pureJump) { f.jumps.push({ x: 20, y: 10, dir: 'right', target: S.pureJump }); sideLive = false; }
    let mergeNear = false;
    if (downLive && sideLive) {
      const M = (!S.empty ? Math.max(downBot, sideBot) : Math.max(downBot, 20)) + 5;
      if (downBot < M) f.els.push(LN([0, downBot], [0, M]));
      if (!S.empty) f.els.push(LN([xs, sideBot], [xs, M], [0, M]));
      else { const xN = r5(Math.max(20, D.R) + 15); f.els.push(LN([20, 10], [xN, 10], [xN, M], [0, M])); R = Math.max(R, xN); }
      f.h = M; f.bot = 'point'; mergeNear = D.empty && M - 20 <= 5;
    } else if (downLive) { f.h = downBot; f.bot = D.empty ? 'edge' : D.bot; }
    else if (sideLive) {
      const M = (!S.empty ? Math.max(downBot, sideBot) : Math.max(downBot, 20)) + 5;
      if (!S.empty) f.els.push(LN([xs, sideBot], [xs, M], [0, M]));
      else { const xN = r5(Math.max(20, D.R) + 15); f.els.push(LN([20, 10], [xN, 10], [xN, M], [0, M])); R = Math.max(R, xN); }
      f.h = M; f.bot = 'point';
    } else { f.h = Math.max(downBot, sideBot); f.dead = true; }
    f.els.push(LAB(mergeNear ? -8.5 : 1.5, 22.5, downLab, it.key));
    f.els.push(LAB(22, 6.5, sideLab, it.key));
    f.L = Lx; f.R = R;
    return f;
  }
  function fCasc(it) {
    const f = frag(); f.first = { shape: 'dia' };
    const armsF = it.arms.map(a => fSeq(a.body));
    const maxL = Math.max(20, ...armsF.filter(a => !a.empty).map(a => a.L));
    const xs = r5(20 + 15 + maxL);
    let y = 0, R = 28, prevBot = null; const exits = [];
    it.arms.forEach((a, i) => {
      const A = armsF[i], yc = y + 10;
      if (prevBot !== null) f.els.push(LN([0, prevBot], [0, y]));
      f.els.push({ k: 'b', shape: 'dia', x: 0, y: yc, text: condText(a.cond), key: a.key, kind: 'cond' });
      f.els.push(LAB(21.5, yc - 3.5, 'Да', a.key));
      f.els.push(LAB(1.5, y + 22.5, 'Нет', a.key));
      let armBot = y + 20, needStub = false;
      if (A.empty) {
        if (A.pureJump) f.jumps.push({ x: 20, y: yc, dir: 'right', target: A.pureJump });
        else exits.push({ pts: [[20, yc]], y: yc });
      } else {
        let top;
        if (A.top === 'edge') { top = y; f.els.push(LN([20, yc], [xs - 20, yc])); }
        else { top = yc + 5; f.els.push(LN([20, yc], [xs, yc], [xs, top])); }
        put(f, A, xs, top); armBot = top + A.h; R = Math.max(R, xs + A.R);
        const rightExit = A.single && A.first && A.first.shape === 'rect' && A.top === 'edge';
        if (!A.dead) {
          if (rightExit) exits.push({ pts: [[xs + 20, yc]], y: yc });
          else { exits.push({ pts: [[xs, armBot], [xs, armBot + 5]], y: armBot + 5 }); needStub = true; }
        } else if (!rightExit) needStub = true;
      }
      prevBot = y + 20;
      y = Math.max(y + 25, armBot + (needStub ? 10 : 5));
    });
    const lastBot = prevBot;
    const E = it.els ? fSeq(it.els) : null;
    let elsBot = lastBot;
    if (E && !E.empty) { f.els.push(LN([0, lastBot], [0, lastBot + 5])); put(f, E, 0, lastBot + 5); elsBot = lastBot + 5 + E.h; f.L = Math.max(20, E.L); R = Math.max(R, E.R); }
    else if (E && E.pureJump) f.jumps.push({ x: 0, y: lastBot, dir: 'down', target: E.pureJump });
    const elsLive = !(E && E.dead);
    if (exits.length) {
      const M = Math.max(elsBot, ...exits.map(e => e.y)) + 5;
      const XM = r5(Math.max(R + 20, 45));
      exits.sort((a, b) => a.y - b.y);
      exits.forEach((e, i) => {
        const pts = e.pts.concat([[XM, e.y]]);
        if (i === 0) pts.push([XM, M], [0, M]);
        f.els.push({ k: 'l', pts });
      });
      if (elsLive && elsBot < M) f.els.push(LN([0, elsBot], [0, M]));
      if ((!E || E.empty) && M - lastBot <= 5) { const lab = f.els.filter(e => e.k === 't' && e.text === 'Нет').pop(); if (lab) lab.x = -8.5; }
      f.h = M; f.bot = 'point'; R = XM;
    } else if (elsLive) { f.h = elsBot; f.bot = (E && !E.empty) ? E.bot : 'edge'; }
    else { f.h = elsBot; f.dead = true; }
    f.R = R; f.L = Math.max(f.L || 20, 20);
    return f;
  }
  function fWhile(it) {
    const f = frag(); f.top = 'point'; f.first = { shape: 'point' };
    const Bd = fSeq(it.body);
    f.els.push(LN([0, 0], [0, 5]));
    f.els.push({ k: 'b', shape: 'dia', x: 0, y: 15, text: condText(it.cond), key: it.key, kind: 'cond' });
    let yb = 25;
    if (!Bd.empty) { f.els.push(LN([0, 25], [0, 30])); put(f, Bd, 0, 30); yb = 30 + Bd.h; }
    const hasCont = !!it.used.continue;
    const xL = -(Math.max(20, Bd.L) + 10);
    if (!Bd.dead) f.els.push(LN([0, yb], [0, yb + 5], [xL, yb + 5], [xL, 0], [0, 0]));
    if (hasCont) f.slots.push({ name: 'cont:' + it.key, x: 0, y: yb + 5 });
    const xN = r5(Math.max(20, Bd.R) + 15 + (hasCont ? 10 : 0));
    const yE = yb + 15;
    f.els.push(LN([20, 15], [xN, 15], [xN, yE], [0, yE]));
    f.lanes.push({ name: 'brk:' + it.key, x: xN, y0: 15, y1: yE });
    f.els.push(LAB(1.5, 27.5, 'Да', it.key));
    f.els.push(LAB(22, 11.5, 'Нет', it.key));
    f.h = yE; f.bot = 'point'; f.L = -xL; f.R = xN;
    return f;
  }
  function fRepeat(it) {
    const f = frag(); f.top = 'point'; f.first = { shape: 'point' };
    const Bd = fSeq(it.body);
    f.els.push(LN([0, 0], [0, 5]));
    let yd = 5;
    if (!Bd.empty) {
      put(f, Bd, 0, 5); const yb = 5 + Bd.h;
      if (it.used.continue) { f.els.push(LN([0, yb], [0, yb + 10])); f.slots.push({ name: 'cont:' + it.key, x: 0, y: yb + 5 }); yd = yb + 10; }
      else { f.els.push(LN([0, yb], [0, yb + 5])); yd = yb + 5; }
    }
    const yc = yd + 10;
    f.els.push({ k: 'b', shape: 'dia', x: 0, y: yc, text: condText(it.cond), key: it.key, kind: 'cond' });
    const xR = r5(Math.max(20, Bd.R) + 15);
    f.els.push(LN([20, yc], [xR, yc], [xR, 0], [0, 0]));
    f.els.push(LAB(1.5, yd + 22.5, 'Да', it.key));
    f.els.push(LAB(22, yc - 3.5, 'Нет', it.key));
    if (it.used.break) { f.els.push(LN([0, yd + 20], [0, yd + 25])); f.slots.push({ name: 'brk:' + it.key, x: 0, y: yd + 25 }); f.h = yd + 25; f.bot = 'point'; }
    else { f.h = yd + 20; f.bot = 'edge'; }
    f.L = Math.max(20, Bd.L); f.R = xR;
    return f;
  }
  return { expand, layItem, fSeq, measure };
}

// ---------- правки пользователя в логической модели ----------
function applyEdits(ir, edits) {
  const hidden = edits.hidden || {}, ins = edits.inserted || {};
  function walk(seq) {
    const out = [];
    for (const it of seq) {
      if (it.t === 'blk' && hidden[it.key]) continue;
      const c = Object.assign({}, it);
      if (c.t === 'if') { c.yes = walk(c.yes); c.no = walk(c.no); }
      else if (c.t === 'casc') { c.arms = c.arms.map(a => Object.assign({}, a, { body: walk(a.body) })); if (c.els) c.els = walk(c.els); }
      else if (c.t === 'while' || c.t === 'repeat' || c.t === 'for') c.body = walk(c.body);
      out.push(c);
      const key = c.t === 'for' ? c.key + ':e' : c.key;
      if (ins[key]) ins[key].forEach((txt, i) => out.push({ t: 'blk', kind: 'proc', key: key + '+' + i, lines: [txt], inserted: true }));
    }
    return out;
  }
  let res = walk(ir);
  if (ins.start) res = ins.start.map((txt, i) => ({ t: 'blk', kind: 'proc', key: 'start+' + i, lines: [txt], inserted: true })).concat(res);
  // если ветвь стала пустой — убрать пустое ветвление
  (function clean(seq) {
    for (let i = 0; i < seq.length; i++) {
      const it = seq[i];
      if (it.t === 'if') { clean(it.yes); clean(it.no); if (!it.yes.length && !it.no.length) { seq.splice(i, 1); i--; } }
      else if (it.t === 'casc') { it.arms.forEach(a => clean(a.body)); if (it.els) clean(it.els); }
      else if (it.t === 'while' || it.t === 'repeat' || it.t === 'for') clean(it.body);
    }
  })(res);
  return res;
}
function nameLoops(ir) {
  let n = 0;
  (function walk(seq) {
    for (const it of seq) {
      if (it.t === 'for') { it.name = String.fromCharCode(65 + (n++ % 26)); walk(it.body); }
      else if (it.t === 'if') { walk(it.yes); walk(it.no); }
      else if (it.t === 'casc') { it.arms.forEach(a => walk(a.body)); if (it.els) walk(it.els); }
      else if (it.t === 'while' || it.t === 'repeat') walk(it.body);
    }
  })(ir);
  return n;
}
function collectTargets(ir) {
  const s = new Set();
  (function walk(seq) {
    for (const it of seq) {
      if (it.t === 'jump') s.add(it.target);
      else if (it.t === 'if') { walk(it.yes); walk(it.no); }
      else if (it.t === 'casc') { it.arms.forEach(a => walk(a.body)); if (it.els) walk(it.els); }
      else if (it.t === 'while' || it.t === 'repeat' || it.t === 'for') walk(it.body);
    }
  })(ir);
  return s;
}

// ---------- главная функция размещения ----------
function layoutDiagram(diag, env) {
  const edits = (env.edits && env.edits[diag.id]) || {};
  const ir = applyEdits(diag.ir, edits);
  const nLoops = nameLoops(ir);
  const LY = makeLayout(diag, env);
  const measure = LY.measure;
  const maxH = (env.opts && env.opts.maxH) || 245;
  const targets = collectTargets(ir);
  const needErr = targets.has('err'), needEnd = needErr || targets.has('end');

  let items = LY.expand([{ t: 'blk', kind: 'term', shape: 'term', key: 'start', lines: ['Начало'] }].concat(ir));
  let errRowIdx = -1;
  if (needErr) {
    const last = items[items.length - 1];
    if (last && last.t === 'blk' && last.shape !== 'term') errRowIdx = items.length - 1;
    else { items.push({ t: 'spacer' }); errRowIdx = items.length - 1; }
  }
  if (needEnd) items.push({ t: 'slot', name: 'end' });
  items.push({ t: 'blk', kind: 'term', shape: 'term', key: 'stop', lines: ['Конец'] });
  const frags = items.map(it => LY.layItem(it));
  frags.forEach((f, i) => { f.idx = i; });

  // --- деление на колонки (перенос) ---
  const maxBottom = maxH - 5;
  const cols = []; let i = 0;
  // глубина вложенности циклов на границе перед элементом — переносим по возможности вне циклов
  const depth = []; { let d = 0; items.forEach((it, k) => { if (it.shape === 'lend') d--; depth[k] = d; if (it.shape === 'lbeg') d++; }); }
  const restNeed = (from, withGap) => { let s = 0; for (let k = from; k < frags.length; k++) s += frags[k].h + ((k > from || withGap) ? GAP : 0); return s; };
  while (i < frags.length) {
    const start = i; let y = cols.length ? 25 : Y_TOP;
    if (y + restNeed(i, false) <= maxBottom) { cols.push(frags.slice(i)); break; }
    let last = i; // последний индекс, до которого (не включая) колонка помещается
    let yy = y;
    for (let k = i; k < frags.length; k++) {
      const add = (k > i ? GAP : 0) + frags[k].h;
      if (k > i && yy + add + 20 > maxBottom) break;
      yy += add; last = k + 1;
    }
    if (last <= i) last = i + 1;
    let best = last;
    if (last < frags.length) {
      const lo = Math.max(i + 1, i + Math.ceil((last - i) * 0.4));
      for (let k = last; k >= lo; k--) if (depth[k] < depth[best]) best = k;
    }
    cols.push(frags.slice(start, best)); i = best;
  }
  // колонка каждого слота/полосы/строки ошибки
  const tcolOf = {};
  cols.forEach((cf, c) => cf.forEach(f => { f.col = c; f.slots.forEach(s => tcolOf[s.name] = c); f.lanes.forEach(l => tcolOf[l.name] = c); }));
  if (needErr) tcolOf.err = frags[errRowIdx].col;

  // --- буквы: сначала циклы, затем переносы ---
  let letterN = nLoops;
  const nextLetter = () => { let L = String.fromCharCode(65 + (letterN % 26)); letterN++; return L; };

  const els = []; const allSlots = {}; const allLanes = {};
  const pendingIn = {}; // col -> [{target, lane?}]
  let prevRight = { blocks: 0, lines: 0 }; let errBlock = null; const colInfo = [];
  const labelW = t => measure(t, 9);

  function maxRightIn(col, y0, y1, xCap) {
    let m = -Infinity; const cap = xCap == null ? Infinity : xCap - 0.01;
    for (const e of els) {
      if (e.col !== col) continue;
      if (e.k === 'l' && cap < Infinity) {
        for (let k = 0; k + 1 < e.pts.length; k++) {
          const [ax, ay] = e.pts[k], [bx, by] = e.pts[k + 1];
          if (Math.max(ay, by) >= y0 && Math.min(ay, by) <= y1) { if (ax < cap) m = Math.max(m, ax); if (bx < cap) m = Math.max(m, bx); }
        }
        continue;
      }
      if (e.k === 'b') {
        const hh = e.shape === 'term' || e.shape === 'conn' ? 5 : 10, hw = e.shape === 'conn' ? 5 : 20;
        if (e.y + hh >= y0 && e.y - hh <= y1) m = Math.max(m, e.x + hw);
      } else if (e.k === 'l') {
        for (let k = 0; k + 1 < e.pts.length; k++) {
          const [ax, ay] = e.pts[k], [bx, by] = e.pts[k + 1];
          if (Math.max(ay, by) >= y0 && Math.min(ay, by) <= y1) m = Math.max(m, ax, bx);
        }
      } else if (e.k === 't') { if (e.y + 2 >= y0 && e.y - 2 <= y1) m = Math.max(m, e.x + labelW(e.text)); }
    }
    return m;
  }
  const push = (e, col) => { e.col = col; els.push(e); return e; };

  for (let c = 0; c < cols.length; c++) {
    const cf = cols[c];
    const Lmax = Math.max(20, ...cf.map(f => f.L));
    const X = c === 0 ? r5(Lmax + 10) : r5(Math.max(prevRight.blocks + 30, prevRight.lines + 20) + Lmax);
    let y = c === 0 ? Y_TOP : 25;
    const info = { X, top: y, jumps: [] };
    if (c > 0) { push({ k: 'b', shape: 'conn', x: X, y: 10, text: colInfo[c - 1].letter, key: 'conn' + c + 't' }, c); push(LN([X, 15], [X, 25]), c); }
    cf.forEach((f, k) => {
      if (k > 0) { push(LN([X, y], [X, y + GAP]), c); y += GAP; }
      f.absY = y; f.absX = X;
      for (const e of f.els) push(moveEl(e, X, y), c);
      for (const j of f.jumps) info.jumps.push(Object.assign({}, j, { x: j.x + X, y: j.y + y }));
      for (const s of f.slots) allSlots[s.name] = { x: s.x + X, y: s.y + y, col: c };
      for (const l of f.lanes) allLanes[l.name] = { x: l.x + X, y0: l.y0 + y, y1: l.y1 + y, col: c };
      y += f.h;
    });
    info.bottom = y;
    if (c < cols.length - 1) {
      push(LN([X, y], [X, y + 10]), c);
      info.letter = nextLetter(); info.connY = y + 15;
      push({ k: 'b', shape: 'conn', x: X, y: y + 15, text: info.letter, key: 'conn' + c + 'b' }, c);
    }
    colInfo.push(info);

    // --- переходы (выходы, ошибки, break/continue) ---
    // 1) break в цикле с предусловием — на вертикаль выхода
    const groups = new Map();
    for (const j of info.jumps) {
      if (allLanes[j.target] && allLanes[j.target].col === c) {
        const ln = allLanes[j.target];
        push({ k: 'l', pts: j.dir === 'right' ? [[j.x, j.y], [ln.x, j.y]] : [[j.x, j.y], [j.x, j.y + 5], [ln.x, j.y + 5]] }, c);
        continue;
      }
      if (!groups.has(j.target)) groups.set(j.target, { target: j.target, srcs: [] });
      groups.get(j.target).srcs.push(j);
    }
    for (const g of pendingIn[c] || []) { if (!groups.has(g.target)) groups.set(g.target, { target: g.target, srcs: [] }); const gg = groups.get(g.target); gg.incoming = true; gg.letterIn = g.letterIn; }
    const errRowFrag = needErr && tcolOf.err === c ? frags[errRowIdx] : null;
    const glist = [...groups.values()].map(g => {
      const tc = g.target === 'err' ? tcolOf.err : (tcolOf[g.target] !== undefined ? tcolOf[g.target] : cols.length - 1);
      g.tcol = tc;
      g.y0 = g.incoming ? 5 : Math.min(...g.srcs.map(s => s.dir === 'down' ? s.y + 5 : s.y));
      if (tc === c) {
        if (g.target === 'err') g.y1 = errRowFrag.absY + 20;
        else g.y1 = (allSlots[g.target] || { y: info.bottom }).y;
      } else g.y1 = info.connY - 5;
      g.span = g.y1 - g.y0;
      return g;
    });
    glist.sort((a, b) => (a.target === 'err' ? -1 : 0) - (b.target === 'err' ? -1 : 0) || (a.target === 'end') - (b.target === 'end') || a.span - b.span);
    for (const g of glist) {
      const isErr = g.target === 'err' && g.tcol === c;
      let cap = null;
      if (g.target.startsWith('cont:') && g.tcol === c) { const ex = allLanes['brk:' + g.target.slice(5)]; if (ex && ex.col === c) cap = ex.x; }
      const mr = maxRightIn(c, g.y0 - 0.5, g.y1 + 0.5, cap);
      let lane = r5(Math.max(mr, X + 20) + 15 + (isErr ? 20 : 0));
      if (cap != null && lane >= cap) lane = cap - 5;
      const srcs = g.srcs.slice().sort((a, b) => a.y - b.y);
      const polys = srcs.map(s => s.dir === 'right' ? [[s.x, s.y], [lane, s.y]] : [[s.x, s.y], [s.x, s.y + 5], [lane, s.y + 5]]);
      let main;
      if (g.incoming) {
        push({ k: 'b', shape: 'conn', x: lane, y: 10, text: g.letterIn, key: 'conn' + c + g.target }, c);
        main = [[lane, 15]];
      } else main = polys.shift();
      // продолжение главной ветви группы
      if (g.tcol !== c) {
        main.push([lane, info.connY - 5]);
        const L = nextLetter();
        push({ k: 'b', shape: 'conn', x: lane, y: info.connY, text: L, key: 'conn' + c + 'x' + g.target }, c);
        (pendingIn[c + 1] = pendingIn[c + 1] || []).push({ target: g.target, letterIn: L });
      } else if (isErr) {
        const rowY = errRowFrag.absY;
        main.push([lane, rowY]);
        errBlock = push({ k: 'b', shape: 'rect', x: lane, y: rowY + 10, text: 'Вывод сообщения\nоб ошибке', key: 'err', kind: 'err' }, c);
      } else if (allSlots[g.target]) {
        const s = allSlots[g.target];
        main.push([lane, s.y]);
        let endX = s.x;
        if (g.target === 'end' && errBlock && errBlock.col === c && lane > errBlock.x) endX = errBlock.x;
        main.push([endX, s.y]);
      }
      push({ k: 'l', pts: main }, c);
      for (const pl of polys) push({ k: 'l', pts: pl }, c);
      if (isErr) {
        const s = allSlots.end;
        push({ k: 'l', pts: [[errBlock.x, errBlock.y + 10], [errBlock.x, s.y], [s.x, s.y]] }, c);
      }
    }
    // правая граница колонки
    const right = { blocks: X + 20, lines: X + 20 };
    for (const e of els) if (e.col === c) {
      if (e.k === 'b') right.blocks = Math.max(right.blocks, e.x + (e.shape === 'conn' ? 5 : 20));
      else if (e.k === 'l') e.pts.forEach(p => { right.lines = Math.max(right.lines, p[0]); });
      else if (e.k === 't') right.lines = Math.max(right.lines, e.x + labelW(e.text));
    }
    prevRight = right;
  }
  // если по какой-то причине блок ошибки не размещён (ошибка без перехода) — ничего не делаем

  // --- нумерация: по колонкам, по рядам сверху вниз, слева направо ---
  const blocks = els.filter(e => e.k === 'b' && e.shape !== 'conn');
  const topOf = b => b.y - (b.shape === 'term' ? 5 : 10);
  blocks.sort((a, b) => a.col - b.col || Math.round((topOf(a) - topOf(b)) * 100) || a.x - b.x);
  blocks.forEach((b, i) => { b.num = i + 1; });

  // --- ключи блоков должны быть уникальны ---
  const seenKeys = {};
  for (const b of els) if (b.k === 'b') { if (seenKeys[b.key]) b.key = b.key + '#' + (seenKeys[b.key]++); else seenKeys[b.key] = 1; }

  return { els, cols: cols.length, loops: nLoops, colInfo, tooTall: cols.some(cf => cf.length === 1 && cf[0].h > maxBottom - Y_TOP) };
}
