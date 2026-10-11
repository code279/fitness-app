import { createApi, createDemoApi } from './api.js';
import { CATEGORIES, CATEGORY_ICON, TESSERACT_URL } from './config.js';
import { icon } from './icons.js';
import { parseReceipt, parseCardList, detectKind } from './parse.js';

// ── 준비 ─────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const DEV = params.has('dev') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname); // 개발용: 글자인식 파일을 로컬에서
const api = DEMO ? createDemoApi() : createApi();
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 사파리 사생활 보호 모드 */ } },
};
const K = { code: 'tb.code', my: 'tb.myWallet' };

const S = {
  code: null,
  data: null,
  loading: false,
  loadError: null,
  tab: 'home',
  my: store.get(K.my),
  entry: { mode: 'manual', draft: null, text: '', kind: null, receipt: null, items: [], cardWallet: null, ocr: null, photoKind: null },
  filter: { wallet: 'all', category: 'all' },
  topup: { wallet: null, amount: '', note: '', date: '' },
  sheet: null,
  busy: false,
};

// ── 도우미 ───────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const nowLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayKey = (iso) => todayStr(new Date(iso));
const toIso = (local) => (local ? new Date(local).toISOString() : null);
const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const shortWhen = (local) => { const [d, t] = local.split('T'); const [, m, dd] = d.split('-').map(Number); return `${m}/${dd} ${t}`; };
const fmtDay = (key) => { const [y, m, d] = key.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return `${m}월 ${d}일 (${WEEK[w]})`; };

function money(n, cur) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toLocaleString('ko-KR');
  return cur === 'KRW' ? `${v < 0 ? '−' : ''}${s}원` : `${v < 0 ? '−' : ''}¥${s}`;
}
const wallets = () => (S.data ? S.data.wallets : []);
const walletById = (id) => wallets().find((w) => w.id === id);
const curOf = (id) => (walletById(id) || {}).currency || 'JPY';
const methodsFor = (w) => (!w ? [] : w.kind === 'account' ? ['체크카드', '이체'] : w.kind === 'cash' ? ['현금'] : ['카드']);
const walletIcon = (w) => (w.kind === 'card' ? 'credit-card' : w.kind === 'cash' ? 'banknote' : 'landmark');
function defaultCategory(w) {
  const p = (w && w.purpose) || '';
  if (/교통|숙소/.test(p)) return '교통';
  if (/식|먹/.test(p)) return '식사';
  return '기타';
}
function defaultWalletId() {
  if (S.my && walletById(S.my)) return S.my;
  const card = wallets().find((w) => w.kind === 'card');
  return (card || wallets()[0] || {}).id || null;
}
function newDraft(extra = {}) {
  const wid = defaultWalletId();
  const w = walletById(wid);
  return { walletId: wid, method: methodsFor(w)[0] || null, category: defaultCategory(w), item: '', amount: '', spentAt: nowLocal(), memo: '', source: 'manual', ...extra };
}

let toastTimer;
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, bad ? 4200 : 2400);
}

async function run(fn, okMsg) {
  if (S.busy) return false;
  S.busy = true;
  document.body.classList.add('busy');
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await load(true);
    return true;
  } catch (e) {
    toast(e.message || '처리하지 못했습니다', true);
    return false;
  } finally {
    S.busy = false;
    document.body.classList.remove('busy');
  }
}

// ── 데이터 불러오기 ──────────────────────────────────
async function load(quiet = false) {
  if (!S.code) return;
  if (!quiet) { S.loading = true; render(); }
  try {
    S.data = await api.call('trip_load', { p_code: S.code });
    S.loadError = null;
    store.set(K.code, S.code);
    if (S.my && !walletById(S.my)) { S.my = null; store.set(K.my, null); }
  } catch (e) {
    S.loadError = e.message;
    if (/여행 코드/.test(e.message)) { store.set(K.code, null); S.data = null; }
  } finally {
    S.loading = false;
  }
  if (!S.entry.draft && S.data) S.entry.draft = newDraft();
  // 입력 중인 화면은 다시 그리지 않는다 (글자를 치던 중에 커서가 튀지 않게)
  if (!quiet || (S.tab !== 'entry' && !S.sheet)) render();
  else renderHeaderOnly();
}

// ── 화면 ─────────────────────────────────────────────
function render() {
  const app = $('#app');
  if (!S.code || (!S.data && S.loadError)) { app.innerHTML = viewCode(); $('#sheet').innerHTML = ''; return; }
  if (!S.data) { app.innerHTML = `<div class="center"><div class="spinner"></div><p>불러오는 중…</p></div>`; return; }
  const view = { home: viewHome, entry: viewEntry, history: viewHistory, topup: viewTopup }[S.tab]();
  app.innerHTML = `${viewHeader()}<main class="main">${view}</main>${viewTabs()}`;
  renderSheet();
}

function renderHeaderOnly() {
  const h = $('#hdr');
  if (h) h.outerHTML = viewHeader();
}

function viewHeader() {
  return `<header class="hdr" id="hdr">
    <div class="hdr-t">${esc(S.data.trip.name)}</div>
    <button class="icon-btn" data-act="reload" aria-label="새로 불러오기">${icon('refresh-cw')}</button>
    <button class="icon-btn" data-act="settings" aria-label="설정">${icon('settings')}</button>
    ${DEMO || S.loadError ? `<div class="banner${S.loadError ? ' bad' : ''}">${S.loadError ? esc(S.loadError) : '체험 모드 · 예시 데이터 (실제 기록과 무관)'}</div>` : ''}
  </header>`;
}

function viewTabs() {
  const t = (id, ic, label) => `<button class="tab${S.tab === id ? ' on' : ''}" data-act="tab" data-tab="${id}">${icon(ic, 24)}<span>${label}</span></button>`;
  return `<nav class="tabs">${t('home', 'house', '홈')}${t('entry', 'pencil-line', '입력')}${t('history', 'list-ordered', '내역')}${t('topup', 'piggy-bank', '충전')}</nav>`;
}

function viewCode() {
  return `<div class="center code-screen">
    <div class="logo">${icon('wallet', 40)}</div>
    <h1>여행 예산</h1>
    <p class="muted">일행 단톡방에 올라온 <b>초대 링크</b>를 눌러 들어오세요.<br>링크 대신 여행 코드를 직접 넣어도 됩니다.</p>
    ${S.loadError ? `<p class="err">${esc(S.loadError)}</p>` : ''}
    <form data-form="code" class="stack">
      <input name="code" class="inp big" placeholder="여행 코드 또는 초대 링크" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn primary big">들어가기</button>
    </form>
  </div>`;
}

function walletCard(w) {
  const remain = Number(w.total) - Number(w.spent);
  const neg = remain < 0;
  const empty = Number(w.total) === 0 && Number(w.spent) === 0;
  const pct = w.total > 0 ? Math.min(100, Math.max(0, (w.spent / w.total) * 100)) : 0;
  const sub = [S.my === w.id ? '내 카드' : '', w.holder, w.purpose].filter(Boolean).join(' · ');
  return `<div class="wcard${neg ? ' neg' : ''}${S.my === w.id ? ' mine' : ''}">
    <div class="wtop">
      <span class="wic k-${w.kind}">${icon(walletIcon(w), 20)}</span>
      <div class="wname"><b>${esc(w.label)}</b>${sub ? `<small${S.my === w.id ? ' class="mine-t"' : ''}>${esc(sub)}</small>` : ''}</div>
    </div>
    ${empty
      ? `<div class="wempty">아직 충전 기록이 없습니다 <button class="link" data-act="go-topup" data-wallet="${w.id}">충전 넣기 ›</button></div>`
      : `<div class="wremain"><small>남은 돈</small><strong>${money(remain, w.currency)}</strong></div>
         <div class="bar"><i style="width:${pct}%"></i></div>
         <div class="wmeta"><span>보유 ${money(w.total, w.currency)}</span><span>사용 ${money(w.spent, w.currency)}</span></div>
         ${neg ? `<div class="warn-row">${icon('triangle-alert', 18)} 쓴 돈이 충전한 돈보다 많습니다 <button class="btn sm danger" data-act="go-topup" data-wallet="${w.id}">충전 추가</button></div>` : ''}`}
  </div>`;
}

function expenseRow(e) {
  const w = walletById(e.wallet_id) || {};
  const tag = e.source === 'receipt' ? '영수증' : e.source === 'card_capture' ? '카드내역' : '';
  return `<button class="erow" data-act="edit" data-id="${e.id}">
    <span class="cic">${icon(CATEGORY_ICON[e.category] || 'ellipsis', 20)}</span>
    <span class="emain"><b>${esc(e.item)}</b><small>${fmtTime(e.spent_at)} · ${esc(w.label || '')}${e.method && w.kind === 'account' ? ` · ${esc(e.method)}` : ''}${tag ? ` · ${tag}` : ''}${e.memo ? ` · ${esc(e.memo)}` : ''}</small></span>
    <span class="eamt${e.amount < 0 ? ' plus' : ''}">${money(e.amount, w.currency)}</span>
  </button>`;
}

function sumByCurrency(list) {
  const out = { JPY: 0, KRW: 0 };
  for (const e of list) out[curOf(e.wallet_id)] += Number(e.amount);
  return out;
}

function viewHome() {
  const today = S.data.expenses.filter((e) => dayKey(e.spent_at) === todayStr());
  const ts = sumByCurrency(today);
  const recent = S.data.expenses.slice(0, 5);
  return `
    <section class="cards">${wallets().map(walletCard).join('')}</section>
    <section class="panel">
      <div class="ph"><h2>오늘 쓴 돈</h2><span class="muted">${today.length}건</span></div>
      <div class="today"><strong>${money(ts.JPY, 'JPY')}</strong>${ts.KRW ? `<strong>${money(ts.KRW, 'KRW')}</strong>` : ''}</div>
    </section>
    <section class="panel">
      <div class="ph"><h2>최근 내역</h2><button class="link" data-act="tab" data-tab="history">전체 보기 ›</button></div>
      ${recent.length ? recent.map(expenseRow).join('') : '<p class="muted pad">아직 지출이 없습니다.</p>'}
    </section>`;
}

// ── 입력 ─────────────────────────────────────────────
function chips(name, options, current, extra = '') {
  const cls = /class="([^"]+)"/.exec(extra);
  const rest = extra.replace(/class="[^"]+"/, '');
  return `<div class="chips${cls ? ` ${cls[1]}` : ''}" ${rest}>${options.map(([val, label, ic]) =>
    `<button type="button" class="chip${val === current ? ' on' : ''}" data-act="pick" data-name="${name}" data-val="${esc(val)}">${ic ? icon(ic, 18) : ''}${esc(label)}</button>`).join('')}</div>`;
}

function expenseForm(d, { mode = 'new', hint = '' } = {}) {
  const w = walletById(d.walletId);
  const cur = w ? w.currency : 'JPY';
  const methods = methodsFor(w);
  return `<form data-form="${mode === 'edit' ? 'edit' : 'expense'}" class="stack form">
    ${hint ? `<div class="hint">${hint}</div>` : ''}
    <label class="lbl">어디서 냈나요</label>
    ${chips('walletId', wallets().map((x) => [x.id, x.label, walletIcon(x)]), d.walletId)}
    ${methods.length > 1 ? `<label class="lbl">결제수단</label>${chips('method', methods.map((m) => [m, m]), d.method)}` : ''}
    <label class="lbl">분류</label>
    ${chips('category', CATEGORIES.map((c) => [c, c, CATEGORY_ICON[c]]), d.category)}
    <label class="lbl" for="f-item">품명</label>
    <input id="f-item" class="inp" name="item" value="${esc(d.item)}" placeholder="예: 라멘, 택시, 편의점" maxlength="100" autocomplete="off">
    <label class="lbl" for="f-amount">금액</label>
    <div class="amount">
      <input id="f-amount" class="inp big" name="amount" value="${esc(d.amount)}" inputmode="numeric" placeholder="0" autocomplete="off">
      <span class="unit">${cur === 'KRW' ? '원' : '엔'}</span>
    </div>
    <label class="lbl" for="f-at">날짜 · 시각</label>
    <input id="f-at" class="inp" type="datetime-local" name="spentAt" value="${esc(d.spentAt)}">
    <label class="lbl" for="f-memo">비고 <small class="muted">(선택)</small></label>
    <input id="f-memo" class="inp" name="memo" value="${esc(d.memo)}" maxlength="200" autocomplete="off">
    ${mode === 'edit'
      ? `<div class="row2"><button type="button" class="btn danger-ghost" data-act="delete-expense">${icon('trash-2', 18)} 삭제</button><button class="btn primary">수정 저장</button></div>`
      : `<button class="btn primary big">${icon('check', 20)} 저장하기</button>`}
  </form>`;
}

function viewEntry() {
  const E = S.entry;
  if (!E.draft) E.draft = newDraft();
  const seg = chips('entryMode', [['manual', '직접 입력', 'pencil-line'], ['paste', '붙여넣기', 'clipboard-paste'], ['photo', '사진 인식', 'camera']], E.mode, 'class="seg" role="tablist"');
  let body = '';
  if (E.mode === 'manual') body = expenseForm(E.draft);
  if (E.mode === 'paste') body = viewPaste();
  if (E.mode === 'photo') body = viewPhoto();
  return `<section class="panel"><h2 class="mb">지출 입력</h2>${seg}</section><section class="panel">${body}</section>`;
}

function viewPaste() {
  const E = S.entry;
  return `<div class="stack">
    <div class="guide">
      <b>사진 속 글자를 복사해서 붙여넣어 주세요</b>
      <ol><li>사진 앱에서 영수증이나 카드 내역 캡처를 엽니다</li>
      <li>글자를 길게 누르고 <b>모두 선택 → 복사</b> (아이폰 라이브 텍스트 / 안드로이드 구글 렌즈)</li>
      <li>아래 <b>붙여넣기</b>를 누릅니다</li></ol>
    </div>
    <button class="btn primary big" data-act="paste-clip">${icon('clipboard-paste', 20)} 붙여넣기</button>
    <textarea class="inp area" data-bind="entryText" placeholder="여기에 길게 눌러 붙여넣어도 됩니다">${esc(E.text)}</textarea>
    <button class="btn" data-act="parse-text">${icon('receipt-text', 20)} 글자 읽기</button>
    ${E.kind ? viewParsed() : ''}
  </div>`;
}

function viewPhoto() {
  const E = S.entry;
  const o = E.ocr;
  return `<div class="stack">
    <div class="guide"><b>무엇을 찍었나요?</b> 고르면 맞는 글자 인식으로 읽습니다.</div>
    ${chips('photoKind', [['receipt', '영수증 사진', 'receipt-text'], ['card', '카드 내역 캡처', 'credit-card']], E.photoKind)}
    ${E.photoKind ? `<label class="btn primary big file">${icon('camera', 20)} 사진 고르기 · 찍기
      <input type="file" accept="image/*" data-act="photo-file" hidden></label>
      <p class="muted small">처음 한 번은 글자 인식 파일(약 5MB)을 내려받습니다. 와이파이에서 미리 한 번 해 두시면 좋습니다.</p>` : ''}
    ${o && o.status === 'run' ? `<div class="ocr"><div class="spinner sm"></div><span>${esc(o.label)}</span><div class="bar"><i style="width:${Math.round(o.progress * 100)}%"></i></div></div>` : ''}
    ${o && o.status === 'err' ? `<p class="err">${esc(o.label)}</p>` : ''}
    ${E.kind ? `<details class="raw"><summary>읽은 글자 보기 · 고치기</summary>
        <textarea class="inp area" data-bind="entryText">${esc(E.text)}</textarea>
        <button class="btn sm" data-act="parse-text">다시 읽기</button></details>${viewParsed()}` : ''}
  </div>`;
}

function viewParsed() {
  const E = S.entry;
  const toggle = chips('entryKind', [['receipt', '영수증 한 장'], ['card', '카드 내역 여러 건']], E.kind);
  if (E.kind === 'receipt') {
    const r = E.receipt || {};
    const hint = r.amount == null
      ? '합계를 찾지 못했습니다. 금액을 직접 넣어 주세요.'
      : `읽은 합계 <b>${money(r.amount, 'JPY')}</b>${r.totalLine ? ` <small>(“${esc(r.totalLine)}” 줄)</small>` : ''} — 영수증과 맞는지 확인하고 저장하세요.`;
    return `<div class="stack parsed">${toggle}${expenseForm(E.draft, { hint })}</div>`;
  }
  const cards = wallets().filter((w) => w.currency === 'JPY');
  if (!E.cardWallet || !walletById(E.cardWallet)) E.cardWallet = (walletById(S.my) && walletById(S.my).currency === 'JPY') ? S.my : (cards[0] || {}).id;
  const sel = E.items.filter((x) => x.on);
  const total = sel.reduce((a, x) => a + (Number(x.amount) || 0) * (x.kind === 'refund' ? -1 : 1), 0);
  return `<div class="stack parsed">${toggle}
    <label class="lbl">어느 카드 내역인가요</label>
    ${chips('cardWallet', cards.map((x) => [x.id, x.label, walletIcon(x)]), E.cardWallet)}
    ${E.items.length ? '' : '<p class="err">¥ 금액이 붙은 줄을 찾지 못했습니다. 글자를 다시 확인해 주세요.</p>'}
    <div class="items">${E.items.map((x, i) => `
      <div class="item${x.on ? ' on' : ''}${x.kind !== 'expense' ? ' odd' : ''}">
        <label class="tick"><input type="checkbox" data-act="item-on" data-i="${i}" ${x.on ? 'checked' : ''}><span></span></label>
        <div class="ibody">
          <input class="inp sm" data-item="${i}" data-field="merchant" value="${esc(x.merchant)}" maxlength="100">
          <div class="irow">
            <select class="inp sm" data-item="${i}" data-field="category">${CATEGORIES.map((c) => `<option${c === x.category ? ' selected' : ''}>${c}</option>`).join('')}</select>
            <div class="amount sm"><span class="pre">¥</span><input class="inp sm num" data-item="${i}" data-field="amount" value="${esc(x.amount)}" inputmode="numeric" aria-label="금액"></div>
          </div>
          <small class="muted">${x.spentAt ? esc(shortWhen(x.spentAt)) : '날짜 없음 → 오늘로 저장'}
            ${x.dup ? '<span class="pill warn">이미 입력됨</span>' : ''}
            ${x.kind === 'topup' ? '<span class="pill">충전 — 충전 탭에 넣으세요</span>' : ''}
            ${x.kind === 'refund' ? '<span class="pill">취소·환불 (−) — 원래 결제가 앱에 있을 때만 체크</span>' : ''}</small>
        </div>
      </div>`).join('')}</div>
    ${E.items.length ? `<button class="btn primary big" data-act="save-items" ${sel.length ? '' : 'disabled'}>${icon('check', 20)} 선택한 ${sel.length}건 저장 · ${money(total, 'JPY')}</button>` : ''}
  </div>`;
}

function markDuplicates(items, walletId) {
  const ex = S.data.expenses.filter((e) => e.wallet_id === walletId);
  for (const it of items) {
    const sign = it.kind === 'refund' ? -1 : 1;
    const key = it.spentAt ? it.spentAt.slice(0, 10) : todayStr();
    const t = new Date(`${key}T12:00`).getTime();
    it.dup = ex.some((e) => Number(e.amount) === sign * Number(it.amount)
      && Math.abs(new Date(`${dayKey(e.spent_at)}T12:00`).getTime() - t) <= 86400000);
    it.on = it.kind === 'expense' && !it.dup;
  }
}

function applyText(text, forceKind) {
  const E = S.entry;
  E.text = text;
  if (!text.trim()) { toast('읽을 글자가 없습니다', true); return; }
  E.kind = forceKind || detectKind(text);
  if (E.kind === 'receipt') {
    const r = parseReceipt(text);
    E.receipt = r;
    const base = newDraft();
    E.draft = { ...base, item: r.merchant || '', amount: r.amount != null ? String(r.amount) : '', spentAt: r.spentAt || base.spentAt, category: r.category !== '기타' ? r.category : base.category, source: 'receipt' };
  } else {
    E.items = parseCardList(text).items;
    const cards = wallets().filter((w) => w.currency === 'JPY');
    if (!E.cardWallet || !walletById(E.cardWallet)) {
      E.cardWallet = (walletById(S.my) && walletById(S.my).currency === 'JPY') ? S.my : (cards[0] || {}).id;
    }
    markDuplicates(E.items, E.cardWallet);
  }
  render();
}

// ── 사진 글자 인식 ───────────────────────────────────
let tess = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('글자 인식 프로그램을 받지 못했습니다. 인터넷 연결을 확인해 주세요'));
    document.head.appendChild(s);
  });
}
async function getWorker(kind) {
  const langs = kind === 'card' ? ['kor', 'jpn', 'eng'] : ['jpn', 'eng'];
  const key = langs.join('+');
  if (tess && tess.key === key) return tess.worker;
  if (tess) { await tess.worker.terminate(); tess = null; }
  await loadScript(DEV ? '/vendor/tesseract/tesseract.min.js' : TESSERACT_URL);
  const opts = {
    logger: (m) => {
      const o = S.entry.ocr;
      if (!o || o.status !== 'run') return;
      o.progress = typeof m.progress === 'number' ? m.progress : o.progress;
      o.label = m.status === 'recognizing text' ? '글자 읽는 중' : '글자 인식 준비 중 (처음엔 조금 걸립니다)';
      const bar = document.querySelector('.ocr .bar i'); const lab = document.querySelector('.ocr span');
      if (bar) bar.style.width = `${Math.round(o.progress * 100)}%`;
      if (lab) lab.textContent = o.label;
    },
  };
  if (DEV) Object.assign(opts, { workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract-core', langPath: '/vendor/lang' });
  const worker = await window.Tesseract.createWorker(langs, 1, opts);
  tess = { key, worker };
  return worker;
}

// 큰 사진은 줄이고 흑백으로 바꿔 글자를 또렷하게 한다
async function prepImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const v = Math.max(0, Math.min(255, (y - 128) * 1.25 + 128));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

async function ocrPhoto(file) {
  const E = S.entry;
  E.ocr = { status: 'run', progress: 0, label: '사진 준비 중' };
  E.kind = null;
  render();
  try {
    const canvas = await prepImage(file);
    const worker = await getWorker(E.photoKind);
    const { data } = await worker.recognize(canvas);
    E.ocr = null;
    applyText(data.text || '', E.photoKind);
  } catch (e) {
    E.ocr = { status: 'err', label: e.message || '사진을 읽지 못했습니다' };
    render();
  }
}

// ── 내역 ─────────────────────────────────────────────
function viewHistory() {
  const F = S.filter;
  const list = S.data.expenses.filter((e) => (F.wallet === 'all' || e.wallet_id === F.wallet) && (F.category === 'all' || e.category === F.category));
  const groups = new Map();
  for (const e of list) { const k = dayKey(e.spent_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const all = sumByCurrency(list);
  return `<section class="panel">
      <h2 class="mb">내역</h2>
      ${chips('fWallet', [['all', '전체'], ...wallets().map((w) => [w.id, w.label])], F.wallet)}
      ${chips('fCategory', [['all', '모든 분류'], ...CATEGORIES.map((c) => [c, c])], F.category)}
      <div class="total-line">합계 <b>${money(all.JPY, 'JPY')}</b>${all.KRW ? ` · <b>${money(all.KRW, 'KRW')}</b>` : ''} <span class="muted">(${list.length}건)</span></div>
    </section>
    ${[...groups].map(([k, arr]) => { const s = sumByCurrency(arr); return `<section class="panel">
      <div class="ph"><h3>${fmtDay(k)}</h3><span class="muted">${money(s.JPY, 'JPY')}${s.KRW ? ` · ${money(s.KRW, 'KRW')}` : ''}</span></div>
      ${arr.map(expenseRow).join('')}</section>`; }).join('') || '<section class="panel"><p class="muted pad">조건에 맞는 내역이 없습니다.</p></section>'}`;
}

// ── 충전 ─────────────────────────────────────────────
function viewTopup() {
  const T = S.topup;
  if (!T.wallet || !walletById(T.wallet)) T.wallet = defaultWalletId();
  if (!T.date) T.date = todayStr();
  const w = walletById(T.wallet);
  return `<section class="panel">
      <h2 class="mb">충전 · 환전 기록</h2>
      <form data-form="topup" class="stack form">
        ${chips('topupWallet', wallets().map((x) => [x.id, x.label, walletIcon(x)]), T.wallet)}
        <label class="lbl" for="t-amt">금액</label>
        <div class="amount"><input id="t-amt" class="inp big" name="amount" value="${esc(T.amount)}" inputmode="numeric" placeholder="0"><span class="unit">${w && w.currency === 'KRW' ? '원' : '엔'}</span></div>
        <label class="lbl" for="t-note">내역</label>
        <input id="t-note" class="inp" name="note" value="${esc(T.note)}" placeholder="예: 1차 충전, 렌트카 충전" maxlength="60">
        <label class="lbl" for="t-date">날짜</label>
        <input id="t-date" class="inp" type="date" name="date" value="${esc(T.date)}">
        <button class="btn primary big">${icon('plus', 20)} 충전 기록 추가</button>
      </form>
    </section>
    ${wallets().map((x) => { const rows = S.data.topups.filter((t) => t.wallet_id === x.id); return `<section class="panel">
      <div class="ph"><h3>${esc(x.label)}</h3><span class="muted">보유 ${money(x.total, x.currency)}</span></div>
      ${rows.length ? rows.map((t) => `<div class="trow"><span>${esc(t.topped_on.slice(5).replace('-', '/'))}</span><span class="grow">${esc(t.note || '')}</span><b>${money(t.amount, x.currency)}</b>
        <button class="icon-btn sm" data-act="del-topup" data-id="${t.id}" aria-label="삭제">${icon('trash-2', 18)}</button></div>`).join('') : '<p class="muted pad">기록 없음</p>'}
    </section>`; }).join('')}`;
}

// ── 시트 (수정 · 설정) ───────────────────────────────
function renderSheet() {
  const el = $('#sheet');
  if (!S.sheet) { el.innerHTML = ''; document.body.classList.remove('locked'); return; }
  document.body.classList.add('locked');
  const inner = S.sheet.type === 'edit' ? viewEdit() : viewSettings();
  el.innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="sh-h"><h2>${S.sheet.type === 'edit' ? '지출 수정' : '설정'}</h2><button class="icon-btn" data-act="close-sheet" aria-label="닫기">${icon('x')}</button></div>
    <div class="sh-b">${inner}</div></div>`;
}

function viewEdit() {
  return expenseForm(S.sheet.draft, { mode: 'edit' });
}

function viewSettings() {
  const link = `${location.origin}${location.pathname}#${S.code}`;
  return `<div class="stack">
    <label class="lbl">내 카드 <small class="muted">— 이 휴대폰에서 입력할 때 미리 골라 둡니다</small></label>
    ${chips('my', [['', '정하지 않음'], ...wallets().map((w) => [w.id, w.label, walletIcon(w)])], S.my || '')}
    <label class="lbl">지갑 이름 · 담당자 · 용도</label>
    ${wallets().map((w) => `<form data-form="wallet" data-id="${w.id}" class="wedit">
      <input class="inp sm" name="label" value="${esc(w.label)}" maxlength="30" aria-label="지갑 이름">
      <div class="irow"><input class="inp sm" name="holder" value="${esc(w.holder || '')}" placeholder="담당자" maxlength="20"><input class="inp sm" name="purpose" value="${esc(w.purpose || '')}" placeholder="용도" maxlength="40"></div>
      <button class="btn sm">저장</button></form>`).join('')}
    <label class="lbl">일행 초대 링크</label>
    <div class="hint">이 링크를 가진 사람은 누구나 보고 쓸 수 있습니다. <b>일행 단톡방에만</b> 올려 주세요.</div>
    <button class="btn" data-act="copy-link" data-link="${esc(link)}">${icon('copy', 18)} 초대 링크 복사</button>
    <p class="muted small">홈 화면에 추가: 아이폰은 사파리 공유 버튼 → "홈 화면에 추가", 안드로이드는 크롬 메뉴 → "홈 화면에 추가".</p>
    <button class="btn ghost" data-act="forget">다른 여행 코드로 들어가기</button>
  </div>`;
}

// ── 이벤트 ───────────────────────────────────────────
function readForm(form) {
  const f = Object.fromEntries(new FormData(form));
  return f;
}
const parseAmount = (v) => Number(String(v).replace(/[^\d-]/g, ''));

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'photo-file') return;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') return;
  const E = S.entry;
  switch (act) {
    case 'tab': S.tab = el.dataset.tab; window.scrollTo(0, 0); render(); break;
    case 'reload': await load(); toast('새로 불러왔습니다'); break;
    case 'settings': S.sheet = { type: 'settings' }; renderSheet(); break;
    case 'close-sheet': S.sheet = null; render(); break;
    case 'go-topup': S.topup.wallet = el.dataset.wallet; S.tab = 'topup'; render(); break;
    case 'edit': {
      const e = S.data.expenses.find((x) => x.id === el.dataset.id);
      if (!e) return;
      S.sheet = { type: 'edit', id: e.id, draft: { walletId: e.wallet_id, method: e.method, category: e.category, item: e.item, amount: String(e.amount), spentAt: nowLocal(new Date(e.spent_at)), memo: e.memo || '', source: e.source } };
      renderSheet();
      break;
    }
    case 'pick': {
      const { name, val } = el.dataset;
      const d = S.sheet && S.sheet.type === 'edit' ? S.sheet.draft : E.draft;
      if (name === 'walletId') { const w = walletById(val); d.walletId = val; if (!methodsFor(w).includes(d.method)) d.method = methodsFor(w)[0]; }
      else if (name === 'method' || name === 'category') d[name] = val;
      else if (name === 'entryMode') { E.mode = val; if (val === 'manual') { E.draft = newDraft(); } E.kind = null; E.text = ''; E.items = []; E.ocr = null; }
      else if (name === 'entryKind') { applyText(E.text, val); return; }
      else if (name === 'photoKind') { E.photoKind = val; E.kind = null; E.ocr = null; }
      else if (name === 'cardWallet') { E.cardWallet = val; markDuplicates(E.items, val); }
      else if (name === 'fWallet') S.filter.wallet = val;
      else if (name === 'fCategory') S.filter.category = val;
      else if (name === 'topupWallet') S.topup.wallet = val;
      else if (name === 'my') { S.my = val || null; store.set(K.my, S.my); E.draft = null; toast(val ? `내 카드: ${walletById(val).label}` : '내 카드를 비웠습니다'); }
      if (S.sheet) renderSheet(); if (!S.sheet || name === 'my') render();
      break;
    }
    case 'paste-clip': {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('복사된 글자가 없습니다', true); return; }
        applyText(t);
      } catch {
        toast('붙여넣기 권한이 없습니다. 아래 칸을 길게 눌러 붙여넣어 주세요', true);
      }
      break;
    }
    case 'parse-text': applyText(E.text, E.mode === 'photo' ? E.photoKind : null); break;
    case 'save-items': {
      const rows = E.items.filter((x) => x.on).map((x) => ({
        wallet_id: E.cardWallet, method: '카드', category: x.category, item: String(x.merchant).trim(),
        amount: parseAmount(x.amount) * (x.kind === 'refund' ? -1 : 1), spent_at: toIso(x.spentAt), source: 'card_capture',
      }));
      if (rows.some((r) => !r.item || !r.amount)) { toast('품명과 금액이 빈 줄이 있습니다', true); return; }
      const ok = await run(() => api.call('trip_add_expenses', { p_code: S.code, p_items: rows }), `${rows.length}건 저장했습니다`);
      if (ok) { E.kind = null; E.items = []; E.text = ''; S.tab = 'home'; render(); }
      break;
    }
    case 'delete-expense': {
      if (!confirm('이 지출을 삭제할까요?')) return;
      const ok = await run(() => api.call('trip_delete_expense', { p_code: S.code, p_id: S.sheet.id }), '삭제했습니다');
      if (ok) { S.sheet = null; render(); }
      break;
    }
    case 'del-topup': {
      if (!confirm('이 충전 기록을 삭제할까요?')) return;
      await run(() => api.call('trip_delete_topup', { p_code: S.code, p_id: el.dataset.id }), '삭제했습니다');
      break;
    }
    case 'copy-link': {
      try { await navigator.clipboard.writeText(el.dataset.link); toast('초대 링크를 복사했습니다'); }
      catch { prompt('아래 링크를 길게 눌러 복사해 주세요', el.dataset.link); }
      break;
    }
    case 'forget': {
      if (!confirm('이 휴대폰에서 지금 여행 코드를 지울까요? (데이터는 지워지지 않습니다)')) return;
      store.set(K.code, null); S.code = null; S.data = null; S.sheet = null; history.replaceState(null, '', location.pathname + location.search); render();
      break;
    }
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.act === 'photo-file' && t.files && t.files[0]) { ocrPhoto(t.files[0]); t.value = ''; return; }
  if (t.dataset.act === 'item-on') { S.entry.items[Number(t.dataset.i)].on = t.checked; render(); return; }
  if (t.dataset.item != null) { S.entry.items[Number(t.dataset.item)][t.dataset.field] = t.value; if (t.dataset.field === 'amount') render(); }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.bind === 'entryText') { S.entry.text = t.value; return; }
  if (t.dataset.item != null && t.dataset.field !== 'category') { S.entry.items[Number(t.dataset.item)][t.dataset.field] = t.value; return; }
  const form = t.closest('form');
  if (!form || !t.name) return;
  const kind = form.dataset.form;
  if (kind === 'expense') S.entry.draft[t.name] = t.value;
  else if (kind === 'edit') S.sheet.draft[t.name] = t.value;
  else if (kind === 'topup') S.topup[t.name] = t.value;
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  const kind = form.dataset.form;
  if (!kind) return;
  ev.preventDefault();
  if (kind === 'code') {
    const raw = String(new FormData(form).get('code') || '').trim();
    const code = raw.includes('#') ? raw.split('#').pop() : raw;
    if (!code) return;
    S.code = code; S.loadError = null; history.replaceState(null, '', `${location.pathname}${location.search}#${code}`);
    await load();
    return;
  }
  if (kind === 'expense' || kind === 'edit') {
    const d = kind === 'edit' ? S.sheet.draft : S.entry.draft;
    Object.assign(d, readForm(form));
    const amount = parseAmount(d.amount);
    if (!d.item.trim()) { toast('품명을 입력해 주세요', true); return; }
    if (!amount) { toast('금액을 입력해 주세요', true); return; }
    const args = { p_code: S.code, p_wallet: d.walletId, p_method: d.method, p_category: d.category, p_item: d.item.trim(), p_amount: amount, p_memo: d.memo || null, p_spent_at: toIso(d.spentAt) };
    if (kind === 'edit') {
      const ok = await run(() => api.call('trip_update_expense', { ...args, p_id: S.sheet.id }), '수정했습니다');
      if (ok) { S.sheet = null; render(); }
    } else {
      const ok = await run(() => api.call('trip_add_expense', { ...args, p_source: d.source || 'manual' }), `저장했습니다 · ${money(amount, curOf(d.walletId))}`);
      if (ok) { S.entry.draft = newDraft(); S.entry.kind = null; S.entry.text = ''; S.entry.receipt = null; render(); }
    }
    return;
  }
  if (kind === 'topup') {
    const T = S.topup; Object.assign(T, readForm(form));
    const amount = parseAmount(T.amount);
    if (!(amount > 0)) { toast('금액을 입력해 주세요', true); return; }
    const ok = await run(() => api.call('trip_add_topup', { p_code: S.code, p_wallet: T.wallet, p_amount: amount, p_note: T.note || null, p_topped_on: T.date || null }), '충전 기록을 추가했습니다');
    if (ok) { T.amount = ''; T.note = ''; render(); }
    return;
  }
  if (kind === 'wallet') {
    const f = readForm(form);
    await run(() => api.call('trip_update_wallet', { p_code: S.code, p_id: form.dataset.id, p_label: f.label, p_holder: f.holder, p_purpose: f.purpose }), '저장했습니다');
    renderSheet();
  }
});

// 다른 사람이 넣은 내용을 따라잡는다: 화면으로 돌아올 때, 그리고 켜 둔 동안 15초마다
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.code && !S.busy) load(true); });
setInterval(() => { if (!document.hidden && S.code && !S.busy) load(true); }, 15000);

// ── 시작 ─────────────────────────────────────────────
S.code = (location.hash || '').replace(/^#/, '') || (DEMO ? 'DEMO' : store.get(K.code));
if (DEMO) S.code = 'DEMO';
if (S.code && !location.hash && !DEMO) history.replaceState(null, '', `${location.pathname}${location.search}#${S.code}`);
render();
load();
if ('serviceWorker' in navigator && !DEV && !DEMO) navigator.serviceWorker.register('./sw.js').catch(() => {});
