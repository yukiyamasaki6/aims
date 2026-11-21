-- 更新前の矢（矢のIDで識別、射順は任意）を、マス(distance_id, end_number, shot_number)へ写す移行を確認する。
--   - 生きている矢は、エンドごとに点数の高い順（X、10、9、…、1、M）、同点は旧idの昇順で、1から射順を振る
--   - 旧shot_numberは使わず、他の矢の番号と衝突しても、NULLや範囲外でも失敗しない
--   - 取り消し済みの矢とその履歴は残らず、生きている矢の履歴はマスへ付け替わり、revisionは更新前の続きになる
--   - 生きている矢の合計・小計は、移行の前後で変わらない
-- 実行の方式: pgTAPのトランザクションの中で、shotsとshot_eventsを更新前の形へDDLで戻し、更新前の形のデータを入れ、
-- 適用済みの移行のSQL（supabase_migrations.schema_migrationsのstatements）を実行し、結果を確かめて巻き戻す。
-- 移行のファイルは、テストの実行環境から読めない（tests/だけが読める）ため、CLIが適用時に記録した同じSQLを使う。
-- 他のテストが作った行は、更新前の形へ戻すために、このトランザクションの中でだけ消す（巻き戻す）。

begin;

select plan(19);

create temp table mg_id (alias text primary key, id uuid not null);
insert into mg_id (alias, id) values
  ('E',  'f2000000-0000-0000-0000-000000000001'),
  ('V',  'f2000000-0000-0000-0000-000000000002'),
  ('R',  'f2000000-0000-0000-0000-000000000010'),
  ('R2', 'f2000000-0000-0000-0000-000000000011'),
  ('D1', 'f2000000-0000-0000-0000-000000000020'),
  ('D2', 'f2000000-0000-0000-0000-000000000021'),
  ('D3', 'f2000000-0000-0000-0000-000000000022'),
  ('D4', 'f2000000-0000-0000-0000-000000000023');

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from mg_id where alias = p_alias $$;

-- 更新前の形へ戻す。矢と履歴は空にしてから、主キー・列・索引を更新前に揃える。
create function pg_temp.to_old_form() returns void
language plpgsql
as $$
begin
  delete from public.shot_events;
  delete from public.shots;
  alter table public.shots drop constraint shots_pkey;
  alter table public.shots add column id uuid not null default gen_random_uuid();
  alter table public.shots add constraint shots_pkey primary key (id);
  alter table public.shots alter column shot_number drop not null;
  create index shots_live_end_idx on public.shots (distance_id, end_number);
  create unique index shots_live_shot_number_key on public.shots (distance_id, end_number, shot_number)
    where disabled_at is null and shot_number is not null;
  alter table public.shot_events drop constraint shot_events_cell_revision_key;
  alter table public.shot_events add column shot_id uuid not null;
  alter table public.shot_events alter column shot_number drop not null;
  alter table public.shot_events add constraint shot_events_shot_id_revision_key unique (shot_id, revision);
end;
$$;

-- 適用済みの移行のSQLを、記録された順に実行する。
create function pg_temp.run_migration() returns void
language plpgsql
as $$
declare
  v_statements text[];
  v_statement text;
begin
  select statements into strict v_statements
  from supabase_migrations.schema_migrations where version = '20261121000001';
  foreach v_statement in array v_statements loop
    execute v_statement;
  end loop;
end;
$$;

-- 更新前の矢。idは番号から作る。同点の矢のidが小さいほど作成を遅くし、id順と作成順を逆にする。
create function pg_temp.old_shot(
  p_n int, p_distance text, p_end int, p_shooter text, p_score text, p_old_number int, p_disabled boolean default false, p_revision int default 1
) returns void
language plpgsql
as $$
begin
  insert into public.shots (id, distance_id, end_number, shooter_id, score_str, score_int, created_at, disabled_at, shot_number, revision)
  values (
    ('a0000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid, pg_temp.id(p_distance), p_end, pg_temp.id(p_shooter), p_score,
    case p_score when 'X' then 10 when 'M' then 0 when 'Z' then 99 else p_score::bigint end,
    timestamptz '2026-01-01 00:00+00' + make_interval(secs => 1000 - p_n), case when p_disabled then now() end, p_old_number, p_revision);
end;
$$;

-- 更新前の履歴。マスの番号は、旧shot_numberを記録した履歴だけが持つ。
create function pg_temp.old_event(
  p_n int, p_shot int, p_distance text, p_end int, p_revision int, p_type text, p_score text, p_old_number int, p_set_fields text[]
) returns void
language plpgsql
as $$
begin
  insert into public.shot_events (event_id, distance_id, shot_id, type, author_id, revision, end_number, shooter_id, score_str, score_int, shot_number, set_fields, created_at)
  values (
    ('b0000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid, pg_temp.id(p_distance),
    ('a0000000-0000-0000-0000-' || lpad(p_shot::text, 12, '0'))::uuid, p_type, pg_temp.id('E'), p_revision, p_end,
    case p_type when 'RECORDED' then pg_temp.id('E') end, p_score,
    case p_score when 'X' then 10 when 'M' then 0 when 'Z' then 99 else p_score::bigint end, p_old_number, p_set_fields,
    timestamptz '2026-01-01 01:00+00' + make_interval(secs => p_n));
end;
$$;

-- マスごとの 点数:マスの番号 を番号順に並べる。
create function pg_temp.cells(p_distance text, p_end int) returns text
language sql stable
as $$
  select string_agg(score_str || ':' || shot_number, ' ' order by shot_number)
  from public.shots where distance_id = pg_temp.id(p_distance) and end_number = p_end
$$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('V'));
select pg_temp.to_old_form();

-- Fixture: 検証データは屋外の形（12エンド×3射、6エンド×6射）で、D2だけ範囲外の行を持つ。
insert into public.rounds (id, name, round_date, format, bow_type, disabled_at) values
  (pg_temp.id('R'), 'Migration', '2026-01-01', 'outdoor', 'recurve', null),
  (pg_temp.id('R2'), 'Migration Deleted', '2026-01-01', 'outdoor', 'recurve', now());
insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('R'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R'), pg_temp.id('V'), 'editor'),
  (pg_temp.id('R2'), pg_temp.id('E'), 'editor');
insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, disabled_at) values
  (pg_temp.id('D1'), pg_temp.id('R'), 'a', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', true, null),
  (pg_temp.id('D2'), pg_temp.id('R'), 'b', 50, 12, 3, 'a1000000-0000-0000-0000-000000000001', true, null),
  (pg_temp.id('D3'), pg_temp.id('R'), 'c', 30, 6, 6, 'a1000000-0000-0000-0000-000000000001', true, now()),
  (pg_temp.id('D4'), pg_temp.id('R2'), 'a', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', true, null);

-- D1の1エンド: 順不同の点数（X・10・同点の9・M）。旧shot_numberはNULLと任意の値。取り消し済みの矢（Xと9）を含む。
select pg_temp.old_shot(101, 'D1', 1, 'E', '7', 1);
select pg_temp.old_shot(102, 'D1', 1, 'E', 'X', 2);
select pg_temp.old_shot(103, 'D1', 1, 'E', 'M', null);
select pg_temp.old_shot(104, 'D1', 1, 'E', '10', 3);
select pg_temp.old_shot(105, 'D1', 1, 'E', '9', 4, false, 3);
select pg_temp.old_shot(106, 'D1', 1, 'V', '9', 5);
select pg_temp.old_shot(107, 'D1', 1, 'E', 'X', 6, true, 2);
select pg_temp.old_shot(108, 'D1', 1, 'E', '9', null, true, 2);
-- 矢105は3回直した。矢107・108は取り消した。
select pg_temp.old_event(1, 105, 'D1', 1, 1, 'RECORDED', '8', 4, array['score', 'shooter_id', 'shot_number']);
select pg_temp.old_event(2, 105, 'D1', 1, 2, 'RECORDED', '9', 4, array['score', 'shot_number']);
select pg_temp.old_event(3, 105, 'D1', 1, 3, 'RECORDED', '9', null, array['score']);
select pg_temp.old_event(4, 102, 'D1', 1, 1, 'RECORDED', 'X', 2, array['score', 'shooter_id', 'shot_number']);
select pg_temp.old_event(5, 107, 'D1', 1, 1, 'RECORDED', 'X', 6, array['score', 'shooter_id', 'shot_number']);
select pg_temp.old_event(6, 107, 'D1', 1, 2, 'CLEARED', null, null, null);
select pg_temp.old_event(7, 108, 'D1', 1, 1, 'RECORDED', '9', null, array['score', 'shooter_id']);
select pg_temp.old_event(8, 108, 'D1', 1, 2, 'CLEARED', null, null, null);
-- D1の2エンド: 低い点数が旧番号1、高い点数が旧番号2で入れ替わり、欠番（5）がある。
select pg_temp.old_shot(111, 'D1', 2, 'E', '5', 1);
select pg_temp.old_shot(112, 'D1', 2, 'E', '9', 2);
select pg_temp.old_shot(113, 'D1', 2, 'E', '8', 5);
-- D1の3エンド: 旧shot_numberがNULLと範囲外（射数/エンド6に対して9）。
select pg_temp.old_shot(121, 'D1', 3, 'E', '6', null);
select pg_temp.old_shot(122, 'D1', 3, 'E', '10', 9);
-- D1の4エンドとD2の2エンド: エンドごとに独立して1から振られる。
select pg_temp.old_shot(131, 'D1', 4, 'E', '9', 3);
select pg_temp.old_shot(161, 'D2', 2, 'E', '9', 1);
-- D1の6エンド: 的に無い点数（Z=99）。
select pg_temp.old_shot(141, 'D1', 6, 'E', '9', 1);
select pg_temp.old_shot(142, 'D1', 6, 'E', 'Z', 2);
-- D2の1エンド: 射数/エンド3を超える4本（範囲外の行）。
select pg_temp.old_shot(151, 'D2', 1, 'E', 'X', null);
select pg_temp.old_shot(152, 'D2', 1, 'E', '10', null);
select pg_temp.old_shot(153, 'D2', 1, 'E', '9', null);
select pg_temp.old_shot(154, 'D2', 1, 'E', '8', null);
-- 削除済みの距離（D3）と、削除済みのラウンドの距離（D4）。
select pg_temp.old_shot(171, 'D3', 1, 'E', '9', 2);
select pg_temp.old_shot(172, 'D3', 1, 'E', '10', 1);
select pg_temp.old_shot(181, 'D4', 1, 'E', '7', null);
select pg_temp.old_shot(182, 'D4', 1, 'E', 'X', null);

-- 移行の前の、生きている矢の距離ごとの合計・件数と、残る履歴。
create temp table mg_before_sum as
select distance_id, sum(score_int) as total, count(*) as n from public.shots where disabled_at is null group by distance_id;
create temp table mg_before_events as
select event_id, distance_id, end_number, revision, type, score_str, shooter_id, created_at,
  array_remove(set_fields, 'shot_number') as set_fields
from public.shot_events
where shot_id in (select id from public.shots where disabled_at is null);

-- ============================================================
-- 移行の実行
-- ============================================================

select lives_ok(
  'select pg_temp.run_migration()',
  '更新前の形のデータに対して、移行は失敗せず完了する'
);

-- ============================================================
-- 射順の振り方
-- ============================================================

select is(
  pg_temp.cells('D1', 1),
  'X:1 10:2 9:3 9:4 7:5 M:6',
  '各エンドで点数の高い順(X、10、9、…、1、M)に1から射順が振られ、Xは10より前、Mは最後になる'
);
select is(
  (select string_agg(u.alias, ',' order by s.shot_number)
    from public.shots s join mg_id u on u.id = s.shooter_id
    where s.distance_id = pg_temp.id('D1') and s.end_number = 1 and s.score_str = '9'),
  'E,V',
  '同点は旧idの昇順で振られる（作成時刻が逆でも旧idの順）'
);
select is(
  pg_temp.cells('D1', 3),
  '10:1 6:2',
  '旧shot_numberがNULLや範囲外でも、旧い番号は使わず点数順に振り直される'
);
select is(
  pg_temp.cells('D1', 2),
  '9:1 8:2 5:3',
  '旧shot_numberが他の矢の振る番号と衝突し、欠番があるエンドでも、失敗せず点数順に1から振られる'
);
select is(
  pg_temp.cells('D1', 4) || ' ' || pg_temp.cells('D2', 2) || ' ' || pg_temp.cells('D1', 1),
  '9:1 9:1 X:1 10:2 9:3 9:4 7:5 M:6',
  'エンドごと・距離ごとに独立して1から振られ、エンドをまたいで続かない'
);
select is(
  pg_temp.cells('D1', 6),
  'Z:1 9:2',
  '的に無い点数の矢も、点数の大きさで同じ規則に従って振られる'
);
select is(
  pg_temp.cells('D3', 1) || ' ' || pg_temp.cells('D4', 1),
  '10:1 9:2 X:1 7:2',
  '削除済みの距離・削除済みのラウンドの矢も、同じ規則で振られる'
);
select is(
  pg_temp.cells('D2', 1),
  'X:1 10:2 9:3 8:4',
  '射数/エンドを超える範囲外の行があっても失敗せず、範囲の補正はせずに振られる'
);

-- ============================================================
-- 取り消し済みの矢と履歴
-- ============================================================

select is(
  (select count(*) from public.shots where disabled_at is not null)
    || ' ' || (select count(*) from public.shot_events where event_id in
      (select ('b0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from unnest(array[5, 6, 7, 8]) n)),
  '0 0',
  '取り消し済みの行と、その矢の履歴は残らない'
);
select is(
  (select count(*) from public.shots where distance_id = pg_temp.id('D1') and end_number = 1),
  6::bigint,
  '生きている矢の番号は取り消し済みの矢を数えず、1から6まで欠けずに並ぶ'
);

-- ============================================================
-- 生きている矢の履歴
-- ============================================================

select results_eq(
  $$select event_id, distance_id, end_number, revision, type, score_str, shooter_id, created_at, array_remove(set_fields, 'shot_number')
    from public.shot_events order by event_id$$,
  $$select event_id, distance_id, end_number, revision, type, score_str, shooter_id, created_at, set_fields
    from mg_before_events order by event_id$$,
  '生きている矢の履歴は、件数・revision・点数・射手・時刻が変わらず、set_fieldsからshot_numberだけが外れる'
);
select is(
  (select string_agg(e.shot_number::text, ',' order by e.revision) from public.shot_events e
    where e.distance_id = pg_temp.id('D1') and e.end_number = 1 and e.event_id in (
      'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003')),
  '3,3,3',
  '矢を直した複数の履歴は、旧shot_numberでなく移行後のマスの番号(3)へ付け替えられる'
);
select is(
  (select count(*) from public.shot_events e
    left join public.shots s using (distance_id, end_number, shot_number) where s.score_str is null),
  0::bigint,
  '全ての履歴のマスに、対応する矢の行がある'
);

-- ============================================================
-- 合計・小計
-- ============================================================

select results_eq(
  $$select distance_id, sum(score_int)::bigint, count(*)::bigint from public.shots where disabled_at is null group by distance_id order by distance_id$$,
  $$select distance_id, total::bigint, n::bigint from mg_before_sum order by distance_id$$,
  '生きている矢の距離ごとの合計と件数は、削除済みの距離・ラウンドを含めて、移行の前後で一致する'
);

-- ============================================================
-- 移行後の矢
-- ============================================================

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000001', true);

-- 移行後のマスへ、直す・消す・直して戻す。revisionは更新前の続き（矢105は3まで）になる。
create temp table mg_r (n int primary key, r jsonb not null);
grant select, insert on mg_r to authenticated;
insert into mg_r (n, r) values
  (1, public.record_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', 'c0000000-0000-0000-0000-000000000001', 'distance_id', 'f2000000-0000-0000-0000-000000000020',
    'end_number', 1, 'shot_number', 3, 'score_str', '8', 'score_int', 8)))),
  (2, public.clear_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', 'c0000000-0000-0000-0000-000000000002', 'distance_id', 'f2000000-0000-0000-0000-000000000020',
    'end_number', 1, 'shot_number', 3)))),
  (3, public.record_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', 'c0000000-0000-0000-0000-000000000003', 'distance_id', 'f2000000-0000-0000-0000-000000000020',
    'end_number', 1, 'shot_number', 3, 'score_str', '10', 'score_int', 10))));
select is(
  (select string_agg(coalesce(r -> 0 ->> 'revision', '-') || ':' || (r -> 0 ->> 'applied'), ' ' order by n) from mg_r),
  '4:true 5:true 6:true',
  '移行後の矢は、直す・消す・消した後に戻す記録の対象になり、revisionは更新前の最大の次から進む'
);
select is(
  (select score_str || ' ' || shot_number || ' ' || (disabled_at is null)::text from public.shots
    where distance_id = 'f2000000-0000-0000-0000-000000000020' and end_number = 1 and shot_number = 3),
  '10 3 true',
  '戻した記録は、移行したマスの行に反映される'
);

-- 旧い形（shot_idで矢を指す）の要素は、移行後は契約の不一致で破棄される。
select throws_ok(
  $$select public.record_shots(jsonb_build_array(jsonb_build_object(
    'shot_event_id', 'c0000000-0000-0000-0000-000000000004', 'shot_id', 'a0000000-0000-0000-0000-000000000105',
    'distance_id', 'f2000000-0000-0000-0000-000000000020', 'end_number', 1, 'score_str', '9', 'score_int', 9)))$$,
  'PT422',
  null,
  '更新前の形の要素（shot_idで矢を指し、shot_numberが無い）は、移行後は契約の不一致で拒否される'
);

reset role;

-- ============================================================
-- 空の表
-- ============================================================

select pg_temp.to_old_form();
select lives_ok(
  'select pg_temp.run_migration()',
  'shotsとshot_eventsが空でも、移行は失敗せず完了する'
);

select * from finish();

rollback;
