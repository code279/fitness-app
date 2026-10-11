// 브라우저 종단 시험 (체험 모드 + 사진 글자인식).
// 준비: web/ 파일과 vendor/(tesseract.js, tesseract.js-core, @tesseract.js-data/{jpn,eng,kor}) 를 한 폴더에 두고
//       python3 -m http.server 8765 로 띄운 뒤, SP=<스크린샷 폴더> node test/e2e.mjs
// playwright-core 와 크로미움이 필요하다. 진짜 데이터베이스는 건드리지 않는다(?demo).
import { chromium } from 'playwright-core';
const SP = process.env.SP;
const BASE = 'http://127.0.0.1:8765/index.html?demo&dev';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Tokyo', permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const log = (...a) => console.log(...a);
const shot = (n) => p.screenshot({ path: `${SP}/shot-${n}.png`, fullPage: false });
const toast = async () => (await p.locator('#toast').textContent()).trim();

await p.goto(BASE); await p.waitForSelector('.wcard');
log('1 home wallets:', await p.locator('.wcard').count(), '| remain card①:', await p.locator('.wcard').first().locator('.wremain strong').textContent());
await shot('1-home');

// 2 직접 입력
await p.click('[data-tab="entry"]');
await p.click('[data-name="walletId"][data-val="w2"]');
await p.click('[data-name="category"][data-val="식사"]');
await p.fill('#f-item', '라멘 이치란');
await p.fill('#f-amount', '5,600');
await shot('2-entry');
await p.click('form[data-form="expense"] button.primary');
await p.waitForTimeout(400);
log('2 manual save toast:', await toast());

// 3 붙여넣기 — 카드 내역
await p.click('[data-name="entryMode"][data-val="paste"]');
const cardText = `1월 14일 (목)\nLAWSON SHINJUKU\n21:03 · 결제\n-¥556\n-5,123원\nUNIQLO SHINJUKU\n18:20 · 결제\n-¥4,990\n엔화 충전\n15:00\n+¥50,000\n하코네 소바\n-¥9,600`;
await p.evaluate((t) => navigator.clipboard.writeText(t), cardText);
await p.click('[data-act="paste-clip"]');
await p.waitForSelector('.items .item');
const items = await p.locator('.items .item').evaluateAll((els) => els.map((e) => [e.querySelector('[data-field=merchant]').value, e.querySelector('[data-field=amount]').value, e.classList.contains('on'), (e.querySelector('.pill')||{}).textContent || '']));
log('3 parsed card items:', JSON.stringify(items));
await p.click('[data-name="cardWallet"][data-val="w2"]');
const itemsW2 = await p.locator('.items .item').evaluateAll((els) => els.map((e) => [e.querySelector('[data-field=merchant]').value, e.classList.contains('on'), (e.querySelector('.pill')||{}).textContent || '']));
log('3b on card②, dup check:', JSON.stringify(itemsW2));
await shot('3-paste-card');
await p.click('[data-act="save-items"]'); await p.waitForTimeout(400);
log('3c save toast:', await toast());

// 4 붙여넣기 — 영수증
await p.click('[data-tab="entry"]');
await p.click('[data-name="entryMode"][data-val="paste"]');
await p.fill('[data-bind="entryText"]', `ファミリーマート 新宿駅前店\n2027年1月15日 22:41\nからあげクン ¥260\n合計 ¥1,120\nお預り ¥2,000\nお釣 ¥880`);
await p.click('[data-act="parse-text"]');
await p.waitForSelector('.parsed form');
log('4 receipt prefill:', await p.inputValue('#f-item'), '|', await p.inputValue('#f-amount'), '|', await p.inputValue('#f-at'), '| cat:', await p.locator('[data-name=category].on').textContent());
await shot('4-paste-receipt');
await p.click('.parsed form button.primary'); await p.waitForTimeout(400);
log('4b save toast:', await toast());

// 5 내역 · 수정 · 삭제
await p.click('[data-tab="history"]');
await p.click('[data-name="fWallet"][data-val="w2"]');
log('5 history w2 rows:', await p.locator('.erow').count(), '|', (await p.locator('.total-line').textContent()).trim());
await shot('5-history');
await p.locator('.erow', { hasText: '라멘 이치란' }).click();
await p.fill('.sheet #f-amount', '6200');
await shot('5b-edit');
await p.click('.sheet form button.primary'); await p.waitForTimeout(400);
log('5b edit toast:', await toast(), '| row now:', (await p.locator('.erow', { hasText: '라멘 이치란' }).locator('.eamt').textContent()));
p.once('dialog', (d) => d.accept());
await p.locator('.erow', { hasText: '라멘 이치란' }).click();
await p.click('.sheet [data-act="delete-expense"]'); await p.waitForTimeout(400);
log('5c delete toast:', await toast(), '| left:', await p.locator('.erow', { hasText: '라멘 이치란' }).count());

// 6 충전
await p.click('[data-tab="topup"]');
await p.click('[data-name="topupWallet"][data-val="w3"]');
await p.fill('#t-amt', '20000'); await p.fill('#t-note', '2차 환전');
await p.click('form[data-form="topup"] button.primary'); await p.waitForTimeout(400);
log('6 topup toast:', await toast());
await shot('6-topup');

// 7 설정 — 내 카드
await p.click('[data-act="settings"]');
await p.click('.sheet [data-name="my"][data-val="w1"]');
await shot('7-settings');
await p.click('.sheet [data-act="close-sheet"]');
await p.click('[data-tab="entry"]');
await p.click('[data-name="entryMode"][data-val="manual"]');
log('7 my card preselected in entry:', await p.locator('[data-name="walletId"].on').textContent(), '| default cat:', await p.locator('[data-name=category].on').textContent());

// 8 사진 인식 — 일본어 영수증 이미지
const rp = await ctx.newPage();
await rp.setViewportSize({ width: 420, height: 760 });
await rp.setContent(`<body style="margin:0;background:#ddd"><div style="margin:20px auto;width:360px;background:#fff;padding:22px;font:20px/1.55 'Noto Sans CJK JP','Noto Sans CJK KR',sans-serif;color:#111">
<div style="text-align:center;font-weight:700;font-size:24px">ローソン 新宿西口店</div>
<div style="text-align:center">東京都新宿区西新宿1-1-1</div><div style="text-align:center">電話 03-1234-5678</div>
<div>2027年1月14日(木) 21:03</div><div style="text-align:center;font-weight:700;margin:6px 0">領 収 証</div>
<div style="display:flex;justify-content:space-between"><span>おにぎり 鮭</span><span>¥168</span></div>
<div style="display:flex;justify-content:space-between"><span>緑茶 525ml</span><span>¥140</span></div>
<div style="display:flex;justify-content:space-between"><span>ビール 350ml</span><span>¥248</span></div>
<div style="display:flex;justify-content:space-between;font-weight:700;font-size:24px;margin-top:6px"><span>合計</span><span>¥556</span></div>
<div style="display:flex;justify-content:space-between"><span>お預り</span><span>¥1,000</span></div>
<div style="display:flex;justify-content:space-between"><span>お釣</span><span>¥444</span></div></div></body>`);
await rp.screenshot({ path: `${SP}/receipt.png` });
const cp = await ctx.newPage();
await cp.setViewportSize({ width: 390, height: 700 });
await cp.setContent(`<body style="margin:0;padding:18px;font:17px/1.5 'Noto Sans CJK KR',sans-serif;color:#111;background:#fff">
<div style="font-weight:700;font-size:20px;margin-bottom:8px">이용내역</div>
<div style="color:#666;margin:10px 0">1월 15일 (금)</div>
${[['ODAKYU ROMANCECAR','08:12','4,400'],['HAKONE TOZAN RAILWAY','10:40','1,500'],['LAWSON HAKONE YUMOTO','12:05','738']].map(([m,t,a])=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee"><div><div style="font-weight:700">${m}</div><div style="color:#888;font-size:14px">${t} · 결제</div></div><div style="font-weight:700">-¥${a}</div></div>`).join('')}
</body>`);
await cp.screenshot({ path: `${SP}/cardcap.png` });

await p.click('[data-name="entryMode"][data-val="photo"]');
await p.click('[data-name="photoKind"][data-val="receipt"]');
const t0 = Date.now();
await p.setInputFiles('input[type=file][data-act=photo-file]', `${SP}/receipt.png`);
await p.waitForSelector('.parsed', { timeout: 180000 });
log(`8 OCR receipt (${((Date.now()-t0)/1000).toFixed(1)}s):`, await p.inputValue('#f-item'), '|', await p.inputValue('#f-amount'), '|', await p.inputValue('#f-at'));
log('8 raw text:', JSON.stringify((await p.inputValue('details.raw textarea')).slice(0, 300)));
await shot('8-photo-receipt');

await p.click('[data-name="photoKind"][data-val="card"]');
const t1 = Date.now();
await p.setInputFiles('input[type=file][data-act=photo-file]', `${SP}/cardcap.png`);
await p.waitForSelector('.parsed', { timeout: 180000 });
const ocrItems = await p.locator('.items .item').evaluateAll((els) => els.map((e) => [e.querySelector('[data-field=merchant]').value, e.querySelector('[data-field=amount]').value, e.querySelector('small').textContent.trim().slice(0, 16)]));
log(`9 OCR card capture (${((Date.now()-t1)/1000).toFixed(1)}s):`, JSON.stringify(ocrItems));
log('9 raw text:', JSON.stringify((await p.inputValue('details.raw textarea')).slice(0, 300)));
await shot('9-photo-card');

// 10 다크 모드 · 처음 화면
await p.emulateMedia({ colorScheme: 'dark' });
await p.click('[data-tab="home"]'); await shot('10-dark-home');
const np = await ctx.newPage(); await np.goto('http://127.0.0.1:8765/index.html'); await np.waitForSelector('.code-screen'); await np.screenshot({ path: `${SP}/shot-11-code.png` });

log('ERRORS:', errors.length ? errors : 'none');
await b.close();
