/**
 * Оператор выбора: одно «Решение» с несколькими выходами (пп. 3.2.2.4, 4.3.1 ГОСТ 19.701-90).
 * Ветви стоят друг под другом справа от линии ветвления, выход «Нет» — вниз.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeOptions } from '../src/core/options.js';
import { analyzeGeometry } from '../src/core/validate.js';
import { GOST, TEXTS } from '../src/gost/index.js';
import { build } from './helpers.js';

const program = (body) => ({ id: 't', names: {}, code: `program T;\nvar n, s: integer;\nbegin\n${body}\nend.` });
const main = (body, opts) => build(program(body), opts).diagrams[0].G;
const decisions = (G) => G.items.filter((i) => i.type === 'block' && i.shape === 'dia');
const labelsOf = (G, b) => G.items.filter((i) => i.type === 'label' && i.owner === b.id);
const block = (G, text) => G.items.find((i) => i.type === 'block' && i.text === text);
const clean = (G) => { const a = analyzeGeometry(G); for (const k of ['badEntries', 'badExits', 'offCenter', 'overlaps', 'throughSymbols', 'unshiftedMerges', 'unlabeledDecisions', 'offGrid', 'oblique']) assert.deepEqual(a[k], [], k); return a; };

const THREE = '  case n of\n    1: s := 10;\n    2, 3: s := 20;\n    4..6: s := 30;\n  else\n    s := 0;\n  end;';

test('case — один символ «Решение» с выражением выбора', () => {
  const G = main(THREE);
  const dia = decisions(G);
  assert.equal(dia.length, 1);
  assert.equal(dia[0].text, 'n' + TEXTS.caseSuffix);
  assert.equal(dia[0].ctl, 'switch');
});

test('каждый выход подписан значением условия; выход вниз — «Нет» (п. 4.3.1.2)', () => {
  const G = main(THREE);
  assert.deepEqual(labelsOf(G, decisions(G)[0]).map((l) => l.text), ['1', '2, 3', '4..6', TEXTS.no]);
  const noElse = main('  case n of\n    1: s := 1;\n  end;');
  assert.deepEqual(labelsOf(noElse, decisions(noElse)[0]).map((l) => l.text), ['1', TEXTS.no]);
});

test('ветви стоят друг под другом справа, ветвь else — под символом', () => {
  const G = main(THREE);
  const dia = decisions(G)[0];
  const arms = ['s = 10', 's = 20', 's = 30'].map((t) => block(G, t));
  assert.ok(arms.every((b) => b.x === arms[0].x && b.x > dia.x), 'ветви в одной колонке правее символа');
  assert.ok(arms[0].y < arms[1].y && arms[1].y < arms[2].y, 'сверху вниз в порядке записи');
  assert.equal(block(G, 's = 0').x, dia.x);
  // подпись значения — над своим ответвлением, слева от ветви
  labelsOf(G, dia).slice(0, 3).forEach((l, i) => { assert.ok(l.y < arms[i].y && l.x < arms[i].x - GOST.metrics.symbol.hw); });
});

test('из символа: одна линия ветвления из правой вершины и выход «Нет» вниз (пп. 4.2.4, 4.3.1.1)', () => {
  const G = main(THREE);
  const dia = decisions(G)[0];
  const ports = GOST.symbols.ports('dia', dia.x, dia.y);
  const leaving = G.items.filter((i) => i.type === 'line' && GOST.symbols.onBoundary('dia', i.pts[0][0] - dia.x, i.pts[0][1] - dia.y));
  assert.deepEqual(leaving.map((l) => l.pts[0]).sort(), [ports.right, ports.bottom].sort());
  const a = clean(G);
  assert.deepEqual(a.crossings, []);
});

test('case любой длины помещается по ширине листа', () => {
  const many = '  case n of\n' + Array.from({ length: 7 }, (_, v) => `    ${v}: s := ${v};`).join('\n') + '\n  end;';
  const { G, bounds } = build(program(many)).diagrams[0];
  assert.equal(decisions(G).length, 1);
  assert.ok(bounds.W <= GOST.metrics.page.width, `ширина ${bounds.W}`);
  clean(G);
});

test('настройка «цепочка»: каждое значение — отдельная проверка Да/Нет', () => {
  const G = main(THREE, { caseStyle: 'cascade' });
  assert.equal(decisions(G).length, 3);
  for (const d of decisions(G)) assert.deepEqual(labelsOf(G, d).map((l) => l.text).sort(), [TEXTS.yes, TEXTS.no].sort());
  assert.equal(normalizeOptions({ caseStyle: 'auto' }, GOST).caseStyle, 'multi');
});

test('пустые ветви, составные ветви и досрочные выходы', () => {
  for (const body of [
    '  case n of\n    1: exit;\n    2: ;\n    3: s := 3;\n  end;\n  writeln(s);',
    '  case n of\n    1: s := 1;\n    2: ;\n  else exit;\n  end;\n  writeln(s);',
    '  case n of\n    1: begin s := 1; writeln(s); end;\n    2: if s > 0 then s := 2 else s := 3;\n    3: writeln(n);\n  else begin if s > 5 then exit; s := 9; end;\n  end;\n  writeln(s);',
    '  case n of\n    1: exit;\n    2: exit;\n  else exit;\n  end;',
    '  case n of\n    1: ;\n    2: ;\n  end;\n  writeln(s);',
  ]) {
    const G = main(body);
    assert.equal(decisions(G).filter((d) => d.ctl === 'switch').length, 1);
    clean(G);
  }
});
