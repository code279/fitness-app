-- ============================================================
-- 육룡이 투표 추리 — Supabase 준비 SQL
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN 하세요.
-- ============================================================

-- 1) 표 만들기
create table if not exists public.vg_entries (
  player    text primary key,
  guess     jsonb,
  truth     text,
  guess_at  timestamptz,
  truth_at  timestamptz
);

-- 2) 한 번 제출하면 못 바꾸게 잠그기 (게임 공정성)
create or replace function public.vg_lock()
returns trigger
language plpgsql
as $$
begin
  if old.guess is not null and new.guess is distinct from old.guess then
    raise exception 'guess is locked';
  end if;
  if old.truth is not null and new.truth is distinct from old.truth then
    raise exception 'truth is locked';
  end if;
  return new;
end;
$$;

drop trigger if exists vg_lock_trigger on public.vg_entries;
create trigger vg_lock_trigger
  before update on public.vg_entries
  for each row execute function public.vg_lock();

-- 3) 접근 권한 (링크를 아는 사람만 쓰는 친목용)
alter table public.vg_entries enable row level security;

drop policy if exists vg_read   on public.vg_entries;
drop policy if exists vg_write  on public.vg_entries;
drop policy if exists vg_modify on public.vg_entries;
drop policy if exists vg_clear  on public.vg_entries;

create policy vg_read   on public.vg_entries for select using (true);
create policy vg_write  on public.vg_entries for insert with check (true);
create policy vg_modify on public.vg_entries for update using (true);
create policy vg_clear  on public.vg_entries for delete using (true);

-- 4) 실시간 반영 켜기
alter publication supabase_realtime add table public.vg_entries;
