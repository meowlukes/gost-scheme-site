/**
 * Устойчивость: на испорченном тексте программы движок не падает и не зависает,
 * а построенная геометрия остаётся корректной.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeGeometry } from '../src/core/validate.js';
import { build, programs } from './helpers.js';

/** Детерминированный генератор: один и тот же набор порчи при каждом запуске. */
function generator(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }
const INSERTS = ['begin', 'end', ';', '(', ')', "'", '{', 'case', 'of', 'if', 'then', 'else', 'until', '.', 'goto', 'with', ':', 'do'];
const TIME_LIMIT_MS = 3000;

function variants(code, rnd) {
  const out = [];
  for (let k = 1; k < 30; k++) out.push(code.slice(0, Math.floor((code.length * k) / 30)));
  for (let k = 0; k < 40; k++) { const i = Math.floor(rnd() * code.length), n = 1 + Math.floor(rnd() * 12); out.push(code.slice(0, i) + code.slice(i + n)); }
  for (let k = 0; k < 40; k++) { const i = Math.floor(rnd() * code.length); out.push(code.slice(0, i) + ' ' + INSERTS[Math.floor(rnd() * INSERTS.length)] + ' ' + code.slice(i)); }
  return out;
}

for (const program of programs()) {
  test(`испорченный текст: ${program.id}`, () => {
    const rnd = generator(program.code.length);
    for (const code of variants(program.code, rnd)) {
      const started = Date.now();
      let result;
      assert.doesNotThrow(() => { result = build({ ...program, code }, { maxH: 150 }); }, `падение на тексте:\n${code.slice(0, 300)}`);
      for (const { G, bounds } of result.diagrams) {
        const a = analyzeGeometry(G);
        assert.deepEqual(a.oblique, []);
        assert.ok(Number.isFinite(bounds.W) && Number.isFinite(bounds.H));
        for (const it of G.items) if (it.type === 'block') assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y));
      }
      assert.ok(Date.now() - started < TIME_LIMIT_MS, 'слишком долго');
    }
  });
}

test('пустой и бессмысленный ввод', () => {
  for (const code of ['', ' ', 'begin', 'end.', 'program;', '((((', "'", '{', 'begin end.', 'if then else', 'case of end', 'x := ;', 'a'.repeat(5000), 'begin '.repeat(300)]) {
    assert.doesNotThrow(() => build({ id: 't', names: {}, code }));
  }
});
