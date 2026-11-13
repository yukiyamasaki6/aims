-- 履歴の取得の関数rounds_listの振る舞いを確認する。
--   - 返す行（完了かつ削除されていない）、返す項目、合計点
--   - 並び（基準 × 向き、同値の並び）と絞り込み（種別、弓種、期間、得点の範囲、距離の構成）
--   - ページの切り出し（has_more、起点のID、全ページの連結）と、ページの間の変更
--   - 権限（自分が属するラウンドだけ）、起点が見えない・引数が未知のとき
-- 関数の実行権限（anon、authenticated）はrls_matrix.sqlの関数表で固定している。

begin;

select plan(95);

create temp table rl_id (alias text primary key, id uuid not null);
insert into rl_id (alias, id) values
  ('E', 'c0000000-0000-0000-0000-000000000001'),
  ('N', 'c0000000-0000-0000-0000-000000000002'),
  ('U', 'c0000000-0000-0000-0000-000000000003'),
  ('A', 'c0000000-0000-0000-0000-000000000101'),
  ('B', 'c0000000-0000-0000-0000-000000000102'),
  ('C', 'c0000000-0000-0000-0000-000000000103'),
  ('D', 'c0000000-0000-0000-0000-000000000104'),
  ('F', 'c0000000-0000-0000-0000-000000000106'),
  ('G', 'c0000000-0000-0000-0000-000000000107'),
  ('H', 'c0000000-0000-0000-0000-000000000108'),
  ('I', 'c0000000-0000-0000-0000-000000000109'),
  ('J', 'c0000000-0000-0000-0000-00000000010a'),
  ('P', 'c0000000-0000-0000-0000-000000000110'),
  ('X', 'c0000000-0000-0000-0000-000000000111'),
  ('Y', 'c0000000-0000-0000-0000-000000000112'),
  ('Z', 'c0000000-0000-0000-0000-000000000113'),
  ('Q', 'c0000000-0000-0000-0000-000000000121'),
  ('R', 'c0000000-0000-0000-0000-000000000122'),
  ('S', 'c0000000-0000-0000-0000-000000000123'),
  ('V', 'c0000000-0000-0000-0000-000000000130'),
  ('W', 'c0000000-0000-0000-0000-000000000131'),
  ('M1', 'c0000000-0000-0000-0000-000000000132'),
  ('M2', 'c0000000-0000-0000-0000-000000000133'),
  ('M3', 'c0000000-0000-0000-0000-000000000134'),
  ('M4', 'c0000000-0000-0000-0000-000000000135'),
  ('M5', 'c0000000-0000-0000-0000-000000000136'),
  ('M6', 'c0000000-0000-0000-0000-000000000137'),
  ('M7', 'c0000000-0000-0000-0000-000000000138'),
  ('M8', 'c0000000-0000-0000-0000-000000000139'),
  ('M9', 'c0000000-0000-0000-0000-00000000013a'),
  ('M10', 'c0000000-0000-0000-0000-00000000013b'),
  ('M11', 'c0000000-0000-0000-0000-00000000013c'),
  ('M12', 'c0000000-0000-0000-0000-00000000013d'),
  ('M13', 'c0000000-0000-0000-0000-00000000013e'),
  ('M14', 'c0000000-0000-0000-0000-00000000013f'),
  ('M15', 'c0000000-0000-0000-0000-000000000140'),
  ('K1', 'c0000000-0000-0000-0000-000000000141'),
  ('K2', 'c0000000-0000-0000-0000-000000000142'),
  ('K3', 'c0000000-0000-0000-0000-000000000143'),
  ('K4', 'c0000000-0000-0000-0000-000000000144'),
  ('K5', 'c0000000-0000-0000-0000-000000000145');

grant select on rl_id to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from rl_id where alias = p_alias $$;

-- 実際にある形のラウンドを作る。屋外は各距離12エンド×3射、インドアは10エンド×3射で、全距離で同じ形にする。
-- 合計点は、10点の矢を並べ、端数の1本と残りの0点で作る（矢の点そのものは検証の対象ではない）。
create function pg_temp.mk(
  p_alias text, p_owner text, p_date date, p_format text, p_bow_type text,
  p_status text, p_created timestamptz, p_total int, p_disabled boolean default false
) returns void
language plpgsql
as $$
declare
  v_round uuid := pg_temp.id(p_alias);
  v_ends int := case p_format when 'outdoor' then 12 else 10 end;
  v_shots_per_distance int := v_ends * 3;
  v_distance uuid;
  v_n int;
begin
  insert into public.rounds (id, name, round_date, created_at, format, bow_type, status, disabled_at)
  values (v_round, p_alias, p_date, p_created, p_format, p_bow_type, p_status, case when p_disabled then p_created end);
  insert into public.round_users (round_id, user_id, role) values (v_round, pg_temp.id(p_owner), 'editor');
  for v_n in 1..2 loop
    v_distance := gen_random_uuid();
    insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values (v_distance, v_round, v_n::text, 30 * v_n, v_ends, 3, 'a1000000-0000-0000-0000-000000000001');
    insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int)
    select v_distance, (i - 1) / 3 + 1, pg_temp.id(p_owner),
      case s when 10 then 'X' when 0 then 'M' else s::text end, s
    from generate_series(1, v_shots_per_distance) as i,
      lateral (select case
        when (v_n - 1) * v_shots_per_distance + i <= p_total / 10 then 10
        when (v_n - 1) * v_shots_per_distance + i = p_total / 10 + 1 then p_total % 10
        else 0 end as s) as score;
  end loop;
end;
$$;

-- 期間（p_from、p_to）、得点の範囲（p_min、p_max）、距離の構成（p_distances）は任意で、指定しなければ絞り込まない。
create function pg_temp.list(
  p_sort_key text, p_sort_direction text, p_format text, p_bow_type text, p_after text, p_limit int,
  p_from date default null, p_to date default null, p_min bigint default null, p_max bigint default null,
  p_distances jsonb default null
) returns jsonb
language sql stable
as $$ select public.rounds_list(p_sort_key, p_sort_direction, p_format, p_bow_type, p_after::uuid, p_limit, p_from, p_to, p_min, p_max, p_distances) $$;

-- 返した行の別名を、返した順に並べる。
create function pg_temp.ids(p_page jsonb) returns text
language sql stable
as $$
  select coalesce(string_agg(i.alias, ',' order by e.ord), '')
  from jsonb_array_elements(p_page -> 'rounds') with ordinality as e(r, ord)
  join rl_id i on i.id = (e.r ->> 'id')::uuid
$$;

create function pg_temp.totals(p_page jsonb) returns text
language sql stable
as $$
  select coalesce(string_agg(i.alias || ':' || (e.r ->> 'total'), ',' order by i.alias), '')
  from jsonb_array_elements(p_page -> 'rounds') as e(r)
  join rl_id i on i.id = (e.r ->> 'id')::uuid
$$;

-- 行数と続きの有無。
create function pg_temp.shape(p_page jsonb) returns text
language sql stable
as $$ select jsonb_array_length(p_page -> 'rounds') || ':' || (p_page ->> 'has_more') $$;

-- 起点のIDで全ページをたどり、返した順に連結する。件数はsizesを順に使う（ページごとに違う）。
create function pg_temp.walk(
  p_sort_key text, p_sort_direction text, p_format text, p_sizes int[],
  p_from date default null, p_to date default null, p_min bigint default null, p_max bigint default null,
  p_distances jsonb default null
) returns text
language plpgsql stable
as $$
declare
  v_page jsonb;
  v_after text := null;
  v_ids text := '';
  v_n int := 0;
  v_pages text;
begin
  loop
    v_page := pg_temp.list(p_sort_key, p_sort_direction, p_format, null, v_after, p_sizes[v_n % cardinality(p_sizes) + 1], p_from, p_to, p_min, p_max, p_distances);
    v_pages := pg_temp.ids(v_page);
    v_ids := v_ids || case when v_ids = '' or v_pages = '' then '' else ',' end || v_pages;
    exit when not (v_page ->> 'has_more')::boolean;
    v_after := v_page -> 'rounds' -> -1 ->> 'id';
    v_n := v_n + 1;
    exit when v_n > 50;
  end loop;
  return v_ids;
end;
$$;

-- 距離の行を指定してラウンドを作る（距離の構成の検証用）。完了のラウンドは、実施日の9時に作る。
-- p_rows は距離の行の配列で、項目は k=position_key、d=距離、e=総エンド数、a=1エンドの矢数、
-- f=的のID（省略時は屋外122cmの公式の的）、m=距離が判明しているか（省略時は真）、x=無効にした行か、i=行のID（省略時は無作為）。
-- 行は配列の順に挿入する（挿入順と position_key の順が違う入力を作るため）。
-- p_tens は、最初の行に置く10点の矢の本数（合計点は p_tens * 10）。
create function pg_temp.mkd(
  p_alias text, p_owner text, p_date date, p_format text, p_bow_type text, p_status text, p_rows jsonb,
  p_disabled boolean default false, p_tens int default 0
) returns void
language plpgsql
as $$
declare
  v_round uuid := pg_temp.id(p_alias);
  v_created timestamptz := (p_date + time '09:00') at time zone 'UTC';
  v_first uuid;
begin
  insert into public.rounds (id, name, round_date, created_at, format, bow_type, status, disabled_at)
  values (v_round, p_alias, p_date, v_created, p_format, p_bow_type, p_status, case when p_disabled then v_created end);
  insert into public.round_users (round_id, user_id, role) values (v_round, pg_temp.id(p_owner), 'editor');
  insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, disabled_at)
  select coalesce((e.v ->> 'i')::uuid, gen_random_uuid()), v_round, e.v ->> 'k', (e.v ->> 'd')::int, (e.v ->> 'e')::int, (e.v ->> 'a')::int,
    coalesce((e.v ->> 'f')::uuid, 'a1000000-0000-0000-0000-000000000001'::uuid), coalesce((e.v ->> 'm')::boolean, true),
    case when (e.v ->> 'x')::boolean then v_created end
  from jsonb_array_elements(p_rows) with ordinality as e(v, ord)
  order by e.ord;
  select id into v_first from public.distances where round_id = v_round order by position_key, id limit 1;
  insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int)
  select v_first, (i - 1) / 3 + 1, pg_temp.id(p_owner), 'X', 10 from generate_series(1, p_tens) as i;
end;
$$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('N')), (pg_temp.id('U')), (pg_temp.id('V')), (pg_temp.id('W'));

-- Fixture: 本人Eが見えるラウンド（完了・削除されていない）9件。
--   実施日と合計点が同じ組（A/H、B/C/D）と、合計点が同じで実施日が違う組（B/C/D/I）を含む。
--   CとDは実施日・合計点・作成時刻まで同じで、IDだけが違う（値そのものが同値の並びの検証対象）。
select pg_temp.mk('A', 'E', '2026-09-10', 'outdoor', 'recurve', 'completed', '2026-09-10 09:00+00', 540);
select pg_temp.mk('H', 'E', '2026-09-10', 'indoor',  'barebow', 'completed', '2026-09-10 12:00+00', 540);
select pg_temp.mk('B', 'E', '2026-09-12', 'indoor',  'compound', 'completed', '2026-09-12 09:00+00', 580);
select pg_temp.mk('C', 'E', '2026-09-12', 'outdoor', 'barebow', 'completed', '2026-09-12 10:00+00', 580);
select pg_temp.mk('D', 'E', '2026-09-12', 'outdoor', 'recurve', 'completed', '2026-09-12 10:00+00', 580);
select pg_temp.mk('I', 'E', '2026-09-13', 'outdoor', 'recurve', 'completed', '2026-09-13 09:00+00', 580);
select pg_temp.mk('F', 'E', '2026-09-14', 'indoor',  'recurve', 'completed', '2026-09-14 09:00+00', 450);
select pg_temp.mk('G', 'E', '2026-09-14', 'outdoor', 'compound', 'completed', '2026-09-14 08:00+00', 597);
-- Eは閲覧者として属する他人（N）のラウンド。
select pg_temp.mk('Z', 'N', '2026-09-11', 'indoor',  'recurve', 'completed', '2026-09-11 09:00+00', 400);
insert into public.round_users (round_id, user_id, role) values (pg_temp.id('Z'), pg_temp.id('E'), 'viewer');
-- 返さない行: 入力中、削除済み。
select pg_temp.mk('P', 'E', '2026-09-15', 'outdoor', 'recurve', 'in_progress', '2026-09-15 09:00+00', 300);
select pg_temp.mk('X', 'E', '2026-09-15', 'outdoor', 'recurve', 'completed', '2026-09-15 10:00+00', 300, true);
-- Eが属さない、Nだけの完了のラウンド。
select pg_temp.mk('Y', 'N', '2026-09-16', 'outdoor', 'recurve', 'completed', '2026-09-16 09:00+00', 500);
-- 合計点の検証用（Uだけが属する）。Q: 距離なし、R: 矢なし、S: 無効な距離・無効な矢を含む。
insert into public.rounds (id, name, round_date, format, bow_type, status) values
  (pg_temp.id('Q'), 'Q', '2026-09-01', 'outdoor', 'recurve', 'completed'),
  (pg_temp.id('R'), 'R', '2026-09-01', 'outdoor', 'recurve', 'completed');
insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('Q'), pg_temp.id('U'), 'editor'),
  (pg_temp.id('R'), pg_temp.id('U'), 'editor');
insert into public.distances (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values (pg_temp.id('R'), '1', 70, 12, 3, 'a1000000-0000-0000-0000-000000000001');
select pg_temp.mk('S', 'U', '2026-09-02', 'outdoor', 'recurve', 'completed', '2026-09-02 09:00+00', 300);
-- Sに、無効な距離（矢は10点）と、生きている距離の無効な矢（10点）を足す。
with disabled_distance as (
  insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, disabled_at)
  values ('c0000000-0000-0000-0000-0000000001d1', pg_temp.id('S'), '3', 90, 12, 3, 'a1000000-0000-0000-0000-000000000001', now())
  returning id
)
insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int)
select id, (i - 1) / 3 + 1, pg_temp.id('U'), 'X', 10 from disabled_distance, generate_series(1, 36) as i;
insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int, disabled_at)
select id, 1, pg_temp.id('U'), 'X', 10, now() from public.distances where round_id = pg_temp.id('S') and position_key = '1';

-- Fixture（距離の構成）: 利用者Vが見える完了のラウンドと、Vに見えない（別の利用者W、入力中、削除済み）ラウンド。
--   実施日は全ラウンドで違う値にして、既定の並び（実施日の新しい順）を一意にする。
--   M1〜M15は屋外6エンド×6射（M6だけ12エンド×3射）で、距離の行の構成だけが違う。
--   M1: 50m→30m  M2: 30m→50m  M3: 70m  M4: 70m→70m  M5: 50m（的は屋外80cm）  M6: 50m 12×3
--   M7: 50m + 無効な30m  M8: 距離なし  M9: 50m + 距離未確定の行  M10: 距離未確定の行だけ（距離50が入っている）
--   M11: position_key の順は30m→50mだが、50mを先に挿入  M15: position_key が同じ2行（30mのIDが小さい）で、50mを先に挿入
--   M12: Wの完了  M13: Vの入力中  M14: Vの削除済み（いずれも50mの1行でVには返らない）
--   K1〜K5: 距離18mの1行（K5だけ18m→30mの2行）で、種別・弓種・実施日・合計点を変えた、他の条件との組合せ用。
select pg_temp.mkd('M1', 'V', '2026-10-01', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6},{"k":"2","d":30,"e":6,"a":6}]');
select pg_temp.mkd('M2', 'V', '2026-10-02', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":30,"e":6,"a":6},{"k":"2","d":50,"e":6,"a":6}]');
select pg_temp.mkd('M3', 'V', '2026-10-03', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":70,"e":6,"a":6}]');
select pg_temp.mkd('M4', 'V', '2026-10-04', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":70,"e":6,"a":6},{"k":"2","d":70,"e":6,"a":6}]');
select pg_temp.mkd('M5', 'V', '2026-10-05', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000002"}]');
select pg_temp.mkd('M6', 'V', '2026-10-06', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":12,"a":3}]');
select pg_temp.mkd('M7', 'V', '2026-10-07', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6},{"k":"2","d":30,"e":6,"a":6,"x":true}]');
select pg_temp.mkd('M8', 'V', '2026-10-08', 'outdoor', 'recurve', 'completed', '[]');
select pg_temp.mkd('M9', 'V', '2026-10-09', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6},{"k":"2","d":null,"e":6,"a":6,"m":false}]');
select pg_temp.mkd('M10', 'V', '2026-10-10', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6,"m":false}]');
select pg_temp.mkd('M11', 'V', '2026-10-11', 'outdoor', 'recurve', 'completed', '[{"k":"2","d":50,"e":6,"a":6},{"k":"1","d":30,"e":6,"a":6}]');
select pg_temp.mkd('M12', 'W', '2026-10-12', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6}]');
select pg_temp.mkd('M13', 'V', '2026-10-13', 'outdoor', 'recurve', 'in_progress', '[{"k":"1","d":50,"e":6,"a":6}]');
select pg_temp.mkd('M14', 'V', '2026-10-14', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6}]', true);
select pg_temp.mkd('M15', 'V', '2026-10-15', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":50,"e":6,"a":6,"i":"c0000000-0000-0000-0000-0000000001b2"},{"k":"1","d":30,"e":6,"a":6,"i":"c0000000-0000-0000-0000-0000000001b1"}]');
select pg_temp.mkd('K1', 'V', '2026-11-10', 'indoor', 'recurve', 'completed', '[{"k":"1","d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004"}]', false, 30);
select pg_temp.mkd('K2', 'V', '2026-11-11', 'indoor', 'compound', 'completed', '[{"k":"1","d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004"}]', false, 20);
select pg_temp.mkd('K3', 'V', '2026-11-12', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":18,"e":6,"a":6}]', false, 10);
select pg_temp.mkd('K4', 'V', '2026-11-13', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":18,"e":6,"a":6}]', false, 30);
select pg_temp.mkd('K5', 'V', '2026-11-14', 'outdoor', 'recurve', 'completed', '[{"k":"1","d":18,"e":6,"a":6},{"k":"2","d":30,"e":6,"a":6}]', false, 30);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- 返す行・項目・合計点
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  'F,G,I,C,D,B,Z,H,A',
  '完了かつ削除されていないラウンドだけを返し、入力中と削除済みを返さない（閲覧者として属するラウンドを含む）'
);

select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.list(null, null, null, null, null, 100)) as k),
  array['has_more', 'rounds'],
  '戻り値の項目は rounds と has_more だけである'
);

select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.list(null, null, null, null, null, 100) -> 'rounds' -> 0) as k),
  array['id', 'name', 'round_date', 'total'],
  '1件の項目は id・name・round_date・total だけで、種別・弓種・作成時刻・距離・矢を含まない'
);

select is(
  pg_temp.totals(pg_temp.list(null, null, null, null, null, 100)),
  'A:540,B:580,C:580,D:580,F:450,G:597,H:540,I:580,Z:400',
  '合計点は、矢の点（score_int）の和である'
);

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('U')::text, true);
set local role authenticated;

select is(
  pg_temp.totals(pg_temp.list(null, null, null, null, null, 100)),
  'Q:0,R:0,S:300',
  '距離が0件・矢が0件のラウンドの合計点は0で、無効な距離の矢と無効な矢を合計に含めない'
);

select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- 並び
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  'F,G,I,C,D,B,Z,H,A',
  '既定の並びは日付の降順で、同じ日付は作成時刻の新しい順、それも同じ（CとD）ならIDの昇順である'
);

select is(
  pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100)),
  'H,A,Z,C,D,B,I,F,G',
  '日付の昇順でも、同じ日付は作成時刻の新しい順、それも同じ（CとD）ならIDの昇順である'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100)),
  'G,I,C,D,B,H,A,F,Z',
  '得点の降順で、同じ得点は実施日の新しい順、作成時刻の新しい順、IDの昇順である'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100)),
  'Z,F,H,A,I,C,D,B,G',
  '得点の昇順でも、同じ得点は向きによらず実施日の新しい順、作成時刻の新しい順、IDの昇順である'
);

-- ============================================================
-- 絞り込み
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, 'indoor', null, null, 100)),
  'F,B,Z,H',
  '種別だけで絞り込む'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, 'compound', null, 100)),
  'G,B',
  '弓種だけで絞り込む'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, 'indoor', 'recurve', null, 100)),
  'F,Z',
  '種別と弓種の両方に一致するものだけを返す'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', 'outdoor', null, null, 100)),
  'G,I,C,D,A',
  '絞り込みと並べ替えを同時に指定できる'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, 'field', null, null, 100)),
  '',
  '一致するラウンドがなければ空の配列を返す'
);

select is(
  pg_temp.list(null, null, 'field', 'compound', null, 10),
  '{"rounds": [], "has_more": false}'::jsonb,
  '一致するラウンドがなければ、続きなしを返す'
);

-- ============================================================
-- ページの切り出し
-- ============================================================

select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 5)), '5:true', '全9件より少ない件数では、その件数だけ返して続きありにする');
select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 8)), '8:true', '全件より1件少ない件数（M=N+1）では、続きありにする');
select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 9)), '9:false', '全件と同じ件数（M=N）では、続きなしにする');
select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 10)), '9:false', '全件より多い件数（M<N）では、全件を返して続きなしにする');

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 3)),
  'F,G,I',
  '先頭のページ（起点なし）は、並びの先頭から返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, pg_temp.id('I')::text, 3)),
  'C,D,B',
  '起点のIDを指定すると、そのラウンドより後を返す'
);

select is(pg_temp.walk('date', 'desc', null, array[2, 3, 1]), pg_temp.ids(pg_temp.list('date', 'desc', null, null, null, 100)), '日付の降順: ページごとに件数が違っても、全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'asc', null, array[2, 3, 1]), pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100)), '日付の昇順: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'desc', null, array[2, 3, 1]), pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100)), '得点の降順: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'asc', null, array[2, 3, 1]), pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100)), '得点の昇順: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'desc', 'outdoor', array[1, 2]), pg_temp.ids(pg_temp.list('date', 'desc', 'outdoor', null, null, 100)), '日付の降順、種別の絞り込みあり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'asc', 'outdoor', array[1, 2]), pg_temp.ids(pg_temp.list('date', 'asc', 'outdoor', null, null, 100)), '日付の昇順、種別の絞り込みあり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'desc', 'outdoor', array[1, 2]), pg_temp.ids(pg_temp.list('score', 'desc', 'outdoor', null, null, 100)), '得点の降順、種別の絞り込みあり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'asc', 'outdoor', array[1, 2]), pg_temp.ids(pg_temp.list('score', 'asc', 'outdoor', null, null, 100)), '得点の昇順、種別の絞り込みあり: 全ページの連結が1回の取得と一致する');

-- ============================================================
-- 起点が見えない・引数が未知
-- ============================================================

select is(
  pg_temp.list(null, null, null, null, '00000000-0000-4000-8000-000000000000', 10),
  '{"rounds": [], "has_more": false}'::jsonb,
  '存在しない起点のIDでは、0件で続きなしを返す'
);

select is(
  pg_temp.list(null, null, null, null, pg_temp.id('Y')::text, 10),
  '{"rounds": [], "has_more": false}'::jsonb,
  '自分に見えないラウンドを起点にしても、0件で続きなしを返す'
);

select is(
  pg_temp.ids(pg_temp.list('name', 'up', null, null, null, 100)),
  'F,G,I,C,D,B,Z,H,A',
  '未知の基準と向きは、例外にならず既定の並び（日付の降順）になる'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'up', null, null, null, 100)),
  'G,I,C,D,B,H,A,F,Z',
  '向きが昇順（asc）以外なら降順になる'
);

-- ============================================================
-- 期間と得点の範囲（境界を含む）
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-09-12')),
  'F,G,I,C,D,B',
  '開始日だけを指定すると、実施日が開始日以後（当日を含む）のラウンドだけを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, '2026-09-12')),
  'C,D,B,Z,H,A',
  '終了日だけを指定すると、実施日が終了日以前（当日を含む）のラウンドだけを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-09-11', '2026-09-13')),
  'I,C,D,B,Z',
  '開始日と終了日の両方を指定すると、両端の当日を含む期間のラウンドだけを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-09-12', '2026-09-12')),
  'C,D,B',
  '開始日と終了日が同じ日なら、その日のラウンドだけを返す'
);

select is(
  pg_temp.list(null, null, null, null, null, 10, '2026-10-01'),
  '{"rounds": [], "has_more": false}'::jsonb,
  '期間に一致するラウンドがなければ、空で続きなしを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-09-15')),
  '',
  '期間の中でも、入力中・削除済み・属さないラウンドは返さない'
);

select is(
  concat_ws('|',
    '580=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 580)),
    '581=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 581)),
    '579=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 579))
  ),
  '580=G,I,C,D,B|581=G|579=G,I,C,D,B',
  '得点の下限は、その点（580）を含み、1点上（581）は除き、1点下（579）は580と同じ結果になる'
);

select is(
  concat_ws('|',
    '540=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, null, 540)),
    '539=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, null, 539)),
    '541=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, null, 541))
  ),
  '540=H,A,F,Z|539=F,Z|541=H,A,F,Z',
  '得点の上限は、その点（540）を含み、1点下（539）は除き、1点上（541）は540と同じ結果になる'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 450, 540)),
  'H,A,F',
  '得点の下限と上限の両方を指定すると、両端の点を含む範囲のラウンドだけを返す'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 580, 580)),
  'I,C,D,B',
  '下限と上限が同じ点なら、その点のラウンドだけを返す'
);

select is(
  concat_ws('|',
    '597=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 597)),
    '598=' || pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 598))
  ),
  '597=G|598=',
  '最高点（597）を下限にするとそのラウンドを返し、1点上（598）では空になる'
);

-- Uの完了のラウンドは Q:0、R:0、S:300（無効な距離・矢を除いた合計）。
reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('U')::text, true);
set local role authenticated;

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 0, 0)),
  'Q,R',
  '0点のラウンド（距離なし、矢なし）は、下限0・上限0の範囲に含まれる（下限0を指定なしと取り違えない）'
);

select is(
  concat_ws('|',
    'min300=' || pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 300)),
    'min301=' || pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 301)),
    'max300=' || pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, 300)),
    'max299=' || pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, 299))
  ),
  'min300=S|min301=|max300=S,Q,R|max299=Q,R',
  '得点の範囲は、返す合計点と同じ値（無効な距離・矢を除いた300点）で比べる'
);

select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- 期間・得点・種別・弓種の組合せ、並び、ページ
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, 'outdoor', 'recurve', null, 100, '2026-09-12', null, 580)),
  'I,D',
  '期間、得点、種別、弓種の4条件がすべて効く（Aは実施日、Bは種別、Cは弓種、Gは弓種で落ちる）'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', null, 'recurve', null, 100, null, null, 450)),
  'I,D,A,F',
  '得点の降順と得点の下限を同時に指定でき、同点（I・D）は実施日の新しい順に並ぶ'
);

select is(
  pg_temp.ids(pg_temp.list('date', 'asc', null, 'recurve', null, 100, null, null, 450, 580)),
  'A,D,I,F',
  '日付の昇順と得点の範囲を同時に指定できる'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', null, 'recurve', null, 100, null, '2026-09-13')),
  'I,D,A,Z',
  '得点の降順と期間を同時に指定できる'
);

select is(pg_temp.walk('date', 'desc', null, array[1, 2], '2026-09-11', '2026-09-14', 450, 597), pg_temp.ids(pg_temp.list('date', 'desc', null, null, null, 100, '2026-09-11', '2026-09-14', 450, 597)), '日付の降順、範囲の指定あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'asc', null, array[1, 2], '2026-09-11', '2026-09-14', 450, 597), pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100, '2026-09-11', '2026-09-14', 450, 597)), '日付の昇順、範囲の指定あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'desc', null, array[1, 2], '2026-09-11', '2026-09-14', 450, 597), pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, '2026-09-11', '2026-09-14', 450, 597)), '得点の降順、範囲の指定あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'asc', null, array[1, 2], '2026-09-11', '2026-09-14', 450, 597), pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100, '2026-09-11', '2026-09-14', 450, 597)), '得点の昇順、範囲の指定あり: 全ページの連結が1回の取得と一致する');

select is(
  pg_temp.shape(pg_temp.list(null, null, null, null, null, 6, '2026-09-12')) || '|' || pg_temp.shape(pg_temp.list(null, null, null, null, null, 5, '2026-09-12')),
  '6:false|5:true',
  '範囲に一致する件数と同じ件数では続きなし、1件少ない件数では続きありにする'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, pg_temp.id('F')::text, 10, null, null, 590)),
  'G',
  '起点のラウンドが範囲の外（450点、下限590）でも、起点として引け、その続きを返す'
);

select is(
  pg_temp.list(null, null, null, null, null, 10, '2026-09-13', '2026-09-12'),
  '{"rounds": [], "has_more": false}'::jsonb,
  '開始日が終了日より後でも、例外にせず、空で続きなしを返す'
);

select is(
  pg_temp.list(null, null, null, null, null, 10, null, null, 600, 500),
  '{"rounds": [], "has_more": false}'::jsonb,
  '下限が上限より大きくても、例外にせず、空で続きなしを返す'
);

select is(
  public.rounds_list(null, null, 'outdoor', 'recurve', null, 100),
  public.rounds_list(null, null, 'outdoor', 'recurve', null, 100, null, null, null, null, null),
  '6引数の呼び出しは、範囲の4引数と距離の構成をnullにした11引数の呼び出しと同じ結果を返す'
);

select is(
  public.rounds_list(null, null, 'outdoor', 'recurve', null, 100, null, null, null, null),
  public.rounds_list(null, null, 'outdoor', 'recurve', null, 100, null, null, null, null, null),
  '旧い版の画面の10引数の呼び出しも動き、距離の構成なしの11引数の呼び出しと同じ結果を返す'
);

select is(
  (select count(*) from pg_proc where proname = 'rounds_list' and pronamespace = 'public'::regnamespace),
  1::bigint,
  'rounds_list は11引数の1つだけで、旧い署名の関数が残っていない（呼び出しが曖昧にならない）'
);

-- ============================================================
-- ページの間の変更
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 3)),
  'F,G,I',
  'ページの間の変更の前: 先頭のページの最後は I である'
);

reset role;
-- 先頭のページにいたFが削除され、起点（I）より前に新しいラウンドJが完了した。
update public.rounds set disabled_at = now() where id = pg_temp.id('F');
select pg_temp.mk('J', 'E', '2026-09-20', 'outdoor', 'recurve', 'completed', '2026-09-20 09:00+00', 500);
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
set local role authenticated;

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, pg_temp.id('I')::text, 3)),
  'C,D,B',
  '起点より前のラウンドの削除・完了があっても、次のページに重複も抜けも出ない'
);

reset role;
update public.rounds set disabled_at = now() where id = pg_temp.id('I');
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
set local role authenticated;

select is(
  pg_temp.list(null, null, null, null, pg_temp.id('I')::text, 3) ->> 'has_more',
  'true',
  '起点のラウンド自身が削除されても、起点として引け、続きの有無を返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, pg_temp.id('I')::text, 3)),
  'C,D,B',
  '起点のラウンド自身が削除されても、その続きを返す'
);

-- ============================================================
-- 権限
-- ============================================================

select set_config('request.jwt.claim.sub', pg_temp.id('N')::text, true);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  'Y,Z',
  '属するラウンドだけを返し、属さないラウンドを返さない'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-09-16')),
  'Y',
  '期間を指定しても、属するラウンドだけを返す'
);


-- ============================================================
-- 距離の構成（利用者V）
--   p_distances は射つ順の行の配列 [{distance, arrows_per_end, total_arrows, target_face_id}]。指定のない項目は null（鍵が無くても同じ）。
--   無効でない距離を (position_key, id) の順に並べた行が、指定と同じ個数で、先頭から順に各行が一致するラウンドだけを返す。
-- ============================================================

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('V')::text, true);
set local role authenticated;

-- 距離の構成だけを指定して、返した別名を並べる。
create function pg_temp.byd(p_distances text) returns text
language sql stable
as $$ select pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, p_distances::jsonb)) $$;

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  'K5,K4,K3,K2,K1,M15,M11,M10,M9,M8,M7,M6,M5,M4,M3,M2,M1',
  '距離の構成を指定しないときは、Vが見える完了のラウンドをすべて返す（Wのラウンド、入力中、削除済みは返さない）'
);

select is(
  pg_temp.byd('[{"distance": 50}]'),
  'M7,M6,M5',
  '距離だけを指定した1行は、無効でない距離が50mの1行だけのラウンドを返し、2行以上のラウンド・距離のないラウンド・距離が未確定のラウンドを返さない'
);

select is(
  pg_temp.byd('[{"distance": 50}, {"distance": 30}]'),
  'M1',
  '射つ順が50m→30mの指定は、その順のラウンド（M1）だけを返し、30m→50mのラウンドと、無効な30mを持つラウンド（M7）を返さない'
);

select is(
  pg_temp.byd('[{"distance": 30}, {"distance": 50}]'),
  'M15,M11,M2',
  '射つ順が30m→50mの指定は、その順のラウンドだけを返し、挿入順でなく position_key と id の順で比べる（M11、M15）'
);

select is(
  pg_temp.byd('[{"distance": 70}]') || '|' || pg_temp.byd('[{"distance": 70}, {"distance": 70}]'),
  'M3|M4',
  '距離の行の個数が一致するラウンドだけを返す（70mの1行の指定はM3だけ、70mの2行の指定はM4だけ）'
);

select is(
  pg_temp.byd('[{"distance": 50, "arrows_per_end": 6}]') || '|' || pg_temp.byd('[{"distance": 50, "arrows_per_end": 3}]'),
  'M7,M5|M6',
  '1エンドの矢数を指定すると、その矢数の行だけが一致する（6はM7とM5、3はM6）'
);

select is(
  concat_ws('|',
    '36=' || pg_temp.byd('[{"distance": 50, "total_arrows": 36}]'),
    '35=' || pg_temp.byd('[{"distance": 50, "total_arrows": 35}]'),
    '37=' || pg_temp.byd('[{"distance": 50, "total_arrows": 37}]'),
    '72=' || pg_temp.byd('[{"distance": 50, "total_arrows": 72}]'),
    '12=' || pg_temp.byd('[{"distance": 50, "total_arrows": 12}]'),
    '3=' || pg_temp.byd('[{"distance": 50, "total_arrows": 3}]')
  ),
  '36=M7,M6,M5|35=|37=|72=|12=|3=',
  '矢の総数は総エンド数×1エンドの矢数（6×6と12×3の36）で比べ、1つ違い（35、37）・総エンド数だけ（12）・1エンドの矢数だけ（3）では一致しない'
);

select is(
  pg_temp.byd(format('[{"distance": 50, "target_face_id": "%s"}]', 'a1000000-0000-0000-0000-000000000002'))
    || '|' || pg_temp.byd(format('[{"distance": 50, "target_face_id": "%s"}]', 'a1000000-0000-0000-0000-000000000001')),
  'M5|M7,M6',
  '的を指定すると、距離が同じでも的が違う行は一致しない（80cmの的はM5だけ、122cmの的はM5を除く）'
);

select is(
  concat_ws('|',
    'all=' || pg_temp.byd('[{"distance": 50, "arrows_per_end": 6, "total_arrows": 36, "target_face_id": "a1000000-0000-0000-0000-000000000002"}]'),
    'face=' || pg_temp.byd('[{"distance": 50, "arrows_per_end": 6, "total_arrows": 36, "target_face_id": "a1000000-0000-0000-0000-000000000004"}]'),
    'total=' || pg_temp.byd('[{"distance": 50, "arrows_per_end": 6, "total_arrows": 35, "target_face_id": "a1000000-0000-0000-0000-000000000002"}]'),
    'ape=' || pg_temp.byd('[{"distance": 50, "arrows_per_end": 3, "total_arrows": 36, "target_face_id": "a1000000-0000-0000-0000-000000000002"}]'),
    'dist=' || pg_temp.byd('[{"distance": 30, "arrows_per_end": 6, "total_arrows": 36, "target_face_id": "a1000000-0000-0000-0000-000000000002"}]')
  ),
  'all=M5|face=|total=|ape=|dist=',
  '距離・1エンドの矢数・矢の総数・的のすべてを指定した行は、すべてが一致するラウンドだけを返し、1項目でも違えば除外する'
);

select is(
  pg_temp.byd('[{"distance": 50, "arrows_per_end": null, "total_arrows": null, "target_face_id": null}]'),
  pg_temp.byd('[{"distance": 50}]'),
  '項目がnullの指定は、項目の鍵が無い指定と同じ結果で、比べない'
);

select is(
  pg_temp.byd(format('[{"distance": 50}, {"distance": 30, "target_face_id": "%s"}]', 'a1000000-0000-0000-0000-000000000001'))
    || '|' || pg_temp.byd(format('[{"distance": 50}, {"distance": 30, "target_face_id": "%s"}]', 'a1000000-0000-0000-0000-000000000002')),
  'M1|',
  '行ごとに指定する項目が違っても、各行は自分の指定した項目だけで比べる（2行目に的を指定し、一致すればM1、的が違えば除外）'
);

select is(
  pg_temp.byd('[{"distance": 50}, {"distance": 70}]') || '|' || pg_temp.byd('[{"distance": 50}, {"distance": 30}, {"distance": 30}]'),
  '|',
  '2行目だけが違う指定、行数が多い指定は、一致するラウンドがない（すべての行が一致し、個数も同じでなければならない）'
);

select is(
  pg_temp.byd('[{"distance": 50}, {"distance": 50}]'),
  '',
  '同じ距離を2回指定した指定は、50mの2行のラウンドがなければ空を返す（距離が未確定の行は50mとして数えない）'
);

select is(
  pg_temp.byd('[]'),
  '',
  '空の配列の指定は、0件を返す'
);

select is(
  pg_temp.byd(null),
  'K5,K4,K3,K2,K1,M15,M11,M10,M9,M8,M7,M6,M5,M4,M3,M2,M1',
  '距離の構成がnullなら、絞り込まずにすべてを返す（距離のないラウンドM8も含む）'
);

-- ------------------------------------------------------------
-- 他の条件との組合せ、並び、ページ
-- ------------------------------------------------------------

select is(
  concat_ws('|',
    'indoor=' || pg_temp.ids(pg_temp.list(null, null, 'indoor', null, null, 100, null, null, null, null, '[{"distance": 18}]')),
    'indoor-recurve=' || pg_temp.ids(pg_temp.list(null, null, 'indoor', 'recurve', null, 100, null, null, null, null, '[{"distance": 18}]')),
    'outdoor=' || pg_temp.ids(pg_temp.list(null, null, 'outdoor', null, null, 100, null, null, null, null, '[{"distance": 18}]'))
  ),
  'indoor=K2,K1|indoor-recurve=K1|outdoor=K4,K3',
  '距離の構成と種別・弓種を同時に指定すると、すべてに一致するラウンドだけを返す（18mの1行でも、2行のK5は返さない）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-11-11', '2026-11-14', null, null, '[{"distance": 18}]')),
  'K4,K3,K2',
  '距離の構成と期間（両端の当日を含む）を同時に指定すると、両方に一致するラウンドだけを返す（K1は実施日、K5は距離の構成で外れる）'
);

select is(
  concat_ws('|',
    '200-300=' || pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 200, 300, '[{"distance": 18}]')),
    '300-=' || pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 300, null, '[{"distance": 18}]'))
  ),
  '200-300=K4,K2,K1|300-=K4,K1',
  '距離の構成と得点の範囲（両端の点を含む）を同時に指定すると、両方に一致するラウンドだけを返す（K3は得点、K5は距離の構成で外れる）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, 'outdoor', 'recurve', null, 100, '2026-11-12', null, 200, null, '[{"distance": 18}]')),
  'K4',
  '距離の構成・種別・弓種・期間・得点の範囲をすべて指定すると、すべてに一致するラウンドだけを返す'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, null, null, '[{"distance": 18}]'))
    || '|' || pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100, null, null, null, null, '[{"distance": 18}]')),
  'K4,K1,K2,K3|K1,K2,K3,K4',
  '距離の構成を指定しても並べ替えに従う（得点の降順で同点は実施日の新しい順、日付の昇順）'
);

select is(pg_temp.walk('date', 'desc', null, array[1, 2], null, null, null, null, '[{"distance": 18}]'), 'K4,K3,K2,K1', '日付の降順、距離の構成の指定あり: 全ページの連結が一致するラウンドを重複も抜けもなく並べる');
select is(pg_temp.walk('date', 'asc', null, array[1, 2], null, null, null, null, '[{"distance": 18}]'), 'K1,K2,K3,K4', '日付の昇順、距離の構成の指定あり: 全ページの連結が一致するラウンドを重複も抜けもなく並べる');
select is(pg_temp.walk('score', 'desc', null, array[1, 2], null, null, null, null, '[{"distance": 18}]'), 'K4,K1,K2,K3', '得点の降順、距離の構成の指定あり: 全ページの連結が一致するラウンドを重複も抜けもなく並べる');
select is(pg_temp.walk('score', 'asc', null, array[1, 2], null, null, null, null, '[{"distance": 18}]'), 'K3,K2,K4,K1', '得点の昇順、距離の構成の指定あり: 全ページの連結が一致するラウンドを重複も抜けもなく並べる');

select is(
  pg_temp.shape(pg_temp.list(null, null, null, null, null, 4, null, null, null, null, '[{"distance": 18}]'))
    || '|' || pg_temp.shape(pg_temp.list(null, null, null, null, null, 3, null, null, null, null, '[{"distance": 18}]')),
  '4:false|3:true',
  '続きの有無は、距離の構成で絞り込んだ後の件数で決まる（一致する4件と同じ件数では続きなし、1件少ない件数では続きあり）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, pg_temp.id('K5')::text, 10, null, null, null, null, '[{"distance": 18}]')),
  'K4,K3,K2,K1',
  '起点のラウンド（K5）が距離の構成の外でも、起点として引け、その続きを返す'
);

-- ------------------------------------------------------------
-- 権限
-- ------------------------------------------------------------

select is(
  pg_temp.byd('[{"distance": 50}]'),
  'M7,M6,M5',
  '構成が一致していても、別の利用者のラウンド（M12）、入力中（M13）、削除済み（M14）は返さない'
);

reset role;
select set_config('request.jwt.claim.sub', pg_temp.id('W')::text, true);
set local role authenticated;

select is(
  pg_temp.byd('[{"distance": 50}]') || '|' || pg_temp.byd(null),
  'M12|M12',
  '利用者Wに切り替えると、Wのラウンドだけが返る'
);

select * from finish();

rollback;
