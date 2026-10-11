-- 여행 예산 앱: 식단 앱과 섞이지 않도록 API에 노출되지 않는 별도 스키마에 둔다.
-- 앱은 public 의 trip_* 함수만 호출할 수 있고, 모든 함수는 여행 코드를 확인한 뒤에만 동작한다.
create schema if not exists trip_budget;
revoke all on schema trip_budget from public, anon, authenticated;

create table trip_budget.trips (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (length(code) >= 12),
  name       text not null,
  created_at timestamptz not null default now()
);

-- 지갑: 트래블카드 ①·②, 엔화 현금, 원화
create table trip_budget.wallets (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trip_budget.trips(id) on delete cascade,
  label      text not null check (length(label) between 1 and 30),
  currency   text not null check (currency in ('JPY', 'KRW')),
  kind       text not null check (kind in ('card', 'cash', 'account')),
  holder     text check (length(holder) <= 20),
  purpose    text check (length(purpose) <= 40),
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

-- 충전·환전 기록 (시트의 환전(카드충전) / 환전(현금) 칸)
create table trip_budget.topups (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trip_budget.trips(id) on delete cascade,
  wallet_id  uuid not null references trip_budget.wallets(id) on delete cascade,
  amount     bigint not null check (amount > 0 and amount <= 100000000),
  note       text check (length(note) <= 60),
  topped_on  date not null default current_date,
  created_at timestamptz not null default now()
);

-- 지출 (금액은 지갑 통화 기준, 환불은 음수)
create table trip_budget.expenses (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trip_budget.trips(id) on delete cascade,
  wallet_id  uuid not null references trip_budget.wallets(id) on delete restrict,
  method     text check (length(method) <= 10),
  category   text not null default '기타',
  item       text not null,
  amount     bigint not null,
  memo       text,
  spent_at   timestamptz not null default now(),
  source     text not null default 'manual' check (source in ('manual', 'receipt', 'card_capture')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_trip_spent_idx on trip_budget.expenses (trip_id, spent_at desc);
create index topups_trip_idx on trip_budget.topups (trip_id);
create index wallets_trip_idx on trip_budget.wallets (trip_id);

-- 스키마가 노출되지 않더라도 이중으로 막아 둔다
alter table trip_budget.trips    enable row level security;
alter table trip_budget.wallets  enable row level security;
alter table trip_budget.topups   enable row level security;
alter table trip_budget.expenses enable row level security;

-- ── 내부 도우미 ───────────────────────────────────────────
create or replace function trip_budget.resolve(p_code text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from trip_budget.trips where code = p_code;
  if v is null then
    raise exception '여행 코드가 올바르지 않습니다' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function trip_budget.check_wallet(p_trip uuid, p_wallet uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from trip_budget.wallets where id = p_wallet and trip_id = p_trip) then
    raise exception '지갑을 찾을 수 없습니다';
  end if;
end $$;

create or replace function trip_budget.check_expense(
  p_method text, p_category text, p_item text, p_amount bigint, p_memo text, p_source text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_method is not null and length(p_method) > 10 then raise exception '결제수단이 너무 깁니다'; end if;
  if p_category is null or length(btrim(p_category)) = 0 or length(p_category) > 20 then raise exception '분류가 올바르지 않습니다'; end if;
  if p_item is null or length(btrim(p_item)) = 0 or length(p_item) > 100 then raise exception '품명을 입력해 주세요 (100자 이내)'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 then raise exception '금액이 올바르지 않습니다'; end if;
  if p_memo is not null and length(p_memo) > 200 then raise exception '비고는 200자 이내로 적어 주세요'; end if;
  if p_source not in ('manual', 'receipt', 'card_capture') then raise exception '입력 경로가 올바르지 않습니다'; end if;
end $$;

revoke all on all functions in schema trip_budget from public, anon, authenticated;

-- ── 앱이 부르는 창구 ──────────────────────────────────────
create or replace function public.trip_load(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code);
begin
  return jsonb_build_object(
    'trip', (select jsonb_build_object('id', t.id, 'name', t.name)
               from trip_budget.trips t where t.id = v_trip),
    'wallets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'label', w.label, 'currency', w.currency, 'kind', w.kind,
               'holder', w.holder, 'purpose', w.purpose, 'sort', w.sort,
               'total', coalesce((select sum(tp.amount) from trip_budget.topups tp where tp.wallet_id = w.id), 0),
               'spent', coalesce((select sum(e.amount)  from trip_budget.expenses e where e.wallet_id = w.id), 0))
             order by w.sort)
        from trip_budget.wallets w where w.trip_id = v_trip), '[]'::jsonb),
    'topups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', tp.id, 'wallet_id', tp.wallet_id, 'amount', tp.amount,
               'note', tp.note, 'topped_on', tp.topped_on)
             order by tp.topped_on, tp.created_at)
        from trip_budget.topups tp where tp.trip_id = v_trip), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(s.x order by s.spent_at desc, s.created_at desc)
        from (select e.spent_at, e.created_at,
                     jsonb_build_object('id', e.id, 'wallet_id', e.wallet_id, 'method', e.method,
                       'category', e.category, 'item', e.item, 'amount', e.amount, 'memo', e.memo,
                       'spent_at', e.spent_at, 'source', e.source) as x
                from trip_budget.expenses e
               where e.trip_id = v_trip
               order by e.spent_at desc limit 2000) s), '[]'::jsonb)
  );
end $$;

create or replace function public.trip_add_expense(
  p_code text, p_wallet uuid, p_method text, p_category text, p_item text, p_amount bigint,
  p_memo text default null, p_spent_at timestamptz default null, p_source text default 'manual')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code); v_id uuid;
begin
  perform trip_budget.check_wallet(v_trip, p_wallet);
  perform trip_budget.check_expense(p_method, p_category, p_item, p_amount, p_memo, p_source);
  insert into trip_budget.expenses (trip_id, wallet_id, method, category, item, amount, memo, spent_at, source)
  values (v_trip, p_wallet, p_method, btrim(p_category), btrim(p_item), p_amount,
          nullif(btrim(p_memo), ''), coalesce(p_spent_at, now()), p_source)
  returning id into v_id;
  return v_id;
end $$;

-- 카드 내역 캡처처럼 여러 건을 한 번에. 한 건이라도 틀리면 전부 취소된다.
create or replace function public.trip_add_expenses(p_code text, p_items jsonb)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code); r jsonb; n int := 0; v_src text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception '한 번에 1~60건까지 저장할 수 있습니다';
  end if;
  for r in select value from jsonb_array_elements(p_items) loop
    v_src := coalesce(r->>'source', 'card_capture');
    perform trip_budget.check_wallet(v_trip, (r->>'wallet_id')::uuid);
    perform trip_budget.check_expense(r->>'method', r->>'category', r->>'item', (r->>'amount')::bigint, r->>'memo', v_src);
    insert into trip_budget.expenses (trip_id, wallet_id, method, category, item, amount, memo, spent_at, source)
    values (v_trip, (r->>'wallet_id')::uuid, r->>'method', btrim(r->>'category'), btrim(r->>'item'),
            (r->>'amount')::bigint, nullif(btrim(r->>'memo'), ''),
            coalesce((r->>'spent_at')::timestamptz, now()), v_src);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.trip_update_expense(
  p_code text, p_id uuid, p_wallet uuid, p_method text, p_category text, p_item text,
  p_amount bigint, p_memo text, p_spent_at timestamptz)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code); v_src text;
begin
  select source into v_src from trip_budget.expenses where id = p_id and trip_id = v_trip;
  if v_src is null then raise exception '지출 내역을 찾을 수 없습니다'; end if;
  perform trip_budget.check_wallet(v_trip, p_wallet);
  perform trip_budget.check_expense(p_method, p_category, p_item, p_amount, p_memo, v_src);
  update trip_budget.expenses
     set wallet_id = p_wallet, method = p_method, category = btrim(p_category), item = btrim(p_item),
         amount = p_amount, memo = nullif(btrim(p_memo), ''), spent_at = coalesce(p_spent_at, spent_at),
         updated_at = now()
   where id = p_id and trip_id = v_trip;
end $$;

create or replace function public.trip_delete_expense(p_code text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code);
begin
  delete from trip_budget.expenses where id = p_id and trip_id = v_trip;
  if not found then raise exception '지출 내역을 찾을 수 없습니다'; end if;
end $$;

create or replace function public.trip_add_topup(
  p_code text, p_wallet uuid, p_amount bigint, p_note text default null, p_topped_on date default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code); v_id uuid;
begin
  perform trip_budget.check_wallet(v_trip, p_wallet);
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception '금액이 올바르지 않습니다'; end if;
  if p_note is not null and length(p_note) > 60 then raise exception '내역은 60자 이내로 적어 주세요'; end if;
  insert into trip_budget.topups (trip_id, wallet_id, amount, note, topped_on)
  values (v_trip, p_wallet, p_amount, nullif(btrim(p_note), ''), coalesce(p_topped_on, current_date))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.trip_delete_topup(p_code text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code);
begin
  delete from trip_budget.topups where id = p_id and trip_id = v_trip;
  if not found then raise exception '충전 기록을 찾을 수 없습니다'; end if;
end $$;

create or replace function public.trip_update_wallet(
  p_code text, p_id uuid, p_label text, p_holder text, p_purpose text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_trip uuid := trip_budget.resolve(p_code);
begin
  if p_label is null or length(btrim(p_label)) = 0 or length(p_label) > 30 then raise exception '지갑 이름이 올바르지 않습니다'; end if;
  if length(p_holder) > 20 or length(p_purpose) > 40 then raise exception '담당자·용도가 너무 깁니다'; end if;
  update trip_budget.wallets
     set label = btrim(p_label), holder = nullif(btrim(p_holder), ''), purpose = nullif(btrim(p_purpose), '')
   where id = p_id and trip_id = v_trip;
  if not found then raise exception '지갑을 찾을 수 없습니다'; end if;
end $$;

-- 창구 권한: 기본 PUBLIC 실행권을 거두고 앱(anon)에만 연다
revoke all on function public.trip_load(text) from public;
revoke all on function public.trip_add_expense(text, uuid, text, text, text, bigint, text, timestamptz, text) from public;
revoke all on function public.trip_add_expenses(text, jsonb) from public;
revoke all on function public.trip_update_expense(text, uuid, uuid, text, text, text, bigint, text, timestamptz) from public;
revoke all on function public.trip_delete_expense(text, uuid) from public;
revoke all on function public.trip_add_topup(text, uuid, bigint, text, date) from public;
revoke all on function public.trip_delete_topup(text, uuid) from public;
revoke all on function public.trip_update_wallet(text, uuid, text, text, text) from public;

grant execute on function public.trip_load(text) to anon, authenticated;
grant execute on function public.trip_add_expense(text, uuid, text, text, text, bigint, text, timestamptz, text) to anon, authenticated;
grant execute on function public.trip_add_expenses(text, jsonb) to anon, authenticated;
grant execute on function public.trip_update_expense(text, uuid, uuid, text, text, text, bigint, text, timestamptz) to anon, authenticated;
grant execute on function public.trip_delete_expense(text, uuid) to anon, authenticated;
grant execute on function public.trip_add_topup(text, uuid, bigint, text, date) to anon, authenticated;
grant execute on function public.trip_delete_topup(text, uuid) to anon, authenticated;
grant execute on function public.trip_update_wallet(text, uuid, text, text, text) to anon, authenticated;
