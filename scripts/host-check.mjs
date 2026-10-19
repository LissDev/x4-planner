import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { seedRussian } from './legacy-russian-fixture.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.resolve(process.argv.find(arg => arg.startsWith('--root='))?.slice(7) ?? projectRoot);
const screenshotDirectory = path.join(projectRoot, 'qa');
const browserPath = process.env.X4_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = createServer(async (request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(webRoot, relative);
  if (!target.startsWith(webRoot + path.sep) && target !== path.join(webRoot, 'index.html')) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'content-type': `${type[path.extname(target)] ?? 'application/octet-stream'}; charset=utf-8` }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, acceptDownloads: true });
await seedRussian(page);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = `http://127.0.0.1:${server.address().port}/`;

try {
  await page.goto(url);
  assert.match(page.url(), /#projects$/);

  await page.getByRole('button', { name: '＋ Новый проект' }).click();
  await page.getByLabel('Название проекта').fill('Отмена не создаёт проект');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.match(page.url(), /#projects$/, 'Cancel must stay on the project list');
  assert.equal(await page.locator('.project-card').count(), 0, 'Cancel must not create a project');
  await page.getByRole('button', { name: '＋ Новый проект' }).click();
  await page.getByLabel('Название проекта').fill('Проверка станции');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  assert.match(page.url(), /#calculator\//);

  await page.getByRole('combobox', { name: 'Добавить конечный товар' }).selectOption({ label: 'Энергоэлементы' });
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.locator('#module-picker').click();
  await page.getByRole('option', { name: 'Производство энергоэлементов · Энергоэлементы', exact: true }).click();
  await page.getByRole('button', { name: '＋ Добавить модуль' }).click();
  assert.match(await page.locator('.metrics').innerText(), /168[\s\u00a0]*000 кр\./, 'Average ware price must produce revenue');
  assert.equal(await page.locator('input[data-count]').first().inputValue(), '1');
  await page.getByRole('button', { name: 'Сохранить проект' }).click();

  await page.getByRole('spinbutton', { name: 'Модули для Энергоэлементы' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Модули для Энергоэлементы' }).press('Tab');
  await page.getByRole('button', { name: 'Построить цепочку' }).click();
  await page.locator('#preview').waitFor({ state: 'visible' });
  assert.equal(await page.locator('input[data-count]').first().inputValue(), '1', 'Preview must not mutate draft');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(await page.locator('#preview').count(), 0);
  assert.equal(await page.locator('input[data-count]').first().inputValue(), '1', 'Cancel must preserve draft');
  await page.getByRole('button', { name: 'Построить цепочку' }).click();
  await page.locator('#preview').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Применить к черновику' }).click();
  const appliedCount = await page.locator('input[data-count]').count();
  assert.equal(await page.locator('input[data-count]').first().inputValue(), '2',
    'Apply must replace the production module count in the draft');
  await page.reload();
  assert.equal(await page.locator('input[data-count]').first().inputValue(), '1', 'Unsaved Apply must not change persisted project');

  await page.getByRole('spinbutton', { name: 'Модули для Энергоэлементы' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Модули для Энергоэлементы' }).press('Tab');
  await page.getByRole('button', { name: 'Построить цепочку' }).click();
  await page.locator('#preview').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Применить к черновику' }).click();
  await page.getByRole('button', { name: 'Сохранить проект' }).click();
  const savedCount = await page.locator('input[data-count]').count();
  await page.goBack();
  assert.match(page.url(), /#projects$/);
  assert.equal(await page.locator('.project-card').count(), 1);
  await page.goForward();
  assert.match(page.url(), /#calculator\//);
  await page.reload();
  assert.equal(await page.locator('input[data-count]').count(), savedCount, 'Saved plan must survive reload');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '⇩ Экспорт' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.name, 'Проверка станции');
  await page.getByRole('link', { name: '← Проекты' }).click();
  const invalid = { ...exported, station: { ...exported.station,
    modules: { ...exported.station.modules, [Object.keys(exported.station.modules)[0]]: -3 } } };
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalid)) });
  assert.match(await page.locator('#notice').innerText(), /Некорректное количество модулей/);
  assert.equal(await page.locator('.project-card').count(), 1, 'Invalid import must preserve the existing project');
  await page.getByRole('button', { name: /Открыть/ }).click();
  assert.equal(await page.locator('input[data-count]').count(), savedCount);

  if (webRoot === projectRoot) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDirectory, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(screenshotDirectory, 'mobile.png') });
  }
  assert.deepEqual(errors, [], 'No uncaught page errors');
  console.log('HOST GREEN: create/cancel, average prices, preview Cancel/Apply, save, Back/Forward, reload, export, invalid import.');
  if (webRoot === projectRoot) console.log('Screenshots: qa/desktop.png, qa/mobile.png');
} finally {
  await browser.close();
  server.close();
}
