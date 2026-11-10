import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeOptions } from '../src/core/options.js';
import { lex, parsePascal } from '../src/core/parser.js';
import { autoArrows } from '../src/core/project.js';
import { GOST, TEXTS } from '../src/gost/index.js';
import { crc32, pngWithDpi } from '../src/render/canvas.js';
import { buildScene } from '../src/render/scene.js';
import { sceneToSvg, sceneToSvgFile } from '../src/render/svg.js';
import { approximateMeasure, createTextEngine, parseMarkup, plainText } from '../src/render/text.js';
import { sanitizeState } from '../src/ui/state.js';
import { build, programs } from './helpers.js';

const program = (code) => ({ id: 't', names: {}, code });
const blocks = (G) => G.items.filter((i) => i.type === 'block');

test('лексер: комментарии, строки, составные знаки', () => {
  const toks = lex("x := 'a''b'; { c } y <> 2 // z\n(* w *) k <= 1.5e3").filter((t) => t.t !== 'eof');
  assert.deepEqual(toks.map((t) => [t.t, t.v]), [['id', 'x'], ['sym', ':='], ['str', "'a''b'"], ['sym', ';'], ['id', 'y'], ['sym', '<>'], ['num', '2'], ['id', 'k'], ['sym', '<='], ['num', '1.5e3']]);
});

test('парсер сообщает об ошибке с номером строки и не падает', () => {
  const prog = parsePascal('program P;\nbegin\n  x := ;\n  y := 1;\nend.');
  assert.ok(prog.errors.length >= 1);
  assert.equal(prog.errors[0].line, 3);
});

test('настройка «Данные»: ввод и вывод — параллелограмм; вызов своей подпрограммы — «Предопределённый процесс»', () => {
  const { diagrams } = build(program('program P;\nvar a: integer;\nprocedure Step(x: integer);\nbegin\n  writeln(x);\nend;\nbegin\n  readln(a);\n  a := a + 1;\n  Step(a);\n  writeln(a);\nend.'), { ioSymbol: 'data' });
  const main = diagrams.find((x) => x.d.id === 'main').G;
  assert.deepEqual(blocks(main).map((b) => b.shape), ['term', 'data', 'rect', 'predef', 'data', 'term']);
  assert.equal(blocks(main)[0].text, TEXTS.start);
  assert.equal(blocks(main).at(-1).text, TEXTS.end);
});

test('своя подпрограмма с именем стандартной (Show, Clear) не пропадает со схемы', () => {
  for (const name of ['Show', 'Clear', 'Update']) {
    const { diagrams } = build(program(`program P;\nvar a: integer;\nprocedure ${name}(x: integer);\nbegin\n  writeln(x);\nend;\nbegin\n  a := 1;\n  ${name}(a);\nend.`));
    const main = diagrams.find((x) => x.d.id === 'main').G;
    assert.ok(blocks(main).some((b) => b.shape === 'predef' && b.text.startsWith(name)), name);
  }
});

test('идентификаторы символов идут подряд с единицы; у соединителей их нет', () => {
  for (const p of programs()) {
    for (const { G } of build(p, { maxH: 150 }).diagrams) {
      const nums = blocks(G).filter((b) => b.shape !== 'conn').map((b) => b.num).sort((a, b) => a - b);
      assert.deepEqual(nums, nums.map((_, i) => i + 1));
      assert.ok(blocks(G).filter((b) => b.shape === 'conn').every((b) => b.num == null));
    }
  }
});

test('стрелки: только там, где поток идёт справа налево или снизу вверх (п. 4.2.1)', () => {
  assert.deepEqual(autoArrows({ pts: [[0, 0], [0, 10], [20, 10]] }), []);
  assert.deepEqual(autoArrows({ pts: [[20, 0], [20, 10], [0, 10]] }), [{ at: [0, 10], dir: [-1, 0] }]);
  const up = autoArrows({ pts: [[0, 40], [-30, 40], [-30, 0], [0, 0]] });
  assert.deepEqual(up[0].dir, [0, -1]);
  assert.equal(up[0].at[0], -30);
  assert.deepEqual(autoArrows({ pts: [[0, 0], [0, 10]], arrow: 'none' }), []);
  assert.deepEqual(autoArrows({ pts: [[0, 0], [0, 10]], arrow: 'end' }), [{ at: [0, 10], dir: [0, 1] }]);
});

test('разметка формул и подбор текста под символ', () => {
  assert.deepEqual(parseMarkup('a_i^{2}').map((n) => n.t), ['txt', 'sub', 'sup']);
  assert.equal(plainText('a_{ij}'), 'aij');
  const text = createTextEngine(GOST, approximateMeasure(GOST.metrics.pt));
  const short = text.fitText('x = 1', 'rect');
  assert.equal(short.overflow, undefined);
  assert.equal(short.size, GOST.metrics.font.textPtByLines[0]);
  const long = text.fitText('слово '.repeat(60).trim(), 'dia');
  assert.equal(long.overflow, true);
  assert.ok(text.fitText('a = b + c', 'data').lines[0].w <= GOST.symbols.centeredWidth('data', -1, 1));
});

test('SVG и растр строятся из одной сцены; файл SVG корректен', () => {
  const { diagrams } = build(programs()[0]);
  const text = createTextEngine(GOST, approximateMeasure(GOST.metrics.pt));
  for (const { G, bounds } of diagrams) {
    const scene = buildScene(G, GOST, text);
    assert.equal(scene.groups.length, G.items.length);
    const file = sceneToSvgFile(scene, bounds, GOST, text, { background: true, caption: 'Рисунок 1 – <Схема> & "тест"' });
    assert.ok(file.startsWith('<?xml'));
    assert.ok(file.includes(`width="${bounds.W}mm"`));
    assert.ok(file.includes('&lt;Схема&gt; &amp; &quot;тест&quot;'));
    assert.equal((file.match(/<g/g) || []).length, (file.match(/<\/g>/g) || []).length);
    const inter = sceneToSvg(scene, GOST, { interactive: true });
    assert.equal((inter.match(/data-id="/g) || []).length, G.items.length);
    assert.ok(!sceneToSvg(buildScene(G, GOST, text, { fill: 'none' }), GOST).includes('fill="#fff"'));
  }
});

test('PNG: блок pHYs с верной контрольной суммой', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const png = new Uint8Array(45);
  png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const out = pngWithDpi(png.buffer, 300);
  assert.equal(out.length, png.length + 21);
  assert.equal(String.fromCharCode(...out.subarray(37, 41)), 'pHYs');
  assert.equal(new DataView(out.buffer).getUint32(41), 11811);
  assert.equal(pngWithDpi(new Uint8Array(40).buffer, 300).length, 40);
});

test('настройки и сохранённое состояние проверяются', () => {
  const d = normalizeOptions(undefined, GOST);
  assert.deepEqual(d, { mergeN: 3, collapseIO: true, maxH: GOST.metrics.page.height, autoBuild: true, ioSymbol: 'process', callSymbol: 'predefined', caseStyle: 'multi', splitLongBranches: true });
  assert.deepEqual(normalizeOptions({ mergeN: 99, maxH: 'x', caseStyle: 7, ioSymbol: 'data' }, GOST), { ...d, ioSymbol: 'data' });
  assert.equal(normalizeOptions({ maxH: 152 }, GOST).maxH, 150);
  const defaults = { ui: { grid: true, side: 'props' }, exp: { fmt: 'png', bg: 'white', fill: 'white', dpi: 300 } };
  const s = sanitizeState({ code: 5, names: { a: { disp: 'x', desc: 3 }, b: 'bad' }, manual: { m: { items: [{ id: 'b1', type: 'block', shape: 'nope', x: 1, y: 1 }, { id: 'b2', type: 'block', shape: 'rect', x: 5, y: 5, text: 't' }, { id: 'l', type: 'line', pts: [[0, 0], ['a', 1]] }] } }, ui: { zoom: -1, side: 'zzz' }, exp: { fmt: 'exe', dpi: 1 } }, defaults, GOST);
  assert.equal(s.code, '');
  assert.deepEqual(s.names, { a: { disp: 'x', desc: '' } });
  assert.deepEqual(s.manual.m.items.map((i) => i.id), ['b2']);
  assert.deepEqual(s.ui, { grid: true, zoom: null, side: 'props' });
  assert.equal(s.exp.fmt, 'png');
  assert.equal(s.exp.dpi, 300);
  assert.deepEqual(sanitizeState(null, defaults, GOST).manual, {});
});

test('по умолчанию — как в методичке: ввод и вывод в «Процессе», циклы «Цикл A» с диапазоном', () => {
  const { diagrams } = build(program('program P;\nvar i, n, k: integer;\nbegin\n  readln(n);\n  for i := n downto 1 do k := k + 1;\n  writeln(k);\nend.'));
  const b = blocks(diagrams[0].G);
  assert.deepEqual(b.map((x) => x.shape), ['term', 'rect', 'lbeg', 'rect', 'lend', 'rect', 'term']);
  assert.equal(b[2].text, 'Цикл A\nn ≥ i ≥ 1');
  assert.equal(b[4].text, 'Цикл A\ni');
});
