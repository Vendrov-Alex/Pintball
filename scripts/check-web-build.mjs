/**
 * Smoke test for the single-file web build.
 *
 * Serves artifact/pintball-survivor.html with no charset header and no viewport
 * meta of its own — the two things a host might not provide — then boots it,
 * drives the joystick, and fails on any console error. Both of those omissions
 * have already caused real defects: mojibake upgrade icons, and touch input
 * landing 60% away from where the joystick was drawn.
 *
 *   npm run qa:web
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';

const html = readFileSync('artifact/pintball-survivor.html', 'utf8');
// Deliberately no charset in the content-type: this proves the bundle is ASCII-safe.
const server = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise((r) => server.listen(5401, '127.0.0.1', r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:5401/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.battle-btn', { timeout: 15000 });
console.log('single-file page booted');
await page.tap('.battle-btn');
await page.waitForSelector('.battle:not([hidden])');

const box = await page.locator('.battle__canvas').boundingBox();
// One clean press-and-hold, captured before the first level-up card can appear.
await page.mouse.move(box.x + 118, box.y + 640);
await page.mouse.down();
await page.mouse.move(box.x + 160, box.y + 598, { steps: 6 });
await wait(1600);
// Clear the level-up card the opening bots trigger, then re-plant the stick.
await page.mouse.up();
for (let i = 0; i < 3; i++) {
  const card = await page.$('.modal--levelup:not([hidden]) .choice');
  if (!card) break;
  await card.tap();
  await wait(220);
}
await page.mouse.move(box.x + 118, box.y + 640);
await page.mouse.down();
await page.mouse.move(box.x + 160, box.y + 598, { steps: 6 });
await wait(900);

console.log('layout width (must equal the 390px viewport):', await page.evaluate(() => document.documentElement.clientWidth));
console.log('icon mojibake:', (await page.evaluate(() => document.body.innerHTML.includes('â'))) ? 'YES' : 'none');
console.log('HUD:', await page.evaluate(() => JSON.stringify({
  timer: document.querySelector('.hud__timer-value').textContent,
  gold: document.querySelector('.chip--gold .chip__value').textContent,
  hp: document.querySelector('.bar--hp .bar__label').textContent,
  lvl: document.querySelector('.bar--xp .bar__level').textContent,
})));
mkdirSync('screenshots', { recursive: true });
await page.screenshot({ path: 'screenshots/07-joystick.png' });
console.log('debug handle stripped:', await page.evaluate(() => typeof window.__game === 'undefined'));
console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
server.close();
process.exit(0);
