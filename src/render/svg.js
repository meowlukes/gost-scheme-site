/**
 * Вывод сцены в SVG: фрагмент для экрана и самостоятельный файл.
 */
import { captionPrimitive } from './scene.js';

export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (v) => Math.round(v * 1000) / 1000;
const points = (pts) => pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
const INK = '#000';

function primitive(p, gost) {
  const sw = f(gost.metrics.stroke.width);
  switch (p.t) {
    case 'path': return `<path d="${p.d}" fill="${p.fill || 'none'}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="miter"/>`;
    case 'poly': return `<polyline points="${points(p.pts)}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="miter"` +
      (p.cap ? ` stroke-linecap="${p.cap}"` : '') + (p.dash ? ` stroke-dasharray="${p.dash.map(f).join(' ')}"` : '') + '/>';
    case 'text': return `<text x="${f(p.x)}" y="${f(p.y)}" font-size="${f(p.size * gost.metrics.pt)}">${escapeXml(p.s)}</text>`;
    case 'rule': return `<line x1="${f(p.x0)}" y1="${f(p.y)}" x2="${f(p.x1)}" y2="${f(p.y)}" stroke="${INK}" stroke-width="${f(p.width)}"/>`;
    default: throw new RangeError(`Неизвестный примитив: ${p.t}`);
  }
}

/**
 * Содержимое схемы как фрагмент SVG.
 * @param {{interactive?:boolean}} [opts] interactive — добавить идентификаторы элементов и
 *   невидимые области для захвата мышью
 */
export function sceneToSvg(scene, gost, opts = {}) {
  const hitWidth = gost.metrics.unit / 2;
  let out = '';
  for (const g of scene.groups) {
    const body = g.prims.map((p) => primitive(p, gost)).join('');
    if (!opts.interactive) { out += body; continue; }
    const id = escapeXml(g.id);
    let hit = '';
    if (g.hit && g.hit.pts) hit = `<polyline class="hit" points="${points(g.hit.pts)}" fill="none" stroke="transparent" stroke-width="${f(hitWidth)}"/>`;
    else if (g.hit && g.hit.rect) { const [x, y, w, h] = g.hit.rect; hit = `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="transparent"/>`; }
    out += `<g data-id="${id}" class="${g.cls}">${body}${hit}</g>`;
  }
  return out;
}

/**
 * Самостоятельный SVG-файл в натуральную величину (единицы — миллиметры).
 * @param {{x0:number,y0:number,W:number,H:number}} frame
 * @param {{background?:boolean, caption?:string|null}} opts
 */
export function sceneToSvgFile(scene, frame, gost, text, opts = {}) {
  const m = gost.metrics;
  const H = frame.H + (opts.caption ? m.caption.height : 0);
  const bg = opts.background ? `<rect x="${frame.x0}" y="${frame.y0}" width="${frame.W}" height="${H}" fill="#fff"/>` : '';
  const cap = opts.caption ? primitive(captionPrimitive(opts.caption, frame, gost, text), gost) : '';
  const family = escapeXml(m.font.css.replace(/"/g, "'"));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${frame.W}mm" height="${H}mm" viewBox="${frame.x0} ${frame.y0} ${frame.W} ${H}">` +
    `<g font-family="${family}" fill="${INK}">${bg}${sceneToSvg(scene, gost)}${cap}</g></svg>`;
}
