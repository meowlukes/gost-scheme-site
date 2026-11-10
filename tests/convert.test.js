/**
 * Качество преобразования: конструкции Pascal, которые раньше терялись или искажались.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeGeometry } from '../src/core/validate.js';
import { build, programs } from './helpers.js';

const DECL = 'type TR = record x, y: integer; name: string; end;\n  PNode = ^TNode;\n  TNode = record v: integer; next: PNode; end;\n' +
  'var a, b, c, i, n, s: integer; x: real; st: string; arr: array[1..10] of integer; r: TR; p: PNode; rs: array[1..3] of TR; f: text;\n';
const program = (body, decl = '') => ({ id: 't', names: {}, code: `program T;\n${decl}${DECL}begin\n${body}\nend.` });
const run = (body, decl, opts) => { const r = build(program(body, decl), opts); return { ...r, G: r.diagrams[0].G, notes: r.project.notes, errors: r.project.errors }; };
const texts = (G) => G.items.filter((i) => i.type === 'block' && i.shape !== 'term' && i.shape !== 'conn').map((b) => b.text.replace(/\n/g, ' / '));
const connectors = (G) => G.items.filter((i) => i.type === 'block' && i.shape === 'conn');
const clean = (G) => { const a = analyzeGeometry(G); for (const k of ['badEntries', 'badExits', 'offCenter', 'overlaps', 'throughSymbols', 'unshiftedMerges', 'unlabeledDecisions', 'connectorPairs', 'loopPairs', 'offGrid', 'oblique']) assert.deepEqual(a[k], [], k); };

test('пустой оператор — не ошибка', () => {
  const { G, errors } = run('  ;\n  a := 1;;\n  if a > 0 then ;\n  begin end;\n  b := 2;');
  assert.deepEqual(errors, []);
  assert.deepEqual(texts(G), ['a = 1', 'b = 2']);
});

test('goto назад и вперёд — парные соединители с одним обозначением (п. 3.4.1)', () => {
  const back = run('  1: a := a + 1;\n  if a < 10 then goto 1;\n  writeln(a);', 'label 1;\n');
  assert.deepEqual(connectors(back.G).map((c) => c.text), ['A', 'A']);
  assert.ok(!texts(back.G).some((t) => t.includes('Переход')));
  clean(back.G);
  const two = run('  if a > 0 then goto fin;\n  b := 1;\n  if b > 0 then goto fin;\n  c := 2;\n  fin: writeln(c);', 'label fin;\n');
  assert.equal(connectors(two.G).length, 3, 'два перехода и одна метка');
  clean(two.G);
});

test('оператор после goto недостижим: не рисуется, о нём сообщается', () => {
  const { G, notes } = run('  a := 1;\n  goto L1;\n  b := 2;\n  L1: s := 3;', 'label L1;\n');
  assert.deepEqual(texts(G), ['a = 1', 's = 3']);
  assert.ok(notes.some((n) => /недостижим/.test(n.msg)));
  clean(G);
});

test('метка без перехода убирается; goto без метки показывается блоком с замечанием', () => {
  assert.equal(connectors(run('  a := 1;\n  L2: b := 2;', 'label L2;\n').G).length, 0);
  const { G, notes } = run('  a := 1;\n  goto nowhere;');
  assert.ok(texts(G).some((t) => t.includes('Переход к nowhere')));
  assert.ok(notes.some((n) => /метка не найдена/.test(n.msg)));
});

test('with: поля записи получают её имя', () => {
  const { G, notes } = run('  with r do begin\n    x := y + 1;\n    name := st;\n    a := x;\n  end;\n  with p^ do v := v + 1;\n  with rs[i] do x := 0;');
  assert.deepEqual(texts(G).join(' / ').split(' / '), ['r.x = r.y + 1', 'r.name = st', 'a = r.x', 'p.v = p.v + 1', 'rs_i.x = 0']);
  assert.deepEqual(notes, []);
  const unknown = run('  with something do zz := 1;');
  assert.ok(unknown.notes.some((n) => /with something/.test(n.msg)));
});

test('пропущенные операторы видны в замечаниях со строкой программы', () => {
  const { G, notes } = run('  assign(f, \'a.txt\');\n  reset(f);\n  readln(f, a);\n  close(f);\n  randomize;');
  assert.deepEqual(texts(G), ['Ввод a']);
  assert.deepEqual(notes.map((n) => n.line), [7, 8, 10, 11]);
  assert.ok(notes.every((n) => /не показан/.test(n.msg)));
});

test('операции с памятью и размером массива показываются', () => {
  const { G } = run('  new(p);\n  setlength(st, 3);\n  dispose(p);');
  assert.deepEqual(texts(G).join(' / ').split(' / '), ['new(p)', 'setlength(st, 3)', 'dispose(p)']);
});

test('try/except: потерянный обработчик отмечается', () => {
  const { notes } = run('  try\n    b := 10 div a;\n  except\n    b := 0;\n  end;');
  assert.ok(notes.some((n) => /except/.test(n.msg)));
});

test('выражения: сцепление чисел, управляющие символы, (a/b)·c, random', () => {
  const { G } = run('  st := IntToStr(a) + FloatToStr(x);\n  st := \'s=\' + IntToStr(a);\n  st := #13#10;\n  x := a / b * c;\n  x := a / (b * c);\n  x := random;');
  assert.deepEqual(texts(G).join(' / ').split(' / '), ['st = строка(a) + строка(x)', 'st = «s=» + a', 'st = #13#10', 'x = (a/b)·c', 'x = a/(b·c)', 'x = случ']);
});

test('длинные ветви выносятся через соединители и помещаются в колонку', () => {
  const tall = programs().find((p) => p.id === 'fx:tall.pas');
  for (const maxH of [245, 180, 150]) {
    const { G, bounds } = build(tall, { maxH }).diagrams[0];
    assert.equal(G.tooTall, false, `колонка ${maxH}`);
    assert.ok(bounds.H <= maxH, `высота ${bounds.H} при колонке ${maxH}`);
    clean(G);
  }
  const off = build(tall, { maxH: 150, splitLongBranches: false }).diagrams[0];
  assert.ok(off.bounds.H > 150, 'без выноса ветвь выходит за лист');
});

test('вынесенная ветвь возвращается в нужное место', () => {
  const body = Array.from({ length: 12 }, (_, k) => `    a := a + ${k};\n    writeln(a);`).join('\n');
  // while: возврат — к проверке условия (метка перед циклом); if: к оператору после ветвления
  for (const code of [`  while n > 0 do begin\n${body}\n  end;\n  s := 1;`, `  if n > 0 then begin\n${body}\n  end;\n  s := 1;`, `  repeat\n${body}\n  until n > 0;\n  s := 1;`]) {
    const { G, bounds } = build(program(code), { maxH: 150 }).diagrams[0];
    assert.ok(bounds.H <= 150);
    assert.ok(connectors(G).length >= 4, 'вход в ветвь и возврат — две пары');
    clean(G);
  }
  // ветвь с досрочным выходом не выносится: её переходы привязаны к месту
  const withExit = build(program(`  if n > 0 then begin\n${body}\n    if a > 5 then exit;\n  end;`), { maxH: 150 }).diagrams[0];
  clean(withExit.G);
});
