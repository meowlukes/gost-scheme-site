/**
 * Формальная проверка правил ГОСТ 19.701-90 на всех программах: во всех вариантах настроек
 * и при других размерах символов. Второе доказывает, что раскладка не зависит от конкретных
 * чисел: достаточно сменить метрики, и схема остаётся правильной.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXAMPLES } from '../src/core/examples.js';
import { analyzeGeometry, checkGeometry } from '../src/core/validate.js';
import { createGost, GOST } from '../src/gost/index.js';
import { build, LEGACY_OPTS, programs } from './helpers.js';

const OPTION_SETS = { 'по умолчанию': {}, 'ввод-вывод символом «Данные»': { ioSymbol: 'data' }, 'case цепочкой': { caseStyle: 'cascade' }, 'прежний набор символов': LEGACY_OPTS };
const GOST_SETS = { 'размеры по умолчанию': GOST, 'модуль 4 мм': createGost({ unit: 4 }), 'символ 10×6 модулей': createGost({ symbolWidthUnits: 10, symbolHeightUnits: 6 }) };
const siteExamples = new Set(EXAMPLES.map((e) => e.id));

/**
 * Досрочный выход из тела цикла (exit, break) в этой раскладке пересекает линию выхода или
 * возврата того же цикла. П. 4.2.2 требует пересечений «избегать», но не запрещает их;
 * здесь фиксируется верхняя граница, чтобы число пересечений не росло незаметно.
 */
const KNOWN_CROSSINGS = { 'fx:jumps.pas': 3, 'fx:long.pas': 1 };

for (const [gostName, gost] of Object.entries(GOST_SETS)) {
  for (const [optName, opts] of Object.entries(OPTION_SETS)) {
    for (const maxH of [gost.metrics.page.height, 150]) {
      test(`правила ГОСТ: ${gostName}, ${optName}, колонка ${maxH} мм`, () => {
        for (const program of programs()) {
          for (const { d, G, bounds } of build(program, { ...opts, maxH }, gost).diagrams) {
            const a = analyzeGeometry(G, gost);
            const where = `${program.id} / ${d.id}`;
            assert.deepEqual(a.badEntries, [], `${where}: вход в символ не сверху и не слева (п. 4.2.4)`);
            assert.deepEqual(a.badExits, [], `${where}: выход из символа не снизу и не справа (п. 4.2.4)`);
            assert.deepEqual(a.offCenter, [], `${where}: линия не направлена к центру символа (п. 4.2.4)`);
            assert.deepEqual(a.overlaps, [], `${where}: наложение линий`);
            assert.deepEqual(a.throughSymbols, [], `${where}: линия проходит сквозь символ`);
            assert.deepEqual(a.unshiftedMerges, [], `${where}: слияние линий не смещено (п. 4.2.3)`);
            assert.deepEqual(a.unlabeledDecisions, [], `${where}: выход «Решения» без подписи (п. 4.3.1.2)`);
            assert.deepEqual(a.connectorPairs, [], `${where}: соединитель без пары (п. 3.4.1)`);
            assert.deepEqual(a.loopPairs, [], `${where}: идентификаторы границ цикла (п. 3.2.2.6)`);
            assert.deepEqual(a.oblique, [], `${where}: наклонный отрезок`);
            assert.deepEqual(a.offGrid, [], `${where}: отрезок не по сетке`);
            const limit = siteExamples.has(program.id) ? 0 : (KNOWN_CROSSINGS[program.id] ?? 0);
            assert.ok(a.crossings.length <= limit, `${where}: пересечений ${a.crossings.length}, допустимо ${limit} (п. 4.2.2)`);
            assert.equal(bounds.W % gost.metrics.unit, 0);
            assert.equal(bounds.H % gost.metrics.unit, 0);
          }
        }
      });
    }
  }
}

test('чек-лист интерфейса: примеры сайта проходят все пункты стандарта', () => {
  for (const program of programs().filter((p) => siteExamples.has(p.id))) {
    for (const { d, G, bounds } of build(program).diagrams) {
      const failed = checkGeometry(G, bounds, 0, GOST.metrics.page.height, GOST).filter((c) => !c.ok && c.clause !== 'оформление');
      assert.deepEqual(failed, [], `${program.id} / ${d.id}`);
    }
  }
});
