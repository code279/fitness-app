// 실행: node --test trip-2027/budget-app/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, parseCardList, detectKind, normalize, guessCategory } from '../web/parse.js';

const TODAY = new Date(2027, 0, 16, 12, 0); // 여행 셋째 날을 기준일로

test('편의점 영수증 — 합계, 받은 돈·거스름돈 줄에 속지 않는다', () => {
  const t = `LAWSON
ローソン 新宿西口店
東京都新宿区西新宿1-1-1
電話:03-1234-5678
登録番号T1234567890123
2027年1月14日(木) 21:03
レジ#2 責No.123
領 収 証
おにぎり 鮭 ¥168軽
緑茶 525ml ¥140軽
ビール 350ml ¥248
小計 ¥556
(10%対象 ¥248 内消費税等 ¥22)
合計 ¥556
お預り ¥1,000
お釣 ¥444`;
  const r = parseReceipt(t, TODAY);
  assert.equal(r.amount, 556);
  assert.equal(r.merchant, 'LAWSON');
  assert.equal(r.spentAt, '2027-01-14T21:03');
  assert.equal(r.category, '간식·편의점');
  assert.equal(detectKind(t), 'receipt');
});

test('식당 영수증 — 합계 금액이 다음 줄에 있을 때', () => {
  const t = `居酒屋 とりまる 新宿店
2027/01/14 19:45
生ビール 4 2,400
焼鳥盛合せ 2 1,760
お会計
¥8,560
お預り ¥10,000
お釣り ¥1,440`;
  const r = parseReceipt(t, TODAY);
  assert.equal(r.amount, 8560);
  assert.equal(r.merchant, '居酒屋 とりまる 新宿店');
  assert.equal(r.category, '식사');
});

test('글자인식이 띄어 쓴 일본어와 벌어진 쉼표', () => {
  const t = `ド ン ・ キ ホ ー テ 新 宿 店
2 0 2 7年1月15日 14:20
合 計 3点 ¥1, 280
お 預 り ¥2, 000`;
  assert.match(normalize('合 計'), /^合計$/);
  const r = parseReceipt(t, TODAY);
  assert.equal(r.amount, 1280);
  assert.equal(r.category, '쇼핑');
});

test('전각 숫자와 ￥, 금액 뒤에 円', () => {
  const r = parseReceipt(`スターバックス コーヒー
令和9年1月15日 08:12
合計　１，２５０円`, TODAY);
  assert.equal(r.amount, 1250);
  assert.equal(r.spentAt, '2027-01-15T08:12');
  assert.equal(r.category, '식사');
});

test('합계 표시가 없으면 ¥ 금액 중 가장 큰 것, 거스름돈은 제외', () => {
  const r = parseReceipt(`自動販売機
¥160
お釣り ¥840`, TODAY);
  assert.equal(r.amount, 160);
});

test('트래블월렛 내역 캡처 — 여러 건, 원화 환산·충전·취소 구분', () => {
  const t = `이용내역
1월 14일 (목)
LAWSON SHINJUKU NISHIGUCHI
21:03 · 결제
-¥556
-5,123원
ODAKYU ELECTRIC RAILWAY
18:20 · 결제
-¥1,200
엔화 충전
15:00
+¥50,000
1월 15일 (금)
HAKONE TOZAN RAILWAY
10:40 결제취소
+¥1,200
UNIQLO SHINJUKU
-¥4,990
잔액 ¥42,054`;
  assert.equal(detectKind(t), 'card');
  const { items } = parseCardList(t, TODAY);
  const brief = items.map((x) => [x.merchant, x.amount, x.kind, x.spentAt, x.category]);
  assert.deepEqual(brief, [
    ['LAWSON SHINJUKU NISHIGUCHI', 556, 'expense', '2027-01-14T21:03', '간식·편의점'],
    ['ODAKYU ELECTRIC RAILWAY', 1200, 'expense', '2027-01-14T18:20', '교통'],
    ['엔화 충전', 50000, 'topup', '2027-01-14T15:00', '기타'],
    ['HAKONE TOZAN RAILWAY', 1200, 'refund', '2027-01-15T10:40', '기타'],
    ['UNIQLO SHINJUKU', 4990, 'expense', '2027-01-15T12:00', '쇼핑'],
  ]);
});

test('가게와 금액이 한 줄에 있는 내역', () => {
  const { items } = parseCardList(`2027.01.16
FAMILYMART 新宿駅前 ¥398 09:15
吉野家 新宿 ¥680 12:02`, TODAY);
  assert.deepEqual(items.map((x) => [x.merchant, x.amount, x.spentAt]), [
    ['FAMILYMART 新宿駅前', 398, '2027-01-16T09:15'],
    // 두 글자 일본어 조각은 붙인다 — 글자인식의 "ロー ソン" 을 고치는 대가로 "吉野家 新宿" 도 붙는다
    ['吉野家新宿', 680, '2027-01-16T12:02'],
  ]);
});

test('연도 없는 날짜는 기준일에 가까운 과거로 본다', () => {
  const { items } = parseCardList(`12월 30일\nAMAZON JP\n-¥3,000`, TODAY);
  assert.equal(items[0].spentAt.slice(0, 10), '2026-12-30');
});

test('분류 추정', () => {
  assert.equal(guessCategory('KEIO PLAZA HOTEL'), '숙소');
  assert.equal(guessCategory('JR EAST 新宿駅'), '교통');
  assert.equal(guessCategory('알 수 없는 가게'), '기타');
  assert.equal(guessCategory('ファミリーマート 新宿駅前店'), '간식·편의점');
  assert.equal(guessCategory('ODAKYU ROMANCECAR'), '교통');
});

test('사진 글자인식 결과 그대로 — 조각난 가게 이름, \\ 로 읽힌 ¥', () => {
  const t = `ロー ソン 新宿 西口 店
東京 都 新宿 区 西新 宿 1-1-1
電話 03-1234-5678
2027 年 1 月 14 日 ( 木 ) 21:03
領収 証
お に ぎり 鮭 \\168
合計 \\556
お 預り ¥1,000
HH ¥444`;
  const r = parseReceipt(t, TODAY);
  assert.equal(r.merchant, 'ローソン新宿西口店');
  assert.equal(r.amount, 556);
  assert.equal(r.spentAt, '2027-01-14T21:03');
});

test('카드 내역 캡처 글자인식 — 가게와 금액이 한 줄, 시각은 아랫줄', () => {
  const t = `이용내역
1월 15일 (금)
ODAKYU ROMANCECAR               -¥4,400
08:12 - ZH
HAKONE TOZAN RAILWAY             -¥1,500
10:40 - ZH
LAWSON HAKONE YUMOTO             -¥738
12:05 - ZH`;
  const { items } = parseCardList(t, TODAY);
  assert.deepEqual(items.map((x) => [x.merchant, x.amount, x.spentAt, x.category]), [
    ['ODAKYU ROMANCECAR', 4400, '2027-01-15T08:12', '교통'],
    ['HAKONE TOZAN RAILWAY', 1500, '2027-01-15T10:40', '기타'],
    ['LAWSON HAKONE YUMOTO', 738, '2027-01-15T12:05', '간식·편의점'],
  ]);
});
