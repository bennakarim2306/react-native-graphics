// Captures the Phase 4 Effects tab of the exported web build (react-native-web + CanvasKit).
// Headless Chromium renders WebGL in software, so a screenshot takes over a second. To capture
// exact moments, page time (performance.now, which the engine's frame clock reads) runs at
// 0.25x and is frozen while each screenshot is taken. The app itself is unchanged.
const { chromium } = require('playwright');
const out = process.argv[2];
const scale = Number(process.argv[3] || 2);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: scale });
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror ' + String(e)));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall')) logs.push(m.type() + ' ' + m.text());
  });
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    let anchorReal = realNow();
    let anchorVirtual = anchorReal;
    let speed = 1;
    let frozen = null;
    const now = () => (frozen !== null ? frozen : anchorVirtual + (realNow() - anchorReal) * speed);
    performance.now = now;
    window.__fxTime = {
      now,
      freeze() { frozen = now(); },
      run(s) { anchorVirtual = now(); anchorReal = realNow(); frozen = null; if (s !== undefined) speed = s; },
      wait(ms) {
        const end = now() + ms;
        return new Promise((resolve) => { const loop = () => (now() >= end ? resolve() : requestAnimationFrame(loop)); loop(); });
      },
      frames(n) {
        return new Promise((resolve) => { const loop = (k) => (k <= 0 ? resolve() : requestAnimationFrame(() => loop(k - 1))); loop(n); });
      },
      onText(src) {
        const re = new RegExp(src);
        const found = () => [...document.querySelectorAll('div')].some((d) => d.childElementCount === 0 && re.test(d.textContent || ''));
        return new Promise((resolve) => {
          if (found()) { window.__fxTime.freeze(); resolve(); return; }
          const mo = new MutationObserver(() => { if (found()) { mo.disconnect(); window.__fxTime.freeze(); resolve(); } });
          mo.observe(document.body, { subtree: true, childList: true, characterData: true });
        });
      },
    };
  });
  await page.goto(process.env.SHOWCASE_URL || 'http://localhost:8099/');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__fxTime.run(0.25));

  const click = async (text) => { await page.getByText(text, { exact: true }).first().click(); };
  const wait = (ms) => page.evaluate((m) => window.__fxTime.wait(m), ms);
  const shotFrozen = async (name) => {
    await page.evaluate(() => window.__fxTime.frames(3)); // let the overlay draw the frozen frame
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.evaluate(() => window.__fxTime.run());
  };
  const shot = async (name) => { await page.evaluate(() => window.__fxTime.freeze()); await shotFrozen(name); };
  const shotOnText = async (re, name) => { await page.evaluate((s) => window.__fxTime.onText(s), re.source); await shotFrozen(name); };
  // Scroll the ScrollView with the wheel (real scroll events, so targets re-measure).
  const scrollTo = async (text) => {
    for (let i = 0; i < 12; i++) {
      const box = await page.getByText(text).first().boundingBox();
      const delta = box.y - 215;
      if (Math.abs(delta) < 4) break;
      await page.mouse.move(206, 600);
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(400);
    }
    await wait(100);
  };

  // A. Fire border
  await click('Enable fire'); await wait(1200); await shot('a1-fire-border');
  await click('+'); await click('+'); await click('+');
  await click('Blue'); await wait(600); await shot('a2-fire-blue-intensity');
  await click('Rotate'); await wait(560); await shot('a3-fire-rotated');
  await wait(800);
  await click('Scale'); await wait(430); await shot('a4-fire-scaled');
  await wait(600);
  await click('Move'); await wait(430); await shot('a5-fire-moved');
  await wait(600);
  await click('Orange'); await wait(200);

  // B. Throw & Explode
  await scrollTo('B · Throw & Explode');
  await click('Throw & Explode'); await wait(150); await shot('b1-throw-launch');
  await shotOnText(/^Peak$/, 'b2-throw-peak');
  await wait(330); await shot('b3-throw-falling');
  await shotOnText(/^Impact!/, 'b4-throw-impact');
  await wait(140); await shot('b5-throw-explosion');
  await wait(450); await shot('b6-throw-smoke');
  await shotOnText(/^Settled/, 'b7-throw-settled');
  await click('vanish'); await click('Replay'); await shotOnText(/^Impact!/, 'b8-vanish-impact');
  await wait(300); await shot('b9-vanish-gone');
  await click('Throw & Explode'); await wait(380); await click('Cancel'); await shotOnText(/^Cancelled/, 'b10-cancelled-restored');
  await click('return');

  // C. Particle playground
  await scrollTo('C · Particle playground');
  await click('Burst'); await wait(220); await shot('c1-burst');
  await wait(1500);
  await click('Ice'); await click('circle'); await click('Fountain'); await wait(1300); await shot('c2-fountain-ice');
  await click('Stop fountain'); await wait(1500);
  await click('Candy'); await click('square');
  for (let i = 0; i < 3; i++) await page.getByText('Gravity').locator('xpath=..').getByText('−', { exact: true }).click();
  await click('Burst'); await wait(400); await shot('c3-burst-candy-low-gravity');
  await wait(1500);

  // D. Gallery
  await scrollTo('D · Effects gallery');
  await click('Confetti'); await click('Golden sparks'); await wait(450); await shot('d1-confetti-sparks');
  await wait(3000);
  await click('Trail on/off'); await click('Glow pulse'); await wait(900); await shot('d2-trail-glow');
  await click('Trail on/off'); await wait(900);
  await click('Explosion'); await wait(120); await shot('d3-explosion');
  await wait(3000);
  await click('Victory'); await wait(700); await shot('d4-victory');
  await wait(3000);
  await click('Smoke 3 s'); await wait(1200); await click('Shockwave'); await wait(180); await shot('d5-smoke-shockwave');
  await wait(3500);

  // E. Combined
  await scrollTo('E · Combined effects');
  await click('Fire on all'); await wait(900);
  await click('Glow + sparks on middle'); await wait(500); await shot('e1-fire-glow-sparks');
  await click('Spin all'); await wait(380); await shot('e2-spin-all');
  await wait(800);
  await click('Explode in sequence'); await wait(560); await shot('e3-explode-sequence');
  await wait(3000);
  await click('Clear all'); await wait(1200); await shot('e4-cleared');
  logs.push('final counter: ' + (await page.getByText(/^Active: /).first().textContent()));
  console.log(JSON.stringify(logs, null, 1));
  await browser.close();
})();
