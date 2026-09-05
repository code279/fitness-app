const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1.6 });
  await p.goto('file:///home/user/fitness-app/taipei-trip-2027/poster.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);
  const h = await p.evaluate(() => document.body.scrollHeight);
  console.log('height', h);
  await p.screenshot({ path: '/home/user/fitness-app/taipei-trip-2027/타이베이_3박4일_일정표.png', fullPage: true });
  await b.close();
})();
