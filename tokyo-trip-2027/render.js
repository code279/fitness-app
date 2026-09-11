const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1980, height: 1500 }, deviceScaleFactor: 1.5 });
  await p.goto('file:///home/user/fitness-app/tokyo-trip-2027/poster.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1000);
  console.log('height', await p.evaluate(() => document.body.scrollHeight));
  await p.screenshot({ path: '/home/user/fitness-app/tokyo-trip-2027/tokyo-4day-itinerary.png', fullPage: true });
  await b.close();
})();
