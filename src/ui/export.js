/**
 * Экспорт схемы в файлы: SVG, PNG, JPEG, WebP, PDF. Библиотеки PDF и ZIP подгружаются
 * при первом обращении.
 */
import { geomBounds } from '../core/project.js';
import { canvasBlob, jpegWithDpi, pngWithDpi, sceneToCanvas } from '../render/canvas.js';
import { buildScene } from '../render/scene.js';
import { sceneToSvgFile } from '../render/svg.js';
import { EXPORT, VENDOR } from './config.js';

export const isRaster = fmt => fmt !== 'svg';
export const canBeTransparent = fmt => EXPORT.transparent.includes(fmt);
/** Параметры изображения с учётом ограничений формата. */
export function exportLook(E) {
  const bg = canBeTransparent(E.fmt) ? E.bg : 'white';
  return { background: bg === 'white', fill: bg === 'transparent' ? E.fill : 'white', bg };
}
export function safeName(s) { return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/–/g, '-').slice(0, EXPORT.fileNameLength); }

/** Библиотеки экспорта подгружаются только при первом обращении. */
const vendorLoads = new Map();
export function loadVendor(name) {
  const lib = VENDOR[name];
  if (window[lib.global]) return Promise.resolve(window[lib.global]);
  if (!vendorLoads.has(name)) {
    vendorLoads.set(name, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = lib.src;
      el.onload = () => (window[lib.global] ? resolve(window[lib.global]) : reject(new Error(`Модуль ${lib.title} не загрузился`)));
      el.onerror = () => { vendorLoads.delete(name); reject(new Error(`Не удалось загрузить модуль ${lib.title} — проверьте соединение`)); };
      document.head.append(el);
    }));
  }
  return vendorLoads.get(name);
}
/**
 * @param {object} gost оформление
 * @param {ReturnType<import('../render/text.js').createTextEngine>} text
 */
export function createExporter(gost, text) {
  const M = gost.metrics;
  function rasterCanvas(g, b, E, caption) {
    const look = exportLook(E);
    return sceneToCanvas(buildScene(g, gost, text, { fill: look.fill }), b, gost, text, { dpi: E.dpi || EXPORT.defaultDpi, background: look.background, caption });
  }
  /**
   * Файл схемы в выбранном формате.
   * @param {{items:object[]}} g геометрия
   * @param {object} E настройки экспорта
   * @param {string} title подпись рисунка (она же имя файла)
   */
  async function makeFile(g, E, title) {
    const b = geomBounds(g, text.measure, gost);
    const look = exportLook(E);
    const caption = E.caption ? title : null;
    const base = safeName(title);
    if (E.fmt === 'svg') {
      const svg = sceneToSvgFile(buildScene(g, gost, text, { fill: look.fill }), b, gost, text, { background: look.background, caption });
      return { name: base + '.svg', blob: new Blob([svg], { type: 'image/svg+xml' }) };
    }
    const dpi = E.dpi || EXPORT.defaultDpi;
    const cv = rasterCanvas(g, b, E, caption);
    if (E.fmt === 'png') { const bl = await canvasBlob(cv, 'image/png'); return { name: base + '.png', blob: new Blob([pngWithDpi(await bl.arrayBuffer(), dpi)], { type: 'image/png' }) }; }
    if (E.fmt === 'jpg') { const bl = await canvasBlob(cv, 'image/jpeg', EXPORT.jpegQuality); return { name: base + '.jpg', blob: new Blob([jpegWithDpi(await bl.arrayBuffer(), dpi)], { type: 'image/jpeg' }) }; }
    if (E.fmt === 'webp') return { name: base + '.webp', blob: await canvasBlob(cv, 'image/webp', EXPORT.webpQuality) };
    if (E.fmt === 'pdf') {
      const { jsPDF } = await loadVendor('pdf');
      const H = b.H + (caption ? M.caption.height : 0);
      const doc = new jsPDF({ unit: 'mm', format: [b.W, H], orientation: b.W > H ? 'l' : 'p', compress: true });
      doc.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, b.W, H, undefined, 'FAST');
      return { name: base + '.pdf', blob: doc.output('blob') };
    }
    throw new Error('Неизвестный формат файла');
  }
  return { makeFile, rasterCanvas };
}
