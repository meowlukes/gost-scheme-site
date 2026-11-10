import assert from 'node:assert/strict';
import { test } from 'node:test';
import { symbolForKind } from '../src/core/options.js';
import { createGost, createMetrics, GOST, letterId } from '../src/gost/index.js';

test('реестр содержит символы схемы программы с пунктами стандарта', () => {
  const expected = { rect: '3.2.1.1', data: '3.1.1.1', predef: '3.2.2.1', dia: '3.2.2.4', lbeg: '3.2.2.6', lend: '3.2.2.6', term: '3.4.2', conn: '3.4.1' };
  assert.deepEqual([...GOST.symbols.ids].sort(), Object.keys(expected).sort());
  for (const [id, clause] of Object.entries(expected)) assert.equal(GOST.symbols.get(id).clause, clause);
  assert.throws(() => GOST.symbols.get('unknown'), RangeError);
});

test('точки присоединения лежат на контуре и на осях символа (п. 4.2.4)', () => {
  for (const gost of [GOST, createGost({ unit: 3, symbolWidthUnits: 12, symbolHeightUnits: 5 })]) {
    for (const id of gost.symbols.ids) {
      const p = gost.symbols.ports(id, 100, 50);
      for (const [side, [x, y]] of Object.entries(p)) {
        assert.ok(gost.symbols.onBoundary(id, x - 100, y - 50), `${id}.${side} не на контуре`);
        if (side === 'top' || side === 'bottom') assert.equal(x, 100); else assert.equal(y, 50);
      }
      assert.ok(!gost.symbols.onBoundary(id, 0, 0), `${id}: центр не на контуре`);
    }
  }
});

test('контур каждого символа укладывается в его габариты', () => {
  for (const id of GOST.symbols.ids) {
    const def = GOST.symbols.get(id);
    const nums = def.path(0, 0).replace(/A[^A-Z]*?(-?[\d.]+) (-?[\d.]+)(?=[A-Z]|$)/g, 'L$1 $2').match(/-?\d+(\.\d+)?/g).map(Number);
    assert.ok(Math.max(...nums.map(Math.abs)) <= Math.max(def.w, def.h) / 2 + 1e-6, id);
    for (const v of [-def.h / 2, 0, def.h / 2]) { const [l, r] = def.span(v); assert.ok(l >= -def.w / 2 - 1e-9 && r <= def.w / 2 + 1e-9 && l <= r, `${id} span(${v})`); }
  }
});

test('«Данные» — параллелограмм, «Предопределённый процесс» — прямоугольник с двумя вертикалями', () => {
  const { slant, hw, hh, predefinedInset } = GOST.metrics.symbol;
  assert.deepEqual(GOST.symbols.get('data').span(-hh), [-hw + slant, hw]);
  assert.deepEqual(GOST.symbols.get('data').span(hh), [-hw, hw - slant]);
  assert.equal(GOST.symbols.get('predef').path(0, 0).match(/M/g).length, 3);
  assert.equal(GOST.symbols.centeredWidth('predef', -1, 1), 2 * (hw - predefinedInset));
});

test('назначение блока определяет символ', () => {
  const g = { ioSymbol: 'data', callSymbol: 'predefined' };
  assert.equal(symbolForKind('in', {}), 'rect');
  assert.equal(symbolForKind('in', g), 'data');
  assert.equal(symbolForKind('out', g), 'data');
  assert.equal(symbolForKind('err', g), 'data');
  assert.equal(symbolForKind('call', g), 'predef');
  assert.equal(symbolForKind('proc', g), 'rect');
  assert.equal(symbolForKind('in', { ioSymbol: 'process' }), 'rect');
  assert.equal(symbolForKind('call', { callSymbol: 'process' }), 'rect');
});

test('метрики масштабируются от модуля сетки и защищены от изменения', () => {
  const a = createMetrics(), b = createMetrics({ unit: 10 });
  assert.equal(b.symbol.w, 2 * a.symbol.w);
  assert.equal(b.flow.branchGap, 2 * a.flow.branchGap);
  assert.equal(a.symbol.w / a.symbol.h, 2);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.symbol) && Object.isFrozen(a.font));
  assert.throws(() => createMetrics({ unit: 0 }), RangeError);
  assert.equal(a.snapUp(12), 15);
  assert.equal(a.snapUp(15), 15);
});

test('обозначения циклов и соединителей не повторяются после 26-го', () => {
  assert.equal(letterId(0), 'A');
  assert.equal(letterId(25), 'Z');
  assert.equal(letterId(26), 'AA');
  assert.equal(letterId(27), 'AB');
  assert.equal(letterId(701), 'ZZ');
  assert.equal(letterId(702), 'AAA');
  assert.equal(new Set(Array.from({ length: 2000 }, (_, i) => letterId(i))).size, 2000);
  assert.throws(() => letterId(-1), RangeError);
});
