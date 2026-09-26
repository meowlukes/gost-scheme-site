// Проверка движка без браузера: разбирает все примеры и печатает блоки схем.
// Запуск из корня проекта:  node tests/engine-test.js [id-примера]
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const code = ['parser.js', 'transform.js', 'layout.js', 'project.js', 'examples.js'].map(src).join('\n');
eval(code + '\nglobal.ENGINE = { buildProject, buildGeometry, geomBounds, EXAMPLES };');
const E = global.ENGINE;
const measure = (s, pt) => String(s).replace(/\\(.)/g, '$1').replace(/[_^{}]/g, '').length * pt * 0.3528 * 0.5;
const only = process.argv[2];
let failed = 0;
for (const ex of E.EXAMPLES) {
  if (only && ex.id !== only) continue;
  const env = { names: ex.names, opts: { mergeN: 3, collapseIO: true, maxH: 245 }, edits: {}, ifopts: {}, measure };
  try {
    const pj = E.buildProject(ex.code, env);
    console.log(`=== ${ex.id}: ${ex.title}` + (pj.errors.length ? `  (ошибки разбора: ${pj.errors.length})` : ''));
    for (const d of pj.diagrams) {
      if (d.empty) { console.log(`  — ${d.title}: нет действий`); continue; }
      const G = E.buildGeometry(d, env), b = E.geomBounds(G, measure);
      console.log(`  ${d.title}: ${b.W} × ${b.H} мм, колонок ${G.cols}`);
      for (const it of G.items) if (it.type === 'block') console.log(`    ${String(it.num ?? '').padStart(2)} ${it.shape.padEnd(4)} ${JSON.stringify(it.text)}`);
    }
  } catch (e) { failed++; console.log(`!!! ${ex.id}: ${e.stack}`); }
}
process.exit(failed ? 1 : 0);
