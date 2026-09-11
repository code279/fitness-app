const { chromium } = require('playwright');
const f = process.argv[2] || 'poster';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2180, height: 1500 }, deviceScaleFactor: 1.5 });
  await p.goto(`file:///home/user/fitness-app/taipei-trip-2027/${f}.html`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1000);
  console.log('height', await p.evaluate(() => document.body.scrollHeight));
  await p.screenshot({ path: `/home/user/fitness-app/taipei-trip-2027/taiwan-5day-itinerary.png`, fullPage: true });
  await b.close();
})();
