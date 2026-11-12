import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXAMPLES } from '../src/core/examples.js';
import { isSameProgram, withoutExampleNames } from '../src/core/names.js';
import { parsePascal } from '../src/core/parser.js';

const withNames = EXAMPLES.find((e) => Object.values(e.names || {}).some((n) => n.desc));

test('заголовок программы разбирается', () => {
  assert.deepEqual(parsePascal('program CircleArea;\nbegin end.').header, { kind: 'program', name: 'CircleArea' });
  assert.deepEqual(parsePascal('unit Unit1;\ninterface\nimplementation\nend.').header, { kind: 'unit', name: 'Unit1' });
  assert.equal(parsePascal('begin end.').header, null);
});

test('пример с правками — та же программа; другая программа — нет', () => {
  const ex = parsePascal(withNames.code);
  assert.ok(isSameProgram(parsePascal(withNames.code.replace(/\n/, '\n// правка\n')), ex));
  assert.ok(!isSameProgram(parsePascal('program CircleArea;\nvar s: real;\nbegin\n  s := 1;\nend.'), ex));
  // тот же заголовок unit Unit1, но ни одной подпрограммы примера
  assert.ok(!isSameProgram(parsePascal('unit Unit1;\ninterface\nimplementation\nprocedure Other;\nbegin\nend;\nend.'), ex));
});

test('убираются только неизменённые описания из примера', () => {
  const ex = { s: { disp: '', desc: 'проверяемое слово' }, r: { disp: 'R', desc: '' } };
  const names = { s: { disp: '', desc: 'проверяемое слово' }, r: { disp: 'R', desc: 'радиус' }, own: { disp: '', desc: 'моё' } };
  assert.deepEqual(withoutExampleNames(names, ex), { r: { disp: 'R', desc: 'радиус' }, own: { disp: '', desc: 'моё' } });
  assert.deepEqual(withoutExampleNames(names, undefined), names);
});
