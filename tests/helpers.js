import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES } from '../src/core/examples.js';
import { GOST } from '../src/gost/index.js';
import { buildGeometry, buildProject, geomBounds } from '../src/core/project.js';
import { approximateMeasure, plainText } from '../src/render/text.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Измерение текста без шрифта: одинаково в тестах и в эталоне. */
export const measureFor = (gost) => { const m = approximateMeasure(gost.metrics.pt); return (s, pt) => m(plainText(s), pt); };

/** Примеры сайта и дополнительные программы из tests/fixtures. */
export function programs() {
  const list = EXAMPLES.map((e) => ({ id: e.id, code: e.code, names: e.names || {} }));
  const dir = join(ROOT, 'tests', 'fixtures');
  for (const f of readdirSync(dir).sort()) list.push({ id: 'fx:' + f, code: readFileSync(join(dir, f), 'utf8'), names: {} });
  return list;
}

/** Профиль «как было до перехода на символы ГОСТ» — для сравнения с эталоном. */
export const LEGACY_OPTS = { ioSymbol: 'process', callSymbol: 'process', caseStyle: 'cascade' };

export function build(program, opts = {}, gost = GOST) {
  const env = { names: program.names, opts: { mergeN: 3, collapseIO: true, ...opts }, edits: {}, ifopts: {}, measure: measureFor(gost), gost };
  const project = buildProject(program.code, env);
  const diagrams = project.diagrams.filter((d) => !d.empty).map((d) => {
    const G = buildGeometry(d, env);
    return { d, G, bounds: geomBounds(G, env.measure, gost) };
  });
  return { project, diagrams, env };
}
