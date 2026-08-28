begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- Tables
-- ============================================================

create table if not exists round_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users (id) on delete cascade,
  name text not null,
  format text not null check (format in ('outdoor', 'indoor', 'field')),
  bow_type text not null check (bow_type in ('recurve', 'compound', 'barebow')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists round_preset_distances (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references round_presets (id) on delete cascade,
  distance_number bigint not null,
  distance bigint not null,
  total_ends bigint not null,
  arrows_per_end bigint not null,
  target_face_id uuid not null references target_faces (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table round_presets enable row level security;

grant select, insert, update, delete on round_presets to anon, authenticated;

create policy "select_all_authenticated" on round_presets
  for select
  to authenticated
  using (true);

create policy "insert_own" on round_presets
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "update_own" on round_presets
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "delete_own" on round_presets
  for delete
  to authenticated
  using (owner_id = auth.uid());

alter table round_preset_distances enable row level security;

grant select, insert, update, delete on round_preset_distances to anon, authenticated;

create policy "select_all_authenticated" on round_preset_distances
  for select
  to authenticated
  using (true);

create policy "insert_if_owner" on round_preset_distances
  for insert
  to authenticated
  with check (
    exists (
      select 1 from round_presets rp
      where rp.id = round_preset_distances.preset_id and rp.owner_id = auth.uid()
    )
  );

create policy "update_if_owner" on round_preset_distances
  for update
  to authenticated
  using (
    exists (
      select 1 from round_presets rp
      where rp.id = round_preset_distances.preset_id and rp.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from round_presets rp
      where rp.id = round_preset_distances.preset_id and rp.owner_id = auth.uid()
    )
  );

create policy "delete_if_owner" on round_preset_distances
  for delete
  to authenticated
  using (
    exists (
      select 1 from round_presets rp
      where rp.id = round_preset_distances.preset_id and rp.owner_id = auth.uid()
    )
  );

-- ============================================================
-- Seed data (グローバルプリセット。owner_id = null はマイグレーションでのみ作成する)
-- ============================================================

insert into round_presets (id, owner_id, name, format, bow_type) values
  ('a3000000-0000-0000-0000-000000000001', null, 'WA 1440', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000002', null, '70m (720)', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000003', null, '50m (720)', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000004', null, '30m (720)', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000005', null, '50m / 30m (720)', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000006', null, '70m (360)', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000007', null, '50m (360)', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000008', null, '30m (360)', 'outdoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000009', null, '18m (600)', 'indoor', 'recurve'),
  ('a3000000-0000-0000-0000-000000000010', null, '18m (300)', 'indoor', 'recurve');

insert into round_preset_distances (preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id) values
  -- WA 1440: 90/70m=122cm、50/30m=80cm
  ('a3000000-0000-0000-0000-000000000001', 1, 90, 6, 6, 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000001', 2, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000001', 3, 50, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-000000000001', 4, 30, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  -- 70m (720): 70m x2セット
  ('a3000000-0000-0000-0000-000000000002', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000002', 2, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001'),
  -- 50m (720): 50m x2セット
  ('a3000000-0000-0000-0000-000000000003', 1, 50, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-000000000003', 2, 50, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  -- 30m (720): 30m x2セット
  ('a3000000-0000-0000-0000-000000000004', 1, 30, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-000000000004', 2, 30, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  -- 50m / 30m (720)
  ('a3000000-0000-0000-0000-000000000005', 1, 50, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-000000000005', 2, 30, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  -- 単発距離（36本）
  ('a3000000-0000-0000-0000-000000000006', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000007', 1, 50, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-000000000008', 1, 30, 6, 6, 'a1000000-0000-0000-0000-000000000002'),
  -- インドア18m
  ('a3000000-0000-0000-0000-000000000009', 1, 18, 10, 3, 'a1000000-0000-0000-0000-000000000007'),
  ('a3000000-0000-0000-0000-000000000009', 2, 18, 10, 3, 'a1000000-0000-0000-0000-000000000007'),
  ('a3000000-0000-0000-0000-000000000010', 1, 18, 10, 3, 'a1000000-0000-0000-0000-000000000007');

commit;
