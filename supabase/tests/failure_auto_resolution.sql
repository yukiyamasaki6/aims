-- 項目ごとの自動解決（update_round / update_distanceのp_changes）の、規則表に収まらない振る舞いを確認する。
--   - 効いた項目だけがイベントのset_fieldsに残り、効かなかった項目と操作は記録されない（revisionに欠番を作らない）
--   - 同じ操作の中で、is_markedを距離(m)より先に判定する
--   - configは3項目を一体で判定し、見えている矢が収まらなければ3項目とも反映しない
--   - 取り消し済みの矢は、configの判定に使わない
--   - 削除済みの距離は、後から届いた操作が効かない
-- RPC × 観点の網羅（権限、入力検証、冪等性）はrpc_matrix.sqlで固定している。

begin;

select plan(23);

create temp table fa_id (alias text primary key, id uuid not null);
insert into fa_id (alias, id) values
  ('E',  'e0000000-0000-0000-0000-000000000001'),
  ('N',  'e0000000-0000-0000-0000-000000000002'),
  ('RF', 'e0000000-0000-0000-0000-000000000010'),
  ('RO', 'e0000000-0000-0000-0000-000000000011'),
  ('U',  'e0000000-0000-0000-0000-000000000021'),
  ('S',  'e0000000-0000-0000-0000-000000000022'),
  ('X',  'e0000000-0000-0000-0000-000000000023'),
  ('SS', 'e0000000-0000-0000-0000-000000000031'),
  ('XS', 'e0000000-0000-0000-0000-000000000032');

grant select on fa_id to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from fa_id where alias = p_alias $$;

create function pg_temp.ev(p_n int) returns uuid
language sql immutable
as $$ select ('e0000000-0000-0000-0000-0000000e' || lpad(p_n::text, 4, '0'))::uuid $$;

create function pg_temp.face() returns uuid
language sql stable
as $$ select id from public.target_faces order by id limit 1 $$;

create function pg_temp.fields(p_result jsonb) returns text
language sql immutable
as $$ select coalesce(array_to_string(array(select jsonb_array_elements_text(p_result -> 'applied_fields')), ','), '-') $$;

create function pg_temp.rejected(p_result jsonb) returns text
language sql immutable
as $$
  select coalesce(string_agg((r ->> 'field') || ':' || (r ->> 'reason'), ',' order by o), '-')
  from jsonb_array_elements(p_result -> 'rejected_fields') with ordinality as t(r, o)
$$;

create function pg_temp.set_fields(p_event int) returns text
language sql stable
as $$
  select coalesce(array_to_string((select set_fields from public.round_events where event_id = pg_temp.ev(p_event)
    union all select set_fields from public.distance_events where event_id = pg_temp.ev(p_event)), ','), '-')
$$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('N'));

-- RF: field（Unmarked距離Uを持つ）。RO: outdoor。S: 矢あり（6x6）。X: 矢を取り消した（6x6）。
insert into public.rounds (id, name, round_date, format, bow_type) values
  (pg_temp.id('RF'), 'Auto Field', '2026-01-01', 'field', 'recurve'),
  (pg_temp.id('RO'), 'Auto Outdoor', '2026-01-01', 'outdoor', 'recurve');
insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('RF'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('RO'), pg_temp.id('E'), 'editor');
insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked) values
  (pg_temp.id('U'), pg_temp.id('RF'), 'a', null, 6, 6, pg_temp.face(), false),
  (pg_temp.id('S'), pg_temp.id('RO'), 'a', 50, 6, 6, pg_temp.face(), true),
  (pg_temp.id('X'), pg_temp.id('RO'), 'b', 30, 6, 6, pg_temp.face(), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

select public.record_shots(jsonb_build_array(
  jsonb_build_object('shot_event_id', pg_temp.ev(1), 'shot_id', pg_temp.id('SS'), 'distance_id', pg_temp.id('S'), 'end_number', 3, 'score_str', '9', 'score_int', 9),
  jsonb_build_object('shot_event_id', pg_temp.ev(2), 'shot_id', pg_temp.id('XS'), 'distance_id', pg_temp.id('X'), 'end_number', 5, 'score_str', '9', 'score_int', 9)
));
select public.clear_shots(jsonb_build_array(
  jsonb_build_object('shot_event_id', pg_temp.ev(3), 'shot_id', pg_temp.id('XS'), 'distance_id', pg_temp.id('X'))
));

-- ============================================================
-- ラウンド: 効いた項目だけが記録される
-- ============================================================

-- Given: Unmarkedの距離を持つフィールドのラウンド
-- When: ラウンド名の変更と、種別のフィールド以外への変更を同時に送る
create temp table fa_r1 as
select public.update_round(pg_temp.ev(10), pg_temp.id('RF'), '{"name":"Auto Field Renamed","format":"outdoor"}') as r;

-- Then: 名前だけが反映され、種別は不変条件で反映されない
select is(pg_temp.fields((select r from fa_r1)), 'name', 'update_round: 効いた項目だけをapplied_fieldsで返す');
select is(pg_temp.rejected((select r from fa_r1)), 'format:INVARIANT', 'update_round: 効かなかった項目を理由付きでrejected_fieldsで返す');
select is(
  (select name || '/' || format from public.rounds where id = pg_temp.id('RF')),
  'Auto Field Renamed/field',
  'update_round: 効いた項目だけがラウンドに反映される'
);
select is(pg_temp.set_fields(10), 'name', 'update_round: イベントのset_fieldsには効いた項目だけが残る');

-- Given: 上の操作でrevisionが2になった
-- When: 全項目が効かない操作を送り、続けて効く操作を送る
create temp table fa_r2 as
select public.update_round(pg_temp.ev(11), pg_temp.id('RF'), '{"format":"outdoor"}') as r;
create temp table fa_r3 as
select public.update_round(pg_temp.ev(12), pg_temp.id('RF'), '{"bow_type":"barebow"}') as r;

-- Then: 効かない操作は記録されず、次の操作が欠番なく連続したrevisionになる
select is(
  (select coalesce(r ->> 'revision', '') || '/' || (r ->> 'applied') from fa_r2),
  '/false',
  'update_round: 全項目が効かない操作はrevisionを持たず、appliedがfalseになる'
);
select is(
  (select count(*)::int from public.round_events where event_id = pg_temp.ev(11)),
  0,
  'update_round: 全項目が効かない操作はイベントに残らない'
);
select is((select r ->> 'revision' from fa_r3), '3', 'update_round: 効かない操作の後の次の操作は欠番なく連続したrevisionになる');

-- ============================================================
-- 距離: Markedの判定に同じ操作の距離(m)を使う
-- ============================================================

-- Given: Unmarkedで距離(m)がない距離（フィールド）
-- When: Markedにする変更と距離(m)の設定を同じ操作で送る
create temp table fa_d1 as
select public.update_distance(pg_temp.ev(20), pg_temp.id('U'), '{"is_marked":true,"distance":60}') as r;

-- Then: 同じ操作の項目は同じ確定の順序なので、Markedは保存後の距離(m)で判定され、両方が効く
select is(pg_temp.fields((select r from fa_d1)), 'is_marked,distance', 'update_distance: 同じ操作のMarkedと距離(m)は両方が効く');
select is(pg_temp.rejected((select r from fa_d1)), '-', 'update_distance: 同じ操作のMarkedと距離(m)は不反映にならない');
select is(
  (select is_marked::text || '/' || distance from public.distances where id = pg_temp.id('U')),
  'true/60',
  'update_distance: Markedと距離(m)が同時に反映される'
);
select is(pg_temp.set_fields(20), 'distance,is_marked', 'update_distance: イベントのset_fieldsは効いた項目だけになる');

-- Given: 距離(m)を持つUnmarkedの距離
select public.update_distance(pg_temp.ev(24), pg_temp.id('U'), '{"is_marked":false}');
-- When: Markedにする変更だけを送る
create temp table fa_d1b as
select public.update_distance(pg_temp.ev(23), pg_temp.id('U'), '{"is_marked":true}') as r;

-- Then: 反映される
select is(pg_temp.fields((select r from fa_d1b)), 'is_marked', 'update_distance: 距離(m)を持つUnmarkedの距離はMarkedにできる');

-- Given: Markedになった距離
-- When: 距離(m)を未設定にする変更だけを送る
create temp table fa_d2 as
select public.update_distance(pg_temp.ev(21), pg_temp.id('U'), '{"distance":null}') as r;

-- Then: Markedは距離(m)が必要なため、反映されない
select is(pg_temp.rejected((select r from fa_d2)), 'distance:INVARIANT', 'update_distance: Markedの距離の距離(m)の未設定は不変条件で効かない');
select is(
  (select distance from public.distances where id = pg_temp.id('U')),
  60::bigint,
  'update_distance: 効かなかった距離(m)の未設定は距離に反映されない'
);

-- Given: Markedの距離
-- When: 距離(m)の未設定とUnmarkedへの変更を同じ操作で送る
create temp table fa_d3 as
select public.update_distance(pg_temp.ev(22), pg_temp.id('U'), '{"is_marked":false,"distance":null}') as r;

-- Then: フィールドのため、Unmarkedと距離(m)の未設定が両方反映される
select is(pg_temp.fields((select r from fa_d3)), 'is_marked,distance', 'update_distance: フィールドのUnmarkedへの変更と距離(m)の未設定を同じ操作で反映できる');

-- ============================================================
-- 距離: configは3項目を一体で判定する
-- ============================================================

-- Given: 3エンド目に矢がある距離
-- When: 距離(m)の変更と、矢が収まらないエンド数のconfigの変更を同時に送る
create temp table fa_c1 as
select public.update_distance(pg_temp.ev(30), pg_temp.id('S'),
  jsonb_build_object('distance', 40, 'config', jsonb_build_object('total_ends', 2, 'arrows_per_end', 6, 'target_face_id', pg_temp.face()))) as r;

-- Then: 距離(m)だけが反映され、configは3項目とも反映されない
select is(pg_temp.fields((select r from fa_c1)), 'distance', 'update_distance: configが収まらなくても、他の項目は反映される');
select is(pg_temp.rejected((select r from fa_c1)), 'config:UNFIT', 'update_distance: 収まらないconfigは3項目を1つのconfigとして理由付きで返す');
select is(
  (select total_ends::text || 'x' || arrows_per_end from public.distances where id = pg_temp.id('S')),
  '6x6',
  'update_distance: 収まらないconfigは3項目とも反映されない'
);

-- When: 矢が収まる範囲へconfigを変更する
create temp table fa_c2 as
select public.update_distance(pg_temp.ev(31), pg_temp.id('S'),
  jsonb_build_object('config', jsonb_build_object('total_ends', 3, 'arrows_per_end', 4, 'target_face_id', pg_temp.face()))) as r;

-- Then: 3項目とも反映され、set_fieldsには3項目に展開して残る
select is(
  (select total_ends::text || 'x' || arrows_per_end from public.distances where id = pg_temp.id('S')),
  '3x4',
  'update_distance: 矢が収まるconfigは3項目とも反映される'
);
select is(pg_temp.set_fields(31), 'total_ends,arrows_per_end,target_face_id', 'update_distance: configのset_fieldsは3項目に展開される');

-- Given: 5エンド目の矢が取り消されている距離
-- When: 取り消した矢のエンドが収まらないconfigへ変更する
create temp table fa_c3 as
select public.update_distance(pg_temp.ev(32), pg_temp.id('X'),
  jsonb_build_object('config', jsonb_build_object('total_ends', 2, 'arrows_per_end', 2, 'target_face_id', pg_temp.face()))) as r;

-- Then: 取り消された矢は見えないため、configが反映される
select is(pg_temp.fields((select r from fa_c3)), 'config', 'update_distance: 取り消し済みの矢はconfigの判定に使わない');

-- ============================================================
-- 削除済みの距離
-- ============================================================

-- Given: 削除された距離
-- When: 後から届いた変更を送る
select public.disable_distance(pg_temp.ev(40), pg_temp.id('X'));
create temp table fa_x1 as
select public.update_distance(pg_temp.ev(41), pg_temp.id('X'), '{"distance":20}') as r;

-- Then: DISABLEDで効かず、記録されない
select is(
  (select (r ->> 'reason') || '/' || (r ->> 'applied') from fa_x1),
  'DISABLED/false',
  'update_distance: 削除済みの距離への変更はDISABLEDで効かない'
);
select is(
  (select count(*)::int from public.distance_events where event_id = pg_temp.ev(41)),
  0,
  'update_distance: 削除済みの距離への変更はイベントに残らない'
);

select * from finish();

rollback;
