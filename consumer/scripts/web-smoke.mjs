// Web smoke test of the exported app (`npm run export:web` first): serves dist-web, drives every
// demo screen in headless Chromium through its buttons, and checks that effects start, that the
// engine counters return to their idle values, that the lifecycle self-tests pass and that the
// page logs no errors. Screenshots and a JSON report go to web-smoke-out/.
//
// This runs React Native Web with CanvasKit (WebGL) in a desktop browser. It proves the packaged
// SDK works end to end in a consumer app on that platform; it says nothing about Android or iOS
// rendering or performance, which need a device or emulator.
//
// Needs Playwright with Chromium: `npm i -D playwright` and `npx playwright install chromium`,
// or a global install (NODE_PATH). PW_CHROMIUM_PATH selects another Chromium binary.
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const root = resolve('dist-web');
const out = resolve('web-smoke-out');
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist-web/index.html is missing. Run: npm run export:web');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf', '.css': 'text/css' };
const server = createServer((req, res) => {
  let path = join(root, decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
const address = server.address();
const url = `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}/`;

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error') errors.push(`console.error: ${text}`);
  if (text.startsWith('[gamefx-consumer]') || text.startsWith('[gamefx-bench]')) console.log(`  ${text}`);
});

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const visible = (testId) => page.getByTestId(testId).filter({ visible: true }).first();
const tap = async (testId) => { await visible(testId).click(); };
const text = async (testId) => (await visible(testId).textContent()) ?? '';
const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`) }); };
const back = async () => {
  await page.getByRole('link', { name: /, back$/ }).filter({ visible: true }).first().click();
  await page.waitForTimeout(500);
};
/** Polls a screen's stats panel until `test` accepts it, or the time runs out. */
const waitStats = async (test, ms) => {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    last = await text('engine-stats');
    if (test(last)) return { ok: true, last };
    await page.waitForTimeout(150);
  }
  return { ok: false, last };
};
const effects = (s) => Number(/effects (\d+)/.exec(s)?.[1] ?? NaN);
const idle = (s) => /effects 0 · playbacks 0/.test(s);
const waitText = async (testId, re, ms) => {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    last = await text(testId);
    if (re.test(last)) return { ok: true, last };
    await page.waitForTimeout(150);
  }
  return { ok: false, last };
};
const open = async (screen) => { await tap(`go-${screen}`); await page.waitForTimeout(700); };

try {
  await page.goto(url);
  await visible('claim').waitFor({ timeout: 30000 });
  check('app starts with the SDK', true);

  // A. Ordinary screen
  const before = await text('points');
  await tap('claim');
  await page.waitForTimeout(500);
  await shot('a-home-claim');
  check('A: claim updates the app and plays effects', (await text('points')) !== before);

  // B. Fire border
  await open('FireBorder');
  await tap('fire-start');
  let r = await waitStats((s) => effects(s) === 1, 3000);
  check('B: fire starts', r.ok, r.last.split('\n')[1]);
  await tap('fire-rotate');
  await tap('fire-scale');
  await page.waitForTimeout(800);
  await shot('b-fire-rotated-scaled');
  await tap('card-button');
  check('B: view under the fire still takes touches', /Tap me \(1\)/.test(await text('card-button')));
  await tap('fire-stop');
  r = await waitStats(idle, 4000);
  check('B: graceful stop ends the effect', r.ok);
  await tap('fire-start');
  await page.waitForTimeout(300);
  await back();

  // C. Throw & explode
  await open('Throw');
  await tap('throw');
  r = await waitText('throw-status', /Impact/, 4000);
  await shot('c-throw-impact');
  check('C: throw reaches impact', r.ok, r.last);
  r = await waitText('throw-status', /Settled/, 6000);
  check('C: sequence completes', r.ok, r.last);
  await tap('replay');
  await page.waitForTimeout(400);
  await tap('throw-cancel');
  r = await waitText('throw-status', /Cancelled/, 2000);
  check('C: cancel restores the card', r.ok, r.last);
  r = await waitStats(idle, 3000);
  check('C: nothing left running after cancel', r.ok);
  await back();

  // D. Particles
  await open('Particles');
  await tap('tap-area');
  await tap('five-bursts');
  await tap('all-three');
  await page.waitForTimeout(250);
  await shot('d-particles');
  r = await waitStats((s) => effects(s) >= 6, 1000);
  check('D: overlapping bursts run together', r.ok, r.last.split('\n')[1]);
  r = await waitStats(idle, 8000);
  check('D: every burst ends by itself', r.ok);
  await back();

  // E. Composition
  await open('Composition');
  await tap('stack');
  await tap('sequence-play');
  // The reward stage is on screen for only 150 ms, too short to catch reliably by polling its
  // text, so the check reads the path of stages the screen recorded.
  r = await waitText('sequence-path', /Reward/, 4000);
  await shot('e-composition-reward');
  check('E: sequence reaches the reward stage', r.ok && r.last.startsWith('Move › Impact › Reward'), r.last);
  r = await waitText('sequence-stage', /Done/, 4000);
  check('E: sequence completes', r.ok, r.last);
  check('E: three effects on one view', /3/.test(await text('stack-count')));
  await tap('sequence-play');
  await page.waitForTimeout(300);
  await tap('sequence-cancel');
  r = await waitText('sequence-stage', /Cancelled/, 2000);
  check('E: one cancel ends the whole sequence', r.ok, r.last);
  await tap('unstack');
  r = await waitStats(idle, 4000);
  check('E: stacked effects stop gracefully', r.ok);
  await back();

  // F. Navigation and lifecycle
  await open('Lifecycle');
  r = await waitStats(idle, 4000);
  check('F: effects of left screens ended (fire left burning on B)', r.ok, r.last.split('\n')[1]);
  await tap('nav-test');
  r = await waitText('nav-result', /PASS|FAIL/, 60000);
  check('F: open and leave a busy screen ×10, counters back to start', /PASS/.test(r.last), r.last.split('\n')[0]);
  await tap('remount-test');
  r = await waitText('remount-result', /PASS|FAIL/, 20000);
  check('F: provider mounted and unmounted ×20, all engines disposed', /PASS/.test(r.last), r.last);
  await back();

  // G. Quality and reduced motion
  await open('Quality');
  await page.getByText('low', { exact: true }).filter({ visible: true }).first().click();
  r = await waitText('quality-profile', /fx\.quality = low/, 2000);
  check('G: quality prop reaches the engine', r.ok, r.last.split('\n')[0]);
  await page.getByText('on', { exact: true }).filter({ visible: true }).first().click();
  r = await waitText('reduced-motion', /= true/, 2000);
  check('G: reduced motion prop reaches the engine', r.ok, r.last);
  await tap('q-fire');
  await tap('q-explosion');
  await page.waitForTimeout(300);
  await shot('g-low-reduced');
  await page.getByText('system', { exact: true }).filter({ visible: true }).first().click();
  await page.getByText('medium', { exact: true }).filter({ visible: true }).first().click();
  await back();

  // H. One benchmark scenario (web numbers are not mobile measurements).
  await open('Benchmark');
  await tap('bench-throw-1');
  r = await waitText('bench-results', /throw-1/, 15000);
  check('H: benchmark scenario reports and cleans up', /throw-1.*clean/.test(r.last), r.last);
  await back();
} catch (error) {
  check('script ran to the end', false, String(error));
  await shot('failure').catch(() => undefined);
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
writeFileSync(join(out, 'report.json'), `${JSON.stringify({ url, checks, errors }, null, 2)}\n`);
await browser.close();
server.close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`${String(checks.length - failed)}/${String(checks.length)} checks passed. Screenshots and report.json in web-smoke-out/`);
process.exit(failed ? 1 : 0);
