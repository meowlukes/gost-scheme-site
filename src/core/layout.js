/**
 * Раскладка схемы программы по ГОСТ 19.701-90.
 *
 * Правила стандарта, на которых построена раскладка:
 *  — поток идёт сверху вниз и слева направо (п. 4.2.1);
 *  — линия входит в символ сверху или слева, выходит снизу или справа и направлена
 *    к центру символа (п. 4.2.4);
 *  — линии, сливающиеся в одну, примыкают со смещением, а не в одной точке (п. 4.2.3);
 *  — у «Решения» каждый выход подписан значением условия (пп. 3.2.2.4, 4.3.1.2);
 *  — несколько выходов показываются одной линией, которая затем разветвляется (п. 4.3.1.1);
 *  — обе части «Границы цикла» несут один идентификатор (п. 3.2.2.6);
 *  — разрыв линии и перенос в другую колонку — парными соединителями с одним уникальным
 *    обозначением (пп. 3.4.1, 4.2.5).
 *
 * Все размеры берутся из оформления (gost.metrics, gost.symbols); чисел в миллиметрах
 * в этом файле нет.
 */
import { GOST, letterId } from '../gost/index.js';
import { approximateMeasure } from '../render/text.js';
import { normalizeOptions, symbolForKind } from './options.js';
import { negate } from './transform.js';

/** Допуск сравнения координат, мм. */
const EPS = 0.01;
/** Наименьшая доля колонки, которую нужно заполнить, прежде чем искать место переноса вне цикла. */
const MIN_COLUMN_FILL = 0.4;

const moveEl = (e, dx, dy) => (e.k === 'l'
  ? { ...e, pts: e.pts.map(([x, y]) => [x + dx, y + dy]) }
  : { ...e, x: e.x + dx, y: e.y + dy });
const LN = (...pts) => ({ k: 'l', pts });
const LAB = (x, y, text, owner) => ({ k: 't', x, y, text, owner });

/** Обход логической модели: вызывает visit для каждой вложенной последовательности. */
function eachSequence(item, visit) {
  if (item.t === 'if') { visit(item.yes); visit(item.no); }
  else if (item.t === 'casc') { item.arms.forEach((a) => visit(a.body)); if (item.els) visit(item.els); }
  else if (item.t === 'while' || item.t === 'repeat' || item.t === 'for') visit(item.body);
}

/**
 * Построитель фрагментов: каждый оператор превращается во фрагмент с собственной системой
 * координат (ось потока — x = 0, верх — y = 0), фрагменты затем складываются в колонки.
 */
function makeLayout(diag, env, gost, opts) {
  const { metrics: M, symbols: SYM, texts: T } = gost;
  const { hw, hh, h: H } = M.symbol;
  const FL = M.flow;
  const G = FL.gap;
  const LB = M.label;
  const snapUp = M.snapUp;
  const P = diag.ctx.P;
  const measure = env.measure || approximateMeasure(M.pt);
  const labelW = (text) => measure(text, M.font.labelPt);
  const ifopts = (env.ifopts && env.ifopts[diag.id]) || {};
  const condText = (c) => P.pr(c).s;

  const shapeOf = (it) => it.shape || symbolForKind(it.kind, opts);
  /** Линию можно подвести слева по сетке к символу основной высоты. */
  const entersFromSide = (first) => !!first && SYM.has(first.shape) && SYM.get(first.shape).sideEntry && SYM.get(first.shape).h === H;
  const exitsToSide = (first) => !!first && SYM.has(first.shape) && SYM.get(first.shape).sideExit;
  const leftPortX = (shape) => SYM.get(shape).span(0)[0];
  const rightPortX = (shape) => SYM.get(shape).span(0)[1];

  /** Есть ли во фрагменте досрочные переходы (exit, break, continue, ошибка), уходящие вправо. */
  const hasJumps = (f) => f.jumps.length > 0 || !!f.pureJump;
  /** Самая нижняя горизонталь, по которой переходы фрагмента уходят вправо. */
  const lowestJumpLine = (jumps) => Math.max(...jumps.map((j) => (j.dir === 'down' ? j.y + G : j.y)));

  function frag() {
    return { h: 0, top: 'edge', bot: 'edge', L: hw, R: hw, dead: false, els: [], jumps: [], slots: [], lanes: [], first: null, empty: false };
  }
  function put(dst, src, dx, dy) {
    for (const e of src.els) dst.els.push(moveEl(e, dx, dy));
    for (const j of src.jumps) dst.jumps.push({ ...j, x: j.x + dx, y: j.y + dy });
    for (const s of src.slots) dst.slots.push({ ...s, x: s.x + dx, y: s.y + dy });
    for (const l of src.lanes) dst.lanes.push({ ...l, x: l.x + dx, y0: l.y0 + dy, y1: l.y1 + dy });
  }
  /** Подпись выхода вниз: справа от линии, а если ниже сразу слияние — слева от неё. */
  const downLabel = (y, text, owner, leftOfLine) => LAB(leftOfLine ? -(LB.padX + labelW(text)) : LB.padX, y + G / 2, text, owner);
  /** Подпись бокового выхода: над линией у правой вершины символа. */
  const sideLabel = (yc, text, owner) => LAB(hw + LB.sideGap, yc - LB.sideRise, text, owner);

  function blockFrag(it) {
    const shape = shapeOf(it);
    const f = frag();
    f.h = SYM.get(shape).h;
    f.els.push({ k: 'b', shape, x: 0, y: f.h / 2, text: it.lines.join('\n'), key: it.key, kind: it.kind, warn: it.warn });
    f.first = { shape };
    return f;
  }
  /** Цикл со счётчиком — пара символов «Граница цикла» с общим идентификатором (п. 3.2.2.6). */
  function expand(items) {
    const out = [];
    for (const it of items) {
      if (it.t !== 'for') { out.push(it); continue; }
      const title = T.loop + ' ' + it.name;
      out.push({ t: 'blk', shape: 'lbeg', kind: 'loop', key: it.key + ':b', lines: [title, it.range] });
      const body = it.body.slice();
      if (body.length && body[body.length - 1].t === 'jump') body.pop();
      out.push(...expand(body));
      if (it.used.continue) out.push({ t: 'slot', name: 'cont:' + it.key });
      out.push({ t: 'blk', shape: 'lend', kind: 'loop', key: it.key + ':e', lines: [title, it.vName] });
      if (it.used.break) out.push({ t: 'slot', name: 'brk:' + it.key });
    }
    return out;
  }
  function pointFrag() { const f = frag(); f.top = f.bot = 'point'; f.L = f.R = 0; return f; }
  function layItem(it) {
    switch (it.t) {
      case 'blk': return blockFrag(it);
      case 'slot': { const f = pointFrag(); f.slots.push({ name: it.name, x: 0, y: 0 }); return f; }
      case 'spacer': { const f = pointFrag(); f.h = H; f.els.push(LN([0, 0], [0, H])); f.spacer = true; return f; }
      case 'if': return fIf(it);
      case 'casc': return fCase(it);
      case 'while': return fWhile(it);
      case 'repeat': return fRepeat(it);
      default: return frag();
    }
  }
  function fSeq(items) {
    const f = pointFrag();
    const content = [];
    let jump = null;
    for (const it of items) { if (it.t === 'jump') { jump = it; break; } content.push(it); }
    const ex = expand(content);
    let y = 0, prev = null;
    for (const it of ex) {
      const c = layItem(it);
      if (prev) { f.els.push(LN([0, y], [0, y + G])); y += G; }
      else { f.top = c.top; f.first = c.first; }
      put(f, c, 0, y); y += c.h; prev = c;
      f.L = Math.max(f.L, c.L); f.R = Math.max(f.R, c.R);
    }
    f.h = y;
    if (prev) f.bot = prev.bot;
    f.empty = !prev;
    f.single = ex.length === 1 && ex[0].t === 'blk';
    if (jump) {
      f.dead = true;
      if (!prev) f.pureJump = jump.target;
      else if (f.single && exitsToSide(f.first)) f.jumps.push({ x: rightPortX(f.first.shape), y: f.h / 2, dir: 'right', target: jump.target });
      else f.jumps.push({ x: 0, y, dir: 'down', target: jump.target });
    } else if (prev && prev.dead) f.dead = true;
    return f;
  }

  /** Двоичное «Решение»: один выход вниз, второй — вправо; оба подписаны. */
  function fIf(it) {
    const o = ifopts[it.key] || { inv: it.inv, mode: it.mode };
    const cond = o.inv ? negate(it.cond) : it.cond;
    const yes = o.inv ? it.no : it.yes, no = o.inv ? it.yes : it.no;
    let right = o.mode === 'right';
    const f = frag(); f.first = { shape: 'dia' };
    f.els.push({ k: 'b', shape: 'dia', x: 0, y: hh, text: condText(cond), key: it.key, kind: 'cond', ctl: 'if' });
    let D = fSeq(right ? no : yes), S = fSeq(right ? yes : no);
    // Переходы уходят вправо. Если они есть только в нижней ветви, а справа стоит другая ветвь,
    // ветви меняются местами: иначе линия перехода прошла бы сквозь символы соседней ветви.
    if (hasJumps(D) && !hasJumps(S) && !S.empty) { [D, S] = [S, D]; right = !right; }
    const downLab = right ? T.no : T.yes, sideLab = right ? T.yes : T.no;
    const top = H + G;
    let downBot = H, R = Math.max(hw + LB.room, D.R);
    const Lx = Math.max(hw, D.L);
    if (!D.empty) { f.els.push(LN([0, H], [0, top])); put(f, D, 0, top); downBot = top + D.h; }
    else if (D.pureJump) f.jumps.push({ x: 0, y: H, dir: 'down', target: D.pureJump });
    const downLive = !D.dead;
    let sideLive = true, xs = null, sideBot = H;
    if (!S.empty) {
      // переходы есть в обеих ветвях: боковая ветвь начинается ниже линий перехода нижней
      const below = f.jumps.length ? lowestJumpLine(f.jumps) + G : 0;
      const beside = right && !below && S.top === 'edge' && entersFromSide(S.first);
      xs = snapUp(Math.max(hw, D.R) + FL.branchGap + Math.max(hw, S.L));
      const sTop = beside ? 0 : Math.max(top, below);
      if (beside) f.els.push(LN([hw, hh], [xs + leftPortX(S.first.shape), hh]));
      else f.els.push(LN([hw, hh], [xs, hh], [xs, sTop]));
      put(f, S, xs, sTop); sideBot = sTop + S.h; R = Math.max(R, xs + S.R);
      sideLive = !S.dead;
    } else if (S.pureJump) { f.jumps.push({ x: hw, y: hh, dir: 'right', target: S.pureJump }); sideLive = false; }
    const bypassX = () => snapUp(Math.max(hw, D.R) + FL.branchGap);
    const joinSide = (yM) => {
      if (!S.empty) f.els.push(LN([xs, sideBot], [xs, yM], [0, yM]));
      else { const xN = bypassX(); f.els.push(LN([hw, hh], [xN, hh], [xN, yM], [0, yM])); R = Math.max(R, xN); }
    };
    let mergeNear = false;
    if (downLive && sideLive) {
      const yM = Math.max(downBot, S.empty ? H : sideBot) + G;
      if (downBot < yM) f.els.push(LN([0, downBot], [0, yM]));
      joinSide(yM);
      f.h = yM; f.bot = 'point'; mergeNear = D.empty && yM - H <= G;
    } else if (downLive) { f.h = downBot; f.bot = D.empty ? 'edge' : D.bot; }
    else if (sideLive) {
      const yM = Math.max(downBot, S.empty ? H : sideBot) + G;
      joinSide(yM);
      f.h = yM; f.bot = 'point';
    } else { f.h = Math.max(downBot, sideBot); f.dead = true; }
    f.els.push(downLabel(H, downLab, it.key, mergeNear));
    f.els.push(sideLabel(hh, sideLab, it.key));
    f.L = Lx; f.R = R;
    return f;
  }

  /** Оператор выбора: многовыходное «Решение» или цепочка двоичных — по настройке. */
  function fCase(it) {
    const multiway = it.sel && it.arms.every((a) => a.cond && a.cond.e === 'case');
    return multiway && opts.caseStyle !== 'cascade' ? fSwitch(it) : fCascade(it);
  }

  /**
   * «Решение» с несколькими выходами (пп. 3.2.2.4, 4.3.1). Из правой вершины выходит одна
   * линия, она идёт вниз и разветвляется на ветви, стоящие друг под другом; над каждым
   * ответвлением — значение условия (п. 4.3.1.2). Выход вниз — случай, когда ни одно
   * значение не подошло (ветвь else или сразу слияние).
   */
  function fSwitch(it) {
    const f = frag(); f.first = { shape: 'dia' };
    f.els.push({ k: 'b', shape: 'dia', x: 0, y: hh, text: condText(it.sel) + T.caseSuffix, key: it.key, kind: 'cond', ctl: 'switch' });
    const arms = it.arms.map((a) => ({ label: a.cond.labels.map((l) => P.pr(l).s).join(', '), F: fSeq(a.body) }));
    const E = fSeq(it.els || []);
    const maxL = Math.max(hw, ...arms.filter((a) => !a.F.empty).map((a) => a.F.L));
    const labelRoom = Math.max(...arms.map((a) => labelW(a.label))) + 2 * LB.padX;
    // вертикаль ветвления — правее символа и ветви «Нет»; ветви — правее подписей значений
    const xBus = snapUp(Math.max(hw, E.empty ? 0 : E.R) + FL.busGap);
    const xs = snapUp(xBus + Math.max(FL.busGap, labelRoom) + maxL);
    let y = hh + G, R = xs + hw, armsBot = H;
    const exits = [];
    const branches = [];
    arms.forEach((a) => {
      const A = a.F, yc = y + hh;
      f.els.push(LAB(xBus + LB.padX, yc - LB.sideRise, a.label, it.key));
      let armBot = y + H, needStub = false, branch;
      if (A.empty) {
        branch = [[xBus, yc]];
        if (A.pureJump) { branch.push([xs, yc]); f.jumps.push({ x: xs, y: yc, dir: 'right', target: A.pureJump }); }
        else exits.push({ from: branch, pts: [], y: yc });
      } else {
        const beside = A.top === 'edge' && entersFromSide(A.first);
        const top = beside ? y : yc + G;
        branch = beside ? [[xBus, yc], [xs + leftPortX(A.first.shape), yc]] : [[xBus, yc], [xs, yc], [xs, top]];
        put(f, A, xs, top); armBot = top + A.h; R = Math.max(R, xs + A.R);
        const rightExit = beside && A.single && exitsToSide(A.first);
        if (!A.dead) {
          if (rightExit) exits.push({ pts: [[xs + rightPortX(A.first.shape), yc]], y: yc });
          else { exits.push({ pts: [[xs, armBot], [xs, armBot + G]], y: armBot + G }); needStub = true; }
        } else if (!rightExit) needStub = true;
      }
      branches.push(branch);
      armsBot = armBot + (needStub ? G : 0);
      y = Math.max(y + H + G, armBot + (needStub ? 2 * G : G));
    });
    // линия ветвления: из правой вершины вправо, вниз и в последнюю ветвь; остальные примыкают к ней
    const lastBranch = branches[branches.length - 1];
    const bus = [[hw, hh], [xBus, hh]].concat(lastBranch);
    const pass = exits.find((e) => e.from === lastBranch);
    if (!pass) f.els.push({ k: 'l', pts: bus });
    for (const b of branches.slice(0, -1)) {
      const through = exits.find((e) => e.from === b);
      if (through) through.pts = b.slice(); else f.els.push({ k: 'l', pts: b });
    }
    if (pass) pass.pts = bus;
    // выход «Нет» — вниз
    f.els.push(downLabel(H, T.no, it.key, false));
    let elsBot = H;
    if (!E.empty) {
      // переходы ветви уходят вправо — тогда она начинается ниже боковых ветвей
      const eTop = Math.max(H + G, hasJumps(E) ? armsBot + G : 0);
      f.els.push(LN([0, H], [0, eTop])); put(f, E, 0, eTop); elsBot = eTop + E.h;
    } else if (E.pureJump) {
      // ветвь «Нет» — сразу переход: его линия уходит вправо ниже боковых ветвей
      if (armsBot > H) f.els.push(LN([0, H], [0, armsBot]));
      f.jumps.push({ x: 0, y: armsBot, dir: 'down', target: E.pureJump });
      elsBot = armsBot + G;
    }
    f.L = Math.max(hw, E.empty ? 0 : E.L);
    const elsLive = !E.dead;
    if (exits.length) {
      const yM = Math.max(elsBot, armsBot, ...exits.map((e) => e.y)) + G;
      const xM = snapUp(R + FL.mergeLaneGap);
      exits.sort((a, b) => a.y - b.y);
      exits.forEach((e, i) => {
        const pts = e.pts.concat([[xM, e.y]]);
        if (i === 0) pts.push([xM, yM], [0, yM]);
        f.els.push({ k: 'l', pts });
      });
      if (elsLive) f.els.push(LN([0, elsBot], [0, yM]));
      f.h = yM; f.bot = 'point'; R = xM;
    } else if (elsLive) {
      const bottom = Math.max(elsBot, armsBot);
      if (bottom > elsBot) { f.els.push(LN([0, elsBot], [0, bottom])); f.bot = 'point'; }
      else f.bot = E.empty ? 'edge' : E.bot;
      f.h = bottom;
    } else { f.h = Math.max(elsBot, armsBot); f.dead = true; }
    f.R = R;
    return f;
  }

  /** Цепочка двоичных «Решений»: «Да» — вправо к ветви, «Нет» — вниз к следующей проверке. */
  function fCascade(it) {
    const f = frag(); f.first = { shape: 'dia' };
    const armsF = it.arms.map((a) => fSeq(a.body));
    const maxL = Math.max(hw, ...armsF.filter((a) => !a.empty).map((a) => a.L));
    const xs = snapUp(hw + FL.branchGap + maxL);
    let y = 0, R = hw + LB.room, prevBot = null, lastArmBot = 0;
    const exits = [];
    const noLabels = [];
    it.arms.forEach((a, i) => {
      const A = armsF[i], yc = y + hh;
      if (prevBot !== null) f.els.push(LN([0, prevBot], [0, y]));
      f.els.push({ k: 'b', shape: 'dia', x: 0, y: yc, text: condText(a.cond), key: a.key, kind: 'cond' });
      f.els.push(sideLabel(yc, T.yes, a.key));
      const noLab = downLabel(y + H, T.no, a.key, false);
      f.els.push(noLab); noLabels.push(noLab);
      let armBot = y + H, needStub = false;
      if (A.empty) {
        if (A.pureJump) f.jumps.push({ x: hw, y: yc, dir: 'right', target: A.pureJump });
        else exits.push({ pts: [[hw, yc]], y: yc });
      } else {
        const beside = A.top === 'edge' && entersFromSide(A.first);
        let top;
        if (beside) { top = y; f.els.push(LN([hw, yc], [xs + leftPortX(A.first.shape), yc])); }
        else { top = yc + G; f.els.push(LN([hw, yc], [xs, yc], [xs, top])); }
        put(f, A, xs, top); armBot = top + A.h; R = Math.max(R, xs + A.R);
        const rightExit = beside && A.single && exitsToSide(A.first);
        if (!A.dead) {
          if (rightExit) exits.push({ pts: [[xs + rightPortX(A.first.shape), yc]], y: yc });
          else { exits.push({ pts: [[xs, armBot], [xs, armBot + G]], y: armBot + G }); needStub = true; }
        } else if (!rightExit) needStub = true;
      }
      prevBot = y + H; lastArmBot = armBot + (needStub ? G : 0);
      y = Math.max(y + H + G, armBot + (needStub ? 2 * G : G));
    });
    const lastBot = prevBot;
    const E = it.els ? fSeq(it.els) : null;
    let elsBot = lastBot;
    if (E && !E.empty) {
      // переходы ветви «иначе» уходят вправо — она начинается ниже последней боковой ветви
      const eTop = Math.max(lastBot + G, hasJumps(E) ? lastArmBot + G : 0);
      f.els.push(LN([0, lastBot], [0, eTop])); put(f, E, 0, eTop); elsBot = eTop + E.h; f.L = Math.max(hw, E.L); R = Math.max(R, E.R);
    }
    else if (E && E.pureJump) f.jumps.push({ x: 0, y: lastBot, dir: 'down', target: E.pureJump });
    const elsLive = !(E && E.dead);
    if (exits.length) {
      const yM = Math.max(elsBot, ...exits.map((e) => e.y)) + G;
      const xM = snapUp(R + FL.mergeLaneGap);
      exits.sort((a, b) => a.y - b.y);
      exits.forEach((e, i) => {
        const pts = e.pts.concat([[xM, e.y]]);
        if (i === 0) pts.push([xM, yM], [0, yM]);
        f.els.push({ k: 'l', pts });
      });
      if (elsLive && elsBot < yM) f.els.push(LN([0, elsBot], [0, yM]));
      if ((!E || E.empty) && yM - lastBot <= G) { const lab = noLabels[noLabels.length - 1]; lab.x = -(LB.padX + labelW(lab.text)); }
      f.h = yM; f.bot = 'point'; R = xM;
    } else if (elsLive) { f.h = elsBot; f.bot = (E && !E.empty) ? E.bot : 'edge'; }
    else { f.h = elsBot; f.dead = true; }
    f.R = R; f.L = Math.max(f.L, hw);
    return f;
  }

  /** Цикл с предусловием: возврат — слева вверх (со стрелкой), выход «Нет» — вправо и вниз. */
  function fWhile(it) {
    const f = frag(); f.top = 'point'; f.first = { shape: 'point' };
    const Bd = fSeq(it.body);
    const yc = G + hh;
    f.els.push(LN([0, 0], [0, G]));
    f.els.push({ k: 'b', shape: 'dia', x: 0, y: yc, text: condText(it.cond), key: it.key, kind: 'cond' });
    let yb = G + H;
    if (!Bd.empty) { f.els.push(LN([0, yb], [0, yb + G])); put(f, Bd, 0, yb + G); yb = yb + G + Bd.h; }
    const hasCont = !!it.used.continue;
    const xL = -(Math.max(hw, Bd.L) + FL.loopBackGap);
    if (!Bd.dead) f.els.push(LN([0, yb], [0, yb + G], [xL, yb + G], [xL, 0], [0, 0]));
    if (hasCont) f.slots.push({ name: 'cont:' + it.key, x: 0, y: yb + G });
    const xN = snapUp(Math.max(hw, Bd.R) + FL.branchGap + (hasCont ? FL.laneGap : 0));
    const yE = yb + FL.loopExitDrop;
    f.els.push(LN([hw, yc], [xN, yc], [xN, yE], [0, yE]));
    f.lanes.push({ name: 'brk:' + it.key, x: xN, y0: yc, y1: yE });
    f.els.push(downLabel(G + H, T.yes, it.key, false));
    f.els.push(sideLabel(yc, T.no, it.key));
    f.h = yE; f.bot = 'point'; f.L = -xL; f.R = xN;
    return f;
  }

  /** Цикл с постусловием: «Нет» — вправо и вверх к началу тела (со стрелкой), «Да» — вниз. */
  function fRepeat(it) {
    const f = frag(); f.top = 'point'; f.first = { shape: 'point' };
    const Bd = fSeq(it.body);
    f.els.push(LN([0, 0], [0, G]));
    let yd = G;
    if (!Bd.empty) {
      put(f, Bd, 0, G);
      const yb = G + Bd.h;
      if (it.used.continue) { f.els.push(LN([0, yb], [0, yb + 2 * G])); f.slots.push({ name: 'cont:' + it.key, x: 0, y: yb + G }); yd = yb + 2 * G; }
      else { f.els.push(LN([0, yb], [0, yb + G])); yd = yb + G; }
    }
    const yc = yd + hh;
    f.els.push({ k: 'b', shape: 'dia', x: 0, y: yc, text: condText(it.cond), key: it.key, kind: 'cond' });
    const xR = snapUp(Math.max(hw, Bd.R) + FL.branchGap);
    f.els.push(LN([hw, yc], [xR, yc], [xR, 0], [0, 0]));
    f.els.push(downLabel(yd + H, T.yes, it.key, false));
    f.els.push(sideLabel(yc, T.no, it.key));
    if (it.used.break) { f.els.push(LN([0, yd + H], [0, yd + H + G])); f.slots.push({ name: 'brk:' + it.key, x: 0, y: yd + H + G }); f.h = yd + H + G; f.bot = 'point'; }
    else { f.h = yd + H; f.bot = 'edge'; }
    f.L = Math.max(hw, Bd.L); f.R = xR;
    return f;
  }
  return { expand, layItem, measure, labelW, shapeOf };
}

// ---------- правки пользователя в логической модели ----------
function applyEdits(ir, edits, texts) {
  const hidden = edits.hidden || {}, ins = edits.inserted || {};
  const inserted = (key, list) => list.map((txt, i) => ({ t: 'blk', kind: 'proc', key: key + '+' + i, lines: [txt || texts.newAction], inserted: true }));
  function walk(seq) {
    const out = [];
    for (const it of seq) {
      if (it.t === 'blk' && hidden[it.key]) continue;
      const c = { ...it };
      if (c.t === 'if') { c.yes = walk(c.yes); c.no = walk(c.no); }
      else if (c.t === 'casc') { c.arms = c.arms.map((a) => ({ ...a, body: walk(a.body) })); if (c.els) c.els = walk(c.els); }
      else if (c.t === 'while' || c.t === 'repeat' || c.t === 'for') c.body = walk(c.body);
      out.push(c);
      const key = c.t === 'for' ? c.key + ':e' : c.key;
      if (ins[key]) out.push(...inserted(key, ins[key]));
    }
    return out;
  }
  let res = walk(ir);
  if (ins.start) res = inserted('start', ins.start).concat(res);
  // если обе ветви стали пустыми — убрать пустое ветвление
  (function clean(seq) {
    for (let i = 0; i < seq.length; i++) {
      const it = seq[i];
      eachSequence(it, clean);
      if (it.t === 'if' && !it.yes.length && !it.no.length) { seq.splice(i, 1); i--; }
    }
  })(res);
  return res;
}
/** Присваивает циклам со счётчиком идентификаторы A, B, …; возвращает их число. */
function nameLoops(ir) {
  let count = 0;
  (function walk(seq) {
    for (const it of seq) {
      if (it.t === 'for') it.name = letterId(count++);
      eachSequence(it, walk);
    }
  })(ir);
  return count;
}
function collectTargets(ir) {
  const s = new Set();
  (function walk(seq) {
    for (const it of seq) {
      if (it.t === 'jump') s.add(it.target);
      eachSequence(it, walk);
    }
  })(ir);
  return s;
}

/**
 * Главная функция размещения: логическая модель → элементы схемы с координатами.
 * @returns {{els:object[], cols:number, loops:number, colInfo:object[], tooTall:boolean}}
 */
export function layoutDiagram(diag, env) {
  const gost = env.gost || GOST;
  const { metrics: M, symbols: SYM, texts: T } = gost;
  const { hw, hh, h: H, connectorD } = M.symbol;
  const FL = M.flow;
  const G = FL.gap;
  const snapUp = M.snapUp;
  const opts = normalizeOptions(env.opts, gost);
  const edits = (env.edits && env.edits[diag.id]) || {};
  const ir = applyEdits(diag.ir, edits, T);
  const nLoops = nameLoops(ir);
  const LY = makeLayout(diag, env, gost, opts);
  const targets = collectTargets(ir);
  const needErr = targets.has('err'), needEnd = needErr || targets.has('end');

  const term = (key, text) => ({ t: 'blk', kind: 'term', shape: 'term', key, lines: [text] });
  const items = LY.expand([term('start', T.start)].concat(ir));
  let errRowIdx = -1;
  if (needErr) {
    const last = items[items.length - 1];
    if (!(last && last.t === 'blk' && last.shape !== 'term')) items.push({ t: 'spacer' });
    errRowIdx = items.length - 1;
  }
  if (needEnd) items.push({ t: 'slot', name: 'end' });
  items.push(term('stop', T.end));
  const frags = items.map((it) => LY.layItem(it));
  frags.forEach((f, i) => { f.idx = i; });

  // --- деление на колонки (перенос через соединители, пп. 3.4.1 и 4.2.5) ---
  const connR = connectorD / 2;
  const yTop = M.page.margin;                                  // верх первой колонки
  const yConnTop = M.page.margin + connR;                      // центр входного соединителя
  const yColTop = M.page.margin + connectorD + FL.connectorLead; // верх колонки-продолжения
  const connReserve = FL.connectorLead + connectorD;           // место под выходной соединитель
  const maxBottom = opts.maxH - M.page.margin;
  const cols = [];
  // глубина вложенности циклов перед элементом — переносим по возможности вне циклов
  const depth = [];
  { let d = 0; items.forEach((it, k) => { if (it.shape === 'lend') d--; depth[k] = d; if (it.shape === 'lbeg') d++; }); }
  const restNeed = (from) => { let s = 0; for (let k = from; k < frags.length; k++) s += frags[k].h + (k > from ? G : 0); return s; };
  for (let i = 0; i < frags.length;) {
    const y = cols.length ? yColTop : yTop;
    if (y + restNeed(i) <= maxBottom) { cols.push(frags.slice(i)); break; }
    let last = i, yy = y; // last — индекс, до которого (не включая) колонка помещается
    for (let k = i; k < frags.length; k++) {
      const add = (k > i ? G : 0) + frags[k].h;
      if (k > i && yy + add + connReserve > maxBottom) break;
      yy += add; last = k + 1;
    }
    if (last <= i) last = i + 1;
    let best = last;
    if (last < frags.length) {
      const lo = Math.max(i + 1, i + Math.ceil((last - i) * MIN_COLUMN_FILL));
      for (let k = last; k >= lo; k--) if (depth[k] < depth[best]) best = k;
    }
    cols.push(frags.slice(i, best)); i = best;
  }
  // колонка каждой точки слияния, линии выхода и строки блока ошибки
  const tcolOf = {};
  cols.forEach((cf, c) => cf.forEach((f) => { f.col = c; f.slots.forEach((s) => { tcolOf[s.name] = c; }); f.lanes.forEach((l) => { tcolOf[l.name] = c; }); }));
  if (needErr) tcolOf.err = frags[errRowIdx].col;

  // --- обозначения: сначала циклы, затем соединители; общая последовательность ⇒ уникальны ---
  let letterN = nLoops;
  const nextLetter = () => letterId(letterN++);

  const els = [];
  const allSlots = {}, allLanes = {};
  const pendingIn = {}; // колонка -> [{target, letterIn}]
  let prevRight = { blocks: 0, lines: 0 };
  let errBlock = null;
  const colInfo = [];
  const errShape = symbolForKind('err', opts);
  const halfOf = (e) => SYM.half(e.shape);

  /** Самая правая точка содержимого колонки в полосе [y0, y1]; xCap — не учитывать правее. */
  function maxRightIn(col, y0, y1, xCap) {
    let m = -Infinity;
    const cap = xCap == null ? Infinity : xCap - EPS;
    const capped = cap < Infinity;
    for (const e of els) {
      if (e.col !== col) continue;
      if (e.k === 'l') {
        for (let k = 0; k + 1 < e.pts.length; k++) {
          const [ax, ay] = e.pts[k], [bx, by] = e.pts[k + 1];
          if (Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
          if (!capped) m = Math.max(m, ax, bx);
          else { if (ax < cap) m = Math.max(m, ax); if (bx < cap) m = Math.max(m, bx); }
        }
      } else if (e.k === 'b') { const [bw, bh] = halfOf(e); if (e.y + bh >= y0 && e.y - bh <= y1) m = Math.max(m, e.x + bw); }
      else if (e.k === 't') { if (e.y + M.label.halfHeight >= y0 && e.y - M.label.halfHeight <= y1) m = Math.max(m, e.x + LY.labelW(e.text)); }
    }
    return m;
  }
  const push = (e, col) => { e.col = col; els.push(e); return e; };
  const connector = (x, y, text, key, col) => push({ k: 'b', shape: 'conn', x, y, text, key }, col);
  /** Линия перехода от источника к вертикали lane. */
  const jumpPath = (s, lane) => (s.dir === 'right' ? [[s.x, s.y], [lane, s.y]] : [[s.x, s.y], [s.x, s.y + G], [lane, s.y + G]]);

  for (let c = 0; c < cols.length; c++) {
    const cf = cols[c];
    const Lmax = Math.max(hw, ...cf.map((f) => f.L));
    const X = c === 0
      ? snapUp(Lmax + M.page.leftMargin)
      : snapUp(Math.max(prevRight.blocks + FL.columnGapSymbols, prevRight.lines + FL.columnGapLines) + Lmax);
    let y = c === 0 ? yTop : yColTop;
    const info = { X, top: y, jumps: [] };
    if (c > 0) { connector(X, yConnTop, colInfo[c - 1].letter, 'conn' + c + 't', c); push(LN([X, yConnTop + connR], [X, yColTop]), c); }
    cf.forEach((f, k) => {
      if (k > 0) { push(LN([X, y], [X, y + G]), c); y += G; }
      f.absY = y; f.absX = X;
      for (const e of f.els) push(moveEl(e, X, y), c);
      for (const j of f.jumps) info.jumps.push({ ...j, x: j.x + X, y: j.y + y });
      for (const s of f.slots) allSlots[s.name] = { x: s.x + X, y: s.y + y, col: c };
      for (const l of f.lanes) allLanes[l.name] = { x: l.x + X, y0: l.y0 + y, y1: l.y1 + y, col: c };
      y += f.h;
    });
    info.bottom = y;
    if (c < cols.length - 1) {
      push(LN([X, y], [X, y + FL.connectorLead]), c);
      info.letter = nextLetter(); info.connY = y + FL.connectorLead + connR;
      connector(X, info.connY, info.letter, 'conn' + c + 'b', c);
    }
    colInfo.push(info);

    // --- переходы (досрочные выходы, ошибки, break/continue) ---
    // 1) break в цикле с предусловием — на вертикаль выхода из цикла
    const groups = new Map();
    const groupOf = (target) => { if (!groups.has(target)) groups.set(target, { target, srcs: [] }); return groups.get(target); };
    for (const j of info.jumps) {
      const ln = allLanes[j.target];
      if (ln && ln.col === c) push({ k: 'l', pts: jumpPath(j, ln.x) }, c);
      else groupOf(j.target).srcs.push(j);
    }
    for (const g of pendingIn[c] || []) { const gg = groupOf(g.target); gg.incoming = true; gg.letterIn = g.letterIn; }
    const errRowFrag = needErr && tcolOf.err === c ? frags[errRowIdx] : null;
    const glist = [...groups.values()].map((g) => {
      g.tcol = g.target === 'err' ? tcolOf.err : (tcolOf[g.target] !== undefined ? tcolOf[g.target] : cols.length - 1);
      g.y0 = g.incoming ? yTop : Math.min(...g.srcs.map((s) => (s.dir === 'down' ? s.y + G : s.y)));
      if (g.tcol !== c) g.y1 = info.connY - connR;
      else if (g.target === 'err') g.y1 = errRowFrag.absY + H;
      else g.y1 = (allSlots[g.target] || { y: info.bottom }).y;
      g.span = g.y1 - g.y0;
      return g;
    });
    // Порядок назначения вертикалей (ближняя к оси — первая). Блок ошибки и точка «Конец»
    // привязаны к своей колонке; транзитные линии (из соединителя в соединитель) занимают всю
    // высоту колонки, поэтому идут последними — снаружи, иначе их пересекали бы все остальные (п. 4.2.2).
    const local = (g) => g.tcol === c;
    const rank = (g) => (!local(g) ? 3 : g.target === 'err' ? 0 : g.target === 'end' ? 2 : 1);
    glist.sort((a, b) => rank(a) - rank(b) || a.span - b.span);
    for (const g of glist) {
      const isErr = g.target === 'err' && g.tcol === c;
      let cap = null;
      if (g.target.startsWith('cont:') && g.tcol === c) { const ex = allLanes['brk:' + g.target.slice('cont:'.length)]; if (ex && ex.col === c) cap = ex.x; }
      const mr = maxRightIn(c, g.y0 - G / 10, g.y1 + G / 10, cap);
      let lane = snapUp(Math.max(mr, X + hw) + FL.branchGap + (isErr ? hw : 0));
      if (cap != null && lane >= cap) lane = cap - FL.laneStep;
      const srcs = g.srcs.slice().sort((a, b) => a.y - b.y);
      const polys = srcs.map((s) => jumpPath(s, lane));
      let main;
      if (g.incoming) { connector(lane, yConnTop, g.letterIn, 'conn' + c + g.target, c); main = [[lane, yConnTop + connR]]; }
      else main = polys.shift();
      // продолжение главной линии группы
      if (g.tcol !== c) {
        main.push([lane, info.connY - connR]);
        const letter = nextLetter();
        connector(lane, info.connY, letter, 'conn' + c + 'x' + g.target, c);
        (pendingIn[c + 1] = pendingIn[c + 1] || []).push({ target: g.target, letterIn: letter });
      } else if (isErr) {
        const rowY = errRowFrag.absY;
        main.push([lane, rowY]);
        errBlock = push({ k: 'b', shape: errShape, x: lane, y: rowY + hh, text: T.errorOutput.join('\n'), key: 'err', kind: 'err' }, c);
      } else if (allSlots[g.target]) {
        const s = allSlots[g.target];
        main.push([lane, s.y]);
        const endX = (g.target === 'end' && errBlock && errBlock.col === c && lane > errBlock.x) ? errBlock.x : s.x;
        main.push([endX, s.y]);
      }
      push({ k: 'l', pts: main }, c);
      for (const pl of polys) push({ k: 'l', pts: pl }, c);
      if (isErr) { const s = allSlots.end; push({ k: 'l', pts: [[errBlock.x, errBlock.y + hh], [errBlock.x, s.y], [s.x, s.y]] }, c); }
    }
    // правая граница колонки
    const right = { blocks: X + hw, lines: X + hw };
    for (const e of els) {
      if (e.col !== c) continue;
      if (e.k === 'b') right.blocks = Math.max(right.blocks, e.x + halfOf(e)[0]);
      else if (e.k === 'l') for (const p of e.pts) right.lines = Math.max(right.lines, p[0]);
      else if (e.k === 't') right.lines = Math.max(right.lines, e.x + LY.labelW(e.text));
    }
    prevRight = right;
  }

  // --- идентификаторы символов (п. 4.1.5): по колонкам, сверху вниз, слева направо ---
  const blocks = els.filter((e) => e.k === 'b' && SYM.get(e.shape).identified);
  const topOf = (b) => b.y - halfOf(b)[1];
  blocks.sort((a, b) => a.col - b.col || Math.round((topOf(a) - topOf(b)) * 100) || a.x - b.x);
  blocks.forEach((b, i) => { b.num = i + 1; });

  // --- ключи блоков должны быть уникальны ---
  const seenKeys = {};
  for (const b of els) if (b.k === 'b') { if (seenKeys[b.key]) b.key = b.key + '#' + (seenKeys[b.key]++); else seenKeys[b.key] = 1; }

  return { els, cols: cols.length, loops: nLoops, colInfo, tooTall: cols.some((cf) => cf.length === 1 && cf[0].h > maxBottom - yTop) };
}
