-- 履歴の読み取りの共通関数history_roundsの契約を確認する。
--   - authenticatedで直接呼ぶと、属するラウンドのうち、完了・無効でない・条件に一致する行だけを返す
--   - 返すラウンドの集合が、roundsを同じ条件で直接読んだ結果と一致する（読む範囲が同じ）
-- 条件ごとの詳細な組合せ（境界、距離の構成の順など）は、この関数を通すrounds_list.sqlが担う。
-- 関数の実行権限（anon、authenticated）はrls_matrix.sqlの関数表で固定している。

begin;

select plan(5);

create temp table hr_id (alias text primary key, id uuid not null);
insert into hr_id (alias, id) values
  ('E', 'c1000000-0000-0000-0000-000000000001'),
  ('N', 'c1000000-0000-0000-0000-000000000002'),
  ('W', 'c1000000-0000-0000-0000-000000000003'),
  ('HA', 'c1000000-0000-0000-0000-000000000101'),
  ('HB', 'c1000000-0000-0000-0000-000000000102'),
  ('HP', 'c1000000-0000-0000-0000-000000000103'),
  ('HX', 'c1000000-0000-0000-0000-000000000104'),
  ('HN', 'c1000000-0000-0000-0000-000000000105'),
  ('HV', 'c1000000-0000-0000-0000-000000000106'),
  ('HW', 'c1000000-0000-0000-0000-000000000107');

grant select on hr_id to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from hr_id where alias = p_alias $$;

-- 実際にある形のラウンドを作る。p_rowsは距離の行の配列で、d=距離、e=総エンド数、a=1エンドの矢数、f=的のID。
-- 屋外は各距離6エンド×6射、インドアは10エンド×3射で、全距離で同じ形にする。矢は入れない（この関数は合計点を扱わない）。
create function pg_temp.mk(
  p_alias text, p_owner text, p_date date, p_format text, p_bow_type text, p_status text, p_rows jsonb, p_disabled boolean default false
) returns void
language plpgsql
as $$
declare
  v_round uuid := pg_temp.id(p_alias);
  v_created timestamptz := (p_date + time '09:00') at time zone 'UTC';
begin
  insert into public.rounds (id, name, round_date, created_at, format, bow_type, status, disabled_at)
  values (v_round, p_alias, p_date, v_created, p_format, p_bow_type, p_status, case when p_disabled then v_created end);
  insert into public.round_users (round_id, user_id, role) values (v_round, pg_temp.id(p_owner), 'editor');
  insert into public.distances (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
  select v_round, e.ord::text, (e.v ->> 'd')::int, (e.v ->> 'e')::int, (e.v ->> 'a')::int, (e.v ->> 'f')::uuid
  from jsonb_array_elements(p_rows) with ordinality as e(v, ord);
end;
$$;

-- 条件を指定して呼び、返したラウンドの別名を、別名の順に並べる。
create function pg_temp.aliases(p_format text default null, p_bow_type text default null, p_from date default null, p_to date default null, p_distances jsonb default null) returns text
language sql stable
as $$
  select coalesce(string_agg(i.alias, ',' order by i.alias), '')
  from public.history_rounds(p_format, p_bow_type, p_from, p_to, p_distances) as r
  join hr_id i on i.id = r.id
$$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('N')), (pg_temp.id('W'));

-- Fixture: 本人Eが見えるラウンド（完了・削除されていない）は、E所有のHA・HBと、閲覧者として属するHV。
--   HA: 屋外・リカーブ・50m→30m  HB: インドア・コンパウンド・18m  HV: インドア・リカーブ・18m（Nの完了。Eは閲覧者）
-- 返さない行: HP（Eの入力中）、HX（Eの削除済み）、HN（Nだけが属する完了）。
-- HW: Wだけが属する屋外・ベアボウの完了。
select pg_temp.mk('HA', 'E', '2026-09-10', 'outdoor', 'recurve', 'completed',
  '[{"d":50,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000001"},{"d":30,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000001"}]');
select pg_temp.mk('HB', 'E', '2026-09-12', 'indoor', 'compound', 'completed',
  '[{"d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004"}]');
select pg_temp.mk('HP', 'E', '2026-09-13', 'outdoor', 'recurve', 'in_progress',
  '[{"d":50,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000001"}]');
select pg_temp.mk('HX', 'E', '2026-09-14', 'outdoor', 'recurve', 'completed',
  '[{"d":50,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000001"}]', true);
select pg_temp.mk('HN', 'N', '2026-09-15', 'outdoor', 'recurve', 'completed',
  '[{"d":50,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000001"}]');
select pg_temp.mk('HV', 'N', '2026-09-11', 'indoor', 'recurve', 'completed',
  '[{"d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004"}]');
insert into public.round_users (round_id, user_id, role) values (pg_temp.id('HV'), pg_temp.id('E'), 'viewer');
select pg_temp.mk('HW', 'W', '2026-09-16', 'outdoor', 'barebow', 'completed',
  '[{"d":70,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000001"},{"d":50,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000001"}]');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

select is(
  pg_temp.aliases(),
  'HA,HB,HV',
  '条件を全て指定しないと、完了で無効でない、属するラウンドだけを返し、入力中・削除済み・属さないラウンドを返さない'
);

select is(
  (select count(*) from public.history_rounds(null, null, null, null, null) as r where r.id = pg_temp.id('HV')),
  1::bigint,
  '閲覧者として属するラウンドも返す'
);

select is(
  (select array_agg(r.id order by r.id) from public.history_rounds(null, null, null, null, null) as r),
  (select array_agg(r.id order by r.id) from public.rounds as r where r.status = 'completed' and r.disabled_at is null),
  '返すラウンドの集合が、同じ条件（完了・無効でない）でroundsを直接読んだ結果と一致する'
);

select is(
  pg_temp.aliases('outdoor', 'recurve', '2026-09-10', '2026-09-10', '[{"distance": 50}, {"distance": 30}]'),
  'HA',
  '種別・弓種・期間・距離の構成の5条件を全て渡すと、全てに一致するラウンドだけを返す'
);

select set_config('request.jwt.claim.sub', pg_temp.id('W')::text, true);

select is(
  pg_temp.aliases(),
  'HW',
  '利用者を切り替えると、その利用者が属するラウンドだけを返し、切替前の結果と重ならない'
);

select * from finish();

rollback;
