// 영수증·카드 내역 글자 덩어리에서 가게·날짜·금액을 찾는다.
// 휴대폰의 라이브 텍스트/구글 렌즈로 복사한 글자와, 앱 안 글자인식(Tesseract) 결과를 같은 규칙으로 처리한다.
// 브라우저와 Node 테스트에서 같이 쓰도록 DOM 에 의존하지 않는다.

const KANA_KANJI = '\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f';

export function normalize(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[￥]/g, '¥')
    .replace(/\\(?=[ \t]*\d)/g, '¥') // 일본 글꼴의 ¥ 를 글자인식이 \ 로 읽는다
    .replace(/[，､]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[：]/g, ':')
    .replace(/[／]/g, '/')
    .replace(/[－−–—]/g, '-')
    .replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/　/g, ' ')
    // "1, 280" 처럼 쉼표 뒤가 벌어진 숫자를 붙인다
    .replace(/(\d)[ \t]*,[ \t]*(\d{3})(?!\d)/g, '$1,$2')
    .replace(/¥[ \t]+(?=\d)/g, '¥')
    .split('\n').map(joinSpacedKana).join('\n');
}

// 글자인식은 일본어를 한두 글자씩 띄워 읽는다 ("合 計", "ロー ソン 新宿 西口 店").
// 일본어끼리 붙어 있고 둘 중 하나가 두 글자 이하일 때만 잇는다. "居酒屋 とりまる 新宿店" 같은 진짜 띄어쓰기는 둔다.
const ALL_KANA = new RegExp(`^[${KANA_KANJI}]+$`);
function joinSpacedKana(line) {
  const out = [];
  let prevShort = false;
  for (const w of line.split(/[ \t]+/)) {
    if (!w) continue;
    const kana = ALL_KANA.test(w);
    const short = kana && w.length <= 2;
    const last = out[out.length - 1];
    if (kana && last && ALL_KANA.test(last) && (short || prevShort)) out[out.length - 1] = last + w;
    else out.push(w);
    prevShort = short;
  }
  return out.join(' ');
}

function linesOf(text) {
  return normalize(text).split('\n').map((s) => s.trim()).filter(Boolean);
}

// ── 금액 ─────────────────────────────────────────────
const MONEY_RE = /(-)?[ \t]*(¥|JPY|KRW|₩)?[ \t]*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[ \t]*(円|엔|원|JPY|KRW|yen|won)?/gi;

export function findMoney(line) {
  const out = [];
  for (const m of line.matchAll(MONEY_RE)) {
    const [, neg, pre, num, suf] = m;
    const value = Number(num.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const marks = `${pre || ''}${suf || ''}`.toUpperCase();
    let cur = null;
    if (/¥|JPY|円|엔|YEN/.test(marks)) cur = 'JPY';
    else if (/₩|KRW|원|WON/.test(marks)) cur = 'KRW';
    out.push({ value, cur, neg: Boolean(neg), index: m.index, text: m[0].trim(), grouped: num.includes(',') });
  }
  return out;
}

// ── 날짜·시각 ────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

// 연도가 없으면 기준일(today) 기준으로 가장 가까운 과거·현재 날짜로 본다.
function inferYear(m, d, today) {
  const y = today.getFullYear();
  const cand = new Date(y, m - 1, d);
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  return cand > limit ? y - 1 : y;
}

export function parseDate(line, today = new Date()) {
  let m;
  if ((m = line.match(/(20\d{2})[ \t]*[年./-][ \t]*(\d{1,2})[ \t]*[月./-][ \t]*(\d{1,2})/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDate(y, mo, d)) return { y, m: mo, d, raw: m[0] };
  }
  if ((m = line.match(/(?:令和|R)[ \t]*(\d{1,2})[ \t]*[年./][ \t]*(\d{1,2})[ \t]*[月./][ \t]*(\d{1,2})/))) {
    const [y, mo, d] = [2018 + Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDate(y, mo, d)) return { y, m: mo, d, raw: m[0] };
  }
  if ((m = line.match(/(?<!\d)(\d{2})[./](\d{1,2})[./](\d{1,2})(?!\d)/))) {
    const [y, mo, d] = [2000 + Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDate(y, mo, d)) return { y, m: mo, d, raw: m[0] };
  }
  if ((m = line.match(/(\d{1,2})[ \t]*[月월][ \t]*(\d{1,2})[ \t]*[日일]/))) {
    const [mo, d] = [Number(m[1]), Number(m[2])];
    if (validDate(2000, mo, d)) return { y: inferYear(mo, d, today), m: mo, d, raw: m[0] };
  }
  // "01.14" "1/14" 처럼 연도 없는 짧은 날짜는 그 줄이 날짜만 있을 때만 믿는다
  if ((m = line.match(/^(\d{1,2})[./](\d{1,2})(?:[ \t]*\(.\))?$/))) {
    const [mo, d] = [Number(m[1]), Number(m[2])];
    if (validDate(2000, mo, d)) return { y: inferYear(mo, d, today), m: mo, d, raw: m[0] };
  }
  return null;
}

export function parseTime(line) {
  const m = line.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  return m ? { h: Number(m[1]), mi: Number(m[2]), raw: m[0] } : null;
}

export function toLocalInput(date, time) {
  if (!date) return null;
  const t = time || { h: 12, mi: 0 };
  return `${date.y}-${pad(date.m)}-${pad(date.d)}T${pad(t.h)}:${pad(t.mi)}`;
}

// ── 분류 추정 ────────────────────────────────────────
// 가게 이름처럼 구체적인 규칙을 먼저, '駅'(역) 같은 넓은 단어는 뒤에 둔다 (新宿駅前店 = 편의점이지 교통이 아니다)
const CATEGORY_RULES = [
  ['숙소', /ホテル|HOTEL|旅館|Airbnb|에어비앤비|INN\b|宿泊|호텔/i],
  ['간식·편의점', /セブン|SEVEN|7-ELEVEN|ファミリーマート|ファミマ|FAMILYMART|FAMILY MART|ローソン|LAWSON|ミニストップ|MINISTOP|まいばすけっと|コンビニ|NEWDAYS|편의점/i],
  ['쇼핑', /ドン・キホーテ|ドンキ|DON QUIJOTE|DONKI|マツモトキヨシ|マツキヨ|MATSUMOTO|ユニクロ|UNIQLO|GU\b|ALPEN|アルペン|ビックカメラ|BIC CAMERA|ヨドバシ|YODOBASHI|高島屋|TAKASHIMAYA|伊勢丹|ISETAN|百貨店|DUTY FREE|免税|무인양품|無印良品|MUJI|LOFT|ロフト|東急ハンズ|HANDS/i],
  ['식사', /レストラン|RESTAURANT|食堂|居酒屋|寿司|鮨|すし|ラーメン|らーめん|拉麺|焼肉|焼鳥|うどん|そば|蕎麦|定食|カフェ|CAFE|COFFEE|珈琲|スターバックス|STARBUCKS|ドトール|吉野家|松屋|すき家|マクドナルド|MCDONALD|KITCHEN|DINING|BAR\b|식당/i],
  ['관광', /美術館|博物館|MUSEUM|展望|SKY|入場|チケット|TICKET|観光|ロープウェイ|ケーブルカー|海賊船|温泉|ONSEN/i],
  ['교통', /JR|駅|Suica|SUICA|PASMO|タクシー|TAXI|택시|地下鉄|メトロ|METRO|バス|BUS|小田急|ODAKYU|ロマンスカー|京王|KEIO|新幹線|成田|N'EX|NEX|ETC|ガソリン|駐車|교통|지하철/i],
];

export function guessCategory(text) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return '기타';
}

// ── 영수증 한 장 ─────────────────────────────────────
const TOTAL_STRONG = /合計|お会計|御会計|総合計|お買上計|お買上げ計|お買い上げ計|ご請求|ご利用額|ご利用金額|お支払(?:い)?額|TOTAL|AMOUNT DUE|합계|결제금액/i;
const TOTAL_WEAK = /小計|現計|SUBTOTAL/i;
const NOT_TOTAL = /預り|預かり|釣|お返し|CHANGE|内消費税|消費税等?|税率|対象|点数|個数|ポイント|POINT|割引|値引|クーポン/i;
const NOISE_LINE = /TEL|電話|〒|FAX|登録番号|インボイス|No\.|NO\.|レジ|担当|責|伝票|会員|カード番号|承認番号|取引番号|端末/i;

function pickAmount(line) {
  const money = findMoney(line).filter((m) => m.value >= 1);
  if (!money.length) return null;
  // ¥·円이 붙은 숫자가 있으면 그것을, 없으면 쉼표가 있는 숫자를, 그것도 없으면 가장 큰 숫자를 쓴다
  const tagged = money.filter((m) => m.cur === 'JPY');
  if (tagged.length) return tagged[tagged.length - 1].value;
  const grouped = money.filter((m) => m.grouped);
  if (grouped.length) return grouped[grouped.length - 1].value;
  const plain = money.filter((m) => !/^\d{1,2}$/.test(m.text) || m.value >= 100);
  return plain.length ? Math.max(...plain.map((m) => m.value)) : null;
}

function merchantFrom(lines) {
  const SKIP = /領収|レシート|RECEIPT|いらっしゃい|ありがとう|THANK|WELCOME|毎度|またの|ご来店|お客様|控え|明細|영수증/i;
  for (const line of lines.slice(0, 6)) {
    if (SKIP.test(line) || NOISE_LINE.test(line)) continue;
    if (parseDate(line) || parseTime(line)) continue;
    const letters = line.replace(/[\d\s¥,.\-:/()#*]/g, '');
    if (letters.length < 2) continue;
    if (/^[\d\s¥,.\-:/()]+$/.test(line)) continue;
    return line.replace(/\s{2,}/g, ' ').slice(0, 40);
  }
  return '';
}

export function parseReceipt(text, today = new Date()) {
  const lines = linesOf(text);
  let total = null;
  let totalLine = '';
  for (const keys of [TOTAL_STRONG, TOTAL_WEAK]) {
    for (let i = 0; i < lines.length && total == null; i++) {
      const line = lines[i];
      if (!keys.test(line) || NOT_TOTAL.test(line)) continue;
      let amt = pickAmount(line.replace(keys, ' '));
      // 금액이 다음 줄로 넘어간 영수증
      if (amt == null && lines[i + 1] && !NOT_TOTAL.test(lines[i + 1])) amt = pickAmount(lines[i + 1]);
      if (amt != null) { total = amt; totalLine = line; }
    }
    if (total != null) break;
  }
  if (total == null) {
    // 합계 표시가 없으면 ¥·円이 붙은 금액 중 가장 큰 것 (받은 돈·거스름돈 줄은 뺀다)
    const cands = lines
      .filter((l) => !NOT_TOTAL.test(l) && !NOISE_LINE.test(l))
      .flatMap((l) => findMoney(l).filter((m) => m.cur === 'JPY'));
    if (cands.length) total = Math.max(...cands.map((m) => m.value));
  }
  let date = null;
  let time = null;
  for (const l of lines) {
    if (!date) date = parseDate(l, today);
    if (!time) time = parseTime(l);
    if (date && time) break;
  }
  const merchant = merchantFrom(lines);
  return {
    kind: 'receipt',
    merchant,
    amount: total,
    spentAt: toLocalInput(date, time),
    category: guessCategory(lines.join('\n')),
    totalLine,
  };
}

// ── 카드 내역 여러 건 (트래블월렛 등 앱 화면 캡처) ─────────
const BALANCE = /잔액|残高|BALANCE|보유|총액|합계|이번 ?달|월간|누적/i;
const TOPUP = /충전|환전|입금|チャージ|CHARGE|TOP ?UP|자동충전|받은/i;
const REFUND = /취소|환불|返金|キャンセル|REFUND|CANCEL|승인취소/i;
const STATUS = /^(결제|승인|완료|결제완료|승인완료|해외결제|국내결제|오프라인|온라인|체크카드|신용카드|트래블월렛|트래블카드|카드|일시불|매입|대기|처리중|JPY|KRW|USD|¥|원|엔|전체|지출|수입|이용내역|거래내역|내역|필터|오늘|어제)$/i;

const STATUS_WORD = /^(결제|승인|완료|취소|결제취소|승인취소|취소완료|환불|환불완료|결제완료|승인완료|해외결제|국내결제|오프라인|온라인|체크카드|신용카드|트래블월렛|트래블카드|카드|일시불|매입|대기|처리중|JPY|KRW|USD|이용|사용)$/i;

// 시각·날짜·상태 단어·기호를 걷어낸 뒤에도 글자가 두 자 이상 남으면 가게 이름 후보로 본다
function textContent(line) {
  let s = line;
  const t = parseTime(s); if (t) s = s.replace(t.raw, ' ');
  const d = parseDate(s); if (d) s = s.replace(d.raw, ' ');
  s = s.replace(/\((?:[월화수목금토일]|[月火水木金土日])\)/g, ' ');
  return s.split(/[\s·•|,]+/).filter((w) => w && !STATUS_WORD.test(w)).join(' ').trim();
}

function isTextLine(line) {
  if (!line || STATUS.test(line) || BALANCE.test(line)) return false;
  const rest = textContent(line);
  const letters = rest.replace(/[\d\s¥₩,.\-+:/()#*원엔円]/g, '');
  return letters.length >= 2;
}

export function parseCardList(text, today = new Date()) {
  const lines = linesOf(text);
  const items = [];
  let curDate = null;
  const used = new Set();
  const usedTime = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const d = parseDate(line, today);
    const money = findMoney(line);
    const yen = money.filter((m) => m.cur === 'JPY');
    if (d && !yen.length) { curDate = d; continue; }
    if (BALANCE.test(line)) continue;
    // ¥·円이 붙은 금액만 지출로 본다. 원화 환산액(₩·원)은 무시한다.
    if (!yen.length) continue;
    const m = yen[0];

    // 가게 이름: 같은 줄에 글자가 있으면 그것, 없으면 위로 세 줄 안의 글자 줄
    let merchant = textContent(line.slice(0, m.index)).replace(/[\s:·•|-]+$/, '').trim();
    let mIdx = i;
    if (!isTextLine(merchant)) {
      merchant = '';
      for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
        if (used.has(k)) break;
        if (findMoney(lines[k]).some((x) => x.cur === 'JPY')) break;
        if (isTextLine(lines[k])) { merchant = textContent(lines[k]); mIdx = k; break; }
      }
    }
    if (mIdx !== i) used.add(mIdx);
    used.add(i);

    // 시각: 같은 줄 → 가게 줄과 금액 줄 사이 → 바로 아랫줄(시각으로 시작할 때) 순서로, 이미 쓴 시각은 다시 쓰지 않는다
    let time = parseTime(line);
    const startsWithTime = (k) => lines[k] && /^\d{1,2}:\d{2}/.test(lines[k]) && !usedTime.has(k);
    if (!time) for (let k = mIdx; k < i && !time; k++) if (!usedTime.has(k) && parseTime(lines[k])) { time = parseTime(lines[k]); usedTime.add(k); }
    if (!time && startsWithTime(i + 1)) { time = parseTime(lines[i + 1]); usedTime.add(i + 1); }
    // 금액 아랫줄은 "취소됨" 같은 상태 표시일 때만 함께 본다 (다음 가게 이름이 섞이지 않게)
    const next = lines[i + 1] && !isTextLine(lines[i + 1]) ? lines[i + 1] : '';
    const ctx = [...lines.slice(mIdx, i + 1), next].join(' ');
    const dateHere = d || curDate;
    const merchantClean = merchant.replace(/\s{2,}/g, ' ').replace(/^[·•\-\s]+/, '').slice(0, 40);
    let kind = 'expense';
    if (TOPUP.test(ctx) && !REFUND.test(ctx)) kind = 'topup';
    else if (REFUND.test(ctx)) kind = 'refund';
    items.push({
      merchant: merchantClean || '(가게 이름 없음)',
      amount: m.value,
      kind,
      spentAt: toLocalInput(dateHere, time),
      category: guessCategory(merchantClean),
    });
  }
  return { kind: 'card', items };
}

// 글자 덩어리를 보고 영수증인지 카드 내역인지 먼저 추측한다. 화면에서 바꿀 수 있다.
export function detectKind(text) {
  const lines = linesOf(text);
  if (lines.some((l) => TOTAL_STRONG.test(l) && !/결제금액/.test(l))) return 'receipt';
  const yenLines = lines.filter((l) => findMoney(l).some((m) => m.cur === 'JPY') && !BALANCE.test(l));
  return yenLines.length >= 2 ? 'card' : 'receipt';
}
