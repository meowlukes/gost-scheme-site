/**
 * Разметка формул (x_i, a^{2}, √{…}), измерение и размещение текста внутри символов.
 * Не зависит от DOM: функция измерения ширины строки передаётся снаружи.
 */

/** Разбор разметки в дерево: текст, нижний/верхний индекс, корень. */
export function parseMarkup(source) {
  const s = String(source);
  let i = 0;
  function seq(stop) {
    const out = [];
    let buf = '';
    const flush = () => { if (buf) { out.push({ t: 'txt', s: buf }); buf = ''; } };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
      if (stop && c === '}') { i++; flush(); return out; }
      if ((c === '_' || c === '^') && i + 1 < s.length) {
        flush(); i++;
        let grp;
        if (s[i] === '{') { i++; grp = seq(true); } else { grp = [{ t: 'txt', s: s[i] }]; i++; }
        out.push({ t: c === '_' ? 'sub' : 'sup', c: grp });
        continue;
      }
      if (c === '√' && s[i + 1] === '{') { flush(); i += 2; out.push({ t: 'sqrt', c: seq(true) }); continue; }
      buf += c; i++;
    }
    flush();
    return out;
  }
  return seq(false);
}

/** Текст без служебных знаков разметки. */
export const plainText = (s) => String(s).replace(/\\(.)/g, '$1').replace(/[_^{}]/g, '');

/**
 * Оценка ширины строки без шрифта (Node.js, тесты): средняя ширина знака — половина кегля.
 * @param {number} mmPerPt
 */
export const approximateMeasure = (mmPerPt) => (str, pt) => String(str).length * pt * mmPerPt * 0.5;

/**
 * @param {object} gost   оформление (см. gost/index.js)
 * @param {(str:string, pt:number)=>number} measurePlain ширина строки без разметки, мм
 */
export function createTextEngine(gost, measurePlain) {
  const { metrics: m, symbols } = gost;
  const F = m.font;
  const pt = m.pt;
  const fitCache = new Map();
  const lineCache = new Map();

  function layoutNodes(nodes, size, x, dy, runs, overs) {
    const hair = 0.01 * m.unit;
    for (const node of nodes) {
      if (node.t === 'txt') { runs.push({ s: node.s, x, dy, size }); x += measurePlain(node.s, size); }
      else if (node.t === 'sub' || node.t === 'sup') {
        const shift = (node.t === 'sub' ? F.subShift : F.supShift) * size * pt;
        x = layoutNodes(node.c, size * F.scriptScale, x, dy + shift, runs, overs) + hair;
      } else if (node.t === 'sqrt') {
        runs.push({ s: '√', x, dy, size });
        x += measurePlain('√', size);
        const x0 = x - hair;
        const first = runs.length;
        x = layoutNodes(node.c, size, x + 2 * hair, dy, runs, overs);
        let top = dy - 0.8 * size * pt;
        for (let k = first; k < runs.length; k++) top = Math.min(top, runs[k].dy - 0.74 * runs[k].size * pt - 6 * hair);
        overs.push({ x0, x1: x + 3 * hair, y: top, size });
        x += 7 * hair;
      }
    }
    return x;
  }

  /** Раскладка одной строки: отрезки текста со смещениями и черта корня. */
  function layoutLine(str, size) {
    const key = size + '|' + str;
    let hit = lineCache.get(key);
    if (!hit) {
      const runs = [], overs = [];
      const w = layoutNodes(parseMarkup(str), size, 0, 0, runs, overs);
      hit = { w, runs, overs };
      lineCache.set(key, hit);
    }
    return hit;
  }
  const measure = (str, size) => layoutLine(str, size).w;

  /** Свободная ширина символа для строки с центром на высоте v. */
  function availWidth(shape, v, size) {
    const cap = F.capRatio * size * pt, desc = F.descentRatio * size * pt;
    return Math.max(0, symbols.centeredWidth(shape, v - cap, v + desc) - 2 * m.text.pad);
  }
  function baseSize(shape, lines) {
    if (shape === 'term') return F.terminatorPt;
    if (shape === 'conn') return F.connectorPt;
    return F.textPtByLines[Math.min(lines, F.textPtByLines.length) - 1];
  }
  /** Центры строк относительно центра символа. */
  function lineOffsets(count, size, shape) {
    const lh = F.lineHeight * size * pt;
    const shift = symbols.get(shape).textShift || 0;
    return Array.from({ length: count }, (_, k) => (k - (count - 1) / 2) * lh + shift);
  }
  function tryFit(lines, shape, size) {
    const offs = lineOffsets(lines.length, size, shape);
    const L = lines.map((l) => layoutLine(l, size));
    const ok = L.every((l, k) => l.w <= availWidth(shape, offs[k], size));
    return { ok, lines: L, offs, size };
  }
  function splitCandidates(line) {
    const res = [];
    let depth = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === ' ' && depth === 0) res.push(i);
    }
    return res;
  }
  /** Делит самую длинную строку по пробелу так, чтобы обе части были как можно короче. */
  function wrapOnce(lines, size) {
    let wi = -1, ww = -1;
    lines.forEach((l, k) => { const w = measure(l, size); if (w > ww) { ww = w; wi = k; } });
    const line = lines[wi];
    let best = null;
    for (const i of splitCandidates(line)) {
      const a = line.slice(0, i), b = line.slice(i + 1);
      let score = Math.max(measure(a, size), measure(b, size));
      if (/[,;=]$/.test(a)) score *= 0.9;
      else if (/^[=≤≥<>≠]/.test(b) || /(и|или)$/.test(a)) score *= 0.97;
      const open = (a.match(/\(/g) || []).length - (a.match(/\)/g) || []).length;
      if (open > 0) score *= 1 + 0.08 * open;
      if (!best || score < best.score) best = { score, a, b };
    }
    if (!best) return null;
    const res = lines.slice();
    res.splice(wi, 1, best.a, best.b);
    return res;
  }

  /**
   * Подбирает разбиение на строки и кегль, при которых текст помещается в символ.
   * Если не помещается даже минимальным кеглем — возвращает результат с overflow: true
   * (п. 4.1.4: в таком случае текст выносят в комментарий).
   */
  function fitText(text, shape, fixedSize) {
    const key = shape + '|' + (fixedSize || '') + '|' + text;
    const cached = fitCache.get(key);
    if (cached) return cached;
    const maxLines = F.textPtByLines.length;
    const cands = [String(text).split('\n')];
    for (let k = 0; k < maxLines - 1 && cands[cands.length - 1].length < maxLines; k++) {
      const w = wrapOnce(cands[cands.length - 1], fixedSize || F.wrapPt);
      if (!w) break;
      cands.push(w);
    }
    const eps = 1e-9;
    const search = (from, to) => {
      for (const c of cands) {
        for (let s = from(c); s >= to - eps; s -= F.stepPt) { const f = tryFit(c, shape, s); if (f.ok) return f; }
      }
      return null;
    };
    let result = null;
    if (fixedSize) {
      for (const c of cands) { const f = tryFit(c, shape, fixedSize); if (f.ok) { result = f; break; } }
    } else {
      const comfort = shape === 'conn' ? F.connectorComfortPt : F.comfortPt;
      result = search((c) => baseSize(shape, c.length), comfort) || search(() => comfort - F.stepPt, F.minPt);
    }
    if (!result) { result = tryFit(cands[cands.length - 1], shape, fixedSize || F.minPt); result.overflow = true; }
    fitCache.set(key, result);
    return result;
  }

  return {
    layoutLine, measure, fitText,
    /** Сдвиг базовой линии от центра строки. */
    baseline: (size) => F.baselineRatio * size * pt,
    lineStep: (size) => F.lineHeight * size * pt,
    reset() { fitCache.clear(); lineCache.clear(); },
  };
}
