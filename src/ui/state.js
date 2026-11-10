/**
 * Проверка состояния, прочитанного из localStorage. Сохранение могло быть сделано старой
 * версией сайта, повреждено или изменено вручную, поэтому в приложение попадает только то,
 * что прошло проверку типов; всё остальное заменяется значениями по умолчанию.
 */
import { normalizeOptions } from '../core/options.js';
import { EXPORT, SIDE_TABS } from './config.js';

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const plain = (v) => (isObject(v) ? v : {});

function sanitizeNames(raw) {
  const out = {};
  for (const [key, e] of Object.entries(plain(raw))) {
    if (!isObject(e)) continue;
    const entry = { disp: str(e.disp), desc: str(e.desc) };
    if (entry.disp || entry.desc) out[key] = entry;
  }
  return out;
}

const point = (p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);

/** Элемент схемы, правленной вручную; null — если элемент непригоден. */
function sanitizeItem(it, symbols) {
  if (!isObject(it) || typeof it.id !== 'string') return null;
  switch (it.type) {
    case 'block':
      if (!symbols.has(it.shape) || !num(it.x) || !num(it.y)) return null;
      return { ...it, text: str(it.text), size: num(it.size) ? it.size : null, num: num(it.num) ? it.num : null };
    case 'line':
      if (!Array.isArray(it.pts) || it.pts.length < 2 || !it.pts.every(point)) return null;
      return { ...it, arrow: oneOf(it.arrow, ['auto', 'end', 'none'], 'auto') };
    case 'label':
      return num(it.x) && num(it.y) ? { ...it, text: str(it.text) } : null;
    case 'comment':
      return num(it.bx) && num(it.by) && num(it.h) ? { ...it, text: str(it.text) } : null;
    default:
      return null;
  }
}

function sanitizeManual(raw, symbols) {
  const out = {};
  for (const [id, g] of Object.entries(plain(raw))) {
    if (!isObject(g) || !Array.isArray(g.items)) continue;
    const items = g.items.map((it) => sanitizeItem(it, symbols)).filter(Boolean);
    if (items.length) out[id] = { ...g, id, items, manual: true };
  }
  return out;
}

/**
 * @param {unknown} raw       разобранный JSON из хранилища
 * @param {object} defaults   состояние по умолчанию
 * @param {object} gost       оформление (для проверки символов и настроек)
 */
export function sanitizeState(raw, defaults, gost) {
  const d = plain(raw);
  const ui = plain(d.ui), exp = plain(d.exp);
  return {
    code: str(d.code),
    exId: str(d.exId),
    names: sanitizeNames(d.names),
    edits: plain(d.edits),
    ifopts: plain(d.ifopts),
    manual: sanitizeManual(d.manual, gost.symbols),
    active: typeof d.active === 'string' ? d.active : null,
    opts: normalizeOptions(d.opts, gost),
    ui: {
      grid: ui.grid === undefined ? defaults.ui.grid : !!ui.grid,
      zoom: num(ui.zoom) && ui.zoom > 0 ? ui.zoom : null,
      side: oneOf(ui.side, SIDE_TABS, defaults.ui.side),
    },
    exp: {
      fmt: oneOf(exp.fmt, EXPORT.formats, defaults.exp.fmt),
      bg: oneOf(exp.bg, ['white', 'transparent'], defaults.exp.bg),
      fill: oneOf(exp.fill, ['white', 'none'], defaults.exp.fill),
      dpi: oneOf(exp.dpi, EXPORT.dpi, defaults.exp.dpi),
      caption: !!exp.caption,
    },
  };
}
