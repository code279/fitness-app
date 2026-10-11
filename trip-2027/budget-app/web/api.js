import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// 데이터베이스의 trip_* 창구를 부른다. 모든 창구는 여행 코드를 먼저 확인한다.
export function createApi() {
  return {
    demo: false,
    async call(fn, args) {
      let res;
      try {
        res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
      } catch {
        throw new Error('인터넷 연결을 확인해 주세요');
      }
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error((body && body.message) || `서버 오류 (${res.status})`);
      return body;
    },
  };
}

// 체험 모드: 주소 끝에 ?demo 를 붙이면 진짜 데이터 대신 이 휴대폰 안의 예시 데이터로 돈다.
export function createDemoApi() {
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const W = [
    { id: 'w1', label: '트래블카드 ①', currency: 'JPY', kind: 'card', holder: '일룡이', purpose: '숙소 · 교통', sort: 1 },
    { id: 'w2', label: '트래블카드 ②', currency: 'JPY', kind: 'card', holder: '이룡이', purpose: '식당 · 현지 먹거리', sort: 2 },
    { id: 'w3', label: '엔화 현금', currency: 'JPY', kind: 'cash', holder: null, purpose: null, sort: 3 },
    { id: 'w4', label: '원화', currency: 'KRW', kind: 'account', holder: null, purpose: '카뱅 체크카드 · 이체', sort: 4 },
  ];
  const d = (day, h, m) => new Date(2027, 0, day, h, m).toISOString();
  const T = [
    { id: uid(), wallet_id: 'w1', amount: 300000, note: '숙소·교통 충전', topped_on: '2027-01-10' },
    { id: uid(), wallet_id: 'w2', amount: 150000, note: '식비 충전', topped_on: '2027-01-10' },
    { id: uid(), wallet_id: 'w3', amount: 60000, note: '1차 환전', topped_on: '2027-01-12' },
    { id: uid(), wallet_id: 'w4', amount: 300000, note: '공금 모음', topped_on: '2027-01-08' },
  ];
  const E = [
    ['w1', '카드', '교통', 'N\'EX 나리타 → 신주쿠 6명', 19500, d(14, 12, 45), 'card_capture'],
    ['w2', '카드', '식사', '이자카야 とりまる', 21600, d(14, 19, 40), 'receipt'],
    ['w3', '현금', '간식·편의점', 'LAWSON 新宿西口', 1556, d(14, 22, 5), 'receipt'],
    ['w1', '카드', '교통', '로망스카 왕복 6매', 26400, d(15, 8, 30), 'manual'],
    ['w2', '카드', '식사', '하코네 소바', 9600, d(15, 12, 10), 'card_capture'],
    ['w4', '이체', '숙소', '에어비앤비 잔금', 120000, d(13, 21, 0), 'manual'],
  ].map(([wallet_id, method, category, item, amount, spent_at, source]) =>
    ({ id: uid(), wallet_id, method, category, item, amount, memo: null, spent_at, source }));

  const need = (c) => { if (c !== 'DEMO') throw new Error('여행 코드가 올바르지 않습니다'); };
  const wallet = (id) => { const w = W.find((x) => x.id === id); if (!w) throw new Error('지갑을 찾을 수 없습니다'); return w; };
  const check = (e) => {
    if (!e.item || !String(e.item).trim()) throw new Error('품명을 입력해 주세요 (100자 이내)');
    if (!e.amount || Math.abs(e.amount) > 1e8) throw new Error('금액이 올바르지 않습니다');
  };
  const sum = (arr, id) => arr.filter((x) => x.wallet_id === id).reduce((a, x) => a + Number(x.amount), 0);
  const fns = {
    trip_load: ({ p_code }) => {
      need(p_code);
      return {
        trip: { id: 'demo', name: '2027 도쿄 여섯 사나이 (체험)' },
        wallets: W.map((w) => ({ ...w, total: sum(T, w.id), spent: sum(E, w.id) })),
        topups: [...T].sort((a, b) => a.topped_on.localeCompare(b.topped_on)),
        expenses: [...E].sort((a, b) => b.spent_at.localeCompare(a.spent_at)),
      };
    },
    trip_add_expense: (a) => {
      need(a.p_code); wallet(a.p_wallet);
      const e = { id: uid(), wallet_id: a.p_wallet, method: a.p_method, category: a.p_category, item: a.p_item,
        amount: a.p_amount, memo: a.p_memo, spent_at: a.p_spent_at || new Date().toISOString(), source: a.p_source };
      check(e); E.push(e); return e.id;
    },
    trip_add_expenses: ({ p_code, p_items }) => {
      need(p_code);
      const rows = p_items.map((r) => ({ id: uid(), wallet_id: wallet(r.wallet_id).id, method: r.method, category: r.category,
        item: r.item, amount: r.amount, memo: r.memo || null, spent_at: r.spent_at || new Date().toISOString(), source: r.source || 'card_capture' }));
      rows.forEach(check); E.push(...rows); return rows.length;
    },
    trip_update_expense: (a) => {
      need(a.p_code); const e = E.find((x) => x.id === a.p_id); if (!e) throw new Error('지출 내역을 찾을 수 없습니다');
      const next = { ...e, wallet_id: wallet(a.p_wallet).id, method: a.p_method, category: a.p_category, item: a.p_item,
        amount: a.p_amount, memo: a.p_memo, spent_at: a.p_spent_at || e.spent_at };
      check(next); Object.assign(e, next);
    },
    trip_delete_expense: ({ p_code, p_id }) => { need(p_code); const i = E.findIndex((x) => x.id === p_id); if (i < 0) throw new Error('지출 내역을 찾을 수 없습니다'); E.splice(i, 1); },
    trip_add_topup: (a) => { need(a.p_code); wallet(a.p_wallet); T.push({ id: uid(), wallet_id: a.p_wallet, amount: a.p_amount, note: a.p_note, topped_on: a.p_topped_on || new Date().toISOString().slice(0, 10) }); },
    trip_delete_topup: ({ p_code, p_id }) => { need(p_code); const i = T.findIndex((x) => x.id === p_id); if (i < 0) throw new Error('충전 기록을 찾을 수 없습니다'); T.splice(i, 1); },
    trip_update_wallet: (a) => { need(a.p_code); Object.assign(wallet(a.p_id), { label: a.p_label, holder: a.p_holder || null, purpose: a.p_purpose || null }); },
  };
  return {
    demo: true,
    async call(fn, args) {
      await new Promise((r) => setTimeout(r, 120));
      return structuredClone(fns[fn](args) ?? null);
    },
  };
}
