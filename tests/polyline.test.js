import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanPts, moveEnd, moveSegment, moveVertex, snap } from '../src/ui/polyline.js';

const orthogonal = (pts) => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);

test('cleanPts убирает повторы и точки на прямой', () => {
  assert.deepEqual(cleanPts([[0, 0], [0, 0], [0, 5], [0, 10], [5, 10]]), [[0, 0], [0, 10], [5, 10]]);
  assert.deepEqual(cleanPts([[0, 0], [10, 0]]), [[0, 0], [10, 0]]);
});

test('перенос конца, излома и отрезка сохраняет прямые углы', () => {
  const line = [[0, 0], [0, 20], [30, 20], [30, 40]];
  for (const moved of [moveEnd(line, 0, 5, 0, 2.5), moveEnd(line, 1, 0, 10, 2.5), moveEnd(line, 1, 10, 0, 2.5), moveVertex(line, 1, [5, 25]), moveVertex(line, 2, [35, 15]), moveSegment(line, 1, 0, 10, 5), moveSegment(line, 0, 10, 0, 5), moveSegment(line, 2, -10, 0, 5)]) {
    assert.ok(orthogonal(moved), JSON.stringify(moved));
    assert.ok(moved.length >= 2);
  }
});

test('прямая линия при переносе конца вбок получает излом', () => {
  const moved = moveEnd([[0, 0], [0, 20]], 1, 10, 0, 2.5);
  assert.equal(moved.length, 4);
  assert.deepEqual(moved[0], [0, 0]);
  assert.deepEqual(moved[3], [10, 20]);
  assert.ok(orthogonal(moved));
});

test('привязка к шагу', () => {
  assert.equal(snap(12.4, 5), 10);
  assert.equal(snap(12.6, 5), 15);
  assert.equal(snap(0.26, 0.5), 0.5);
});
