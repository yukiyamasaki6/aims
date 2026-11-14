-- 履歴の距離単位の取得の関数distances_listの振る舞いを確認する。
--   - 返す行（完了かつ無効でないラウンドの、無効でない距離）、返す項目、射つ順の番号、小計
--   - 並び（基準 × 向き、同値の並び）と絞り込み（種別、弓種、期間、得点の範囲、距離の構成、距離の行）
--   - ページの切り出し（has_more、起点の距離のID、全ページの連結）と、ページの間の変更
--   - 権限（自分が属するラウンドだけ）、起点が見えない・引数が未知のとき
--   - rounds_listと対象のラウンドが同じであること（history_roundsを共有している証拠）
-- 関数の実行権限（anon、authenticated）はrls_matrix.sqlの関数表で固定している。

begin;

select plan(80);

-- 利用者とラウンドの別名。距離の別名は、ラウンドの別名に番号を付けた形（A1、A2）にする。
create temp table dl_id (alias text primary key, id uuid not null);
insert into dl_id (alias, id) values
  ('E', 'c2000000-0000-0000-0000-000000000001'),
  ('N', 'c2000000-0000-0000-0000-000000000002'),
  ('A', 'c2000000-0000-0000-0000-000000000101'),
  ('B', 'c2000000-0000-0000-0000-000000000102'),
  ('C', 'c2000000-0000-0000-0000-000000000103'),
  ('D', 'c2000000-0000-0000-0000-000000000104'),
  ('L', 'c2000000-0000-0000-0000-000000000105'),
  ('F', 'c2000000-0000-0000-0000-000000000106'),
  ('G', 'c2000000-0000-0000-0000-000000000107'),
  ('H', 'c2000000-0000-0000-0000-000000000108'),
  ('I', 'c2000000-0000-0000-0000-000000000109'),
  ('J', 'c2000000-0000-0000-0000-00000000010a'),
  ('K', 'c2000000-0000-0000-0000-00000000010b'),
  ('P', 'c2000000-0000-0000-0000-000000000110'),
  ('X', 'c2000000-0000-0000-0000-000000000111'),
  ('Y', 'c2000000-0000-0000-0000-000000000112'),
  ('Z', 'c2000000-0000-0000-0000-000000000113');

-- 距離の別名とID。mkdが距離を作るたびに入れる。
create temp table dl_dist (alias text primary key, id uuid not null);

grant select on dl_id, dl_dist to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from dl_id where alias = p_alias $$;

create function pg_temp.did(p_alias text) returns uuid
language sql stable
as $$ select id from dl_dist where alias = p_alias $$;

-- ラウンドと距離を作る。実施日の9時（p_created_atで変えられる）に作る。
-- p_rows は距離の行の配列で、項目は n=距離の別名、k=position_key、d=距離（nullは距離が判明しない）、e=総エンド数、a=1エンドの矢数、
-- f=的のID（省略時は屋外122cmの公式の的）、m=距離が判明しているか（省略時は真）、x=無効にした距離か、
-- i=距離のIDの末尾（省略時は無作為）、t=置く10点の矢の本数（小計は t * 10）、dx=置く無効な10点の矢の本数。
-- 行は配列の順に挿入する（挿入順とIDの大小が違う入力を作るため）。
create function pg_temp.mkd(
  p_alias text, p_owner text, p_date date, p_format text, p_bow_type text, p_status text, p_rows jsonb,
  p_disabled boolean default false, p_created_at timestamptz default null
) returns void
language plpgsql
as $$
declare
  v_round uuid := pg_temp.id(p_alias);
  v_created timestamptz := coalesce(p_created_at, (p_date + time '09:00') at time zone 'UTC');
  v_row record;
  v_id uuid;
begin
  insert into public.rounds (id, name, round_date, created_at, format, bow_type, status, disabled_at)
  values (v_round, p_alias, p_date, v_created, p_format, p_bow_type, p_status, case when p_disabled then v_created end);
  insert into public.round_users (round_id, user_id, role) values (v_round, pg_temp.id(p_owner), 'editor');
  for v_row in select e.v from jsonb_array_elements(p_rows) with ordinality as e(v, ord) order by e.ord loop
    v_id := coalesce('d2000000-0000-0000-0000-' || lpad(v_row.v ->> 'i', 12, '0'), gen_random_uuid()::text)::uuid;
    insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, disabled_at)
    values (v_id, v_round, v_row.v ->> 'k', (v_row.v ->> 'd')::int, (v_row.v ->> 'e')::int, (v_row.v ->> 'a')::int,
      coalesce((v_row.v ->> 'f')::uuid, 'a1000000-0000-0000-0000-000000000001'::uuid), coalesce((v_row.v ->> 'm')::boolean, true),
      case when (v_row.v ->> 'x')::boolean then v_created end);
    insert into dl_dist (alias, id) values (v_row.v ->> 'n', v_id);
    insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int)
    select v_id, (i - 1) / (v_row.v ->> 'a')::int + 1, pg_temp.id(p_owner), 'X', 10
    from generate_series(1, coalesce((v_row.v ->> 't')::int, 0)) as i;
    insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int, disabled_at)
    select v_id, 1, pg_temp.id(p_owner), 'X', 10, now()
    from generate_series(1, coalesce((v_row.v ->> 'dx')::int, 0)) as i;
  end loop;
end;
$$;

-- 引数は、基準、向き、種別、弓種、起点（距離の別名）、件数、期間（p_from、p_to）、得点の範囲（p_min、p_max）、距離の構成（p_distances）、距離の行（p_distance）。
-- 期間以降は任意で、指定しなければ絞り込まない。
create function pg_temp.list(
  p_sort_key text, p_sort_direction text, p_format text, p_bow_type text, p_after text, p_limit int,
  p_from date default null, p_to date default null, p_min bigint default null, p_max bigint default null,
  p_distances jsonb default null, p_distance jsonb default null
) returns jsonb
language sql stable
as $$
  select public.distances_list(p_sort_key, p_sort_direction, p_format, p_bow_type, pg_temp.did(p_after), p_limit, p_from, p_to, p_min, p_max, p_distances, p_distance)
$$;

-- 起点に、距離の別名でなくIDそのものを渡す。
create function pg_temp.list_after_id(p_after uuid, p_limit int) returns jsonb
language sql stable
as $$ select public.distances_list(null, null, null, null, p_after, p_limit) $$;

-- 返した距離の別名を、返した順に並べる。
create function pg_temp.ids(p_page jsonb) returns text
language sql stable
as $$
  select coalesce(string_agg(i.alias, ',' order by e.ord), '')
  from jsonb_array_elements(p_page -> 'distances') with ordinality as e(r, ord)
  join dl_dist i on i.id = (e.r ->> 'id')::uuid
$$;

-- 返した距離の、属するラウンドの別名を、最初に現れた順に並べる（重複なし）。
create function pg_temp.round_aliases(p_page jsonb) returns text
language sql stable
as $$
  select coalesce(string_agg(alias, ',' order by first_ord), '')
  from (
    select i.alias, min(e.ord) as first_ord
    from jsonb_array_elements(p_page -> 'distances') with ordinality as e(r, ord)
    join dl_id i on i.id = (e.r ->> 'round_id')::uuid
    group by i.alias
  ) as s
$$;

-- rounds_listが返したラウンドの別名を、返した順に並べる。距離が1件もないラウンド（G）は、距離単位に現れないため除く。
create function pg_temp.rounds_with_distances(p_page jsonb) returns text
language sql stable
as $$
  select coalesce(string_agg(i.alias, ',' order by e.ord), '')
  from jsonb_array_elements(p_page -> 'rounds') with ordinality as e(r, ord)
  join dl_id i on i.id = (e.r ->> 'id')::uuid
  where exists (select 1 from public.distances d where d.round_id = i.id and d.disabled_at is null)
$$;

create function pg_temp.totals(p_page jsonb) returns text
language sql stable
as $$
  select coalesce(string_agg(i.alias || ':' || (e.r ->> 'total'), ',' order by i.alias), '')
  from jsonb_array_elements(p_page -> 'distances') as e(r)
  join dl_dist i on i.id = (e.r ->> 'id')::uuid
$$;

create function pg_temp.numbers(p_page jsonb) returns text
language sql stable
as $$
  select coalesce(string_agg(i.alias || ':' || (e.r ->> 'number'), ',' order by i.alias), '')
  from jsonb_array_elements(p_page -> 'distances') as e(r)
  join dl_dist i on i.id = (e.r ->> 'id')::uuid
$$;

-- 件数と続きの有無。
create function pg_temp.shape(p_page jsonb) returns text
language sql stable
as $$ select jsonb_array_length(p_page -> 'distances') || ':' || (p_page ->> 'has_more') $$;

-- 1件の項目。距離の別名で選ぶ。
create function pg_temp.item(p_page jsonb, p_alias text) returns jsonb
language sql stable
as $$
  select e.r
  from jsonb_array_elements(p_page -> 'distances') as e(r)
  where (e.r ->> 'id')::uuid = pg_temp.did(p_alias)
$$;

-- 起点の距離のIDで全ページをたどり、返した順に連結する。件数はp_sizesを順に使う（ページごとに違う）。
create function pg_temp.walk(
  p_sort_key text, p_sort_direction text, p_sizes int[],
  p_from date default null, p_to date default null, p_min bigint default null, p_max bigint default null,
  p_distances jsonb default null, p_distance jsonb default null
) returns text
language plpgsql stable
as $$
declare
  v_page jsonb;
  v_after uuid := null;
  v_ids text := '';
  v_n int := 0;
  v_pages text;
begin
  loop
    v_page := public.distances_list(p_sort_key, p_sort_direction, null, null, v_after, p_sizes[v_n % cardinality(p_sizes) + 1], p_from, p_to, p_min, p_max, p_distances, p_distance);
    v_pages := pg_temp.ids(v_page);
    v_ids := v_ids || case when v_ids = '' or v_pages = '' then '' else ',' end || v_pages;
    exit when not (v_page ->> 'has_more')::boolean;
    v_after := (v_page -> 'distances' -> -1 ->> 'id')::uuid;
    v_n := v_n + 1;
    exit when v_n > 50;
  end loop;
  return v_ids;
end;
$$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('N'));

-- Fixture: 本人Eが見える完了のラウンド（無効でない）。距離は全て実際にある形（屋外は6エンド×6射か12エンド×3射、インドアは10エンド×3射）で、
-- 小計は、10点の矢の本数で作る（矢の点そのものは検証の対象ではない）。実施日は、既定の並びの検証以外では一意にする。
--   A: 屋外・リカーブ 09-10。A1=50m(300)→A2=30m(320)。ラウンドの合計620は小計のどちらとも違う
--   B: インドア・コンパウンド 09-12。B1=18m(250)→B2=18m(250)。同じラウンドに同じ距離が2つ、小計が同値
--   C: 屋外・ベアボウ 09-12(10:00)。C1=70m(280)→C2=50m(300)。Bと実施日が同じ
--   D: 屋外・リカーブ 09-12(10:00)。D1=50m(300)。Cと実施日・作成時刻が同じで、IDだけが大きい。C2と小計が同値
--   L: 屋外・リカーブ 09-13。L1=50m(0、矢なし)→L2=距離が判明しない(無印で距離50、100)→L3=距離が判明しない(距離なし、50)
--   F: 屋外・リカーブ 09-14。F1=50m(120。無効な10点の矢を1本足してある)→無効な30m(矢は10点)→F3=20m(100)
--   G: 屋外・コンパウンド 09-15。距離なし
--   H: インドア・ベアボウ 09-16。position_keyが同じ2つの距離。H1(100)は先に挿入されIDが大きく、H2(200)は後に挿入されIDが小さい
--   I: 屋外・リカーブ 09-17。I1=50m 12エンド×3射(200)→I2=50m 6エンド×6射(220)。矢の総数は同じ36で、1エンドの矢数が違う
--   J: 屋外・リカーブ 09-18。J1=50m(180)。的が屋外80cm
--   Z: Nの完了で、Eが閲覧者として属する。インドア・リカーブ 09-11。Z1=18m(220)
-- 返さない行: P（入力中）、X（削除済み）、Y（Nだけが属する完了）。
select pg_temp.mkd('A', 'E', '2026-09-10', 'outdoor', 'recurve', 'completed',
  '[{"n":"A1","k":"1","d":50,"e":6,"a":6,"t":30},{"n":"A2","k":"2","d":30,"e":6,"a":6,"t":32}]');
select pg_temp.mkd('B', 'E', '2026-09-12', 'indoor', 'compound', 'completed',
  '[{"n":"B1","k":"1","d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004","t":25},{"n":"B2","k":"2","d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004","t":25}]');
select pg_temp.mkd('C', 'E', '2026-09-12', 'outdoor', 'barebow', 'completed',
  '[{"n":"C1","k":"1","d":70,"e":6,"a":6,"t":28},{"n":"C2","k":"2","d":50,"e":6,"a":6,"t":30}]',
  false, '2026-09-12 10:00+00');
select pg_temp.mkd('D', 'E', '2026-09-12', 'outdoor', 'recurve', 'completed',
  '[{"n":"D1","k":"1","d":50,"e":6,"a":6,"t":30}]',
  false, '2026-09-12 10:00+00');
select pg_temp.mkd('L', 'E', '2026-09-13', 'outdoor', 'recurve', 'completed',
  '[{"n":"L1","k":"1","d":50,"e":6,"a":6},{"n":"L2","k":"2","d":50,"e":6,"a":6,"m":false,"t":10},{"n":"L3","k":"3","d":null,"e":6,"a":6,"m":false,"t":5}]');
select pg_temp.mkd('F', 'E', '2026-09-14', 'outdoor', 'recurve', 'completed',
  '[{"n":"F1","k":"1","d":50,"e":6,"a":6,"t":12,"dx":1},{"n":"F2","k":"2","d":30,"e":6,"a":6,"x":true,"t":10},{"n":"F3","k":"3","d":20,"e":6,"a":6,"t":10}]');
select pg_temp.mkd('G', 'E', '2026-09-15', 'outdoor', 'compound', 'completed', '[]');
select pg_temp.mkd('H', 'E', '2026-09-16', 'indoor', 'barebow', 'completed',
  '[{"n":"H1","k":"1","d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004","i":"b2","t":10},{"n":"H2","k":"1","d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004","i":"b1","t":20}]');
select pg_temp.mkd('I', 'E', '2026-09-17', 'outdoor', 'recurve', 'completed',
  '[{"n":"I1","k":"1","d":50,"e":12,"a":3,"t":20},{"n":"I2","k":"2","d":50,"e":6,"a":6,"t":22}]');
select pg_temp.mkd('J', 'E', '2026-09-18', 'outdoor', 'recurve', 'completed',
  '[{"n":"J1","k":"1","d":50,"e":6,"a":6,"f":"a1000000-0000-0000-0000-000000000002","t":18}]');
select pg_temp.mkd('Z', 'N', '2026-09-11', 'indoor', 'recurve', 'completed',
  '[{"n":"Z1","k":"1","d":18,"e":10,"a":3,"f":"a1000000-0000-0000-0000-000000000004","t":22}]');
insert into public.round_users (round_id, user_id, role) values (pg_temp.id('Z'), pg_temp.id('E'), 'viewer');
select pg_temp.mkd('P', 'E', '2026-09-19', 'outdoor', 'recurve', 'in_progress', '[{"n":"P1","k":"1","d":50,"e":6,"a":6,"t":10}]');
select pg_temp.mkd('X', 'E', '2026-09-20', 'outdoor', 'recurve', 'completed', '[{"n":"X1","k":"1","d":50,"e":6,"a":6,"t":10}]', true);
select pg_temp.mkd('Y', 'N', '2026-09-21', 'outdoor', 'recurve', 'completed', '[{"n":"Y1","k":"1","d":50,"e":6,"a":6,"t":10}]');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- 返す行・項目・番号・小計
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  'J1,I1,I2,H2,H1,F1,F3,L1,L2,L3,C1,C2,D1,B1,B2,Z1,A1,A2',
  '完了で無効でないラウンドの、無効でない距離だけを1件ずつ返す（入力中・削除済み・属さないラウンド・無効な距離を返さず、閲覧者として属するラウンドの距離を返し、距離が0件のラウンドは件を出さない）'
);

select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.list(null, null, null, null, null, 100)) as k),
  array['distances', 'has_more'],
  '戻り値の項目は distances と has_more だけである'
);

select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.list(null, null, null, null, null, 100) -> 'distances' -> 0) as k),
  array['distance', 'id', 'is_marked', 'name', 'number', 'round_date', 'round_id', 'total'],
  '1件の項目は距離のID・属するラウンドのID・名前・実施日・番号・距離・無印か・小計だけで、種別・弓種・作成時刻・矢・的・総件数を含まない'
);

select is(
  pg_temp.item(pg_temp.list(null, null, null, null, null, 100), 'A2'),
  jsonb_build_object('id', pg_temp.did('A2'), 'round_id', pg_temp.id('A'), 'name', 'A', 'round_date', '2026-09-10', 'number', 2, 'distance', 30, 'is_marked', true, 'total', 320),
  '1件の項目は、距離の値、属するラウンドの名前と実施日、射つ順の番号、小計を持つ'
);

select is(
  pg_temp.numbers(pg_temp.list(null, null, null, null, null, 100)),
  'A1:1,A2:2,B1:1,B2:2,C1:1,C2:2,D1:1,F1:1,F3:2,H1:2,H2:1,I1:1,I2:2,J1:1,L1:1,L2:2,L3:3,Z1:1',
  '番号は無効でない距離だけに、position_keyとIDの順で1から詰めて振る（無効な30mを挟むF3は2、position_keyが同じH1とH2はIDの順でH2が1）'
);

select is(
  pg_temp.totals(pg_temp.list(null, null, null, null, null, 100)),
  'A1:300,A2:320,B1:250,B2:250,C1:280,C2:300,D1:300,F1:120,F3:100,H1:100,H2:200,I1:200,I2:220,J1:180,L1:0,L2:100,L3:50,Z1:220',
  '小計は、その距離の無効でない矢の点の和で、無効な矢を数えず、矢のない距離は0である（距離が判明しない距離も出し、小計を持つ）'
);

select is(
  jsonb_build_array(pg_temp.item(pg_temp.list(null, null, null, null, null, 100), 'L2') -> 'distance', pg_temp.item(pg_temp.list(null, null, null, null, null, 100), 'L2') -> 'is_marked',
    pg_temp.item(pg_temp.list(null, null, null, null, null, 100), 'L3') -> 'distance', pg_temp.item(pg_temp.list(null, null, null, null, null, 100), 'L3') -> 'is_marked'),
  '[50, false, null, false]'::jsonb,
  '距離が判明しない距離は、距離の値（入っていれば50、なければnull）と is_marked が偽の項目として返る'
);

select is(
  (select string_agg(r.alias || ':' || r.dl_total || ':' || r.rl_total, ',' order by r.alias)
   from (
     select i.alias,
       (select sum((e.r ->> 'total')::bigint) from jsonb_array_elements(pg_temp.list(null, null, null, null, null, 100) -> 'distances') as e(r) where (e.r ->> 'round_id')::uuid = i.id) as dl_total,
       (select (e.r ->> 'total')::bigint from jsonb_array_elements(public.rounds_list(null, null, null, null, null, 100) -> 'rounds') as e(r) where (e.r ->> 'id')::uuid = i.id) as rl_total
     from dl_id i where i.alias in ('A', 'B', 'C', 'Z')
   ) as r where r.dl_total = r.rl_total),
  'A:620:620,B:500:500,C:580:580,Z:220:220',
  '無効な距離を持たないラウンドは、距離の小計の和が、同じラウンドのrounds_listの合計点と等しい'
);

-- ============================================================
-- 並び
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  'J1,I1,I2,H2,H1,F1,F3,L1,L2,L3,C1,C2,D1,B1,B2,Z1,A1,A2',
  '既定の並びは日付の降順で、同じ日付はラウンドの作成時刻の新しい順、それも同じ（CとD）ならラウンドのIDの昇順、同じラウンドの中は番号の順である'
);

select is(
  pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100)),
  'A1,A2,Z1,C1,C2,D1,B1,B2,L1,L2,L3,F1,F3,H2,H1,I1,I2,J1',
  '日付の昇順でも、同じ日付はラウンドの作成時刻の新しい順、ラウンドのIDの昇順、同じラウンドの中は番号の順である'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100)),
  'A2,C2,D1,A1,C1,B1,B2,I2,Z1,I1,H2,J1,F1,H1,F3,L2,L3,L1',
  '得点の降順は小計で並び、同値はラウンドの実施日の新しい順、作成時刻の新しい順、ラウンドのID、番号の順である（B1とB2、C2とD1とA1）'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100)),
  'L1,L3,H1,F3,L2,F1,J1,I1,H2,I2,Z1,B1,B2,C1,C2,D1,A1,A2',
  '得点の昇順でも、同値の並びは向きによらず変わらず、ラウンドの鍵は新しい順である'
);

select is(
  pg_temp.ids(pg_temp.list('name', 'up', null, null, null, 100)),
  'J1,I1,I2,H2,H1,F1,F3,L1,L2,L3,C1,C2,D1,B1,B2,Z1,A1,A2',
  '未知の基準と向きは、例外にならず既定の並び（日付の降順）になる'
);

-- ============================================================
-- ラウンドの属性での絞り込み（距離が属するラウンドが対象）
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, 'outdoor', null, null, 100)),
  'J1,I1,I2,F1,F3,L1,L2,L3,C1,C2,D1,A1,A2',
  '種別で絞ると、属するラウンドが一致する距離を全て返す（屋外）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, 'indoor', null, null, 100)),
  'H2,H1,B1,B2,Z1',
  '種別で絞ると、属するラウンドが一致する距離を全て返す（インドア）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, 'barebow', null, 100)),
  'H2,H1,C1,C2',
  '弓種で絞ると、属するラウンドが一致する距離を全て返す'
);

select is(
  pg_temp.ids(pg_temp.list('score', 'desc', 'indoor', 'compound', null, 100)),
  'B1,B2',
  '種別と弓種の両方に一致するラウンドの距離だけを返し、並べ替えと同時に指定できる'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-09-12')),
  'J1,I1,I2,H2,H1,F1,F3,L1,L2,L3,C1,C2,D1,B1,B2',
  '期間の開始日だけを指定すると、その日以降（当日を含む）のラウンドの距離を返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, '2026-09-11')),
  'Z1,A1,A2',
  '期間の終了日だけを指定すると、その日以前（当日を含む）のラウンドの距離を返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, '2026-09-12', '2026-09-14')),
  'F1,F3,L1,L2,L3,C1,C2,D1,B1,B2',
  '開始日と終了日の両方を指定すると、両端の当日を含む範囲のラウンドの距離を返す'
);

select is(
  pg_temp.list(null, null, null, null, null, 10, '2026-09-13', '2026-09-12'),
  '{"distances": [], "has_more": false}'::jsonb,
  '開始日が終了日より後なら、例外にせず、空で続きなしを返す'
);

-- ============================================================
-- 得点の範囲（小計が対象）
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 280)),
  'C1,C2,D1,A1,A2',
  '下限だけを指定すると、小計が下限以上（境界を含む）の距離を返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, 50)),
  'L1,L3',
  '上限だけを指定すると、小計が上限以下（境界を含む）の距離を返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 100, 120)),
  'H1,F1,F3,L2',
  '下限と上限の両方を指定すると、小計が両端を含む範囲の距離を返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, 310, 330)),
  'A2',
  '範囲に入る小計の距離は、ラウンドの合計点（A: 620）が範囲の外でも返る'
);

select is(
  pg_temp.list(null, null, null, null, null, 100, null, null, 600, 650),
  '{"distances": [], "has_more": false}'::jsonb,
  'ラウンドの合計点（A: 620）が範囲に入っても、小計（300、320）が範囲の外の距離は返らない'
);

select is(
  pg_temp.list(null, null, null, null, null, 10, null, null, 600, 500),
  '{"distances": [], "has_more": false}'::jsonb,
  '下限が上限より大きくても、例外にせず、空で続きなしを返す'
);

-- ============================================================
-- 距離の構成（ラウンドが対象）
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 50}, {"distance": 30}]')),
  'A1,A2',
  '距離の構成に一致するラウンドの全ての距離を返す（50m→30mのA）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 70}, {"distance": 50}]')),
  'C1,C2',
  '距離の構成に一致するラウンドは、構成に含まれない距離の行（70m→50mのCの70m）も全て返す'
);

select is(
  pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 50}, {"distance": 70}]'),
  '{"distances": [], "has_more": false}'::jsonb,
  '射つ順が違う（逆順）構成のラウンドの距離は返らない'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 50}]')),
  'J1,D1',
  '距離の行の個数が違うラウンドの距離は返らない（50mの1行だけのDとJだけが返り、2行のAは返らない）'
);

select is(
  pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[]'),
  '{"distances": [], "has_more": false}'::jsonb,
  '距離の構成が空の配列なら、0件で続きなしを返す'
);

-- ============================================================
-- 距離の行（距離が対象）
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50}')),
  'J1,I1,I2,F1,L1,C2,D1,A1',
  '距離だけの行は、距離が50mの距離を、属するラウンドの構成によらず全て返す（30m、70m、距離が判明しない距離、無効な距離は返らない）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50, "arrows_per_end": 6}')),
  'J1,I2,F1,L1,C2,D1,A1',
  '1エンドの矢数を加えると、矢数も等しい距離だけを返す（6射のとき、12エンド×3射のI1は返らない）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50, "arrows_per_end": 3}')),
  'I1',
  '1エンドの矢数が3の行は、12エンド×3射の距離だけを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50, "total_arrows": 36}')),
  'J1,I1,I2,F1,L1,C2,D1,A1',
  '矢の総数を加えると、総数が等しい距離を返す（1エンドの矢数が違う2つの50m、I1とI2は、総数36で両方返る）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50, "target_face_id": "a1000000-0000-0000-0000-000000000002"}')),
  'J1',
  '的を加えると、的が等しい距離だけを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50, "arrows_per_end": null, "total_arrows": null, "target_face_id": null}')),
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50}')),
  '外した項目（nullの項目）は、鍵が無い項目と同じく、問わない'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 18, "arrows_per_end": 3, "total_arrows": 30, "target_face_id": "a1000000-0000-0000-0000-000000000004"}')),
  'H2,H1,B1,B2,Z1',
  '距離・1エンドの矢数・矢の総数・的を全て加えた行は、全てが等しい距離だけを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, null)),
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  '距離の行がnullなら、指定なしと同じ結果になる'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 50}, {"distance": 30}]', '{"distance": 50}')),
  'A1',
  '距離の構成と距離の行を併用すると、構成に一致するラウンドの、行に一致する距離だけを返す（50m→30mのAの50mだけ）'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 70}, {"distance": 50}]', '{"distance": 50}')),
  'C2',
  '距離の構成と距離の行を併用すると、構成に一致しないラウンドの50mと、行に一致しない距離（Cの70m）は返らない'
);

-- ============================================================
-- rounds_listとの整合（対象のラウンドをhistory_roundsから読んでいる証拠）
-- ============================================================

select is(
  pg_temp.round_aliases(pg_temp.list(null, null, 'outdoor', null, null, 100)),
  pg_temp.rounds_with_distances(public.rounds_list(null, null, 'outdoor', null, null, 100)),
  '種別で絞ったとき、距離単位の距離が属するラウンドの集合と出現の順が、rounds_listが返すラウンド（距離を持つもの）と一致する'
);

select is(
  pg_temp.round_aliases(pg_temp.list(null, null, null, null, null, 100, '2026-09-12', '2026-09-14')),
  pg_temp.rounds_with_distances(public.rounds_list(null, null, null, null, null, 100, '2026-09-12', '2026-09-14')),
  '期間で絞ったとき、距離が属するラウンドの集合と出現の順が、rounds_listが返すラウンドと一致する'
);

select is(
  pg_temp.round_aliases(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 18}, {"distance": 18}]')),
  pg_temp.rounds_with_distances(public.rounds_list(null, null, null, null, null, 100, null, null, null, null, '[{"distance": 18}, {"distance": 18}]')),
  '距離の構成で絞ったとき、距離が属するラウンドの集合と出現の順が、rounds_listが返すラウンドと一致する'
);

-- ============================================================
-- ページの切り出し
-- ============================================================

select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 5)), '5:true', '全18件より少ない件数では、その件数だけ返して続きありにする');
select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 17)), '17:true', '全件より1件少ない件数では、続きありにする');
select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 18)), '18:false', '全件と同じ件数では、続きなしにする');
select is(pg_temp.shape(pg_temp.list(null, null, null, null, null, 19)), '18:false', '全件より多い件数では、全件を返して続きなしにする');

select is(
  pg_temp.list(null, null, null, null, null, 5) -> 'has_more',
  'true'::jsonb,
  '起点なしの先頭ページは、件数分だけ返し、続きありにする'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 4)),
  'J1,I1,I2,H2',
  '先頭のページ（起点なし）は、並びの先頭から返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, 'I2', 3)),
  'H2,H1,F1',
  '起点の距離のIDを指定すると、その距離より後を返す（同じラウンドの距離がページの境界をまたぐ）'
);

select is(pg_temp.walk('date', 'desc', array[2, 3, 1]), pg_temp.ids(pg_temp.list('date', 'desc', null, null, null, 100)), '日付の降順、条件なし: ページごとに件数が違っても、全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'asc', array[2, 3, 1]), pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100)), '日付の昇順、条件なし: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'desc', array[2, 3, 1]), pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100)), '得点の降順、条件なし: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'asc', array[2, 3, 1]), pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100)), '得点の昇順、条件なし: 全ページの連結が1回の取得と一致する');

select is(pg_temp.walk('date', 'desc', array[1, 2], p_distance => '{"distance": 50}'), pg_temp.ids(pg_temp.list('date', 'desc', null, null, null, 100, p_distance => '{"distance": 50}')), '日付の降順、距離の行あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'asc', array[1, 2], p_distance => '{"distance": 50}'), pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100, p_distance => '{"distance": 50}')), '日付の昇順、距離の行あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'desc', array[1, 2], p_distance => '{"distance": 50}'), pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, p_distance => '{"distance": 50}')), '得点の降順、距離の行あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'asc', array[1, 2], p_distance => '{"distance": 50}'), pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100, p_distance => '{"distance": 50}')), '得点の昇順、距離の行あり: 全ページの連結が1回の取得と一致する');

select is(pg_temp.walk('date', 'desc', array[2, 3], p_min => 100, p_max => 300), pg_temp.ids(pg_temp.list('date', 'desc', null, null, null, 100, null, null, 100, 300)), '日付の降順、得点の範囲あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'asc', array[2, 3], p_min => 100, p_max => 300), pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100, null, null, 100, 300)), '日付の昇順、得点の範囲あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'desc', array[2, 3], p_min => 100, p_max => 300), pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, 100, 300)), '得点の降順、得点の範囲あり: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'asc', array[2, 3], p_min => 100, p_max => 300), pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100, null, null, 100, 300)), '得点の昇順、得点の範囲あり: 全ページの連結が1回の取得と一致する');

select is(pg_temp.walk('date', 'desc', array[1, 2], p_distances => '[{"distance": 18}, {"distance": 18}]', p_distance => '{"distance": 18}'), pg_temp.ids(pg_temp.list('date', 'desc', null, null, null, 100, null, null, null, null, '[{"distance": 18}, {"distance": 18}]', '{"distance": 18}')), '日付の降順、構成と距離の行の併用: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('date', 'asc', array[1, 2], p_distances => '[{"distance": 18}, {"distance": 18}]', p_distance => '{"distance": 18}'), pg_temp.ids(pg_temp.list('date', 'asc', null, null, null, 100, null, null, null, null, '[{"distance": 18}, {"distance": 18}]', '{"distance": 18}')), '日付の昇順、構成と距離の行の併用: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'desc', array[1, 2], p_distances => '[{"distance": 18}, {"distance": 18}]', p_distance => '{"distance": 18}'), pg_temp.ids(pg_temp.list('score', 'desc', null, null, null, 100, null, null, null, null, '[{"distance": 18}, {"distance": 18}]', '{"distance": 18}')), '得点の降順、構成と距離の行の併用: 全ページの連結が1回の取得と一致する');
select is(pg_temp.walk('score', 'asc', array[1, 2], p_distances => '[{"distance": 18}, {"distance": 18}]', p_distance => '{"distance": 18}'), pg_temp.ids(pg_temp.list('score', 'asc', null, null, null, 100, null, null, null, null, '[{"distance": 18}, {"distance": 18}]', '{"distance": 18}')), '得点の昇順、構成と距離の行の併用: 全ページの連結が1回の取得と一致する');

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, 'C1', 10, null, null, null, null, null, '{"distance": 50}')),
  'C2,D1,A1',
  '起点の距離（Cの70m）が距離の行の条件に一致しなくても、起点として引け、その続きを返す'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, 'F1', 10, null, null, 290)),
  'C2,D1,A1,A2',
  '起点の距離（小計120）が得点の範囲（下限290）の外でも、起点として引け、その続きを返す'
);

-- ============================================================
-- 起点が見えない・存在しない
-- ============================================================

select is(
  pg_temp.list_after_id('00000000-0000-4000-8000-000000000000', 10),
  '{"distances": [], "has_more": false}'::jsonb,
  '存在しない起点の距離のIDでは、0件で続きなしを返す'
);

select is(
  pg_temp.list(null, null, null, null, 'Y1', 10),
  '{"distances": [], "has_more": false}'::jsonb,
  '自分が属さないラウンドの距離を起点にしても、中身を返さず、0件で続きなしを返す'
);

-- ============================================================
-- 権限
-- ============================================================

select set_config('request.jwt.claim.sub', pg_temp.id('N')::text, true);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100)),
  'Y1,Z1',
  '利用者を切り替えると、その利用者が属するラウンドの距離だけを返し、Eだけが属するラウンドの距離を返さない'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 100, null, null, null, null, null, '{"distance": 50}')),
  'Y1',
  '距離の行を指定しても、属するラウンドの距離だけを返す'
);

select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- ページの間の変更（利用者E）
-- ============================================================

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 3)),
  'J1,I1,I2',
  'ページの間の変更の前: 先頭のページの最後は I2 である'
);

reset role;
-- 起点の距離（I2）が無効にされた。行は残る。
update public.distances set disabled_at = now() where id = pg_temp.did('I2');
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
set local role authenticated;

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, 'I2', 3)),
  'H2,H1,F1',
  '起点の距離が無効にされても、起点として引け、次のページが重複も抜けもなく続く'
);

reset role;
-- 起点のラウンド（I）が削除された。
update public.rounds set disabled_at = now() where id = pg_temp.id('I');
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
set local role authenticated;

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, 'I2', 3)),
  'H2,H1,F1',
  '起点のラウンドが削除されても、起点として引け、次のページが続く'
);

reset role;
-- ラウンド（H）が完了でなくなった。
update public.rounds set status = 'in_progress' where id = pg_temp.id('H');
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
set local role authenticated;

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, 'I2', 3)),
  'F1,F3,L1',
  '起点より後のラウンドが完了でなくなっても、次のページに抜けも重複も出ない'
);

reset role;
-- 起点より前に、新しいラウンド（K）が完了した。
select pg_temp.mkd('K', 'E', '2026-09-30', 'outdoor', 'recurve', 'completed', '[{"n":"K1","k":"1","d":50,"e":6,"a":6,"t":10}]');
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);
set local role authenticated;

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, 'I2', 3)),
  'F1,F3,L1',
  '起点より前に新しい距離が完了して現れても、次のページに重複して現れない'
);

select is(
  pg_temp.ids(pg_temp.list(null, null, null, null, null, 2)),
  'K1,J1',
  '先頭から取り直すと、新しく完了した距離が先頭に現れる'
);

select * from finish();

rollback;
