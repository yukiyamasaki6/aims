begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- Tables
-- ============================================================

create table if not exists users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  round_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists round_users (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, user_id)
);

create table if not exists distances (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds (id) on delete cascade,
  distance_number bigint not null,
  distance bigint not null,
  total_ends bigint not null,
  arrows_per_end bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shots (
  id uuid primary key default gen_random_uuid(),
  distance_id uuid not null references distances (id) on delete cascade,
  end_number bigint not null,
  arrow_number bigint not null,
  user_id uuid not null references users (id) on delete cascade,
  score_str text not null,
  score_int bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (distance_id, user_id, end_number, arrow_number),
  check (
    (score_str = 'X' and score_int = 10)
    or (score_str = 'M' and score_int = 0)
    or (score_str ~ '^([1-9]|10)$' and score_str = score_int::text)
  )
);

-- ============================================================
-- Row Level Security
-- ============================================================

-- round_users自体のポリシーがround_usersを直接参照すると無限再帰になるため、
-- SECURITY DEFINERでRLSを経由せずに判定するヘルパー関数を介して参照する。
create or replace function is_round_member(target_round_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid()
  );
$$;

create or replace function is_round_editor(target_round_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid() and ru.role = 'editor'
  );
$$;

alter table users enable row level security;

grant select, insert, update, delete on users to anon, authenticated;

create policy "select_all_authenticated" on users
  for select
  to authenticated
  using (true);

create policy "update_own" on users
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "delete_own" on users
  for delete
  to authenticated
  using (auth.uid() = id);

alter table rounds enable row level security;

grant select, insert, update, delete on rounds to anon, authenticated;

create policy "select_if_member" on rounds
  for select
  to authenticated
  using (is_round_member(rounds.id));

create policy "insert_any_authenticated" on rounds
  for insert
  to authenticated
  with check (true);

create policy "update_if_editor" on rounds
  for update
  to authenticated
  using (is_round_editor(rounds.id))
  with check (is_round_editor(rounds.id));

create policy "delete_if_editor" on rounds
  for delete
  to authenticated
  using (is_round_editor(rounds.id));

alter table round_users enable row level security;

grant select, insert, update, delete on round_users to anon, authenticated;

create policy "select_if_member" on round_users
  for select
  to authenticated
  using (is_round_member(round_users.round_id));

create policy "insert_if_editor" on round_users
  for insert
  to authenticated
  with check (is_round_editor(round_users.round_id));

create policy "update_if_editor" on round_users
  for update
  to authenticated
  using (is_round_editor(round_users.round_id))
  with check (is_round_editor(round_users.round_id));

create policy "delete_if_editor" on round_users
  for delete
  to authenticated
  using (is_round_editor(round_users.round_id));

alter table distances enable row level security;

grant select, insert, update, delete on distances to anon, authenticated;

create policy "select_if_member" on distances
  for select
  to authenticated
  using (is_round_member(distances.round_id));

create policy "insert_if_editor" on distances
  for insert
  to authenticated
  with check (is_round_editor(distances.round_id));

create policy "update_if_editor" on distances
  for update
  to authenticated
  using (is_round_editor(distances.round_id))
  with check (is_round_editor(distances.round_id));

create policy "delete_if_editor" on distances
  for delete
  to authenticated
  using (is_round_editor(distances.round_id));

alter table shots enable row level security;

grant select, insert, update, delete on shots to anon, authenticated;

create policy "select_if_member" on shots
  for select
  to authenticated
  using (is_round_member((select d.round_id from distances d where d.id = shots.distance_id)));

create policy "insert_if_editor" on shots
  for insert
  to authenticated
  with check (is_round_editor((select d.round_id from distances d where d.id = shots.distance_id)));

create policy "update_if_editor" on shots
  for update
  to authenticated
  using (is_round_editor((select d.round_id from distances d where d.id = shots.distance_id)))
  with check (is_round_editor((select d.round_id from distances d where d.id = shots.distance_id)));

create policy "delete_if_editor" on shots
  for delete
  to authenticated
  using (is_round_editor((select d.round_id from distances d where d.id = shots.distance_id)));

-- ============================================================
-- Triggers
-- ============================================================

-- ラウンド作成者を round_users に editor として自動登録する。
-- round_users への INSERT は自己参照ポリシー（既に editor であること）を要求するため、
-- クライアントからの直接INSERTでは通せない。SECURITY DEFINER でRLSを回避する。
create or replace function handle_new_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into round_users (round_id, user_id, role)
  values (new.id, auth.uid(), 'editor');
  return new;
end;
$$;

create trigger on_round_created
  after insert on rounds
  for each row
  execute function handle_new_round();

commit;
