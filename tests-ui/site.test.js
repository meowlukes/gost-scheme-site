/**
 * Проверка собранного сайта в настоящем браузере: построение, правка мышью, настройки,
 * экспорт, сохранение состояния. Запуск: npm run test:ui (перед этим npm run build).
 *
 * Браузер: Chromium из playwright-core (npx playwright-core install chromium) либо
 * установленный Chrome — путь к нему задаётся переменной CHROME_PATH.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const STORAGE_KEY = 'gost-pascal-scheme-v1';
const BUILD_WAIT = 1200;

const PROGRAM = `program T;
var n, s: integer; f: text;
procedure Show(x: integer);
begin
  writeln(x);
end;
begin
  readln(n);
  assign(f, 'a.txt');
  case n of
    1: s := 10;
    2, 3: s := 20;
  else s := 0;
  end;
  Show(s);
end.`;

let server, browser, base;
const errors = [];

before(async () => {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = path === '/' ? '/index.html' : path;
    try {
      const data = await readFile(join(ROOT, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // счётчик посещений в тестах не нужен
  await page.route(/mc\.yandex\.ru/, (r) => r.abort());
  await page.goto(base);
  await page.waitForSelector('#board g.bk');
  return page;
}
const count = (page, sel) => page.locator(sel).count();
const status = (page) => page.locator('#status').innerText();
/** Есть ли текст хотя бы на одной из схем (вкладок). */
async function anyTabShows(page, re) {
  const tabs = page.locator('#tabs button');
  for (let i = 0; i < await tabs.count(); i++) {
    await tabs.nth(i).click();
    if (re.test(await page.locator('#board').innerHTML())) return true;
  }
  return false;
}
async function typeProgram(page, code) { await page.fill('#code', code); await page.waitForTimeout(BUILD_WAIT); }

test('страница открывается, все примеры строятся без ошибок', async () => {
  const page = await open();
  const ids = await page.$$eval('#exampleSel option', (o) => o.map((x) => x.value).filter(Boolean));
  assert.ok(ids.length >= 3);
  for (const id of ids) {
    await page.selectOption('#exampleSel', id);
    await page.waitForTimeout(300);
    assert.ok(await count(page, '#board g.bk') > 2, `пример ${id}`);
    assert.equal(await count(page, '#msgs .msg:not(.info)'), 0, `ошибки разбора в примере ${id}`);
    // пункты стандарта (оформление — размер листа — у длинных примеров может не выполняться)
    const failed = (await page.locator('.check li.no').allInnerTexts()).filter((t) => /п\. \d/.test(t));
    assert.deepEqual(failed, [], `чек-лист примера ${id}`);
  }
  await page.context().close();
});

test('своя программа: case одним решением, вызов подпрограммы, замечание о пропуске', async () => {
  const page = await open();
  await typeProgram(page, PROGRAM);
  assert.equal(await count(page, '#tabs button'), 2);
  assert.match(await page.locator('#msgs .notes').innerText(), /Показано не всё: 1/);
  assert.equal(await count(page, '#board g.lb'), 3, 'подписи выходов: 1; 2, 3; Нет');
  await page.locator('details:has(#set-caseStyle)').evaluate((d) => { d.open = true; });
  await page.selectOption('#set-caseStyle', 'cascade');
  await page.waitForTimeout(300);
  assert.equal(await count(page, '#board g.lb'), 4, 'цепочка: два ромба по Да/Нет');
  await page.context().close();
});

test('своя программа вместо примера: описания обозначений из примера не переносятся', async () => {
  const page = await open();
  const ids = await page.$$eval('#exampleSel option', (o) => o.map((x) => x.value).filter(Boolean));
  // пример, в описаниях которого есть «проверяемое слово»
  let found = false;
  for (const id of ids) {
    await page.selectOption('#exampleSel', id);
    await page.waitForTimeout(300);
    if (await anyTabShows(page, /проверяемое слово/)) { found = true; break; }
  }
  assert.ok(found, 'в примерах есть описание «проверяемое слово»');
  await typeProgram(page, (await readFile(join(ROOT, 'tests', 'fixtures', 'circle.pas'), 'utf8')));
  assert.equal(await anyTabShows(page, /проверяемое слово/), false);
  assert.equal(await count(page, '#board g.bk path[d*="M"]'), await count(page, '#board g.bk'), 'символы на месте');
  await page.context().close();
});

test('правка мышью делает схему ручной; отмена возвращает; изменение кода помечает её устаревшей', async () => {
  const page = await open();
  await typeProgram(page, PROGRAM);
  const box = await page.locator('#board g.bk').nth(2).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  assert.match(await status(page), /правилась вручную/);
  // программа меняется по существу — ручная схема больше ей не соответствует
  await typeProgram(page, PROGRAM.replace('  Show(s);', '  s := s + 1;\n  Show(s);'));
  assert.match(await status(page), /больше не соответствует/);
  assert.equal(await count(page, '#tabs .tab.stale'), 1);
  await typeProgram(page, PROGRAM);
  assert.match(await status(page), /правилась вручную/);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.doesNotMatch(await status(page), /вручную/);
  await page.context().close();
});

test('экспорт во все форматы и архив', async () => {
  const page = await open();
  await page.click('.side-tabs button[data-side="export"]');
  await page.waitForSelector('#eSave');
  const signature = { png: [0x89, 0x50, 0x4E, 0x47], jpg: [0xFF, 0xD8], webp: [0x52, 0x49, 0x46, 0x46], pdf: [0x25, 0x50, 0x44, 0x46], svg: [0x3C, 0x3F, 0x78, 0x6D] };
  for (const [fmt, magic] of Object.entries(signature)) {
    await page.click(`.seg[data-k="fmt"] button[data-v="${fmt}"]`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#eSave')]);
    const data = await readFile(await download.path());
    assert.deepEqual([...data.subarray(0, magic.length)], magic, fmt);
    assert.ok(data.length > 1000, fmt);
  }
  const [zip] = await Promise.all([page.waitForEvent('download'), page.click('#eAll')]);
  assert.deepEqual([...(await readFile(await zip.path())).subarray(0, 2)], [0x50, 0x4B]);
  await page.context().close();
});

test('состояние сохраняется; повреждённое сохранение не мешает запуску', async () => {
  const page = await open();
  await typeProgram(page, PROGRAM);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('#board g.bk');
  assert.equal(await page.inputValue('#code'), PROGRAM);
  for (const broken of ['{', '{"code":5,"manual":{"x":{"items":[{"type":"block","shape":"нет"}]}},"opts":{"maxH":"z"}}', 'null', '[]']) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, broken]);
    await page.reload();
    await page.waitForSelector('#board g.bk');
    assert.ok(await count(page, '#board g.bk') > 2);
  }
  await page.context().close();
});

test('в консоли страницы нет ошибок', () => {
  assert.deepEqual(errors, []);
});
