const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2180, height: 1500 }, deviceScaleFactor: 1.5 });
  await p.goto('file:///home/user/fitness-app/laos-trip-2027/poster.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1000);
  console.log('height', await p.evaluate(() => document.body.scrollHeight));
  await p.screenshot({ path: '/home/user/fitness-app/laos-trip-2027/라오스_4박5일_일정표.png', fullPage: true });
  await b.close();
})();
