// ===================== ЛЕКСЕР И ПАРСЕР PASCAL =====================
const RESERVED = new Set(('and array as asm begin case class const constructor destructor div do downto else end except exports ' +
  'finalization finally for function goto if implementation in inherited initialization interface is label library mod nil not ' +
  'object of or packed procedure program raise record repeat resourcestring set shl shr then threadvar to try type unit until uses ' +
  'var while with xor dispinterface').split(' '));
const DIRECTIVES = new Set(('overload override virtual abstract reintroduce static inline cdecl stdcall register pascal safecall ' +
  'forward external export assembler message dynamic deprecated platform experimental varargs local nostackframe public alias ' +
  'final unimplemented winapi far near noreturn iocheck hardfloat interrupt').split(' '));

function lex(src) {
  const toks = []; let i = 0, line = 1; const n = src.length;
  const idStart = c => /[A-Za-z_\u00C0-\uFFFF]/.test(c);
  const idChar = c => /[A-Za-z0-9_\u00C0-\uFFFF]/.test(c);
  const countNl = (a, b) => { for (let k = a; k < b; k++) if (src[k] === '\n') line++; };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\uFEFF' || c === '\u00A0') { i++; continue; }
    if (c === '{') { const j = src.indexOf('}', i + 1); const e = j < 0 ? n : j + 1; countNl(i, e); i = e; continue; }
    if (c === '(' && src[i + 1] === '*') { const j = src.indexOf('*)', i + 2); const e = j < 0 ? n : j + 2; countNl(i, e); i = e; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    const s0 = i, ln = line;
    if (idStart(c) || (c === '&' && idStart(src[i + 1] || ''))) {
      const esc = c === '&'; if (esc) i++;
      let j = i; while (j < n && idChar(src[j])) j++;
      const v = src.slice(i, j), lc = v.toLowerCase();
      toks.push({ t: !esc && RESERVED.has(lc) ? 'kw' : 'id', v, lc, line: ln, s: s0, e: j });
      i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
      toks.push({ t: 'num', v: m[0], lc: m[0], line: ln, s: s0, e: i + m[0].length }); i += m[0].length; continue;
    }
    if ((c === '$' && /[0-9A-Fa-f]/.test(src[i + 1] || '')) || (c === '%' && /[01]/.test(src[i + 1] || '')) || (c === '&' && /[0-7]/.test(src[i + 1] || ''))) {
      let j = i + 1; while (j < n && /[0-9A-Fa-f_]/.test(src[j])) j++;
      toks.push({ t: 'num', v: src.slice(i, j), lc: src.slice(i, j), line: ln, s: s0, e: j }); i = j; continue;
    }
    if (c === "'" || (c === '#' && /[0-9$]/.test(src[i + 1] || ''))) {
      let val = '', j = i;
      while (j < n) {
        if (src[j] === "'") {
          j++;
          while (j < n) {
            if (src[j] === "'") { if (src[j + 1] === "'") { val += "'"; j += 2; continue; } j++; break; }
            if (src[j] === '\n') break;
            val += src[j++];
          }
        } else if (src[j] === '#') {
          j++; let d = '';
          if (src[j] === '$') { j++; while (j < n && /[0-9A-Fa-f]/.test(src[j])) d += src[j++]; val += String.fromCharCode(parseInt(d || '0', 16)); }
          else { while (j < n && /[0-9]/.test(src[j])) d += src[j++]; val += String.fromCharCode(parseInt(d || '0', 10)); }
        } else break;
      }
      toks.push({ t: 'str', v: src.slice(i, j), val, lc: '', line: ln, s: s0, e: j }); i = j; continue;
    }
    const two = src.substr(i, 2);
    if ([':=', '+=', '-=', '*=', '/=', '<=', '>=', '<>', '..', '**', '><'].includes(two)) {
      toks.push({ t: 'sym', v: two, lc: two, line: ln, s: s0, e: i + 2 }); i += 2; continue;
    }
    toks.push({ t: 'sym', v: c, lc: c, line: ln, s: s0, e: i + 1 }); i++;
  }
  toks.push({ t: 'eof', v: '<конец файла>', lc: '', line, s: n, e: n });
  return toks;
}

function parsePascal(src) {
  const toks = lex(src); let p = 0;
  const EOF = toks[toks.length - 1];
  const errors = [];
  const T = () => toks[p] || EOF;
  const P = k => toks[p + k] || EOF;
  const isK = (lc, t = T()) => t.t === 'kw' && t.lc === lc;
  const isS = (v, t = T()) => t.t === 'sym' && t.v === v;
  const isW = (lc, t = T()) => (t.t === 'kw' || t.t === 'id') && t.lc === lc;
  const next = () => toks[p++] || EOF;
  const acc = v => { if (isS(v)) { p++; return true; } return false; };
  const accK = lc => { if (isK(lc)) { p++; return true; } return false; };
  const perr = msg => { const e = new Error(msg); e.line = T().line; return e; };
  const expS = v => { if (!acc(v)) throw perr(`ожидалось «${v}», найдено «${T().v}»`); };
  const expK = lc => { if (!accK(lc)) throw perr(`ожидалось «${lc}», найдено «${T().v}»`); };

  const prog = { routines: [], mains: [], classes: {}, globals: new Map(), errors, src };
  const globalScope = { vars: prog.globals, routines: [], routine: null };

  function skipTo(v) { let d = 0; while (T().t !== 'eof') { if (isS('(') || isS('[')) d++; else if (isS(')') || isS(']')) d--; else if (d <= 0 && isS(v)) return; p++; } }
  function skipParens() { let d = 0; do { if (isS('(')) d++; else if (isS(')')) d--; p++; } while (d > 0 && T().t !== 'eof'); }

  // ----- типы (пропуск с учётом class/record ... end) -----
  function skipType() {
    let depth = 0, pd = 0, cls = null, prev = null; const start = p;
    for (;;) {
      const t = T();
      if (t.t === 'eof') break;
      if (t.t === 'sym') {
        if (t.v === '(' || t.v === '[') pd++;
        else if (t.v === ')' || t.v === ']') pd = Math.max(0, pd - 1);
        else if (t.v === ';' && pd === 0 && depth === 0) break;
        p++; prev = t; continue;
      }
      if (t.t === 'kw') {
        if (t.lc === 'record') { depth++; p++; prev = t; continue; }
        if (t.lc === 'end') { depth = Math.max(0, depth - 1); p++; prev = t; continue; }
        if (t.lc === 'class' || t.lc === 'object' || t.lc === 'interface' || t.lc === 'dispinterface') {
          if (t.lc === 'object' && prev && prev.t === 'kw' && prev.lc === 'of') { p++; prev = t; continue; }
          const nx = P(1);
          if (t.lc === 'class' && (isS(';', nx) || isK('of', nx) || isK('procedure', nx) || isK('function', nx) || isK('var', nx) ||
              isW('property', nx) || isK('constructor', nx) || isK('destructor', nx) || isW('operator', nx) || isK('threadvar', nx) || isK('const', nx) || isK('type', nx))) { p++; prev = t; continue; }
          p++; let parent = null;
          if (isS('(')) { const q = p; skipParens(); parent = toks[q + 1] && toks[q + 1].v; if (isS(';') || isS(')')) { prev = toks[p - 1]; continue; } }
          else if (isS(';')) { prev = t; continue; }
          depth++;
          if (t.lc === 'class' && depth === 1 && !cls) cls = { parent, fields: [] };
          prev = toks[p - 1]; continue;
        }
      }
      if (cls && depth === 1 && pd === 0 && t.t === 'id' && prev && (prev.t === 'sym' && (prev.v === ';' || prev.v === ')') || prev.t === 'id' && /^(private|public|published|protected|strict)$/.test(prev.lc) || prev.t === 'kw' && prev.lc === 'class')) {
        let q = p; const names = [t.v]; q++;
        while (isS(',', toks[q]) && toks[q + 1] && toks[q + 1].t === 'id') { names.push(toks[q + 1].v); q += 2; }
        if (isS(':', toks[q]) && toks[q + 1] && toks[q + 1].t === 'id' && isS(';', toks[q + 2])) {
          for (const nm of names) cls.fields.push({ name: nm, type: toks[q + 1].v });
          p = q + 3; prev = toks[q + 2]; continue;
        }
      }
      p++; prev = t;
    }
    return { text: toks.slice(start, p).map(x => x.v).join(' '), cls };
  }
  function parseTypes() {
    while (T().t === 'id') {
      const name = next().v;
      if (isS('<')) { while (!isS('>') && T().t !== 'eof') p++; acc('>'); }
      if (!acc('=')) { skipTo(';'); acc(';'); continue; }
      accK('type');
      const r = skipType(); acc(';');
      if (r.cls) prog.classes[name.toLowerCase()] = { name, parent: r.cls.parent, fields: r.cls.fields };
    }
  }
  function parseVars(map) {
    while (T().t === 'id') {
      const names = [next().v];
      while (acc(',')) { if (T().t === 'id') names.push(next().v); }
      if (!acc(':')) { skipTo(';'); acc(';'); continue; }
      const r = skipType(); acc(';');
      for (const nm of names) map.set(nm.toLowerCase(), { name: nm, type: r.text.toLowerCase() });
    }
  }
  function skipConsts(map) {
    while (T().t === 'id') {
      const nm = next().v;
      if (acc(':')) { const r = skipType(); if (map) map.set(nm.toLowerCase(), { name: nm, type: r.text.toLowerCase(), isConst: true }); }
      else { let d = 0; while (T().t !== 'eof') { if (isS('(') || isS('[')) d++; else if (isS(')') || isS(']')) d--; else if (d <= 0 && isS(';')) break; p++; } if (map) map.set(nm.toLowerCase(), { name: nm, type: '', isConst: true }); }
      acc(';');
    }
  }
  function parseParams() {
    const params = []; expS('(');
    while (!isS(')') && T().t !== 'eof') {
      if (isK('const') || isK('var') || isW('out') || isW('constref')) p++;
      const names = [];
      while (T().t === 'id') { names.push(next().v); if (!acc(',')) break; }
      let type = '';
      if (acc(':')) { const s = p; let d = 0; while (T().t !== 'eof') { if (isS('(') || isS('[')) d++; else if (isS(']')) d--; else if (isS(')')) { if (d === 0) break; d--; } else if (d === 0 && isS(';')) break; p++; } type = toks.slice(s, p).map(x => x.v).join(' '); }
      for (const nm of names) params.push({ name: nm, type: type.toLowerCase() });
      if (!acc(';') && !isS(')')) p++;
    }
    acc(')');
    return params;
  }
  function parseRoutine(scope, allowBodies) {
    const line = T().line;
    if (isK('class')) p++;
    const kind = next().lc;
    const parts = [next().v];
    while (isS('.') && (P(1).t === 'id' || P(1).t === 'kw')) { p++; parts.push(next().v); }
    if (isS('<')) { while (!isS('>') && T().t !== 'eof') p++; acc('>'); }
    let params = [];
    if (isS('(')) params = parseParams();
    let ret = null;
    if (acc(':')) { const s = p; while (!isS(';') && T().t !== 'eof') p++; ret = toks.slice(s, p).map(x => x.v).join(' '); }
    acc(';');
    let forward = false;
    for (;;) {
      const t = T();
      if ((t.t === 'id' || t.t === 'kw') && DIRECTIVES.has(t.lc)) {
        if (t.lc === 'forward' || t.lc === 'external') forward = true;
        p++; while (!isS(';') && T().t !== 'eof' && !isK('begin') && !isK('var') && !isK('procedure') && !isK('function')) p++;
        acc(';'); continue;
      }
      break;
    }
    const r = { name: parts.join('.'), short: parts[parts.length - 1], cls: parts.length > 1 ? parts[parts.length - 2] : null,
      kind, isFunc: kind === 'function', params, ret, vars: new Map(), consts: new Map(), nested: [], body: null, line, parent: scope.routine };
    if (!allowBodies || forward) { r.decl = true; prog.routines.push(r); return r; }
    const inner = { vars: r.vars, consts: r.consts, routines: r.nested, routine: r };
    parseDecls(inner, true);
    if (isK('begin')) { r.body = parseCompound(); r.endLine = toks[p - 1].line; acc(';'); }
    else if (isK('asm')) { while (!isK('end') && T().t !== 'eof') p++; accK('end'); acc(';'); r.body = { s: 'block', list: [{ s: 'asm' }] }; }
    prog.routines.push(r); scope.routines.push(r);
    return r;
  }
  function parseDecls(scope, allowBodies) {
    for (;;) {
      if (T().t === 'eof') return;
      if (isK('var') || isK('threadvar')) { p++; parseVars(scope.vars); continue; }
      if (isK('const') || isK('resourcestring')) { p++; skipConsts(scope.consts || scope.vars); continue; }
      if (isK('type')) { p++; parseTypes(); continue; }
      if (isK('label') || isK('uses') || isK('exports')) { skipTo(';'); acc(';'); continue; }
      if (isK('procedure') || isK('function') || isK('constructor') || isK('destructor') ||
          (isK('class') && (isK('procedure', P(1)) || isK('function', P(1)) || isK('constructor', P(1)) || isK('destructor', P(1))))) {
        try { parseRoutine(scope, allowBodies); }
        catch (e) { errors.push({ line: e.line || T().line, msg: e.message }); skipTo(';'); acc(';'); }
        continue;
      }
      if (isW('generic')) { p++; continue; }
      return;
    }
  }

  // ----- операторы -----
  function parseCompound() { expK('begin'); const list = parseStmtList(['end']); expK('end'); return { s: 'block', list }; }
  function atStop(stops) { return stops.some(s => isW(s)); }
  function parseStmtList(stops) {
    const list = [];
    for (;;) {
      if (T().t === 'eof' || atStop(stops)) break;
      const before = p;
      const st = parseStmtSafe();
      if (st) list.push(st);
      if (acc(';')) continue;
      if (atStop(stops) || T().t === 'eof') break;
      if (p === before) { errors.push({ line: T().line, msg: `непонятный символ «${T().v}»` }); p++; continue; }
      errors.push({ line: T().line, msg: `ожидалась «;» перед «${T().v}»` });
    }
    return list;
  }
  function parseStmtSafe() {
    const start = p;
    try { return parseStmt(); }
    catch (e) {
      errors.push({ line: e.line || T().line, msg: e.message });
      p = start; let d = 0; const line = T().line;
      while (T().t !== 'eof') {
        if (isK('begin') || isK('case') || isK('try') || isK('record')) d++;
        else if (isK('end')) { if (d === 0) break; d--; }
        else if (isS(';') && d === 0) break;
        p++;
      }
      return { s: 'error', text: toks.slice(start, p).map(x => x.v).join(' '), line };
    }
  }
  function stmtOrEmpty() {
    if (isS(';') || isK('else') || isK('end') || isK('until') || isK('except') || isK('finally') || T().t === 'eof') return null;
    return parseStmtSafe();
  }
  function parseStmt() {
    const t = T(), line = t.line;
    if ((t.t === 'id' || t.t === 'num') && isS(':', P(1))) { p += 2; return stmtOrEmpty() || { s: 'empty' }; }
    if (isK('begin')) { const b = parseCompound(); b.line = line; return b; }
    if (isK('if')) {
      p++; const cond = parseExpr(); expK('then');
      const th = stmtOrEmpty(); let el = null;
      if (accK('else')) el = stmtOrEmpty();
      return { s: 'if', cond, then: th, else: el, line };
    }
    if (isK('case')) {
      p++; const sel = parseExpr(); expK('of');
      const arms = []; let els = null;
      for (;;) {
        if (isK('end') || T().t === 'eof') break;
        if (isK('else') || isW('otherwise')) { p++; els = parseStmtList(['end']); break; }
        const labels = [];
        do { const a = parseExpr(); if (acc('..')) labels.push({ e: 'range', a, b: parseExpr() }); else labels.push(a); } while (acc(','));
        expS(':');
        const body = stmtOrEmpty();
        arms.push({ labels, body });
        if (!acc(';') && !isK('end') && !isK('else') && !isW('otherwise')) throw perr('ожидалась «;» в операторе case');
      }
      expK('end');
      return { s: 'case', sel, arms, els, line };
    }
    if (isK('while')) { p++; const cond = parseExpr(); expK('do'); return { s: 'while', cond, body: stmtOrEmpty(), line }; }
    if (isK('repeat')) { p++; const body = parseStmtList(['until']); expK('until'); return { s: 'repeat', body, cond: parseExpr(), line }; }
    if (isK('for')) {
      p++; accK('var');
      const v = parsePostfix(parsePrimary());
      if (acc(':')) { while (!isS(':=') && !isK('in') && T().t !== 'eof') p++; }
      if (accK('in')) { const coll = parseExpr(); expK('do'); return { s: 'forin', v, coll, body: stmtOrEmpty(), line }; }
      expS(':='); const from = parseExpr(); let down = false;
      if (accK('downto')) down = true; else expK('to');
      const to = parseExpr(); expK('do');
      return { s: 'for', v, from, to, down, body: stmtOrEmpty(), line };
    }
    if (isK('with')) { p++; const objs = [parseExpr()]; while (acc(',')) objs.push(parseExpr()); expK('do'); return { s: 'with', objs, body: stmtOrEmpty(), line }; }
    if (isK('try')) {
      p++; const body = parseStmtList(['except', 'finally']); let exc = null, fin = null;
      if (accK('except')) {
        exc = [];
        if (isW('on')) {
          while (isW('on')) {
            p++; if (T().t === 'id' && isS(':', P(1))) p += 2;
            parsePostfix(parsePrimary()); expK('do');
            const st = stmtOrEmpty(); if (st) exc.push(st); acc(';');
          }
          if (accK('else')) exc.push(...parseStmtList(['end']));
        } else exc = parseStmtList(['end']);
      } else if (accK('finally')) fin = parseStmtList(['end']);
      expK('end');
      return { s: 'try', body, exc, fin, line };
    }
    if (isK('raise')) { p++; const e = (isS(';') || isK('end') || isK('else')) ? null : parseExpr(); if (isW('at')) { p++; parseExpr(); } return { s: 'raise', e, line }; }
    if (isK('goto')) { p++; return { s: 'goto', label: next().v, line }; }
    if (isK('asm')) { while (!isK('end') && T().t !== 'eof') p++; expK('end'); return { s: 'asm', line }; }
    if (isK('inherited')) { p++; if (T().t === 'id') parsePostfix(parsePrimary()); return { s: 'inherited', line }; }
    if (isK('var')) {
      p++; const nm = next();
      if (acc(':')) { while (!isS(':=') && !isS(';') && T().t !== 'eof') p++; }
      if (acc(':=')) return { s: 'assign', lhs: { e: 'id', name: nm.v }, rhs: parseExpr(), op: ':=', line };
      return { s: 'empty' };
    }
    const lhs = parseFactor();
    if (isS(':=') || isS('+=') || isS('-=') || isS('*=') || isS('/=')) { const op = next().v; const rhs = parseExpr(); return { s: 'assign', lhs, rhs, op, line }; }
    return { s: 'call', e: lhs, line };
  }

  // ----- выражения -----
  const REL = new Set(['=', '<>', '<', '>', '<=', '>=']);
  function parseExpr() {
    let l = parseSimple();
    for (;;) {
      if (T().t === 'sym' && REL.has(T().v)) { const op = next().v; l = { e: 'bin', op, l, r: parseSimple() }; }
      else if (isK('in') || isK('is')) { const op = next().lc; l = { e: 'bin', op, l, r: parseSimple() }; }
      else break;
    }
    return l;
  }
  function parseSimple() {
    let l = parseTerm();
    for (;;) {
      if (isS('+') || isS('-')) { const op = next().v; l = { e: 'bin', op, l, r: parseTerm() }; }
      else if (isK('or') || isK('xor')) { const op = next().lc; l = { e: 'bin', op, l, r: parseTerm() }; }
      else break;
    }
    return l;
  }
  function parseTerm() {
    let l = parseFactor();
    for (;;) {
      if (isS('*') || isS('/')) { const op = next().v; l = { e: 'bin', op, l, r: parseFactor() }; }
      else if (isS('**')) { p++; l = { e: 'call', f: { e: 'id', name: 'Power' }, args: [l, parseFactor()] }; }
      else if (isK('div') || isK('mod') || isK('and') || isK('shl') || isK('shr') || isK('as')) { const op = next().lc; l = { e: 'bin', op, l, r: parseFactor() }; }
      else break;
    }
    return l;
  }
  function parseFactor() {
    if (isK('not')) { p++; return { e: 'un', op: 'not', x: parseFactor() }; }
    if (isS('-') || isS('+')) { const op = next().v; return { e: 'un', op, x: parseFactor() }; }
    if (isS('@')) { p++; return parseFactor(); }
    return parsePostfix(parsePrimary());
  }
  function parsePrimary() {
    const t = T();
    if (t.t === 'num') { p++; return { e: 'num', v: t.v }; }
    if (t.t === 'str') { p++; return { e: 'str', v: t.val, raw: t.v }; }
    if (isK('nil')) { p++; return { e: 'nil' }; }
    if (isS('(')) { p++; const x = parseExpr(); if (isS(',')) { while (acc(',')) parseExpr(); } expS(')'); return x; }
    if (isS('[')) {
      p++; const items = [];
      if (!isS(']')) { do { const a = parseExpr(); if (acc('..')) items.push({ e: 'range', a, b: parseExpr() }); else items.push(a); } while (acc(',')); }
      expS(']'); return { e: 'set', items };
    }
    if (isK('inherited')) { p++; if (T().t === 'id') return { e: 'id', name: next().v }; return { e: 'id', name: 'inherited' }; }
    if (t.t === 'id') { p++; return { e: 'id', name: t.v }; }
    if (t.t === 'kw' && (t.lc === 'string' || t.lc === 'file')) { p++; return { e: 'id', name: t.v }; }
    throw perr(`неожиданное «${t.v}»`);
  }
  function parsePostfix(x) {
    for (;;) {
      if (isS('.') && (P(1).t === 'id' || P(1).t === 'kw')) { p++; x = { e: 'dot', x, name: next().v }; continue; }
      if (isS('[')) { p++; const idx = [parseExpr()]; while (acc(',')) idx.push(parseExpr()); expS(']'); x = { e: 'idx', x, idx }; continue; }
      if (isS('(')) {
        p++; const args = [];
        if (!isS(')')) { do { const a = parseExpr(); if (acc(':')) { parseExpr(); if (acc(':')) parseExpr(); } args.push(a); } while (acc(',')); }
        expS(')'); x = { e: 'call', f: x, args }; continue;
      }
      if (isS('^')) { p++; continue; }
      break;
    }
    return x;
  }

  // ----- верхний уровень -----
  let mode = 'impl';
  for (;;) {
    if (T().t === 'eof') break;
    if (isK('program') || isK('library')) { p++; next(); if (isS('(')) skipParens(); acc(';'); mode = 'impl'; continue; }
    if (isK('unit')) { p++; next(); while (acc('.')) next(); while (!isS(';') && T().t !== 'eof') p++; acc(';'); mode = 'intf'; continue; }
    if (isK('interface')) { p++; mode = 'intf'; continue; }
    if (isK('implementation')) { p++; mode = 'impl'; continue; }
    if (isK('initialization')) { p++; parseStmtList(['finalization', 'end']); continue; }
    if (isK('finalization')) { p++; parseStmtList(['end']); continue; }
    if (isK('begin')) {
      const line = T().line;
      try { const b = parseCompound(); prog.mains.push({ name: 'main', body: b, line }); }
      catch (e) { errors.push({ line: e.line || T().line, msg: e.message }); p++; }
      acc('.'); continue;
    }
    if (isK('end')) { p++; acc('.'); continue; }
    const before = p;
    parseDecls(globalScope, mode === 'impl');
    if (p === before) {
      // фрагмент без заголовка: последовательность операторов
      if (prog.routines.length === 0 && prog.mains.length === 0 && (T().t === 'id' || isK('if') || isK('for') || isK('while') || isK('repeat') || isK('case'))) {
        const line = T().line; const list = parseStmtList([]);
        prog.mains.push({ name: 'main', body: { s: 'block', list }, line, fragment: true });
        continue;
      }
      errors.push({ line: T().line, msg: `непонятная конструкция «${T().v}»` }); p++;
    }
  }
  return prog;
}
