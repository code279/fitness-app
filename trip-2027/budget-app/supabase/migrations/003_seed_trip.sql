-- 여행 한 건과 지갑 네 개를 만든다. 여행 코드는 무작위로 생성되며 결과로만 확인한다.
-- 생성된 코드는 초대 링크로만 전달하고, 이 저장소에 적지 않는다.
with t as (
  insert into trip_budget.trips (code, name)
  values (translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_'), '2027 도쿄 여섯 사나이')
  returning id, code, name
), w as (
  insert into trip_budget.wallets (trip_id, label, currency, kind, purpose, sort)
  select t.id, v.label, v.currency, v.kind, v.purpose, v.sort
    from t, (values ('트래블카드 ①', 'JPY', 'card',    '숙소 · 교통',          1),
                    ('트래블카드 ②', 'JPY', 'card',    '식당 · 현지 먹거리',   2),
                    ('엔화 현금',     'JPY', 'cash',    null,                   3),
                    ('원화',          'KRW', 'account', '카뱅 체크카드 · 이체', 4)) as v(label, currency, kind, purpose, sort)
  returning label
)
select t.code, t.name, (select count(*) from w) as wallets from t;
