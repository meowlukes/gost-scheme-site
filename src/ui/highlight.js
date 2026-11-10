/**
 * Подсветка текста программы в редакторе: комментарии, строки, числа, служебные слова.
 */
import { RESERVED } from '../core/parser.js';
import { escapeXml as esc } from '../render/svg.js';

export function highlight(src) {
  const re = /(\{[\s\S]*?(?:\}|$)|\(\*[\s\S]*?(?:\*\)|$)|\/\/[^\n]*)|('(?:[^'\n]|'')*'?|#\$?[0-9A-Fa-f]+)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\$[0-9A-Fa-f]+)|([A-Za-z_\u0400-\u04FF][\w\u0400-\u04FF]*)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="n">${esc(m[3])}</span>`;
    else if (m[4]) out += RESERVED.has(m[4].toLowerCase()) ? `<span class="k">${esc(m[4])}</span>` : esc(m[4]);
    last = re.lastIndex;
    if (m[0].length === 0) re.lastIndex++;
  }
  return out + esc(src.slice(last)) + '\n';
}
