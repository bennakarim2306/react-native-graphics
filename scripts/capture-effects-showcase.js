// Captures the Phase 4 Effects tab (demos A, I, B–E, G and H) of the exported web build (react-native-web + CanvasKit).
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
  // Scroll with the engine frozen: fire drawn in the card's own layer moves with the card even
  // though no engine frame runs (an overlay-drawn effect would stay behind until re-measured).
  await page.evaluate(() => window.__fxTime.freeze());
  await page.mouse.move(206, 600);
  await page.mouse.wheel(0, 140);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/a6-fire-scrolled-engine-frozen.png` });
  await page.evaluate(() => window.__fxTime.run());
  await page.mouse.wheel(0, -140);
  await page.waitForTimeout(400);
  await click('Orange'); await wait(200);

  // I. Burn away (right under A). The web cannot capture views, so this is the char-and-fade fallback.
  const burnCard = page.getByText('I · Burn away', { exact: true }).locator('xpath=..');
  const inBurn = (text) => burnCard.getByText(text, { exact: true }).first();
  await scrollTo('I · Burn away');
  await inBurn('Burn').click(); await wait(700); await shot('i1-burn-fallback-700ms');
  await wait(800); await shot('i2-burn-fallback-1500ms');
  await wait(1200); await shot('i3-burned-away');
  logs.push('burn status: ' + (await burnCard.getByText(/^Burned away|^Burning|^Cancelled/).first().textContent()));
  await inBurn('Restore').click(); await wait(600); await shot('i4-restored');
  await inBurn('Corner').click(); await inBurn('Blue').click(); await inBurn('Fire first: off').click();
  await inBurn('Burn').click(); await wait(600); await shot('i5-fire-first-blue');
  await wait(900); await inBurn('Cancel').click(); await wait(300); await shot('i6-cancelled-restored');
  await inBurn('Burn the hand (staggered)').click(); await wait(900); await shot('i7-hand-staggered');
  await wait(1500); await shot('i8-hand-burned');
  await inBurn('Restore hand').click(); await inBurn('Fire first: on').click(); await inBurn('Orange').click(); await inBurn('Bottom').click();
  await inBurn('Restore').click(); await wait(600); // status back to "Ready", so B's /^Cancelled/ wait is not met by I's text
  logs.push('after I: ' + (await page.getByText(/^Active: /).first().textContent()));

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
  await click('Throw & Explode'); await wait(380); await page.getByText('B · Throw & Explode', { exact: true }).locator('xpath=..').getByText('Cancel', { exact: true }).first().click(); await shotOnText(/^Cancelled/, 'b10-cancelled-restored');
  await click('return');
  // Fire riding on the thrown card.
  await click('Fire on card'); await wait(700);
  await click('Throw & Explode'); await wait(260); await shot('b11-fire-throw-rising');
  await shotOnText(/^Peak$/, 'b12-fire-throw-peak');
  await wait(300); await shot('b13-fire-throw-falling');
  await shotOnText(/^Settled/, 'b14-fire-throw-settled');
  await click('Fire off'); await wait(600);

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
  await click('Flip all'); await wait(420); await shot('e5-flip-all');
  await wait(900);
  await click('Explode in sequence'); await wait(560); await shot('e3-explode-sequence');
  await wait(3000);
  await click('Clear all'); await wait(1200); await shot('e4-cleared');
  logs.push('final counter: ' + (await page.getByText(/^Active: /).first().textContent()));

  // G. Emitter lab (Phase 4A): four emitters, live changes, pause, cancel, target removal.
  const labReport = async (label) => { logs.push(label + ': ' + (await page.getByText(/Particle pool/).first().textContent())); };
  // Labels such as "Fountain", "Violet" and "Cancel" also exist in other demos: stay inside the lab's card.
  const lab = page.getByText('G · Emitter lab', { exact: true }).locator('xpath=..');
  const labStep = async (label, sign, times) => {
    for (let i = 0; i < times; i++) await lab.getByText(label, { exact: true }).last().locator('xpath=..').getByText(sign, { exact: true }).click();
  };
  const clickLast = async (text) => { await lab.getByText(text, { exact: true }).last().click(); };
  await scrollTo('G · Emitter lab');
  await click('Start lab'); await wait(1500); await shot('g1-lab-four-emitters');
  await labReport('lab started');
  await clickLast('Fountain');
  await labStep('Rate /s', '+', 6); await labStep('Spread °', '+', 2);
  await clickLast('Lime');
  // Clicking controls lower down scrolls the page: bring the stage back before each shot.
  await scrollTo('G · Emitter lab'); await wait(700); await shot('g2-fountain-live-rate-spread-lime');
  await clickLast('Trail');
  await clickLast('Violet');
  await labStep('Size', '+', 3);
  await clickLast('Snow');
  await labStep('Gravity', '+', 2);
  await scrollTo('G · Emitter lab'); await wait(700); await shot('g3-trail-violet-snow-gravity');
  await click('Pause all'); await scrollTo('G · Emitter lab'); await wait(600); await shot('g4-all-paused');
  await click('Resume all'); await wait(300);
  await clickLast('Fountain'); await clickLast('Cancel'); await scrollTo('G · Emitter lab'); await wait(400); await shot('g5-fountain-cancelled');
  await labReport('fountain cancelled');
  await click('Remove orb'); await wait(150); await shot('g6-orb-removed');
  await wait(1200); await shot('g7-orb-emitters-ended');
  await labReport('orb removed, emitters ended');
  await click('Add orb'); await wait(900); await shot('g8-orb-added');
  await labReport('orb added');
  await click('End lab'); await wait(600); await shot('g9-lab-ended');
  // H. Visual quality comparison (Phase 4.5): side by side, then fire and throw at a chosen profile.
  const inCard = (title, text) => page.getByText(title).first().locator('xpath=..').getByText(text, { exact: true }).first();
  const profile = async (level) => { await page.getByText('Profile for the two demos below').locator('xpath=..').getByText(level, { exact: true }).click(); };
  const step = async (label, sign, times) => {
    for (let i = 0; i < times; i++) await page.getByText(label, { exact: true }).last().locator('xpath=..').getByText(sign, { exact: true }).click();
  };
  const sbs = 'H · Quality side by side';
  await scrollTo(sbs);
  await inCard(sbs, 'Fire on').click(); await wait(1200); await shot('h1-side-by-side-fire');
  await inCard(sbs, 'Rotate').click(); await wait(600); await shot('h2-side-by-side-rotated');
  await wait(900);
  await inCard(sbs, 'Explode all').click(); await wait(140); await shot('h3-side-by-side-explosion-140ms');
  await wait(500); await shot('h4-side-by-side-explosion-640ms');
  await inCard(sbs, 'Fire off').click(); await wait(1500);
  const fireTitle = /^H · Fire border/;
  await scrollTo('Profile for the two demos below');
  await profile('high');
  await inCard(fireTitle, 'Fire on').click(); await wait(1200); await shot('h5-fire-high');
  await step('Glow strength', '+', 2); await step('Spark density', '+', 2); await wait(900); await shot('h6-fire-high-glow-1.5-sparks-2');
  await profile('medium'); await wait(1000); await shot('h7-fire-medium');
  await profile('low'); await wait(1000); await shot('h8-fire-low');
  await profile('high'); await wait(600);
  await inCard(fireTitle, 'Rotate').click(); await wait(700); await shot('h9-fire-high-rotated');
  await wait(800);
  await inCard(fireTitle, 'Fire off').click(); await wait(800);
  const throwTitle = /^H · Throw & Explode/;
  await scrollTo(throwTitle);
  await inCard(throwTitle, 'Throw').click(); await shotOnText(/^Impact: flash/, 'h10-throw-high-impact');
  await wait(200); await shot('h11-throw-high-explosion-200ms');
  await wait(600); await shot('h12-throw-high-smoke-800ms');
  await wait(2200);
  await profile('low'); await scrollTo(throwTitle);
  await inCard(throwTitle, 'Throw').click(); await shotOnText(/^Impact: flash/, 'h13-throw-low-impact');
  await wait(200); await shot('h14-throw-low-explosion-200ms');
  await wait(2200);
  await inCard(throwTitle, 'Replay').click(); await wait(380); await inCard(throwTitle, 'Cancel').click();
  await shotOnText(/^Cancelled: card restored/, 'h15-throw-cancelled-restored');
  await profile('high'); await scrollTo(throwTitle);
  await inCard(throwTitle, 'Combined finale').click(); await shotOnText(/^Impact: explosion, golden/, 'h16-finale-impact');
  await wait(400); await shot('h17-finale-400ms');
  await wait(900); await shot('h18-finale-1300ms');
  await wait(3000);
  logs.push('after the finale (fire still on the card): ' + (await page.getByText(/^Active: /).first().textContent()));
  await inCard(throwTitle, 'Fire on card').click(); await wait(1000);
  logs.push('after H, fire off: ' + (await page.getByText(/^Active: /).first().textContent()));
  console.log(JSON.stringify(logs, null, 1));
  await browser.close();
})();
