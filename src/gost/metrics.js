/**
 * Единственный источник размеров схемы.
 *
 * ГОСТ 19.701-90 не задаёт ни одного числового размера (ни сторон символов, ни толщины
 * линий, ни шрифта) — он требует только сохранять форму символов (п. 4.1.3), по возможности
 * делать их одного размера и располагать равномерно (п. 4.1.2). Поэтому все числа здесь —
 * параметры оформления (методичка, требования к отчёту), а не «константы стандарта».
 * Остальной код не содержит размеров: он получает их отсюда.
 *
 * Все длины — в миллиметрах, кегли — в пунктах.
 */

export const MM_PER_PT = 25.4 / 72;

/** Исходные параметры. Любой можно переопределить в createMetrics(). */
export const DEFAULT_SPEC = Object.freeze({
  /** Модуль сетки: все координаты символов и изломов линий кратны ему. */
  unit: 5,
  /** Основной символ в модулях: ширина a и высота b (a : b = 2 : 1). */
  symbolWidthUnits: 8,
  symbolHeightUnits: 4,
  /** Лист: поле схемы на странице А4 с полями отчёта. */
  pageWidth: 170,
  pageHeight: 245,
  /** Толщина линий и стрелки. */
  strokePt: 0.9,
  arrowLengthPt: 5.5,
  arrowHalfWidthPt: 2.8,
  /** Шрифт на схеме. */
  fontFamily: ['Times New Roman', 'Tinos', 'Liberation Serif'],
  fontGeneric: 'serif',
  /** Кегль текста в символе в зависимости от числа строк (1, 2, 3, 4 и более). */
  textPtByLines: [9.5, 9, 8, 7.5],
  textComfortPt: 8,
  textMinPt: 7,
  textStepPt: 0.5,
  textWrapPt: 8.5,
  terminatorPt: 9,
  connectorPt: 9.5,
  connectorComfortPt: 7,
  labelPt: 9,
  identifierPt: 9,
  commentPt: 8.5,
  captionPt: 14,
  lineHeight: 1.5,
  /** Доли кегля: высота прописной, нижние выносные, сдвиг базовой линии от центра строки. */
  capRatio: 0.72,
  descentRatio: 0.25,
  baselineRatio: 0.34,
  /** Отступ текста от контура символа. */
  textPad: 1.75,
});

const freezeDeep = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) freezeDeep(v);
  return Object.freeze(o);
};

/**
 * Строит согласованный набор размеров. Производные величины выражены через модуль сетки
 * и размеры основного символа, поэтому смена `unit` или пропорций не ломает раскладку.
 * @param {Partial<typeof DEFAULT_SPEC>} [overrides]
 */
export function createMetrics(overrides = {}) {
  const s = { ...DEFAULT_SPEC, ...overrides };
  const u = s.unit;
  const w = s.symbolWidthUnits * u;
  const h = s.symbolHeightUnits * u;
  if (!(u > 0) || !(w > 0) || !(h > 0)) throw new RangeError('Размеры схемы должны быть положительными');
  const pt = MM_PER_PT;

  return freezeDeep({
    unit: u,
    pt,
    /** Округление вверх до узла сетки. */
    snapUp: (v) => Math.ceil(v / u - 1e-9) * u,
    snap: (v, step = u) => Math.round(v / step) * step,

    symbol: {
      w, h, hw: w / 2, hh: h / 2,
      /** Терминатор и соединитель вдвое ниже основного символа. */
      terminatorH: h / 2,
      connectorD: h / 2,
      /** Срез углов «Границы цикла» и наклон «Данных» — четверть высоты. */
      chamfer: h / 4,
      slant: h / 4,
      /** Отступ внутренних вертикалей «Предопределённого процесса» — 1/8 ширины. */
      predefinedInset: w / 8,
    },

    flow: {
      /** Минимальный отрезок линии между соседними символами. */
      gap: u,
      /** Просвет между соседними ветвями (от контура до контура). */
      branchGap: 3 * u,
      /** Отступ возвратной линии цикла от самого широкого символа тела. */
      loopBackGap: 2 * u,
      /** Отступ дополнительной линии (continue рядом с линией выхода). */
      laneGap: 2 * u,
      /** Спуск линии выхода цикла ниже возвратной линии. */
      loopExitDrop: 3 * u,
      /** Отступ общей линии слияния ветвей от самой правой ветви. */
      mergeLaneGap: 4 * u,
      /** Шаг смещения параллельных линий. */
      laneStep: u,
      /** Отступ вертикали ветвления многовыходного «Решения» и наименьшая длина ответвления. */
      busGap: 2 * u,
      /** Просвет между колонками при переносе: от символов и от линий. */
      columnGapSymbols: 6 * u,
      columnGapLines: 4 * u,
      /** Отрезок линии между символом и соединителем переноса. */
      connectorLead: 2 * u,
    },

    page: {
      width: s.pageWidth,
      height: s.pageHeight,
      /** Поле от края холста до крайних элементов. */
      margin: u,
      /** Поле слева от самой левой линии первой колонки. */
      leftMargin: 2 * u,
    },

    stroke: { width: s.strokePt * pt, dash: [3 * s.strokePt * pt, 2 * s.strokePt * pt] },
    arrow: { length: s.arrowLengthPt * pt, halfWidth: s.arrowHalfWidthPt * pt },

    font: {
      family: s.fontFamily,
      generic: s.fontGeneric,
      css: [...s.fontFamily.map((f) => (/\s/.test(f) ? `"${f}"` : f)), s.fontGeneric].join(', '),
      textPtByLines: s.textPtByLines,
      comfortPt: s.textComfortPt,
      minPt: s.textMinPt,
      stepPt: s.textStepPt,
      wrapPt: s.textWrapPt,
      terminatorPt: s.terminatorPt,
      connectorPt: s.connectorPt,
      connectorComfortPt: s.connectorComfortPt,
      labelPt: s.labelPt,
      identifierPt: s.identifierPt,
      commentPt: s.commentPt,
      captionPt: s.captionPt,
      lineHeight: s.lineHeight,
      capRatio: s.capRatio,
      descentRatio: s.descentRatio,
      baselineRatio: s.baselineRatio,
      /** Нижний/верхний индекс и знак корня в формулах. */
      scriptScale: 0.7,
      subShift: 0.3,
      supShift: -0.45,
      overlineRatio: 0.06,
    },

    text: { pad: s.textPad },

    label: {
      /** Подпись выхода: отступ от линии по горизонтали и от вершины символа. */
      padX: 0.3 * u,
      sideGap: 0.4 * u,
      sideRise: 0.7 * u,
      /** Место справа от символа, зарезервированное под подпись бокового выхода. */
      room: 1.6 * u,
      halfHeight: 0.4 * u,
      /** Шаг перемещения подписи мышью. */
      step: u / 10,
    },

    identifier: {
      /** Идентификатор символа — слева над символом (п. 4.1.5). */
      gap: 0.16 * u,
      height: 0.72 * u,
    },

    comment: {
      /** Скоба комментария: отступ от символа, длина полки, отступ текста. */
      offset: 1.4 * u,
      shelf: 0.4 * u,
      textGap: 0.8 * u,
      minHeight: 4.4 * u,
      heightStep: 0.4 * u,
      pad: 0.8 * u,
      elbow: 0.6 * u,
    },

    caption: { height: 2.4 * u, offset: 1.4 * u },
  });
}

/** Набор по умолчанию. */
export const METRICS = createMetrics();
