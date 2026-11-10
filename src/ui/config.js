/**
 * Параметры интерфейса (не геометрия схемы): хранение, задержки, масштаб, экспорт.
 */

/** Ключ сохранения в localStorage и версия формата данных. */
export const STORAGE_KEY = 'gost-pascal-scheme-v1';
export const STATE_VERSION = 2;

export const UNDO_DEPTH = 80;

/** Задержки, мс. */
export const TIMING = Object.freeze({
  saveDelay: 300,
  buildDelay: 700,
  namesDelay: 350,
  resizeDelay: 150,
  toast: 2600,
  doubleClick: 400,
  revokeUrl: 1500,
});

export const ZOOM = Object.freeze({
  min: 0.25, max: 4, step: 1.2, wheelStep: 1.1,
  /** Автоподбор: пределы, порог читаемости и поля окна в пикселях. */
  fitMin: 0.3, fitLimit: 3, fitMax: 1.2, readable: 0.55, fitInsetPx: 24,
});

export const EXPORT = Object.freeze({
  formats: Object.freeze(['png', 'svg', 'jpg', 'webp', 'pdf']),
  labels: Object.freeze({ png: 'PNG', svg: 'SVG', jpg: 'JPEG', webp: 'WebP', pdf: 'PDF' }),
  transparent: Object.freeze(['png', 'svg', 'webp']),
  dpi: Object.freeze([150, 300, 600]),
  defaultDpi: 300,
  jpegQuality: 0.95,
  webpQuality: 0.97,
  captionPreview: 40,
  fileNameLength: 120,
  archiveName: 'Схемы_программы.zip',
});

/** Библиотеки экспорта: копируются сборкой из node_modules в vendor/. */
export const VENDOR = Object.freeze({
  pdf: Object.freeze({ src: 'vendor/jspdf.umd.min.js', global: 'jspdf', title: 'PDF' }),
  zip: Object.freeze({ src: 'vendor/jszip.min.js', global: 'JSZip', title: 'ZIP' }),
});

export const SIDE_TABS = Object.freeze(['props', 'names', 'export']);
