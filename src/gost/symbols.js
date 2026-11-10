/**
 * Реестр символов схемы программы по ГОСТ 19.701-90 (ИСО 5807-85).
 *
 * Один символ = одно описание: размеры, контур, свободная ширина для текста и точки
 * присоединения линий. Раскладка, отрисовка (SVG и Canvas), проверка габаритов и редактор
 * берут геометрию только отсюда — ни в одном другом месте форма символа не описана.
 *
 * В реестре только символы, разрешённые таблицей раздела 5 стандарта для схемы программы:
 * «Данные», «Процесс», «Предопределённый процесс», «Решение», «Граница цикла»,
 * «Соединитель», «Терминатор» (линии, «Комментарий» и подписи — не символы-блоки и
 * описаны в отрисовке).
 */

const n = (v) => Math.round(v * 1000) / 1000;

/**
 * @typedef {object} SymbolDef
 * @property {string} id            ключ символа в модели схемы
 * @property {string} title         название по стандарту
 * @property {string} clause        пункт ГОСТ 19.701-90
 * @property {number} w             ширина, мм
 * @property {number} h             высота, мм
 * @property {(x:number,y:number)=>string} path  контур (SVG path) с центром в (x, y)
 * @property {(v:number)=>[number,number]} span  левая и правая границы контура на высоте v от центра
 * @property {boolean} identified   ставится ли идентификатор символа (п. 4.1.5)
 * @property {boolean} sideExit     можно ли вывести линию вправо из середины стороны по сетке
 * @property {boolean} sideEntry    можно ли подвести линию слева к середине стороны по сетке
 */

/**
 * @param {ReturnType<import('./metrics.js').createMetrics>} m
 * @returns {{ get(id:string): SymbolDef, has(id:string): boolean, ids: string[], half(id:string): [number, number],
 *   ports(id:string, x:number, y:number): {top:number[], bottom:number[], left:number[], right:number[]},
 *   onBoundary(id:string, dx:number, dy:number, eps?:number): boolean, centeredWidth(id:string, v0:number, v1:number): number }}
 */
export function createSymbols(m) {
  const { w, h, hw, hh, terminatorH, connectorD, chamfer, slant, predefinedInset } = m.symbol;
  const tr = terminatorH / 2;
  const cr = connectorD / 2;
  const box = () => [-hw, hw];
  const circleHalf = (r, v) => (Math.abs(v) >= r ? 0 : Math.sqrt(r * r - v * v));

  /** @type {Record<string, SymbolDef>} */
  const defs = {
    rect: {
      id: 'rect', title: 'Процесс', clause: '3.2.1.1', w, h,
      path: (x, y) => `M${n(x - hw)} ${n(y - hh)}H${n(x + hw)}V${n(y + hh)}H${n(x - hw)}Z`,
      span: box, identified: true, sideExit: true, sideEntry: true,
    },
    data: {
      id: 'data', title: 'Данные', clause: '3.1.1.1', w, h,
      path: (x, y) => `M${n(x - hw + slant)} ${n(y - hh)}H${n(x + hw)}L${n(x + hw - slant)} ${n(y + hh)}H${n(x - hw)}Z`,
      // наклонные стороны: середины сторон не лежат на сетке, поэтому линии — только сверху и снизу
      span: (v) => { const shift = slant / 2 - (v * slant) / h; return [-hw + shift, hw - slant + shift]; },
      identified: true, sideExit: false, sideEntry: false,
    },
    predef: {
      id: 'predef', title: 'Предопределённый процесс', clause: '3.2.2.1', w, h,
      path: (x, y) => `M${n(x - hw)} ${n(y - hh)}H${n(x + hw)}V${n(y + hh)}H${n(x - hw)}Z` +
        `M${n(x - hw + predefinedInset)} ${n(y - hh)}V${n(y + hh)}M${n(x + hw - predefinedInset)} ${n(y - hh)}V${n(y + hh)}`,
      span: box, inner: () => [-hw + predefinedInset, hw - predefinedInset],
      identified: true, sideExit: true, sideEntry: true,
    },
    dia: {
      id: 'dia', title: 'Решение', clause: '3.2.2.4', w, h,
      path: (x, y) => `M${n(x - hw)} ${n(y)}L${n(x)} ${n(y - hh)}L${n(x + hw)} ${n(y)}L${n(x)} ${n(y + hh)}Z`,
      span: (v) => { const k = Math.max(0, 1 - Math.abs(v) / hh) * hw; return [-k, k]; },
      identified: true, sideExit: false, sideEntry: true,
    },
    lbeg: {
      id: 'lbeg', title: 'Граница цикла (начало)', clause: '3.2.2.6', w, h,
      path: (x, y) => `M${n(x - hw)} ${n(y - hh + chamfer)}L${n(x - hw + chamfer)} ${n(y - hh)}H${n(x + hw - chamfer)}L${n(x + hw)} ${n(y - hh + chamfer)}V${n(y + hh)}H${n(x - hw)}Z`,
      span: (v) => { const cut = Math.max(0, chamfer - (v + hh)); return [-hw + cut, hw - cut]; },
      identified: true, sideExit: false, sideEntry: true, textShift: chamfer * 0.16,
    },
    lend: {
      id: 'lend', title: 'Граница цикла (конец)', clause: '3.2.2.6', w, h,
      path: (x, y) => `M${n(x - hw)} ${n(y - hh)}H${n(x + hw)}V${n(y + hh - chamfer)}L${n(x + hw - chamfer)} ${n(y + hh)}H${n(x - hw + chamfer)}L${n(x - hw)} ${n(y + hh - chamfer)}Z`,
      span: (v) => { const cut = Math.max(0, chamfer - (hh - v)); return [-hw + cut, hw - cut]; },
      identified: true, sideExit: false, sideEntry: true, textShift: -chamfer * 0.16,
    },
    term: {
      id: 'term', title: 'Терминатор', clause: '3.4.2', w, h: terminatorH,
      path: (x, y) => `M${n(x - hw + tr)} ${n(y - tr)}H${n(x + hw - tr)}A${n(tr)} ${n(tr)} 0 0 1 ${n(x + hw - tr)} ${n(y + tr)}H${n(x - hw + tr)}A${n(tr)} ${n(tr)} 0 0 1 ${n(x - hw + tr)} ${n(y - tr)}Z`,
      span: (v) => { const k = hw - tr + circleHalf(tr, v); return [-k, k]; },
      identified: true, sideExit: false, sideEntry: true,
    },
    conn: {
      id: 'conn', title: 'Соединитель', clause: '3.4.1', w: connectorD, h: connectorD,
      path: (x, y) => `M${n(x - cr)} ${n(y)}A${n(cr)} ${n(cr)} 0 1 0 ${n(x + cr)} ${n(y)}A${n(cr)} ${n(cr)} 0 1 0 ${n(x - cr)} ${n(y)}Z`,
      span: (v) => { const k = circleHalf(cr, v); return [-k, k]; },
      identified: false, sideExit: false, sideEntry: true,
    },
  };
  for (const d of Object.values(defs)) Object.freeze(d);

  const get = (id) => {
    const d = defs[id];
    if (!d) throw new RangeError(`Неизвестный символ схемы: ${id}`);
    return d;
  };

  return Object.freeze({
    ids: Object.keys(defs),
    has: (id) => Object.hasOwn(defs, id),
    get,
    /** Половины габаритов [по ширине, по высоте]. */
    half: (id) => { const d = get(id); return [d.w / 2, d.h / 2]; },
    /** Точки присоединения линий: середины сторон, линия направлена к центру символа (п. 4.2.4). */
    ports(id, x, y) {
      const d = get(id);
      const [l, r] = d.span(0);
      return { top: [x, y - d.h / 2], bottom: [x, y + d.h / 2], left: [x + l, y], right: [x + r, y] };
    },
    /** Лежит ли точка (dx, dy) от центра на контуре символа. */
    onBoundary(id, dx, dy, eps = 0.06) {
      const d = get(id);
      const hh2 = d.h / 2;
      if (Math.abs(dy) > hh2 + eps) return false;
      const v = Math.max(-hh2, Math.min(hh2, dy));
      const [l, r] = d.span(v);
      if (Math.abs(dx - l) < eps || Math.abs(dx - r) < eps) return true;
      return Math.abs(Math.abs(dy) - hh2) < eps && dx >= l - eps && dx <= r + eps;
    },
    /**
     * Ширина строки, центрированной по оси символа и занимающей по высоте [v0, v1],
     * которая целиком помещается внутри контура (без отступа).
     */
    centeredWidth(id, v0, v1) {
      const d = get(id);
      const f = d.inner || d.span;
      let half = Infinity;
      for (const v of [v0, v1, (v0 + v1) / 2]) {
        const [l, r] = f(v);
        half = Math.min(half, -l, r);
      }
      return Math.max(0, 2 * half);
    },
  });
}
