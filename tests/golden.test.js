/**
 * Регрессия раскладки: при старом наборе символов новая параметрическая раскладка обязана
 * давать ту же геометрию, что и прежняя реализация с числами в коде (tests/golden/legacy.json
 * снят с неё до переработки). Это доказывает, что вынос размеров в метрики ничего не сдвинул.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, LEGACY_OPTS, programs, ROOT } from './helpers.js';

const golden = JSON.parse(readFileSync(join(ROOT, 'tests', 'golden', 'legacy.json'), 'utf8'));
/**
 * В этих программах раскладка изменена намеренно: транзитные линии между соединителями
 * вынесены наружу, чтобы их не пересекали остальные переходы (п. 4.2.2). Для них сверяется
 * только состав символов.
 */
const LANES_REORDERED = new Set(['fx:jumps.pas']);
/** Тексты, которые изменены намеренно: (a/b)·c вместо двусмысленного a/b·c. */
const INTENDED_TEXT = new Map([['Угол = 180/π·arccos((b^2 + c^2 – a^2)/(2bc))', 'Угол = (180/π)·arccos((b^2 + c^2 – a^2)/(2bc))']]);
const intended = (t) => INTENDED_TEXT.get(t) ?? t;
/** Подписи выходов теперь выравниваются по ширине текста, а не константой — допускаем сдвиг. */
const LABEL_TOLERANCE = 5;

for (const program of programs()) {
  for (const maxH of [245, 150]) {
    const expected = golden[`${program.id}@${maxH}`];
    if (!expected) continue; // программа добавлена после снятия эталона
    test(`эталон раскладки: ${program.id}, колонка ${maxH} мм`, () => {
      const { project, diagrams } = build(program, { ...LEGACY_OPTS, maxH });
      assert.equal(project.errors.length, expected.errors);
      assert.deepEqual(diagrams.map((x) => x.d.id), Object.keys(expected.diags));
      for (const { d, G, bounds } of diagrams) {
        const exp = expected.diags[d.id];
        assert.equal(d.title, exp.title);
        const pick = (type) => G.items.filter((i) => i.type === type);
        const expPick = (type) => exp.items.filter((i) => i.type === type);
        if (LANES_REORDERED.has(program.id) && d.id === 'main') {
          const content = (list) => list.filter((x) => x.shape !== 'conn').map((x) => `${x.shape}|${x.text}`).sort();
          assert.deepEqual(content(pick('block')), content(expPick('block')), `${d.id}: состав символов`);
          continue;
        }
        assert.equal(G.cols, exp.cols, `${d.id}: число колонок`);
        assert.deepEqual(
          pick('block').map((b) => ({ shape: b.shape, x: b.x, y: b.y, num: b.num ?? null, text: b.text, key: b.key })),
          expPick('block').map((b) => ({ shape: b.shape, x: b.x, y: b.y, num: b.num, text: intended(b.text), key: b.key })), `${d.id}: символы`);
        assert.deepEqual(pick('line').map((l) => l.pts), expPick('line').map((l) => l.pts), `${d.id}: линии`);
        const labels = pick('label'), expLabels = expPick('label');
        assert.equal(labels.length, expLabels.length, `${d.id}: число подписей`);
        labels.forEach((l, i) => {
          assert.equal(l.text, expLabels[i].text);
          assert.equal(l.ownerKey, expLabels[i].ownerKey);
          assert.equal(l.y, expLabels[i].y);
          assert.ok(Math.abs(l.x - expLabels[i].x) <= LABEL_TOLERANCE, `${d.id}: подпись «${l.text}» сдвинута на ${l.x - expLabels[i].x}`);
        });
        assert.deepEqual(pick('comment').map((c) => ({ bx: c.bx, by: c.by, h: c.h, text: c.text })), expPick('comment').map((c) => ({ bx: c.bx, by: c.by, h: c.h, text: c.text })), `${d.id}: комментарий`);
        assert.equal(bounds.H, exp.H, `${d.id}: высота холста`);
        assert.ok(Math.abs(bounds.W - exp.W) <= LABEL_TOLERANCE, `${d.id}: ширина холста ${bounds.W} вместо ${exp.W}`);
      }
    });
  }
}
