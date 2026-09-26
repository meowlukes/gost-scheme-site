// ===================== ПЕЧАТЬ ВЫРАЖЕНИЙ И ПРЕОБРАЗОВАНИЕ В ЛОГИЧЕСКУЮ МОДЕЛЬ =====================
const PR = { OR: 1, AND: 2, NOT: 3, REL: 4, ADD: 5, MUL: 6, NEG: 7, FN: 8, ATOM: 9 };
const RELSYM = { '=': '=', '<>': '≠', '<': '<', '>': '>', '<=': '≤', '>=': '≥' };
const RELFLIP = { '=': '<>', '<>': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };
const RELSWAP = { '=': '=', '<>': '<>', '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
const CONV = new Set(('strtofloat strtoint strtoint64 strtoqword strtodword strtofloatdef strtointdef strtoint64def floattostr inttostr ' +
  'floattostrf trim trimleft trimright currtostr strtocurr booltostr datetostr strtodate timetostr strtotime datetimetostr ' +
  'utf8decode utf8encode ansitoutf8 utf8toansi sys_utf8toansi strtobool strtobooldef inttohex').split(' '));
const TYPECASTS = new Set(('integer longint int64 cardinal word byte shortint smallint longword qword real double single extended ' +
  'currency char boolean string ansistring widestring unicodestring shortstring pointer variant ansichar widechar').split(' '));
const VALUE_PROPS = new Set(['text', 'caption', 'checked', 'itemindex', 'value', 'position', 'lines', 'cells', 'items', 'date', 'time', 'seltext', 'state', 'selected']);
const COMP_TYPES = /^t(edit|label|button|memo|combobox|radiobutton|checkbox|stringgrid|drawgrid|listbox|spinedit|floatspinedit|trackbar|radiogroup|checkgroup|panel|image|shape|labelededit|maskedit|statictext|datetimepicker|calendar|scrollbar|updown|groupbox|richedit|synedit|progressbar|valuelisteditor|togglebox|bitbtn|speedbutton|colorbox|listview|treeview|chart|checklistbox|editbutton|spinedit\w*|\w*edit|\w*grid|\w*box)$/i;
const READS = new Set(['read', 'readln']);
const WRITES = new Set(['write', 'writeln']);
const MSGS = new Set(['showmessage', 'messagedlg', 'messagebox', 'showmessagefmt', 'questiondlg']);
const IGNORE = new Set(('setfocus show showmodal hide close clear refresh repaint invalidate update beginupdate endupdate free freeandnil ' +
  'destroy randomize sleep beep processmessages setlength assign assignfile reset rewrite append closefile flush selectall ' +
  'clearselection setbounds bringtofront sendtoback terminate release fillchar dispose new getmem freemem initialize finalize ' +
  'delay clrscr gotoxy textcolor textbackground readkey cursoroff cursoron window setcurrentdir chdir inherited clearall ' +
  'sort autosize setfocused').split(' '));
const OUTPUT_NAME = /^(show|display|print|output|out|setdata|setresult|setresults|setvalues|fill|вывод)/i;
const ERR_WORDS = /ошиб|некоррект|неверн|невозмож|недопуст|не явля|не может|не долж|должн|введите|выберите|заполните|не выбран|пуст|error|invalid|wrong|incorrect/i;
const FUNCMAP = { sin: 'sin', cos: 'cos', tan: 'tg', cotan: 'ctg', cot: 'ctg', arctan: 'arctg', arcsin: 'arcsin', arccos: 'arccos',
  arccot: 'arcctg', sinh: 'sh', cosh: 'ch', tanh: 'th', ln: 'ln', log10: 'lg', log2: 'log_2', max: 'max', min: 'min',
  maxvalue: 'max', minvalue: 'min', sum: 'сумма', random: 'случ', ord: 'код', chr: 'символ', copy: 'подстрока', pos: 'поз',
  upcase: 'прописн', uppercase: 'прописн', lowercase: 'строчн', high: 'high', low: 'low', sign: 'sign', floor: 'floor', ceil: 'ceil',
  succ: 'след', pred: 'пред', reversestring: 'обратн', ansiuppercase: 'прописн', ansilowercase: 'строчн', mean: 'среднее' };

const escText = s => String(s).replace(/[\\_^{}]/g, m => '\\' + m);
const escId = s => String(s).replace(/_/g, '\\_');
const plainLen = s => String(s).replace(/\\(.)/g, '$1').replace(/[_^{}]/g, '').replace(/√/g, 'v').length;
const rp = (s, p, kind) => ({ s, p, kind: kind || '' });
const wrap = (r, need) => (r.p < need ? '(' + r.s + ')' : r.s);

function fmtNum(raw) {
  if (/^[$%&]/.test(raw)) return rp(raw, PR.ATOM, 'num');
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m) return rp(raw, PR.ATOM, 'num');
  const mant = m[1] + (m[2] ? ',' + m[2] : '');
  if (m[3] !== undefined) {
    const ex = parseInt(m[3], 10); const exs = (ex < 0 ? '–' : '') + Math.abs(ex);
    if (mant === '1') return rp('10^{' + exs + '}', PR.ATOM, 'num');
    return rp(mant + '·10^{' + exs + '}', PR.MUL, 'num');
  }
  return rp(mant, PR.ATOM, 'num');
}
function subscript(base, parts) {
  parts = parts.map(x => x.replace(/ ([–+]) /g, '$1'));
  const single = parts.every(x => plainLen(x) === 1 && !/[\\{}_^]/.test(x));
  const inner = single ? parts.join('') : parts.join(',');
  return base + '_' + (plainLen(inner) === 1 && !/[{}_^\\]/.test(inner) ? inner : '{' + inner + '}');
}

// ---------- контекст печати ----------
function makePrinter(ctx) {
  const env = ctx.env;
  function nameEnt(lc) { return env.names && env.names[lc]; }
  function use(lc, name, kind) { if (!ctx.used.has(lc)) ctx.used.set(lc, { name, kind }); }
  function canon(name) { const c = ctx.canon.get(name.toLowerCase()); return c || name; }
  function dispRoutine(r) {
    const lc = r.short.toLowerCase(); use(lc, canon(r.short), 'routine');
    const ent = nameEnt(lc); return ent && ent.disp ? ent.disp : escId(canon(r.short));
  }
  function disp(name, kind) {
    const lc = name.toLowerCase();
    if (lc === 'result' && ctx.fn) {
      const ent = nameEnt('result'); if (ent && ent.disp) { use('result', 'Result', 'var'); return ent.disp; }
      return dispRoutine(ctx.fn);
    }
    if (ctx.fn && ctx.fn.isFunc && lc === ctx.fn.short.toLowerCase()) return dispRoutine(ctx.fn);
    if (lc === 'pi') return 'π';
    if (lc === 'true' || lc === 'false') return lc;
    const own = ctx.own.get(lc); if (own) return dispRoutine(own);
    use(lc, canon(name), kind || (ctx.comps.has(lc) ? 'comp' : 'var'));
    const ent = nameEnt(lc); if (ent && ent.disp) return ent.disp;
    return escId(canon(name));
  }
  // ---- компоненты формы ----
  function rootId(e) { while (e && (e.e === 'dot' || e.e === 'idx' || e.e === 'call')) e = e.e === 'call' ? e.f : e.x; return e && e.e === 'id' ? e.name : null; }
  function isComp(e) {
    if (!e) return false;
    if (e.e === 'id') return ctx.comps.has(e.name.toLowerCase());
    if (e.e === 'dot' && e.x.e === 'id' && /^(self|form\d*|t?form\w*)$/i.test(e.x.name) && ctx.comps.has(e.name.toLowerCase())) return true;
    return false;
  }
  function compName(e) { return e.e === 'id' ? e.name : e.name; }
  // чтение значения компонента: Edit1.Text, Memo1.Lines[i], StringGrid1.Cells[c,r], CheckBox1.Checked ...
  function compRead(e) {
    let sub = null, x = e;
    if (x.e === 'idx') { sub = x.idx; x = x.x; }
    if (x.e === 'dot' && x.name.toLowerCase() === 'text' && x.x.e === 'dot' && x.x.name.toLowerCase() === 'lines') x = x.x;
    if (x.e !== 'dot') return null;
    const prop = x.name.toLowerCase();
    if (!VALUE_PROPS.has(prop)) return null;
    let obj = x.x;
    if (obj.e === 'idx' && obj.x.e === 'dot' && obj.x.name.toLowerCase() === 'items') { obj = obj.x.x; }
    if (isComp(obj) || (obj.e === 'id' && /^(text|caption|checked|itemindex|lines|cells|value)$/.test(prop) && !ctx.isVar(obj.name))) {
      return { name: compName(obj), prop, sub };
    }
    return null;
  }
  function compTarget(lhs) {
    let x = lhs; if (x.e === 'idx') x = x.x;
    if (x.e !== 'dot') return null;
    const prop = x.name.toLowerCase();
    let obj = x.x;
    if (/^(caption|text|cells|lines|items|value|checked|hint)$/.test(prop) && (isComp(obj) || (obj.e === 'id' && !ctx.isVar(obj.name)))) return { name: compName(obj), prop };
    if (obj.e === 'dot' && /^(lines|items)$/.test(obj.name.toLowerCase()) && isComp(obj.x)) return { name: compName(obj.x), prop };
    return null;
  }
  // снять преобразования типов: StrToFloat(x) -> x
  function strip(e) {
    for (;;) {
      if (e.e === 'call' && e.f.e === 'id') {
        const lc = e.f.name.toLowerCase();
        if ((CONV.has(lc) || TYPECASTS.has(lc)) && e.args.length) { e = e.args[0]; continue; }
        if (lc === 'formatfloat' && e.args.length > 1) { e = e.args[1]; continue; }
        if (ctx.classNames.has(lc) && e.args.length === 1) { e = e.args[0]; continue; }
      }
      return e;
    }
  }
  // листья для вывода: 'Сумма = ' + FloatToStr(s) -> [str, s]
  function leaves(e, out) {
    out = out || [];
    e = strip(e);
    if (e.e === 'bin' && e.op === '+' && (isStrish(e.l) || isStrish(e.r))) { leaves(e.l, out); leaves(e.r, out); return out; }
    if (e.e === 'call' && e.f.e === 'id') {
      const lc = e.f.name.toLowerCase();
      if (lc === 'format' && e.args.length > 1) { leaves(e.args[0], out); const s = e.args[1]; if (s.e === 'set') s.items.forEach(i => leaves(i, out)); else leaves(s, out); return out; }
      if (lc === 'booltostr' || lc === 'ifthen') { if (lc === 'ifthen') { out.push(e.args[0]); return out; } out.push(e.args[0]); return out; }
      if (lc === 'concat') { e.args.forEach(a => leaves(a, out)); return out; }
    }
    out.push(e); return out;
  }
  function isStrish(e) {
    e = strip(e);
    if (e.e === 'str') return true;
    if (e.e === 'call' && e.f.e === 'id' && /^(floattostr|inttostr|floattostrf|formatfloat|format|currtostr|booltostr|datetostr|concat|copy|trim|uppercase|lowercase)$/i.test(e.f.name)) return true;
    if (e.e === 'bin' && e.op === '+') return isStrish(e.l) || isStrish(e.r);
    return false;
  }
  const isLit = e => e.e === 'str' || e.e === 'num' || e.e === 'nil' || (e.e === 'id' && /^(true|false)$/i.test(e.name));

  // ---- предикаты (фразы для условий) ----
  function charClass(items) {
    const parts = new Set(); let simple = true; const chars = [];
    for (const it of items) {
      if (it.e === 'range' && it.a.e === 'str' && it.b.e === 'str' && it.a.v.length === 1 && it.b.v.length === 1) {
        const a = it.a.v, b = it.b.v;
        if (/[0-9]/.test(a) && /[0-9]/.test(b)) parts.add('цифра');
        else if (/[a-zа-яё]/i.test(a) && /[a-zа-яё]/i.test(b)) parts.add('буква');
        else { simple = false; }
      } else if (it.e === 'str' && it.v.length === 1) {
        const c = it.v; chars.push(c);
        if (/[0-9]/.test(c)) parts.add('цифра'); else if (/[a-zа-яё]/i.test(c)) parts.add('буква');
        else if (c === ' ') parts.add('пробел'); else parts.add('спецсимвол');
      } else simple = false;
    }
    if (!simple || !parts.size) return null;
    if (parts.size === 1 && parts.has('спецсимвол') && chars.length <= 3) return null;
    const order = ['цифра', 'буква', 'пробел', 'спецсимвол'].filter(x => parts.has(x));
    return order;
  }
  function pred(e) {
    if (e.e === 'call' && e.f.e === 'id') {
      const lc = e.f.name.toLowerCase();
      if (/^trystrto(float|int|int64|qword|dword|currency|date|time|datetime|bool)$/.test(lc) && e.args.length >= 2) {
        const v = pr(e.args[1]).s; const isInt = /int|qword|dword/.test(lc);
        return { pos: v + (isInt ? ' – целое число' : ' – число'), neg: v + (isInt ? ' – не целое число' : ' – не число'), tryVar: v };
      }
      if (lc === 'odd' && e.args.length) { const v = wrap(pr(e.args[0]), PR.ADD); return { pos: v + ' нечётно', neg: v + ' чётно' }; }
      if (lc === 'eof') return { pos: 'конец файла', neg: 'не конец файла' };
      if (lc === 'eoln') return { pos: 'конец строки', neg: 'не конец строки' };
      if ((lc === 'containsstr' || lc === 'ansicontainsstr' || lc === 'ansicontainstext') && e.args.length === 2) {
        const a = pr(e.args[1]).s, b = pr(e.args[0]).s; return { pos: a + ' входит в ' + b, neg: a + ' не входит в ' + b };
      }
    }
    if (e.e === 'id' && ctx.comps.has(e.name.toLowerCase()) === false) { /* bool var: no phrase */ }
    const cr = e.e === 'dot' ? compRead(e) : null;
    if (cr && cr.prop === 'checked') { const d = disp(cr.name, 'comp'); return { pos: d + ' отмечен', neg: d + ' не отмечен' }; }
    if (e.e === 'bin' && e.op === 'in') {
      const x = pr(e.l).s;
      if (e.r.e === 'set') {
        const cls = charClass(e.r.items);
        if (cls) return { pos: x + ' – ' + cls.join(' или '), neg: x + ' – не ' + cls.join(' и не ') };
      }
      const S = pr(e.r).s; return { pos: x + ' ∈ ' + S, neg: x + ' ∉ ' + S };
    }
    if (e.e === 'bin' && RELSYM[e.op]) {
      let l = e.l, r = e.r, op = e.op;
      if (isNumLit(l) && !isNumLit(r)) { const t = l; l = r; r = t; op = RELSWAP[op]; }
      const L = strip(l);
      // Pos(a, b) > 0
      if (L.e === 'call' && L.f.e === 'id' && L.f.name.toLowerCase() === 'pos' && L.args.length === 2 && isNumLit(r)) {
        const v = numVal(r); const a = pr(L.args[0]).s, b = pr(L.args[1]).s;
        const inT = a + ' входит в ' + b, outT = a + ' не входит в ' + b;
        const yes = (op === '>' && v >= 0) || (op === '<>' && v === 0) || (op === '>=' && v === 1);
        const no = (op === '=' && v === 0) || (op === '<' && v === 1) || (op === '<=' && v === 0);
        if (yes) return { pos: inT, neg: outT }; if (no) return { pos: outT, neg: inT };
      }
      // ItemIndex = -1
      const cr2 = L.e === 'dot' ? compRead(L) : null;
      if (cr2 && cr2.prop === 'itemindex' && isNumLit(r, true)) {
        const v = numVal(r); const d = disp(cr2.name, 'comp');
        const sel = d + ' выбран', nsel = d + ' не выбран';
        if ((op === '=' && v === -1) || (op === '<' && v === 0) || (op === '<=' && v === -1)) return { pos: nsel, neg: sel };
        if ((op === '<>' && v === -1) || (op === '>=' && v === 0) || (op === '>' && v === -1)) return { pos: sel, neg: nsel };
      }
      // пустая строка
      const R = strip(r);
      if (R.e === 'str' && R.v === '' && (op === '=' || op === '<>')) {
        const x = pr(L).s; return op === '=' ? { pos: x + ' пусто', neg: x + ' не пусто' } : { pos: x + ' не пусто', neg: x + ' пусто' };
      }
      // сравнение с true/false
      if (R.e === 'id' && /^(true|false)$/i.test(R.name) && (op === '=' || op === '<>')) {
        const positive = (R.name.toLowerCase() === 'true') === (op === '=');
        const inner = positive ? L : { e: 'un', op: 'not', x: L };
        const a = pr(inner).s, b = pr(positive ? { e: 'un', op: 'not', x: L } : L).s;
        return { pos: a, neg: b };
      }
    }
    return null;
  }
  function isNumLit(e, allowNeg) { if (e.e === 'num') return true; if (allowNeg && e.e === 'un' && e.op === '-' && e.x.e === 'num') return true; return false; }
  function numVal(e) { if (e.e === 'un') return -parseFloat(e.x.v); return parseFloat(e.v); }

  // ---- основная печать ----
  function pr(e) {
    if (!e) return rp('', PR.ATOM);
    const pd = pred(e); if (pd) return rp(pd.pos, PR.REL, 'pred');
    switch (e.e) {
      case 'num': return fmtNum(e.v);
      case 'str': return rp('«' + escText(e.v.replace(/[\r\n]+/g, ' ')) + '»', PR.ATOM, 'str');
      case 'nil': return rp('nil', PR.ATOM);
      case 'txt': return rp(e.s, PR.REL, 'pred');
      case 'case': {
        const sel = pr(e.sel).s;
        if (e.labels.every(l => l.e !== 'range')) return rp(sel + ' = ' + e.labels.map(l => pr(l).s).join(', '), PR.REL);
        return rp(e.labels.map(l => l.e === 'range' ? pr(l.a).s + ' ≤ ' + sel + ' ≤ ' + pr(l.b).s : sel + ' = ' + pr(l).s).join(' или '), PR.OR);
      }
      case 'range': return rp(pr(e.a).s + '..' + pr(e.b).s, PR.ATOM);
      case 'set': return rp('\\{' + e.items.map(i => pr(i).s).join(', ') + '\\}', PR.ATOM);
      case 'id': return rp(disp(e.name), PR.ATOM, e.name.toLowerCase() === 'pi' ? 'const' : 'id');
      case 'un': {
        if (e.op === 'not') return prNot(e.x);
        if (e.op === '-') return rp('–' + wrap(pr(e.x), PR.NEG), PR.NEG, 'neg');
        return pr(e.x);
      }
      case 'bin': return prBin(e);
      case 'dot': {
        const cr = compRead(e); if (cr) return rp(compDisp(cr), PR.ATOM, 'id');
        if (isComp(e)) return rp(disp(e.name, 'comp'), PR.ATOM, 'id');
        if (e.x.e === 'id' && /^(self)$/i.test(e.x.name)) return rp(disp(e.name), PR.ATOM, 'id');
        return rp(pr(e.x).s + '.' + escId(e.name), PR.ATOM, 'id');
      }
      case 'idx': {
        const cr = compRead(e); if (cr) return rp(compDisp(cr), PR.ATOM, 'id');
        let base = e, idx = [];
        while (base.e === 'idx') { idx = base.idx.concat(idx); base = base.x; }
        const b = pr(base);
        if (b.kind === 'id' && !/_/.test(b.s.replace(/\\_/g, ''))) return rp(subscript(b.s, idx.map(i => pr(i).s)), PR.ATOM, 'id');
        return rp(wrap(b, PR.ATOM) + '[' + idx.map(i => pr(i).s).join(', ') + ']', PR.ATOM, 'id');
      }
      case 'call': return prCall(e);
    }
    return rp('?', PR.ATOM);
  }
  function compDisp(cr) {
    let d = disp(cr.name, 'comp');
    if (cr.sub && cr.prop !== 'items') d = subscript(d, cr.sub.map(i => pr(i).s));
    return d;
  }
  function prNot(x) {
    if (x.e === 'un' && x.op === 'not') return pr(x.x);
    const pd = pred(x); if (pd) return rp(pd.neg, PR.REL, 'pred');
    const n = negate(x);
    if (!(n.e === 'un' && n.op === 'not')) return pr(n);
    return rp('не ' + wrap(pr(x), PR.NOT), PR.NOT);
  }
  function prBin(e) {
    const op = e.op;
    if (op === 'and' || op === 'or') {
      // цепочка TryStrTo... -> «x, y – числа»
      if (op === 'and') {
        const flat = []; (function f(n) { if (n.e === 'bin' && n.op === 'and') { f(n.l); f(n.r); } else flat.push(n); })(e);
        const tv = flat.map(n => { const q = pred(n); return q && q.tryVar; });
        if (flat.length > 1 && tv.every(Boolean)) return rp(tv.join(', ') + ' – числа', PR.REL, 'pred');
      }
      const P = op === 'and' ? PR.AND : PR.OR;
      const l = pr(e.l), r = pr(e.r);
      return rp(wrap(l, P) + (op === 'and' ? ' и ' : ' или ') + wrap(r, P), P);
    }
    if (RELSYM[op]) { return rp(wrap(pr(e.l), PR.ADD) + ' ' + RELSYM[op] + ' ' + wrap(pr(e.r), PR.ADD), PR.REL); }
    if (op === 'is' || op === 'as') return rp(wrap(pr(e.l), PR.ADD) + ' ' + op + ' ' + wrap(pr(e.r), PR.ADD), PR.REL);
    if (op === '+' || op === '-' || op === 'xor') {
      const l = pr(e.l), r = pr(e.r);
      const rs = r.kind === 'neg' ? '(' + r.s + ')' : wrap(r, op === '+' ? PR.ADD : PR.MUL);
      return rp(wrap(l, PR.ADD) + (op === '+' ? ' + ' : op === '-' ? ' – ' : ' xor ') + rs, PR.ADD);
    }
    if (op === '*') {
      if (e.l.e === 'id' && e.r.e === 'id' && e.l.name.toLowerCase() === e.r.name.toLowerCase()) return rp(disp(e.l.name) + '^2', PR.ATOM, 'pow');
      const l = pr(e.l), r = pr(e.r);
      const ls = wrap(l, PR.MUL), rs = r.kind === 'neg' ? '(' + r.s + ')' : wrap(r, PR.MUL);
      const lPar = l.p < PR.MUL, rPar = r.p < PR.MUL || r.kind === 'neg';
      const lastCh = ls.replace(/\\(.)/g, '$1').slice(-1);
      const oneLetter = r.kind === 'id' && plainLen(rs) === 1 && /[A-Za-zА-Яа-яα-ωΑ-Ω]/.test(rs) && rs !== lastCh;
      const implicit = (l.kind === 'num' && !lPar && r.kind !== 'num' && !/^[0-9–]/.test(rs)) || (lPar && rPar) || ((l.kind === 'imul' || (l.kind === 'num' && !lPar)) && oneLetter);
      return rp(ls + (implicit ? '' : '·') + rs, PR.MUL, implicit && (l.kind === 'num' || l.kind === 'imul') && !rPar ? 'imul' : '');
    }
    if (op === '/') {
      const l = pr(e.l), r = pr(e.r);
      return rp(wrap(l, PR.MUL) + '/' + (r.kind === 'neg' ? '(' + r.s + ')' : wrap(r, PR.NEG)), PR.MUL);
    }
    if (op === 'div' || op === 'mod' || op === 'shl' || op === 'shr') {
      return rp(wrap(pr(e.l), PR.MUL) + ' ' + op + ' ' + wrap(pr(e.r), PR.NEG), PR.MUL);
    }
    return rp(wrap(pr(e.l), PR.ADD) + ' ' + op + ' ' + wrap(pr(e.r), PR.ADD), PR.REL);
  }
  function args(list) { return list.map(a => pr(a).s).join(', '); }
  function prCall(e) {
    const f = e.f, A = e.args;
    if (f.e === 'id') {
      const lc = f.name.toLowerCase();
      const own = ctx.own.get(lc);
      if (own) return rp(dispRoutine(own) + (A.length ? '(' + args(A) + ')' : ''), PR.ATOM, 'call');
      if ((CONV.has(lc) || TYPECASTS.has(lc) || ctx.classNames.has(lc)) && A.length) return pr(A[0]);
      if (lc === 'formatfloat' && A.length > 1) return pr(A[1]);
      if (lc === 'format' && A.length > 1) { const s = A[1]; return rp(s.e === 'set' ? s.items.map(i => pr(i).s).join(', ') : pr(s).s, PR.ATOM); }
      const a0 = A[0];
      switch (lc) {
        case 'sqr': return rp(wrap(pr(a0), PR.ATOM) + '^2', PR.ATOM, 'pow');
        case 'sqrt': return rp('√{' + pr(a0).s + '}', PR.ATOM, 'call');
        case 'power': case 'intpower': case 'float_power': {
          const ex = pr(A[1]).s; return rp(wrap(pr(a0), PR.ATOM) + (plainLen(ex) === 1 && !/[\\{}]/.test(ex) ? '^' + ex : '^{' + ex + '}'), PR.ATOM, 'pow');
        }
        case 'exp': return rp('e^{' + pr(a0).s + '}', PR.ATOM, 'pow');
        case 'abs': return rp('|' + pr(a0).s + '|', PR.ATOM, 'call');
        case 'length': { const r = pr(a0); return rp('длина ' + (r.p >= PR.ATOM ? r.s : '(' + r.s + ')'), PR.FN, 'call'); }
        case 'round': return rp('окр(' + pr(a0).s + ')', PR.ATOM, 'call');
        case 'trunc': case 'int': return rp('[' + pr(a0).s + ']', PR.ATOM, 'call');
        case 'frac': return rp('\\{' + pr(a0).s + '\\}', PR.ATOM, 'call');
        case 'logn': return rp('log_{' + pr(a0).s + '}(' + pr(A[1]).s + ')', PR.ATOM, 'call');
        case 'inputbox': case 'inputquery': return rp('ввод', PR.ATOM);
        case 'pos': return rp('позиция ' + pr(A[0]).s + ' в ' + pr(A[1]).s, PR.FN, 'call');
      }
      if (FUNCMAP[lc]) {
        if (!A.length) return rp(FUNCMAP[lc], PR.ATOM, 'call');
        return rp(FUNCMAP[lc] + '(' + args(A) + ')', PR.ATOM, 'call');
      }
      return rp(disp(f.name, 'func') + (A.length ? '(' + args(A) + ')' : ''), PR.ATOM, 'call');
    }
    const fs = pr(f);
    return rp(fs.s + '(' + args(A) + ')', PR.ATOM, 'call');
  }
  return { pr, disp, dispRoutine, compRead, compTarget, strip, leaves, isLit, isComp, rootId, pred };
}

// ---------- отрицание условия ----------
function negate(e) {
  if (!e) return e;
  if (e.e === 'un' && e.op === 'not') return e.x;
  if (e.e === 'bin' && RELFLIP[e.op]) return { e: 'bin', op: RELFLIP[e.op], l: e.l, r: e.r };
  if (e.e === 'bin' && e.op === 'and') return { e: 'bin', op: 'or', l: negate(e.l), r: negate(e.r) };
  if (e.e === 'bin' && e.op === 'or') return { e: 'bin', op: 'and', l: negate(e.l), r: negate(e.r) };
  if (e.e === 'id' && /^(true|false)$/i.test(e.name)) return { e: 'id', name: e.name.toLowerCase() === 'true' ? 'false' : 'true' };
  if (e.e === 'txt') return { e: 'txt', s: e.neg || ('не (' + e.s + ')'), neg: e.s };
  return { e: 'un', op: 'not', x: e };
}
function cleanNeg(e, printer) {
  if (!e) return false;
  if (e.e === 'un' && e.op === 'not') return true;
  if (e.e === 'bin' && RELFLIP[e.op]) return true;
  if (e.e === 'bin' && (e.op === 'and' || e.op === 'or')) return cleanNeg(e.l, printer) && cleanNeg(e.r, printer);
  if (e.e === 'bin' && e.op === 'in') return true;
  if (e.e === 'txt') return !!e.neg;
  if (e.e === 'id' && /^(true|false)$/i.test(e.name)) return true;
  if (printer && printer.pred(e)) return true;
  return false;
}

// ---------- построение логической модели (IR) ----------
function buildContext(prog, R, env) {
  const own = new Map();
  for (const r of prog.routines) {
    const lc = r.short.toLowerCase();
    if (r.cls && prog.classes[r.cls.toLowerCase()] && isFormClass(prog, r.cls)) continue; // обработчики формы не считаем «функциями»
    if (!own.has(lc) || (!own.get(lc).body && r.body)) own.set(lc, r);
  }
  const comps = new Map();
  for (const k in prog.classes) {
    if (!isFormClass(prog, prog.classes[k].name)) continue;
    for (const f of prog.classes[k].fields) comps.set(f.name.toLowerCase(), f);
  }
  const canon = new Map();
  const addCanon = (name) => { if (name && !canon.has(name.toLowerCase())) canon.set(name.toLowerCase(), name); };
  const vars = new Map();
  for (const [k, v] of prog.globals) { vars.set(k, v); addCanon(v.name); }
  for (let r = R; r; r = r.parent) {
    for (const [k, v] of r.vars) { if (!vars.has(k)) vars.set(k, v); addCanon(v.name); }
    for (const [k, v] of r.consts || []) { if (!vars.has(k)) vars.set(k, v); addCanon(v.name); }
    for (const pp of r.params) { if (!vars.has(pp.name.toLowerCase())) vars.set(pp.name.toLowerCase(), { name: pp.name, type: pp.type, param: true }); addCanon(pp.name); }
  }
  for (const r of prog.routines) addCanon(r.short);
  for (const c of comps.values()) addCanon(c.name);
  const classNames = new Set(Object.keys(prog.classes));
  const ctx = { prog, R, env, fn: R && R.isFunc ? R : null, own, comps, canon, vars, classNames, used: new Map(), loops: [], opts: env.opts || {} };
  ctx.isVar = name => vars.has(name.toLowerCase());
  ctx.P = makePrinter(ctx);
  return ctx;
}
function isFormClass(prog, name) {
  let c = prog.classes[String(name).toLowerCase()], guard = 0;
  while (c && guard++ < 10) {
    if (!c.parent) return false;
    const pl = c.parent.toLowerCase();
    if (pl === 'tform' || pl === 'tframe' || pl === 'tcustomform') return true;
    c = prog.classes[pl];
  }
  return false;
}

const asList = st => !st ? [] : st.s === 'block' ? st.list : [st];
function mkBlk(kind, key, lines, extra) { return Object.assign({ t: 'blk', kind, key, lines }, extra || {}); }

function transformRoutine(prog, R, body, env) {
  const ctx = buildContext(prog, R, env);
  const P = ctx.P;
  const opts = ctx.opts;
  const mergeN = Math.max(1, Math.min(3, opts.mergeN || 3));

  const valueOf = v => { if (v.e === 'dot' || v.e === 'idx') { const cr = P.compRead(v); if (cr && !cr.sub) return { e: 'id', name: cr.name }; } return v; };
  const ioBlk = (kind, vars, key) => { vars = vars.map(valueOf); return mkBlk(kind, key, [(kind === 'in' ? 'Ввод ' : 'Вывод ') + vars.map(v => P.pr(v).s).join(', ')], { vars }); };
  const errBlk = key => mkBlk('err', key, ['Вывод сообщения', 'об ошибке']);
  const proc = (key, text) => mkBlk('proc', key, [text]);
  const quoteShort = s => { s = s.replace(/\s+/g, ' ').trim(); return s.length <= 22 ? 'Вывод «' + escText(s) + '»' : 'Вывод сообщения'; };

  function isFileVar(e) {
    if (e.e !== 'id') return false; const v = ctx.vars.get(e.name.toLowerCase());
    return !!v && /^(text|textfile|file)\b/.test(v.type || '');
  }
  function callInfo(e) {
    const f = e.e === 'call' ? e.f : e; const A = e.e === 'call' ? e.args : [];
    let name = null, obj = null;
    if (f.e === 'id') name = f.name; else if (f.e === 'dot') { name = f.name; obj = f.x; }
    const chain = []; let x = f; while (x) { if (x.e === 'dot') { chain.unshift(x.name.toLowerCase()); x = x.x; } else if (x.e === 'id') { chain.unshift(x.name.toLowerCase()); break; } else if (x.e === 'idx' || x.e === 'call') x = x.e === 'call' ? x.f : x.x; else break; }
    return { name, lc: name ? name.toLowerCase() : null, obj, args: A, chain };
  }
  function outFromExprs(list, key, forceErr) {
    const lv = []; list.forEach(a => P.leaves(a, lv));
    const vars = lv.filter(x => !P.isLit(x));
    if (vars.length) return [ioBlk('out', vars, key)];
    const lit = lv.filter(x => x.e === 'str').map(x => x.v).join('');
    if (!lit.trim()) return [];
    if (forceErr || ERR_WORDS.test(lit)) return [errBlk(key)];
    return [mkBlk('out', key, [quoteShort(lit)], { vars: [] })];
  }
  function isInput(rhs) {
    const s = P.strip(rhs);
    if (s.e === 'dot' || s.e === 'idx') { const cr = P.compRead(s); if (cr && cr.prop !== 'checked') return true; if (cr) return true; }
    if (s.e === 'call' && s.f.e === 'id' && /^(inputbox|inputquery|readkey)$/i.test(s.f.name)) return true;
    return false;
  }

  function trAssign(st, key) {
    const { lhs, rhs, op } = st;
    const tgt = P.compTarget(lhs);
    if (tgt) return outFromExprs([rhs], key, false);
    if (op === ':=' && isInput(rhs)) return [ioBlk('in', [lhs], key)];
    let r = rhs;
    if (op !== ':=') r = { e: 'bin', op: op[0], l: lhs, r: rhs };
    return [proc(key, P.pr(lhs).s + ' = ' + wrap(P.pr(r), PR.ADD))];
  }
  function trCall(st, key) {
    const c = callInfo(st.e); const lc = c.lc; const ch = c.chain.join('.');
    if (!lc) return [proc(key, P.pr(st.e).s)];
    if (!c.obj && READS.has(lc)) { let a = c.args; if (a.length && isFileVar(a[0])) a = a.slice(1); return a.length ? [ioBlk('in', a, key)] : []; }
    if (!c.obj && WRITES.has(lc)) { let a = c.args; if (a.length && isFileVar(a[0])) a = a.slice(1); return a.length ? outFromExprs(a, key, false) : []; }
    if (MSGS.has(lc)) { const a = c.args.slice(0, 1); return a.length ? outFromExprs(a, key, true) : []; }
    if (c.chain[0] === 'application') return [];
    if (!c.obj && (lc === 'inc' || lc === 'dec')) {
      const a = c.args[0]; if (!a) return [];
      const n = c.args[1] || { e: 'num', v: '1' };
      return [proc(key, P.pr(a).s + ' = ' + P.pr({ e: 'bin', op: lc === 'inc' ? '+' : '-', l: a, r: n }).s)];
    }
    if (!c.obj && lc === 'exit') {
      const res = [];
      if (c.args.length && ctx.fn) res.push(proc(key, P.dispRoutine(ctx.fn) + ' = ' + P.pr(c.args[0]).s));
      res.push({ t: 'jump', target: 'end' }); return res;
    }
    if (!c.obj && lc === 'halt') return [{ t: 'jump', target: 'end' }];
    if (!c.obj && (lc === 'break' || lc === 'continue')) {
      const L = ctx.loops[ctx.loops.length - 1]; if (!L) return [];
      L.used[lc] = true; return [{ t: 'jump', target: (lc === 'break' ? 'brk:' : 'cont:') + L.key }];
    }
    if (/(^|\.)(lines|items)\.(add|append|addstrings|insert)$/.test(ch)) { const a = lc === 'insert' ? c.args.slice(1) : c.args; return outFromExprs(a, key, false); }
    if (IGNORE.has(lc)) return [];
    if (!c.obj && lc === 'str' && c.args.length >= 2) return [proc(key, P.pr(c.args[1]).s + ' = ' + P.pr(c.args[0]).s)];
    if (!c.obj && lc === 'val' && c.args.length >= 2) {
      if (isInput(c.args[0])) return [ioBlk('in', [c.args[1]], key)];
      return [proc(key, P.pr(c.args[1]).s + ' = ' + P.pr(c.args[0]).s)];
    }
    if (!c.obj && ctx.own.has(lc)) return [proc(key, P.pr(st.e).s)];
    if (c.obj && (/^(self|form\d*|t?form\w*)$/i.test(c.chain[0] || '') || OUTPUT_NAME.test(lc)) && c.args.length) return outFromExprs(c.args, key, false);
    if (OUTPUT_NAME.test(lc) && c.args.length) return outFromExprs(c.args, key, false);
    return [proc(key, P.pr(st.e).s)];
  }

  function trList(stmts, path) {
    const out = [];
    for (let i = 0; i < stmts.length; i++) {
      const st = stmts[i];
      if (st && st.s === 'call' && isPromptThenRead(st, stmts[i + 1])) continue;
      out.push(...trStmt(st, path + '.' + i));
    }
    return mergeBlocks(out);
  }
  function isPromptThenRead(st, nx) {
    const c = callInfo(st.e); if (!c.lc || c.obj || !WRITES.has(c.lc)) return false;
    if (!c.args.length || !c.args.every(a => a.e === 'str')) return false;
    if (!nx || nx.s !== 'call') return false; const d = callInfo(nx.e); return !!d.lc && !d.obj && READS.has(d.lc) && d.args.length > 0;
  }
  function mergeBlocks(items) {
    const res = [];
    for (const it of items) {
      const prev = res[res.length - 1];
      if (prev && prev.t === 'blk' && it.t === 'blk' && !prev.noMerge && !it.noMerge) {
        if ((prev.kind === 'in' || prev.kind === 'out') && prev.kind === it.kind && prev.vars && it.vars && prev.vars.length && it.vars.length) {
          const seen = new Set(prev.vars.map(v => P.pr(v).s)); const add = it.vars.filter(v => !seen.has(P.pr(v).s));
          prev.vars = prev.vars.concat(add); prev.lines = [(prev.kind === 'in' ? 'Ввод ' : 'Вывод ') + prev.vars.map(v => P.pr(v).s).join(', ')]; continue;
        }
        const total = prev.lines.length + it.lines.length;
        const lim = total >= 3 ? 30 : 26;
        if (prev.kind === 'proc' && it.kind === 'proc' && total <= mergeN && !prev.warn && !it.warn &&
            prev.lines.every(l => plainLen(l) <= lim) && it.lines.every(l => plainLen(l) <= lim)) { prev.lines = prev.lines.concat(it.lines); continue; }
      }
      res.push(it);
    }
    return res;
  }
  function trStmt(st, key) {
    if (!st) return [];
    switch (st.s) {
      case 'block': return trList(st.list, key);
      case 'assign': return trAssign(st, key);
      case 'call': return trCall(st, key);
      case 'if': {
        const chain = []; let cur = st;
        while (cur && cur.s === 'if') { chain.push(cur); if (cur.else && cur.else.s === 'if') cur = cur.else; else break; }
        if (chain.length >= 2) {
          const last = chain[chain.length - 1];
          return [{ t: 'casc', key, arms: chain.map((a, i) => ({ cond: a.cond, key: key + '.a' + i, body: trList(asList(a.then), key + '.a' + i) })),
            els: last.else ? trList(asList(last.else), key + '.e') : null }];
        }
        return [{ t: 'if', key, cond: st.cond, yes: trList(asList(st.then), key + '.y'), no: trList(asList(st.else), key + '.n'), inv: false, mode: 'down' }];
      }
      case 'case': {
        const arms = st.arms.map((a, i) => ({ cond: { e: 'case', sel: st.sel, labels: a.labels }, key: key + '.a' + i, body: trList(asList(a.body), key + '.a' + i) }));
        if (!arms.length) return [];
        return [{ t: 'casc', key, arms, els: st.els ? trList(st.els, key + '.e') : null }];
      }
      case 'while': case 'repeat': case 'for': case 'forin': {
        const L = { key, used: {} }; ctx.loops.push(L);
        const body = st.s === 'repeat' ? trList(st.body, key + '.b') : trList(asList(st.body), key + '.b');
        ctx.loops.pop();
        if (st.s === 'while') return [{ t: 'while', key, cond: st.cond, body, used: L.used }];
        if (st.s === 'repeat') return [{ t: 'repeat', key, cond: st.cond, body, used: L.used }];
        const node = { t: 'for', key, body, used: L.used, vName: P.pr(st.v).s, loopVar: P.rootId(st.v) };
        if (st.s === 'for') { node.range = st.down ? P.pr(st.from).s + ' ≥ ' + node.vName + ' ≥ ' + P.pr(st.to).s : P.pr(st.from).s + ' ≤ ' + node.vName + ' ≤ ' + P.pr(st.to).s; }
        else node.range = node.vName + ' ∈ ' + P.pr(st.coll).s;
        if (opts.collapseIO !== false) { const cIO = collapseIO(node); if (cIO) return [cIO]; }
        return [node];
      }
      case 'with': return trList(asList(st.body), key);
      case 'try': {
        const body = trList(st.body, key + '.t');
        let res = body;
        if (st.exc && st.exc.length) {
          const exc = trList(st.exc, key + '.x');
          let k = 0; while (k < body.length && body[k].t === 'blk' && body[k].kind === 'in') k++;
          if (k > 0) {
            const vars = body.slice(0, k).flatMap(b => b.vars || []);
            const names = vars.map(v => P.pr(v).s);
            const s = names.join(', ') + (names.length > 1 ? ' – числа' : ' – число');
            const ns = names.length > 1 ? 'не все из ' + names.join(', ') + ' – числа' : names[0] + ' – не число';
            res = body.slice(0, k).concat([{ t: 'if', key: key + '.c', cond: { e: 'txt', s, neg: ns }, yes: body.slice(k), no: exc, inv: false, mode: 'down' }]);
          }
        }
        if (st.fin) res = res.concat(trList(st.fin, key + '.f'));
        return res;
      }
      case 'raise': return [errBlk(key), { t: 'jump', target: 'end' }];
      case 'goto': return [proc(key, 'Переход к ' + escId(st.label))];
      case 'error': return [mkBlk('proc', key, ['⚠ ' + escText(st.text.slice(0, 40))], { warn: true })];
      default: return [];
    }
  }
  function collapseIO(node) {
    let kind = null; const names = []; const loopVars = new Set();
    function walk(items, n) {
      if (n.loopVar) loopVars.add(n.loopVar.toLowerCase());
      for (const it of items) {
        if (it.t === 'for') { if (!walk(it.body, it)) return false; continue; }
        if (it.t !== 'blk' || (it.kind !== 'in' && it.kind !== 'out')) return false;
        if (kind && kind !== it.kind) return false; kind = it.kind;
        for (const v of it.vars || []) names.push(v);
      }
      return true;
    }
    if (!walk(node.body, node) || !kind) return null;
    const bases = []; const seen = new Set();
    for (const v of names) {
      let b = v; while (b.e === 'idx') b = b.x;
      if (b.e === 'dot' || b.e === 'idx') { const cr = P.compRead(v); if (cr) continue; }
      if (b.e !== 'id') continue;
      const lc = b.name.toLowerCase(); if (loopVars.has(lc) || seen.has(lc)) continue;
      seen.add(lc); bases.push({ e: 'id', name: b.name });
    }
    if (!bases.length) return null;
    return ioBlk(kind, bases, node.key);
  }

  // --- чтение полей формы напрямую -> общий блок «Ввод» в начале ---
  function collectReads(stmts) {
    const found = []; const seen = new Set();
    const addE = (e) => { const s = P.pr(e).s; if (!seen.has(s)) { seen.add(s); found.push(e); } };
    function ex(e) {
      if (!e || typeof e !== 'object') return;
      if (e.e === 'call' && e.f.e === 'id' && /^trystrto/i.test(e.f.name) && e.args.length >= 2) { addE(e.args[1]); return; }
      if (e.e === 'dot' || e.e === 'idx') { const cr = P.compRead(e); if (cr && !cr.sub) { addE({ e: 'id', name: cr.name }); return; } }
      for (const k of ['l', 'r', 'x', 'f', 'a', 'b']) if (e[k]) ex(e[k]);
      if (e.args) e.args.forEach(ex); if (e.idx) e.idx.forEach(ex); if (e.items) e.items.forEach(ex);
    }
    function st(s) {
      if (!s) return;
      switch (s.s) {
        case 'block': s.list.forEach(st); break;
        case 'assign': if (!(s.op === ':=' && isInput(s.rhs))) ex(s.rhs); if (s.lhs.e === 'idx') s.lhs.idx.forEach(ex); break;
        case 'call': ex(s.e); break;
        case 'if': ex(s.cond); st(s.then); st(s.else); break;
        case 'case': ex(s.sel); s.arms.forEach(a => st(a.body)); (s.els || []).forEach(st); break;
        case 'while': ex(s.cond); st(s.body); break;
        case 'repeat': s.body.forEach(st); ex(s.cond); break;
        case 'for': ex(s.from); ex(s.to); st(s.body); break;
        case 'forin': ex(s.coll); st(s.body); break;
        case 'with': st(s.body); break;
        case 'try': s.body.forEach(st); (s.exc || []).forEach(st); (s.fin || []).forEach(st); break;
      }
    }
    stmts.forEach(st);
    return found;
  }

  const stmts = body ? asList(body) : [];
  const reads = collectReads(stmts);
  let ir = trList(stmts, 'b');
  if (reads.length) ir = mergeBlocks([ioBlk('in', reads, 'in0')].concat(ir));
  normalize(ir, true, true, P);
  return { ir, used: ctx.used, ctx };
}

// ---------- нормализация: ветви ошибок, досрочные выходы, выбор направления «Да» ----------
function isDead(seq) {
  if (!seq || !seq.length) return false;
  const l = seq[seq.length - 1];
  if (l.t === 'jump') return true;
  if (l.t === 'if') return l.yes.length > 0 && l.no.length > 0 && isDead(l.yes) && isDead(l.no);
  if (l.t === 'casc') return !!l.els && isDead(l.els) && l.arms.every(a => isDead(a.body));
  return false;
}
function isPureJump(seq) { return seq.length === 1 && seq[0].t === 'jump'; }
function normalize(seq, tail, top, P) {
  for (let i = 0; i < seq.length; i++) {
    const it = seq[i]; const t = tail && i === seq.length - 1;
    if (it.t === 'if') { normalize(it.yes, t, false, P); normalize(it.no, t, false, P); }
    else if (it.t === 'casc') { it.arms.forEach(a => normalize(a.body, t, false, P)); if (it.els) normalize(it.els, t, false, P); }
    else if (it.t === 'while' || it.t === 'repeat' || it.t === 'for') normalize(it.body, false, false, P);
  }
  // [.., ошибка, выход] -> [.., переход к общему блоку ошибки]
  const n = seq.length;
  if (n >= 2 && seq[n - 1].t === 'jump' && seq[n - 1].target === 'end' && seq[n - 2].t === 'blk' && seq[n - 2].kind === 'err') seq.splice(n - 2, 2, { t: 'jump', target: 'err' });
  if (tail && !top && seq.length && seq[seq.length - 1].t === 'blk' && seq[seq.length - 1].kind === 'err') seq.splice(seq.length - 1, 1, { t: 'jump', target: 'err' });
  if (tail && seq.length && seq[seq.length - 1].t === 'jump' && seq[seq.length - 1].target === 'end') seq.pop();
  // вынести «живую» ветвь, если другая заканчивается переходом
  for (let i = 0; i < seq.length; i++) {
    const it = seq[i];
    if (it.t !== 'if') continue;
    if (!it.yes.length && !it.no.length) { seq.splice(i, 1); i--; continue; }
    const yd = isDead(it.yes), nd = isDead(it.no);
    if (yd && !nd && it.no.length) seq.splice(i + 1, 0, ...it.no.splice(0));
    else if (nd && !yd && it.yes.length) seq.splice(i + 1, 0, ...it.yes.splice(0));
  }
  // отбросить недостижимое
  for (let i = 0; i < seq.length; i++) {
    const it = seq[i];
    if (it.t === 'jump' || (it.t === 'if' && isDead([it])) || (it.t === 'casc' && isDead([it]))) { seq.splice(i + 1); break; }
  }
  // направление ветвей
  for (const it of seq) {
    if (it.t !== 'if') continue;
    const yd = isDead(it.yes), nd = isDead(it.no);
    if (yd && !nd) {
      if (isPureJump(it.yes) && cleanNeg(it.cond, P)) it.inv = true; else it.mode = 'right';
    } else if (!it.yes.length && it.no.length && !nd && cleanNeg(it.cond, P)) it.inv = true;
    it.autoInv = it.inv; it.autoMode = it.mode;
  }
}
