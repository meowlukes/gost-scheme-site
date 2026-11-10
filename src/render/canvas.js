/**
 * Вывод сцены на Canvas (растровый экспорт) и запись разрешения в PNG и JPEG,
 * чтобы текстовый редактор вставлял рисунок в натуральную величину.
 */
import { captionPrimitive } from './scene.js';

const MM_PER_INCH = 25.4;
const INK = '#000';

/**
 * @param {{x0:number,y0:number,W:number,H:number}} frame
 * @param {{dpi:number, background?:boolean, caption?:string|null}} opts
 * @returns {HTMLCanvasElement}
 */
export function sceneToCanvas(scene, frame, gost, text, opts) {
  const m = gost.metrics;
  const k = opts.dpi / MM_PER_INCH;
  const H = frame.H + (opts.caption ? m.caption.height : 0);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(frame.W * k);
  canvas.height = Math.round(H * k);
  const ctx = canvas.getContext('2d');
  if (opts.background) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.setTransform(k, 0, 0, k, -frame.x0 * k, -frame.y0 * k);
  ctx.strokeStyle = INK; ctx.fillStyle = INK;
  ctx.lineJoin = 'miter'; ctx.miterLimit = 10; ctx.textBaseline = 'alphabetic';

  const stroke = (pts, width, dash, cap) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.lineWidth = width; ctx.lineCap = cap || 'butt'; ctx.setLineDash(dash || []);
    ctx.stroke();
  };
  const draw = (p) => {
    switch (p.t) {
      case 'path': {
        const path = new Path2D(p.d);
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(path); ctx.fillStyle = INK; }
        ctx.lineWidth = m.stroke.width; ctx.setLineDash([]); ctx.stroke(path);
        break;
      }
      case 'poly': stroke(p.pts, m.stroke.width, p.dash, p.cap); break;
      case 'text': ctx.font = `${p.size * m.pt}px ${m.font.css}`; ctx.fillText(p.s, p.x, p.y); break;
      case 'rule': stroke([[p.x0, p.y], [p.x1, p.y]], p.width); break;
      default: throw new RangeError(`Неизвестный примитив: ${p.t}`);
    }
  };
  for (const g of scene.groups) g.prims.forEach(draw);
  if (opts.caption) draw(captionPrimitive(opts.caption, frame, gost, text));
  return canvas;
}

export const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Браузер не смог сформировать изображение'))), type, quality);
});

// ---- разрешение в файлах ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Конец обязательного блока IHDR: 8 байт сигнатуры + 25 байт блока. */
const PNG_IHDR_END = 33;
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/** Вставляет в PNG блок pHYs (точек на метр) сразу после IHDR. */
export function pngWithDpi(buffer, dpi) {
  const src = new Uint8Array(buffer);
  if (src.length < PNG_IHDR_END || PNG_SIGNATURE.some((b, i) => src[i] !== b)) return src;
  const perMetre = Math.round(dpi / (MM_PER_INCH / 1000));
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  view.setUint32(8, perMetre); view.setUint32(12, perMetre);
  chunk[16] = 1; // единица — метр
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, PNG_IHDR_END), 0);
  out.set(chunk, PNG_IHDR_END);
  out.set(src.subarray(PNG_IHDR_END), PNG_IHDR_END + chunk.length);
  return out;
}

/** Записывает плотность в заголовок JFIF (если он есть). */
export function jpegWithDpi(buffer, dpi) {
  const b = new Uint8Array(buffer);
  const jfif = b[2] === 0xFF && b[3] === 0xE0 && b[6] === 0x4A && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46;
  if (jfif) { b[13] = 1; b[14] = dpi >> 8; b[15] = dpi & 255; b[16] = dpi >> 8; b[17] = dpi & 255; }
  return b;
}
