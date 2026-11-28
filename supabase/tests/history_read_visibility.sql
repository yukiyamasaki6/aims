-- ラウンド・距離・矢と各履歴を読める範囲を、利用者の視点ごとの行の集合（ID）で確認する。
--   - 射つ人と代理の人は、参加するラウンドと、その距離・矢・各履歴が読める（削除済みの行、距離のないラウンド、矢のない距離を含む）
--   - 参加しないラウンドと、その距離・矢・各履歴は、一覧でもID指定でも読めない
--   - member_round_ids()は、本人が参加するラウンドだけを返す
--   - 参加の行の利用者を変えると、読める利用者が移る
--   - 見える矢の親の距離、見える距離の親のラウンドは、必ず見える
-- ポリシーの式や索引の有無は確認しない。読める範囲が変わらないことだけを固定する。
-- anonの拒否と書き込みの拒否はrls_matrix.sqlで固定している。

begin;

select plan(16);

create temp table hv_id (alias text primary key, id uuid not null);
insert into hv_id (alias, id) values
  ('E', 'd0000000-0000-0000-0000-000000000001'),
  ('A', 'd0000000-0000-0000-0000-000000000002'),
  ('X', 'd0000000-0000-0000-0000-000000000003'),
  ('Y', 'd0000000-0000-0000-0000-000000000004'),
  ('Z', 'd0000000-0000-0000-0000-000000000005'),
  ('R1', 'd0000000-0000-0000-0000-000000000101'),
  ('R2', 'd0000000-0000-0000-0000-000000000102'),
  ('R3', 'd0000000-0000-0000-0000-000000000103'),
  ('R4', 'd0000000-0000-0000-0000-000000000104'),
  ('D1a', 'd0000000-0000-0000-0000-000000000201'),
  ('D1b', 'd0000000-0000-0000-0000-000000000202'),
  ('D3', 'd0000000-0000-0000-0000-000000000203'),
  ('D4', 'd0000000-0000-0000-0000-000000000204'),
  ('RE1', 'd0000000-0000-0000-0000-000000000301'),
  ('RE3', 'd0000000-0000-0000-0000-000000000303'),
  ('RE4', 'd0000000-0000-0000-0000-000000000304'),
  ('DE1', 'd0000000-0000-0000-0000-000000000401'),
  ('DE3', 'd0000000-0000-0000-0000-000000000403'),
  ('DE4', 'd0000000-0000-0000-0000-000000000404'),
  ('SE1', 'd0000000-0000-0000-0000-000000000501'),
  ('SE3', 'd0000000-0000-0000-0000-000000000503'),
  ('SE4', 'd0000000-0000-0000-0000-000000000504');

-- 矢のマスの別名。
create temp table hv_cell (alias text primary key, distance_id uuid not null, end_number bigint not null, shot_number bigint not null);
insert into hv_cell (alias, distance_id, end_number, shot_number) values
  ('S1a', 'd0000000-0000-0000-0000-000000000201', 1, 1),
  ('S1b', 'd0000000-0000-0000-0000-000000000201', 1, 2),
  ('S3', 'd0000000-0000-0000-0000-000000000203', 1, 1),
  ('S4', 'd0000000-0000-0000-0000-000000000204', 1, 1);

grant select on hv_id, hv_cell to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from hv_id where alias = p_alias $$;

-- 見えた行を、IDの別名の昇順で返す。別名にない行は「?」で表す。
create function pg_temp.seen(p_table text) returns text
language plpgsql
as $$
declare
  v_result text;
begin
  -- 矢は、IDでなくマスで指すため、マスの別名の表と結ぶ。
  execute format(
    'select coalesce(string_agg(coalesce(i.alias, ''?''), '','' order by coalesce(i.alias, ''?'')), '''') from public.%I t left join %s',
    p_table,
    case p_table
      when 'shots' then 'hv_cell i on (i.distance_id, i.end_number, i.shot_number) = (t.distance_id, t.end_number, t.shot_number)'
      when 'round_events' then 'hv_id i on i.id = t.event_id'
      when 'distance_events' then 'hv_id i on i.id = t.event_id'
      when 'shot_events' then 'hv_id i on i.id = t.event_id'
      else 'hv_id i on i.id = t.id'
    end
  ) into v_result;
  return v_result;
end;
$$;

-- 3つの表で見えた行を、rounds|distances|shots の形で返す。
create function pg_temp.seen_all() returns text
language sql
as $$ select pg_temp.seen('rounds') || '|' || pg_temp.seen('distances') || '|' || pg_temp.seen('shots') $$;

-- 3つの履歴で見えた行を、round_events|distance_events|shot_events の形で返す。
create function pg_temp.seen_events() returns text
language sql
as $$ select pg_temp.seen('round_events') || '|' || pg_temp.seen('distance_events') || '|' || pg_temp.seen('shot_events') $$;

-- member_round_ids()が返すラウンドの別名。
create function pg_temp.member_rounds() returns text
language sql
as $$
  select coalesce(string_agg(coalesce(i.alias, '?'), ',' order by coalesce(i.alias, '?')), '')
  from public.member_round_ids() as m(id)
  left join hv_id i on i.id = m.id
$$;

insert into auth.users (id) select id from hv_id where alias in ('E', 'A', 'X', 'Y', 'Z');

-- Fixture: 検証データは屋外の形（各距離12エンド×3射。同じラウンドの全距離で同じ形）にする。
-- R1: Eが射つ人（射手1）、Aが代理の人。利用者に紐づかない射手2。距離D1a（矢2本）と、矢のない距離D1b。
-- R2: Eのみ。距離のないラウンド。
-- R3: Eのみ。削除済み。削除済みの距離D3と、削除済みの矢S3を持つ。
-- R4: 別の利用者Yのみ。E・A・Xとも参加しない。距離D4と矢S4を持つ。
-- 矢はエンドの全矢を満たさないが、見える範囲の確認に必要な最小本数にする。
insert into public.rounds (id, name, round_date, format, bow_type, status, disabled_at) values
  (pg_temp.id('R1'), 'R1', '2026-10-01', 'outdoor', 'recurve', 'completed', null),
  (pg_temp.id('R2'), 'R2', '2026-10-02', 'outdoor', 'recurve', 'in_progress', null),
  (pg_temp.id('R3'), 'R3', '2026-10-03', 'outdoor', 'recurve', 'completed', '2026-10-04 00:00+00'),
  (pg_temp.id('R4'), 'R4', '2026-10-05', 'outdoor', 'recurve', 'completed', null);

insert into public.round_users (round_id, user_id, role, shooter_number) values
  (pg_temp.id('R1'), pg_temp.id('E'), 'owner', 1),
  (pg_temp.id('R1'), null, null, 2),
  (pg_temp.id('R1'), pg_temp.id('A'), 'editor', null),
  (pg_temp.id('R2'), pg_temp.id('E'), 'owner', 1),
  (pg_temp.id('R3'), pg_temp.id('E'), 'owner', 1),
  (pg_temp.id('R4'), pg_temp.id('Y'), 'owner', 1);

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, disabled_at) values
  (pg_temp.id('D1a'), pg_temp.id('R1'), '1', 70, 12, 3, 'a1000000-0000-0000-0000-000000000001', null),
  (pg_temp.id('D1b'), pg_temp.id('R1'), '2', 60, 12, 3, 'a1000000-0000-0000-0000-000000000001', null),
  (pg_temp.id('D3'), pg_temp.id('R3'), '1', 70, 12, 3, 'a1000000-0000-0000-0000-000000000001', '2026-10-04 00:00+00'),
  (pg_temp.id('D4'), pg_temp.id('R4'), '1', 70, 12, 3, 'a1000000-0000-0000-0000-000000000001', null);

insert into public.shots (round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int, disabled_at)
select pg_temp.id(v.round), c.distance_id, c.end_number, c.shot_number, v.shooter, v.score_str, v.score_int, v.disabled_at
from (values
  ('S1a', 'R1', 1, 'X', 10, null::timestamptz),
  ('S1b', 'R1', 2, '9', 9, null),
  ('S3', 'R3', 1, '8', 8, '2026-10-04 00:00+00'),
  ('S4', 'R4', 1, 'X', 10, null)
) as v (cell, round, shooter, score_str, score_int, disabled_at)
join hv_cell c on c.alias = v.cell;

insert into public.round_events (event_id, round_id, type, author_id, revision, name, round_date, format, bow_type)
select pg_temp.id(v.event), pg_temp.id(v.round), 'CREATED', pg_temp.id(v.author), 1, v.round, '2026-10-01', 'outdoor', 'recurve'
from (values ('RE1', 'R1', 'E'), ('RE3', 'R3', 'E'), ('RE4', 'R4', 'Y')) as v (event, round, author);

insert into public.distance_events (event_id, round_id, distance_id, type, author_id, revision, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id)
select pg_temp.id(v.event), pg_temp.id(v.round), pg_temp.id(v.distance), 'CREATED', pg_temp.id(v.author), 1, '1', 70, true, 12, 3, 'a1000000-0000-0000-0000-000000000001'
from (values ('DE1', 'R1', 'D1a', 'E'), ('DE3', 'R3', 'D3', 'E'), ('DE4', 'R4', 'D4', 'Y')) as v (event, round, distance, author);

insert into public.shot_events (event_id, round_id, distance_id, end_number, shot_number, type, author_id, revision, shooter_number, score_str, score_int, set_fields)
select pg_temp.id(v.event), pg_temp.id(v.round), pg_temp.id(v.distance), 1, 1, 'RECORDED', pg_temp.id(v.author), 1, 1, '9', 9, array['score', 'shooter_number']
from (values ('SE1', 'R1', 'D1a', 'A'), ('SE3', 'R3', 'D3', 'E'), ('SE4', 'R4', 'D4', 'Y')) as v (event, round, distance, author);

set constraints all immediate;

-- ============================================================
-- 参加するラウンド（射つ人E）
-- ============================================================

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

select is(
  pg_temp.seen('rounds'),
  'R1,R2,R3',
  '射つ人には参加するラウンドが見え、削除済みのラウンドと距離のないラウンドを含む'
);

select is(
  pg_temp.seen('distances'),
  'D1a,D1b,D3',
  '射つ人には参加するラウンドの距離が見え、削除済みの距離と矢のない距離を含む'
);

select is(
  pg_temp.seen('shots'),
  'S1a,S1b,S3',
  '射つ人には参加するラウンドの距離の矢が見え、削除済みの矢を含む'
);

select is(
  pg_temp.seen_events(),
  'RE1,RE3|DE1,DE3|SE1,SE3',
  '射つ人には参加するラウンドの各履歴だけが見え、削除済みのラウンドの履歴を含む'
);

select is(
  pg_temp.member_rounds(),
  'R1,R2,R3',
  'member_round_ids()は、射つ人が参加するラウンドを削除済みを含めて返す'
);

-- ============================================================
-- 代理の人A
-- ============================================================

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('A')::text, true);
set local role authenticated;

select is(
  pg_temp.seen_all() || '|' || pg_temp.seen_events(),
  'R1|D1a,D1b|S1a,S1b|RE1|DE1|SE1',
  '代理の人には参加するラウンドとその距離・矢・各履歴だけが見え、参加しないラウンドは見えない'
);

select is(
  pg_temp.member_rounds(),
  'R1',
  'member_round_ids()は、代理の人が参加するラウンドだけを返す'
);

-- ============================================================
-- 空の親・子
-- ============================================================

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
set local role authenticated;

select is(
  (select count(*) from public.distances where round_id = pg_temp.id('R2'))::text
    || ',' || (select count(*) from public.shots where distance_id = pg_temp.id('D1b'))::text,
  '0,0',
  '距離のないラウンドと矢のない距離は、見える親に子が0件である'
);

select is(
  (select count(*) from public.shots s where not exists (select 1 from public.distances d where d.id = s.distance_id))::text
    || ',' || (select count(*) from public.distances d where not exists (select 1 from public.rounds r where r.id = d.round_id))::text,
  '0,0',
  '見える矢の距離と、見える距離のラウンドは、必ず見える'
);

-- ============================================================
-- 属さないラウンド
-- ============================================================

select is(
  (select count(*) from public.distances where id = pg_temp.id('D4'))::text
    || ',' || (select count(*) from public.shots where distance_id = pg_temp.id('D4') and end_number = 1 and shot_number = 1)::text
    || ',' || (select count(*) from public.shots where distance_id = pg_temp.id('D4'))::text,
  '0,0,0',
  '他の利用者のラウンドの距離と矢は、IDを指定しても見えない（他のラウンドに属していても）'
);

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('X')::text, true);
set local role authenticated;

select is(
  pg_temp.seen_all(),
  '||',
  'どのラウンドにも属さない利用者には、ラウンド・距離・矢が1件も見えない'
);

select is(
  (select count(*) from public.rounds where id = pg_temp.id('R4'))::text
    || ',' || (select count(*) from public.distances where round_id = pg_temp.id('R4'))::text
    || ',' || (select count(*) from public.shots where distance_id = pg_temp.id('D4'))::text,
  '0,0,0',
  'どのラウンドにも属さない利用者は、他の利用者のラウンドをID指定で読んでも0件である'
);

select is(
  pg_temp.seen_events() || ' [' || pg_temp.member_rounds() || ']',
  '|| []',
  'どのラウンドにも属さない利用者には各履歴が見えず、member_round_ids()は空である'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;

select is(
  pg_temp.seen_all() || '|' || pg_temp.seen_events() || ' [' || pg_temp.member_rounds() || ']',
  '||||| []',
  '利用者IDの無いauthenticatedには、紐づかない射手のあるラウンドを含めて何も見えず、member_round_ids()は空である'
);

-- ============================================================
-- 参加を失った利用者
-- ============================================================

-- Given: R4の射手1の利用者を、このラウンドに行を持たないZへ変える
reset role;
update public.round_users set user_id = pg_temp.id('Z')
where round_id = pg_temp.id('R4') and shooter_number = 1;

select set_config('request.jwt.claim.sub', pg_temp.id('Y')::text, true);
set local role authenticated;

select is(
  pg_temp.seen_all() || '|' || pg_temp.seen_events() || ' [' || pg_temp.member_rounds() || ']',
  '||||| []',
  '射手の行の利用者が別の利用者へ変わると、変更前の利用者には何も見えない'
);

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('Z')::text, true);
set local role authenticated;

select is(
  pg_temp.seen_all() || '|' || pg_temp.seen_events() || ' [' || pg_temp.member_rounds() || ']',
  'R4|D4|S4|RE4|DE4|SE4 [R4]',
  '射手の行の利用者が変わると、変更後の利用者が読める'
);

reset role;
select * from finish();

rollback;
