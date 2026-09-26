// ===================== ОТРИСОВКА: ТЕКСТ, SVG, CANVAS, ФАЙЛЫ =====================
const PT = 25.4 / 72;                         // мм в пункте
const FONT = '"Times New Roman", Tinos, "Liberation Serif", serif';
const LW = 0.9 * PT;                          // толщина линий 0,9 pt
const _mc = document.createElement('canvas').getContext('2d');
const _mcache = new Map();
function measurePlain(str, pt) {
  let w = _mcache.get(str);
  if (w === undefined) { _mc.font = '100px ' + FONT; w = _mc.measureText(str).width / 100; _mcache.set(str, w); }
  return w * pt * PT;
}
function resetMeasureCache() { _mcache.clear(); _fitCache.clear(); }

function parseMarkup(s) {
  let i = 0; s = String(s);
  function seq(stop) {
    const out = []; let buf = '';
    const flush = () => { if (buf) { out.push({ t: 'txt', s: buf }); buf = ''; } };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
      if (stop && c === '}') { i++; flush(); return out; }
      if ((c === '_' || c === '^') && i + 1 < s.length) {
        flush(); i++; let grp;
        if (s[i] === '{') { i++; grp = seq(true); } else { grp = [{ t: 'txt', s: s[i] }]; i++; }
        out.push({ t: c === '_' ? 'sub' : 'sup', c: grp }); continue;
      }
      if (c === '√' && s[i + 1] === '{') { flush(); i += 2; out.push({ t: 'sqrt', c: seq(true) }); continue; }
      buf += c; i++;
    }
    flush(); return out;
  }
  return seq(false);
}
function layoutNodes(nodes, size, x, dy, runs, overs) {
  for (const n of nodes) {
    if (n.t === 'txt') { runs.push({ s: n.s, x, dy, size }); x += measurePlain(n.s, size); }
    else if (n.t === 'sub' || n.t === 'sup') {
      const s2 = size * 0.7, d2 = dy + (n.t === 'sub' ? 0.3 : -0.45) * size * PT;
      x = layoutNodes(n.c, s2, x, d2, runs, overs) + 0.05;
    } else if (n.t === 'sqrt') {
      runs.push({ s: '√', x, dy, size }); const wr = measurePlain('√', size); x += wr;
      const x0 = x - 0.05; const r0 = runs.length;
      x = layoutNodes(n.c, size, x + 0.1, dy, runs, overs);
      let top = dy - 0.8 * size * PT;
      for (let k = r0; k < runs.length; k++) top = Math.min(top, runs[k].dy - 0.74 * runs[k].size * PT - 0.3);
      overs.push({ x0, x1: x + 0.15, y: top, size }); x += 0.35;
    }
  }
  return x;
}
function layoutLine(str, size) { const runs = [], overs = []; const w = layoutNodes(parseMarkup(str), size, 0, 0, runs, overs); return { w, runs, overs }; }
const measureMarkup = (str, pt) => layoutLine(str, pt).w;
const plainText = s => String(s).replace(/\\(.)/g, '$1').replace(/[_^{}]/g, '');

// ---- размещение текста в блоке ----
const _fitCache = new Map();
function availWidth(shape, v, size) {
  const cap = 0.72 * size * PT, desc = 0.25 * size * PT;
  switch (shape) {
    case 'rect': return 36.5;
    case 'term': return 31;
    case 'lbeg': return v < -3 ? 29 : 36;
    case 'lend': return v > 3 ? 29 : 36;
    case 'conn': return 8;
    case 'dia': { const ext = Math.max(Math.abs(v - cap), Math.abs(v + desc)); return Math.max(0, 40 * (1 - ext / 10) - 2.2); }
  }
  return 36;
}
function baseSize(shape, n) {
  if (shape === 'term') return 9;
  if (shape === 'conn') return 9.5;
  return n <= 1 ? 9.5 : n === 2 ? 9 : n === 3 ? 8 : 7.5;
}
function lineOffsets(n, size, shape) {
  const lh = 1.5 * size * PT; const shift = shape === 'lbeg' ? 0.8 : shape === 'lend' ? -0.8 : 0;
  const res = []; for (let k = 0; k < n; k++) res.push((k - (n - 1) / 2) * lh + shift);
  return res; // центры строк относительно центра блока
}
function tryFit(lines, shape, size) {
  const offs = lineOffsets(lines.length, size, shape);
  const L = lines.map(l => layoutLine(l, size));
  const ok = L.every((l, k) => l.w <= availWidth(shape, offs[k], size));
  return { ok, L, offs, size };
}
function splitCandidates(line) {
  const c = []; let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++; else if (ch === '}') depth--;
    else if (ch === ' ' && depth === 0) c.push(i);
  }
  return c;
}
function wrapOnce(lines, size) {
  let wi = -1, ww = -1;
  lines.forEach((l, k) => { const w = layoutLine(l, size).w; if (w > ww) { ww = w; wi = k; } });
  const line = lines[wi]; const cands = splitCandidates(line);
  if (!cands.length) return null;
  let best = null;
  for (const i of cands) {
    const a = line.slice(0, i), b = line.slice(i + 1);
    let score = Math.max(layoutLine(a, size).w, layoutLine(b, size).w);
    if (/[,;=]$/.test(a)) score *= 0.9; else if (/^[=≤≥<>≠]/.test(b) || /(и|или)$/.test(a)) score *= 0.97;
    const depthPen = (a.match(/\(/g) || []).length - (a.match(/\)/g) || []).length; if (depthPen > 0) score *= 1 + 0.08 * depthPen;
    if (!best || score < best.score) best = { score, a, b };
  }
  const res = lines.slice(); res.splice(wi, 1, best.a, best.b); return res;
}
function fitText(text, shape, fixedSize) {
  const key = shape + '|' + (fixedSize || '') + '|' + text;
  if (_fitCache.has(key)) return _fitCache.get(key);
  const cands = [String(text).split('\n')];
  for (let k = 0; k < 3 && cands[cands.length - 1].length < 4; k++) { const w = wrapOnce(cands[cands.length - 1], fixedSize || 8.5); if (!w) break; cands.push(w); }
  let result = null;
  if (fixedSize) { for (const c of cands) { const f = tryFit(c, shape, fixedSize); if (f.ok) { result = f; break; } } }
  else {
    const comfy = shape === 'conn' ? 7 : 8;
    outer: for (const c of cands) { for (let s = baseSize(shape, c.length); s >= comfy - 1e-9; s -= 0.5) { const f = tryFit(c, shape, s); if (f.ok) { result = f; break outer; } } }
    if (!result) outer2: for (const c of cands) { for (let s = comfy - 0.5; s >= 7 - 1e-9; s -= 0.5) { const f = tryFit(c, shape, s); if (f.ok) { result = f; break outer2; } } }
  }
  if (!result) { result = tryFit(cands[cands.length - 1], shape, fixedSize || 7); result.overflow = true; }
  result.lines = result.L;
  _fitCache.set(key, result);
  return result;
}
// ---- геометрия фигур ----
function shapePath(b) {
  const x = b.x, y = b.y, l = x - 20, r = x + 20;
  switch (b.shape) {
    case 'rect': return `M${l} ${y - 10}H${r}V${y + 10}H${l}Z`;
    case 'term': return `M${l + 5} ${y - 5}H${r - 5}A5 5 0 0 1 ${r - 5} ${y + 5}H${l + 5}A5 5 0 0 1 ${l + 5} ${y - 5}Z`;
    case 'dia': return `M${l} ${y}L${x} ${y - 10}L${r} ${y}L${x} ${y + 10}Z`;
    case 'lbeg': return `M${l} ${y - 5}L${l + 5} ${y - 10}H${r - 5}L${r} ${y - 5}V${y + 10}H${l}Z`;
    case 'lend': return `M${l} ${y - 10}H${r}V${y + 5}L${r - 5} ${y + 10}H${l + 5}L${l} ${y + 5}Z`;
    case 'conn': return `M${x - 5} ${y}A5 5 0 1 0 ${x + 5} ${y}A5 5 0 1 0 ${x - 5} ${y}Z`;
  }
  return '';
}
function arrowWings(a) {
  const [dx, dy] = a.dir, [x, y] = a.at, L = 5.5 * PT, W = 2.8 * PT;
  return [[x - dx * L - dy * W, y - dy * L + dx * W], [x, y], [x - dx * L + dy * W, y - dy * L - dx * W]];
}
function commentGeom(c, G) {
  const ow = G.items.find(o => o.id === c.owner);
  const top = c.by - c.h / 2, bot = c.by + c.h / 2;
  let dash = null;
  if (ow) {
    const hw = ow.shape === 'conn' ? 5 : 20;
    const ax = ow.x + hw, ay = ow.y;
    const ty = Math.min(bot - 1, Math.max(top + 1, ay));
    dash = ty === ay ? [[ax, ay], [c.bx, ay]] : [[ax, ay], [c.bx - 3, ay], [c.bx - 3, ty], [c.bx, ty]];
  }
  return { bracket: [[c.bx + 2, top], [c.bx, top], [c.bx, bot], [c.bx + 2, bot]], dash };
}
function textBaselineShift(size) { return 0.34 * size * PT; }

// ---- SVG ----
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = v => Math.round(v * 1000) / 1000;
function svgRuns(L, x0, baseY) {
  let out = '';
  for (const r of L.runs) out += `<text x="${f2(x0 + r.x)}" y="${f2(baseY + r.dy)}" font-size="${f2(r.size * PT)}">${esc(r.s)}</text>`;
  for (const o of L.overs) out += `<line x1="${f2(x0 + o.x0)}" y1="${f2(baseY + o.y)}" x2="${f2(x0 + o.x1)}" y2="${f2(baseY + o.y)}" stroke-width="${f2(0.06 * o.size * PT)}"/>`;
  return out;
}
function svgBlockText(b) {
  const fit = fitText(b.text, b.shape, b.size);
  let s = '';
  fit.lines.forEach((L, k) => { const base = b.y + fit.offs[k] + textBaselineShift(fit.size); s += svgRuns(L, b.x - L.w / 2, base); });
  return { s, fit };
}
function renderSVG(G, o) {
  o = o || {};
  const fill = o.fill === 'none' ? 'none' : '#fff';
  let body = '';
  const overflow = [];
  for (const it of G.items) {
    if (it.type === 'line') {
      body += `<polyline data-id="${it.id}" class="ln" points="${it.pts.map(p => f2(p[0]) + ',' + f2(p[1])).join(' ')}" fill="none" stroke="#000" stroke-width="${f2(LW)}" stroke-linejoin="miter" stroke-linecap="square"/>`;
      for (const a of autoArrows(it)) body += `<polyline points="${arrowWings(a).map(p => f2(p[0]) + ',' + f2(p[1])).join(' ')}" fill="none" stroke="#000" stroke-width="${f2(LW)}" stroke-linejoin="miter"/>`;
      if (o.interactive) body += `<polyline data-id="${it.id}" class="hit" points="${it.pts.map(p => f2(p[0]) + ',' + f2(p[1])).join(' ')}" fill="none" stroke="transparent" stroke-width="2.6"/>`;
    }
  }
  for (const it of G.items) {
    if (it.type === 'comment') {
      const g = commentGeom(it, G);
      body += `<g data-id="${it.id}" class="cm">`;
      if (g.dash) body += `<polyline points="${g.dash.map(p => f2(p[0]) + ',' + f2(p[1])).join(' ')}" fill="none" stroke="#000" stroke-width="${f2(LW)}" stroke-dasharray="${f2(3 * LW)} ${f2(2 * LW)}"/>`;
      body += `<polyline points="${g.bracket.map(p => f2(p[0]) + ',' + f2(p[1])).join(' ')}" fill="none" stroke="#000" stroke-width="${f2(LW)}"/>`;
      const lines = String(it.text).split('\n'); const sz = it.size || 8.5; const lh = 1.5 * sz * PT;
      lines.forEach((ln, k) => { const L = layoutLine(ln, sz); body += svgRuns(L, it.bx + 4, it.by + (k - (lines.length - 1) / 2) * lh + textBaselineShift(sz)); });
      if (o.interactive) { const w = Math.max(...lines.map(l => measureMarkup(l, sz))); body += `<rect x="${f2(it.bx - 1)}" y="${f2(it.by - it.h / 2)}" width="${f2(w + 6)}" height="${f2(it.h)}" fill="transparent"/>`; }
      body += `</g>`;
    }
  }
  for (const it of G.items) {
    if (it.type === 'block') {
      const t = svgBlockText(it);
      if (t.fit.overflow) overflow.push(it.id);
      body += `<g data-id="${it.id}" class="bk"><path d="${shapePath(it)}" fill="${fill}" stroke="#000" stroke-width="${f2(LW)}" stroke-linejoin="miter"/>${t.s}`;
      if (it.shape !== 'conn' && it.num != null && G.numbering !== false) {
        const top = it.y - (it.shape === 'term' ? 5 : 10);
        body += `<text x="${f2(it.x - 20)}" y="${f2(top - 0.8)}" font-size="${f2(9 * PT)}">${it.num}</text>`;
      }
      body += `</g>`;
    } else if (it.type === 'label') {
      body += `<text data-id="${it.id}" class="lb" x="${f2(it.x)}" y="${f2(it.y + textBaselineShift(9))}" font-size="${f2(9 * PT)}">${esc(it.text)}</text>`;
    }
  }
  return { body, overflow };
}
function exportSVGString(G, frame, o) {
  const { body } = renderSVG(G, { fill: o.fill });
  const cap = o.caption ? captionSVG(o.caption, frame) : '';
  const H = frame.H + (o.caption ? CAPTION_H : 0);
  const bg = o.bg === 'white' ? `<rect x="${frame.x0}" y="${frame.y0}" width="${frame.W}" height="${H}" fill="#fff"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${frame.W}mm" height="${H}mm" viewBox="${frame.x0} ${frame.y0} ${frame.W} ${H}">` +
    `<g font-family="'Times New Roman', Tinos, 'Liberation Serif', serif" fill="#000" stroke="#000" stroke-width="0">${bg}${body.replace(/ data-id="[^"]*"| class="[^"]*"/g, '')}${cap}</g></svg>`;
}
const CAPTION_H = 12;
function captionSVG(text, frame) {
  const size = 14, w = measurePlain(text, size);
  return `<text x="${f2(frame.x0 + frame.W / 2 - w / 2)}" y="${f2(frame.y0 + frame.H + 7 + textBaselineShift(size))}" font-size="${f2(size * PT)}">${esc(text)}</text>`;
}

// ---- Canvas (растровый экспорт) ----
function drawCanvas(G, frame, o) {
  const k = o.dpi / 25.4;
  const H = frame.H + (o.caption ? CAPTION_H : 0);
  const cv = document.createElement('canvas');
  cv.width = Math.round(frame.W * k); cv.height = Math.round(H * k);
  const ctx = cv.getContext('2d');
  if (o.bg === 'white') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.setTransform(k, 0, 0, k, -frame.x0 * k, -frame.y0 * k);
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = LW; ctx.lineJoin = 'miter'; ctx.miterLimit = 10;
  const poly = (pts, dash) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
  const runs = (L, x0, baseY) => {
    for (const r of L.runs) { ctx.font = `${r.size * PT}px ${FONT}`; ctx.fillText(r.s, x0 + r.x, baseY + r.dy); }
    for (const ov of L.overs) { ctx.save(); ctx.lineWidth = 0.06 * ov.size * PT; poly([[x0 + ov.x0, baseY + ov.y], [x0 + ov.x1, baseY + ov.y]]); ctx.restore(); }
  };
  ctx.textBaseline = 'alphabetic';
  for (const it of G.items) if (it.type === 'line') { ctx.lineCap = 'square'; poly(it.pts); ctx.lineCap = 'butt'; for (const a of autoArrows(it)) poly(arrowWings(a)); }
  for (const it of G.items) if (it.type === 'comment') {
    const g = commentGeom(it, G);
    if (g.dash) poly(g.dash, [3 * LW, 2 * LW]);
    poly(g.bracket);
    const lines = String(it.text).split('\n'); const sz = it.size || 8.5; const lh = 1.5 * sz * PT;
    lines.forEach((ln, kk) => runs(layoutLine(ln, sz), it.bx + 4, it.by + (kk - (lines.length - 1) / 2) * lh + textBaselineShift(sz)));
  }
  for (const it of G.items) {
    if (it.type === 'block') {
      const p = new Path2D(shapePath(it));
      if (o.fill !== 'none') { ctx.fillStyle = '#fff'; ctx.fill(p); ctx.fillStyle = '#000'; }
      ctx.stroke(p);
      const fit = fitText(it.text, it.shape, it.size);
      fit.lines.forEach((L, kk) => runs(L, it.x - L.w / 2, it.y + fit.offs[kk] + textBaselineShift(fit.size)));
      if (it.shape !== 'conn' && it.num != null && G.numbering !== false) {
        ctx.font = `${9 * PT}px ${FONT}`; ctx.fillText(String(it.num), it.x - 20, it.y - (it.shape === 'term' ? 5 : 10) - 0.8);
      }
    } else if (it.type === 'label') { ctx.font = `${9 * PT}px ${FONT}`; ctx.fillText(it.text, it.x, it.y + textBaselineShift(9)); }
  }
  if (o.caption) {
    ctx.font = `${14 * PT}px ${FONT}`; const w = ctx.measureText(o.caption).width;
    ctx.fillText(o.caption, frame.x0 + frame.W / 2 - w / 2, frame.y0 + frame.H + 7 + textBaselineShift(14));
  }
  return cv;
}

// ---- DPI в PNG и JPEG (чтобы Word вставлял 1:1) ----
const _crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _crcT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function pngWithDpi(buf, dpi) {
  const src = new Uint8Array(buf); const ppm = Math.round(dpi / 0.0254);
  const ch = new Uint8Array(21); const dv = new DataView(ch.buffer);
  dv.setUint32(0, 9); ch.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); ch[16] = 1;
  dv.setUint32(17, crc32(ch.subarray(4, 17)));
  const out = new Uint8Array(src.length + 21); out.set(src.subarray(0, 33), 0); out.set(ch, 33); out.set(src.subarray(33), 54);
  return out;
}
function jpegWithDpi(buf, dpi) {
  const b = new Uint8Array(buf);
  if (b[2] === 0xFF && b[3] === 0xE0 && b[6] === 0x4A && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46) {
    b[13] = 1; b[14] = dpi >> 8; b[15] = dpi & 255; b[16] = dpi >> 8; b[17] = dpi & 255;
  }
  return b;
}
const canvasBlob = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q));
