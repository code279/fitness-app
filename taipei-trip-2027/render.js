const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 2416 }, deviceScaleFactor: 1.6 });
  await p.goto('file:///home/user/fitness-app/taipei-trip-2027/poster.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1000);
  const m = await p.evaluate(() => ({ body: document.body.scrollHeight, sheet: document.querySelector('.sheet').scrollHeight }));
  console.log('body', m.body, 'sheet-content', m.sheet, '(target 2416)');
  await p.screenshot({ path: '/home/user/fitness-app/taipei-trip-2027/타이베이_3박4일_일정표.png' });
  await b.close();
})();
