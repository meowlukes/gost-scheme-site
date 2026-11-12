/**
 * Описания обозначений (таблица «Обозначения») привязаны к программе. Описания из примера
 * не должны переходить на чужую программу: иначе у новой программы в комментарии появится,
 * например, «s – проверяемое слово» из другого примера.
 */

const lc = (s) => String(s || '').toLowerCase();

/**
 * Та же ли это программа: совпадает заголовок (program/unit/library и имя), и, если в примере
 * были подпрограммы, хотя бы одна из них осталась. Правки внутри примера связь не разрывают.
 * @param {{header: {kind:string,name:string}|null, routines: {name:string, body:unknown}[]}} current
 * @param {typeof current} example
 */
export function isSameProgram(current, example) {
  const h1 = current.header, h2 = example.header;
  if (!h1 !== !h2) return false;
  if (h1 && (h1.kind !== h2.kind || lc(h1.name) !== lc(h2.name))) return false;
  const exRoutines = example.routines.filter((r) => r.body).map((r) => lc(r.name));
  if (!exRoutines.length) return true;
  const own = new Set(current.routines.map((r) => lc(r.name)));
  return exRoutines.some((n) => own.has(n));
}

/**
 * Убирает описания, пришедшие из примера без изменений. Описания, которые пользователь
 * написал или исправил сам, остаются.
 * @param {Record<string, {disp?:string, desc?:string}>} names
 * @param {Record<string, {disp?:string, desc?:string}>} exampleNames
 */
export function withoutExampleNames(names, exampleNames) {
  const out = {};
  for (const [key, e] of Object.entries(names || {})) {
    const ex = exampleNames && exampleNames[key];
    const untouched = ex && (e.disp || '') === (ex.disp || '') && (e.desc || '') === (ex.desc || '');
    if (!untouched) out[key] = e;
  }
  return out;
}
