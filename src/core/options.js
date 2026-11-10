/**
 * Настройки построения схемы: значения по умолчанию и проверка того, что пришло извне
 * (из localStorage или из интерфейса).
 */

/**
 * Чем изображать ввод и вывод. Первое значение — по умолчанию.
 *  process — «Процесс», как в примерах методички (слайды 10, 11, 16);
 *  data    — «Данные» (параллелограмм), п. 3.1.1.1 ГОСТ.
 * Стандарт допускает оба: «Процесс» — обработка данных любого вида (п. 3.2.1.1).
 */
export const IO_SYMBOLS = Object.freeze(['process', 'data']);
/** Чем изображать вызов подпрограммы, описанной в этой же программе. */
export const CALL_SYMBOLS = Object.freeze(['predefined', 'process']);
/**
 * Как изображать оператор выбора (case):
 *  multi   — одно «Решение» с несколькими подписанными выходами (пп. 3.2.2.4 и 4.3.1 ГОСТ),
 *            ветви — друг под другом справа от линии ветвления;
 *  cascade — цепочка двоичных «Решений».
 */
export const CASE_STYLES = Object.freeze(['multi', 'cascade']);

export const MERGE_RANGE = Object.freeze({ min: 1, max: 3 });
export const COLUMN_HEIGHT_RANGE = Object.freeze({ min: 120, max: 400 });

/**
 * @param {object} gost оформление — из него берётся высота листа
 */
export function defaultOptions(gost) {
  return {
    mergeN: MERGE_RANGE.max,
    collapseIO: true,
    maxH: gost.metrics.page.height,
    autoBuild: true,
    ioSymbol: IO_SYMBOLS[0],
    callSymbol: CALL_SYMBOLS[0],
    caseStyle: CASE_STYLES[0],
  };
}

const clampInt = (v, { min, max }, fallback) => (Number.isFinite(+v) ? Math.max(min, Math.min(max, Math.round(+v))) : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

/**
 * Приводит произвольный объект настроек к допустимому виду.
 * @param {unknown} raw
 * @param {object} gost
 */
export function normalizeOptions(raw, gost) {
  const d = defaultOptions(gost);
  const o = raw && typeof raw === 'object' ? raw : {};
  const step = gost.metrics.unit;
  return {
    mergeN: clampInt(o.mergeN, MERGE_RANGE, d.mergeN),
    collapseIO: o.collapseIO === undefined ? d.collapseIO : !!o.collapseIO,
    maxH: Math.round(clampInt(o.maxH, COLUMN_HEIGHT_RANGE, d.maxH) / step) * step,
    autoBuild: o.autoBuild === undefined ? d.autoBuild : !!o.autoBuild,
    ioSymbol: oneOf(o.ioSymbol, IO_SYMBOLS, d.ioSymbol),
    callSymbol: oneOf(o.callSymbol, CALL_SYMBOLS, d.callSymbol),
    caseStyle: oneOf(o.caseStyle, CASE_STYLES, d.caseStyle),
  };
}

/**
 * Символ для блока по его назначению.
 * @param {string} kind вид блока из логической модели
 * @param {{ioSymbol:string, callSymbol:string}} opts
 */
export function symbolForKind(kind, opts) {
  switch (kind) {
    case 'term': return 'term';
    case 'in': case 'out': case 'err': return opts.ioSymbol === 'data' ? 'data' : 'rect';
    case 'call': return opts.callSymbol === 'process' ? 'rect' : 'predef';
    default: return 'rect';
  }
}
