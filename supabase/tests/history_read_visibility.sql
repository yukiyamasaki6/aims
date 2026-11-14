-- ラウンド・距離・矢を読める範囲を、利用者の視点ごとの行の集合（ID）で確認する。
--   - 所属するラウンドと、その距離・矢が読める（削除済みの行、距離のないラウンド、矢のない距離を含む）
--   - 所属しないラウンドと、その距離・矢は、一覧でもID指定でも読めない
--   - 見える矢の親の距離、見える距離の親のラウンドは、必ず見える
-- ポリシーの式や索引の有無は確認しない。読める範囲が変わらないことだけを固定する。
-- anonの拒否と書き込みの拒否はrls_matrix.sqlで固定している。

begin;

select plan(9);

create temp table hv_id (alias text primary key, id uuid not null);
insert into hv_id (alias, id) values
  ('E', 'd0000000-0000-0000-0000-000000000001'),
  ('V', 'd0000000-0000-0000-0000-000000000002'),
  ('X', 'd0000000-0000-0000-0000-000000000003'),
  ('Y', 'd0000000-0000-0000-0000-000000000004'),
  ('R1', 'd0000000-0000-0000-0000-000000000101'),
  ('R2', 'd0000000-0000-0000-0000-000000000102'),
  ('R3', 'd0000000-0000-0000-0000-000000000103'),
  ('R4', 'd0000000-0000-0000-0000-000000000104'),
  ('D1a', 'd0000000-0000-0000-0000-000000000201'),
  ('D1b', 'd0000000-0000-0000-0000-000000000202'),
  ('D3', 'd0000000-0000-0000-0000-000000000203'),
  ('D4', 'd0000000-0000-0000-0000-000000000204'),
  ('S1a', 'd0000000-0000-0000-0000-000000000301'),
  ('S1b', 'd0000000-0000-0000-0000-000000000302'),
  ('S3', 'd0000000-0000-0000-0000-000000000303'),
  ('S4', 'd0000000-0000-0000-0000-000000000304');

grant select on hv_id to authenticated;

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
  execute format(
    'select coalesce(string_agg(coalesce(i.alias, ''?''), '','' order by coalesce(i.alias, ''?'')), '''') from public.%I t left join hv_id i on i.id = t.id',
    p_table
  ) into v_result;
  return v_result;
end;
$$;

-- 3つの表で見えた行を、rounds|distances|shots の形で返す。
create function pg_temp.seen_all() returns text
language sql
as $$ select pg_temp.seen('rounds') || '|' || pg_temp.seen('distances') || '|' || pg_temp.seen('shots') $$;

insert into auth.users (id) select id from hv_id where alias in ('E', 'V', 'X', 'Y');

-- Fixture: 検証データは屋外の形（各距離12エンド×3射。同じラウンドの全距離で同じ形）にする。
-- R1: Eが編集者、Vが閲覧者。距離D1a（矢2本）と、矢のない距離D1b。
-- R2: Eのみ。距離のないラウンド。
-- R3: Eのみ。削除済み。削除済みの距離D3と、削除済みの矢S3を持つ。
-- R4: 別の利用者Yのみ。E・V・Xとも属さない。距離D4と矢S4を持つ。
-- 矢はエンドの全矢を満たさないが、見える範囲の確認に必要な最小本数にする。
insert into public.rounds (id, name, round_date, format, bow_type, status, disabled_at) values
  (pg_temp.id('R1'), 'R1', '2026-10-01', 'outdoor', 'recurve', 'completed', null),
  (pg_temp.id('R2'), 'R2', '2026-10-02', 'outdoor', 'recurve', 'in_progress', null),
  (pg_temp.id('R3'), 'R3', '2026-10-03', 'outdoor', 'recurve', 'completed', '2026-10-04 00:00+00'),
  (pg_temp.id('R4'), 'R4', '2026-10-05', 'outdoor', 'recurve', 'completed', null);

insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('R1'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R1'), pg_temp.id('V'), 'viewer'),
  (pg_temp.id('R2'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R3'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R4'), pg_temp.id('Y'), 'editor');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, disabled_at) values
  (pg_temp.id('D1a'), pg_temp.id('R1'), '1', 70, 12, 3, 'a1000000-0000-0000-0000-000000000001', null),
  (pg_temp.id('D1b'), pg_temp.id('R1'), '2', 60, 12, 3, 'a1000000-0000-0000-0000-000000000001', null),
  (pg_temp.id('D3'), pg_temp.id('R3'), '1', 70, 12, 3, 'a1000000-0000-0000-0000-000000000001', '2026-10-04 00:00+00'),
  (pg_temp.id('D4'), pg_temp.id('R4'), '1', 70, 12, 3, 'a1000000-0000-0000-0000-000000000001', null);

insert into public.shots (id, distance_id, end_number, shooter_id, score_str, score_int, disabled_at) values
  (pg_temp.id('S1a'), pg_temp.id('D1a'), 1, pg_temp.id('E'), 'X', 10, null),
  (pg_temp.id('S1b'), pg_temp.id('D1a'), 1, pg_temp.id('E'), '9', 9, null),
  (pg_temp.id('S3'), pg_temp.id('D3'), 1, pg_temp.id('E'), '8', 8, '2026-10-04 00:00+00'),
  (pg_temp.id('S4'), pg_temp.id('D4'), 1, pg_temp.id('Y'), 'X', 10, null);

-- ============================================================
-- 所属するラウンド（編集者E）
-- ============================================================

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

select is(
  pg_temp.seen('rounds'),
  'R1,R2,R3',
  '所属するラウンドが見え、削除済みのラウンドと距離のないラウンドを含む'
);

select is(
  pg_temp.seen('distances'),
  'D1a,D1b,D3',
  '所属するラウンドの距離が見え、削除済みの距離と矢のない距離を含む'
);

select is(
  pg_temp.seen('shots'),
  'S1a,S1b,S3',
  '所属するラウンドの距離の矢が見え、削除済みの矢を含む'
);

-- ============================================================
-- 閲覧者V
-- ============================================================

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('V')::text, true);
set local role authenticated;

select is(
  pg_temp.seen_all(),
  'R1|D1a,D1b|S1a,S1b',
  '閲覧者として属するラウンドとその距離・矢だけが見え、属さないラウンドは見えない'
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
    || ',' || (select count(*) from public.shots where id = pg_temp.id('S4'))::text
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

reset role;
select * from finish();

rollback;
