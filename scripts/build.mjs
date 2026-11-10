#!/usr/bin/env node
/**
 * Сборка сайта: src/ → index.html (скрипт встроен в страницу) + vendor/.
 *
 *   node scripts/build.mjs          собрать
 *   node scripts/build.mjs --check  проверить, что index.html и vendor/ соответствуют исходникам
 *
 * index.html — результат сборки. Править его руками нельзя: всё, что должно попасть на
 * страницу (включая счётчик посещений), задаётся в src/ и site.config.json.
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_MARK = '/*__APP__*/';
const ANALYTICS_MARK = '<!--__ANALYTICS__-->';
const check = process.argv.includes('--check');

const config = JSON.parse(await readFile(join(ROOT, 'site.config.json'), 'utf8'));

/** Счётчик Яндекс.Метрики из site.config.json. */
function analyticsHtml() {
  const ym = config.analytics?.yandexMetrika;
  if (!ym?.enabled) return '';
  const id = Number(ym.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('site.config.json: analytics.yandexMetrika.id должен быть числом');
  const src = `https://mc.yandex.ru/metrika/tag.js?id=${id}`;
  const options = JSON.stringify(ym.options ?? {}).replace(/</g, '\\u003c');
  return `<script>
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();
for(var j=0;j<e.scripts.length;j++){if(e.scripts[j].src===r){return;}}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script',${JSON.stringify(src)},'ym');
ym(${id},'init',Object.assign(${options},{referrer:document.referrer,url:location.href}));
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/${id}" style="position:absolute;left:-9999px" alt=""></div></noscript>`;
}

async function bundle() {
  const result = await build({
    entryPoints: [join(ROOT, 'src', 'ui', 'app.js')],
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

async function page() {
  const shell = await readFile(join(ROOT, 'src', 'shell.html'), 'utf8');
  for (const mark of [APP_MARK, ANALYTICS_MARK]) if (!shell.includes(mark)) throw new Error(`В src/shell.html нет метки ${mark}`);
  const js = (await bundle()).replace(/<\/script/gi, '<\\/script');
  // функция-замена: в коде могут встретиться последовательности вида $& и $1
  return shell.replace(ANALYTICS_MARK, () => analyticsHtml()).replace(APP_MARK, () => js);
}

const outputs = [{ path: 'index.html', data: Buffer.from(await page(), 'utf8') }];
for (const [target, source] of Object.entries(config.vendor ?? {})) outputs.push({ path: target, data: await readFile(join(ROOT, source)) });

let stale = 0;
for (const { path, data } of outputs) {
  const full = join(ROOT, path);
  if (check) {
    const current = await readFile(full).catch(() => null);
    if (!current || !current.equals(data)) { console.error(`Устарел: ${path} — выполните npm run build`); stale++; }
    continue;
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
  console.log(`${path}  ${(data.length / 1024).toFixed(0)} КБ`);
}
if (check) { if (stale) process.exit(1); console.log('Сборка соответствует исходникам'); }
