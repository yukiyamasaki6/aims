-- 矢の識別（矢のID）、項目ごとの記録、射順（shot_number）、矢数の上限を確認する。
--   - 矢はIDで識別し、エンド内の位置（arrow_number）を持たない
--   - record_shotsは要素に含まれる項目だけを変え、効いた属性をset_fieldsとapplied_fieldsに残す
--   - 射順は1〜矢数で、同じエンドの生きている矢で重ならない。重なる書き込みは射順だけが効かない
--   - 消した矢を戻すとき、射順が他の生きている矢に使われていれば射順だけが外れる
--   - エンドの生きている矢は矢数を超えない（RPCの判定と、RPCを通らない書き込みを止める制約トリガー）
-- RPC × 観点の網羅（権限、入力検証、冪等性）はrpc_matrix.sqlで固定している。
-- 既存データの変換（移行前の行へのIDの付与）は、移行の後に走るこのテストでは再現できないため、移行の後の形だけを確認する。

begin;

select plan(43);

create temp table si_id (alias text primary key, id uuid not null);
insert into si_id (alias, id) values
  ('E',  'f1000000-0000-0000-0000-000000000001'),
  ('V',  'f1000000-0000-0000-0000-000000000002'),
  ('R',  'f1000000-0000-0000-0000-000000000010'),
  ('D',  'f1000000-0000-0000-0000-000000000020'),
  ('DC', 'f1000000-0000-0000-0000-000000000021'),
  ('DS', 'f1000000-0000-0000-0000-000000000022');

grant select on si_id to authenticated;

-- RPCの応答を保存する。応答と、その後の行の状態を別の文で読むため（同じ文の中では呼び出しの前の状態が見える）。
create temp table si_r (n int primary key, r jsonb not null);
grant select, insert on si_r to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from si_id where alias = p_alias $$;

-- イベントIDと矢のIDは番号から作る。
create function pg_temp.ev(p_n int) returns uuid
language sql immutable
as $$ select ('f1000000-0000-0000-0000-0000000e' || lpad(p_n::text, 4, '0'))::uuid $$;

create function pg_temp.sh(p_n int) returns uuid
language sql immutable
as $$ select ('f1000000-0000-0000-0000-0000000a' || lpad(p_n::text, 4, '0'))::uuid $$;

create function pg_temp.face() returns uuid
language sql stable
as $$ select id from public.target_faces order by id limit 1 $$;

-- 記録の要素。p_extraで射手・射順のキーを足す。
create function pg_temp.rec(p_event int, p_shot int, p_distance text, p_end int, p_score int, p_extra jsonb default '{}') returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'shot_event_id', pg_temp.ev(p_event), 'shot_id', pg_temp.sh(p_shot), 'distance_id', pg_temp.id(p_distance),
    'end_number', p_end, 'score_str', p_score::text, 'score_int', p_score
  ) || p_extra
$$;

create function pg_temp.clr(p_event int, p_shot int, p_distance text) returns jsonb
language sql stable
as $$ select jsonb_build_object('shot_event_id', pg_temp.ev(p_event), 'shot_id', pg_temp.sh(p_shot), 'distance_id', pg_temp.id(p_distance)) $$;

-- 1要素の結果を 理由または効いた{効いた属性}!効かなかった属性:理由 で表す。
create function pg_temp.res(p_results jsonb) returns text
language sql immutable
as $$
  select coalesce(e ->> 'reason', 'applied')
    || coalesce('{' || (select string_agg(f, ',') from jsonb_array_elements_text(case when jsonb_typeof(e -> 'applied_fields') = 'array' then e -> 'applied_fields' else '[]' end) f) || '}', '')
    || coalesce('!' || (select string_agg((r ->> 'field') || ':' || (r ->> 'reason'), ',') from jsonb_array_elements(case when jsonb_typeof(e -> 'rejected_fields') = 'array' then e -> 'rejected_fields' else '[]' end) r), '')
  from (select p_results -> 0 as e) t
$$;

-- 矢の行を 点数/射手/#射順/生死 で表す。
create function pg_temp.st(p_shot int) returns text
language sql stable
as $$
  select coalesce((
    select s.score_str || '/' || coalesce(u.alias, '?') || '/#' || coalesce(s.shot_number::text, '-')
      || case when s.disabled_at is null then '/live' else '/cleared' end
    from public.shots s
    left join si_id u on u.id = s.shooter_id
    where s.id = pg_temp.sh(p_shot)
  ), 'absent')
$$;

-- イベントを set_fields/射手/#射順 で表す。
create function pg_temp.evst(p_event int) returns text
language sql stable
as $$
  select coalesce((
    select coalesce(array_to_string(e.set_fields, ','), '-') || '/' || coalesce(u.alias, '-') || '/#' || coalesce(e.shot_number::text, '-')
    from public.shot_events e
    left join si_id u on u.id = e.shooter_id
    where e.event_id = pg_temp.ev(p_event)
  ), 'absent')
$$;

create function pg_temp.live(p_distance text, p_end int) returns bigint
language sql stable
as $$ select count(*) from public.shots where distance_id = pg_temp.id(p_distance) and end_number = p_end and disabled_at is null $$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('V'));

-- D: 6エンド×6本。DC: 6エンド×3本（矢数の上限）。DS: 6エンド×6本（構成の変更と射順）。
insert into public.rounds (id, name, round_date, format, bow_type) values
  (pg_temp.id('R'), 'Shot Identity', '2026-01-01', 'outdoor', 'recurve');
insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('R'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R'), pg_temp.id('V'), 'editor');
insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked) values
  (pg_temp.id('D'), pg_temp.id('R'), 'a', 70, 6, 6, pg_temp.face(), true),
  (pg_temp.id('DC'), pg_temp.id('R'), 'b', 50, 6, 3, pg_temp.face(), true),
  (pg_temp.id('DS'), pg_temp.id('R'), 'c', 30, 6, 6, pg_temp.face(), true);

-- ============================================================
-- 形: 矢はIDで識別し、エンド内の位置を持たない
-- ============================================================

select hasnt_column('public', 'shots', 'arrow_number', 'shotsはエンド内の位置（arrow_number）を持たない');
select hasnt_column('public', 'shot_events', 'arrow_number', 'shot_eventsはエンド内の位置（arrow_number）を持たない');
select col_not_null('public', 'shot_events', 'shot_id', 'shot_eventsは対象の矢のIDを必ず持つ');
select col_is_unique('public', 'shot_events', array['shot_id', 'revision'], 'shot_eventsは矢ごとのrevisionで一意');
select has_trigger('public', 'shots', 'shots_capacity_guard', 'shotsに矢数の上限の制約トリガーがある');
select has_trigger('public', 'distances', 'distances_capacity_guard', 'distancesに矢数の上限の制約トリガーがある');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- 項目: 要素に含まれる項目だけを変える
-- ============================================================

-- When: 射手・射順を省いて新しい矢を記録する
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(1, 1, 'D', 1, 9)))),
  'applied{score,shooter_id}',
  '新しい矢は、射手を省くと実行者を射手として記録し、射手を効いた属性に含める'
);
select is(pg_temp.st(1), '9/E/#-/live', '新しい矢は射順不明（null）で記録される');
select is(pg_temp.evst(1), 'score,shooter_id/E/#-', 'イベントのset_fieldsは効いた属性を挙げる');

-- When: 射手を指定して点数を変える
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(2, 1, 'D', 1, 8, jsonb_build_object('shooter_id', pg_temp.id('V')))))),
  'applied{score,shooter_id}',
  '射手を指定した記録は、射手を効いた属性に含める'
);
select is(pg_temp.st(1), '8/V/#-/live', '射手を指定すると射手が変わる');

-- When: 射手を省いて点数だけを変える
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(3, 1, 'D', 1, 7)))),
  'applied{score}',
  '射手を省いた更新は、点数だけを効いた属性にする'
);
select is(pg_temp.st(1) || ' ' || pg_temp.evst(3), '7/V/#-/live score/V/#-', '射手を省いた更新は射手を変えず、イベントには行の射手を写す');

-- When: 射順を書き、点数だけを変え、射順をnullで外す
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(4, 1, 'D', 1, 7, '{"shot_number":2}')))),
  'applied{score,shot_number}',
  '射順を指定した記録は、射順を効いた属性に含める'
);
select public.record_shots(jsonb_build_array(pg_temp.rec(5, 1, 'D', 1, 6)));
select is(pg_temp.st(1), '6/V/#2/live', '射順を省いた更新は射順を変えない');
insert into si_r (n, r) values (1, public.record_shots(jsonb_build_array(pg_temp.rec(6, 1, 'D', 1, 6, '{"shot_number":null}'))));
select is(
  pg_temp.res((select r from si_r where n = 1)) || ' ' || pg_temp.st(1) || ' ' || pg_temp.evst(6),
  'applied{score,shot_number} 6/V/#-/live score,shot_number/V/#-',
  '射順のnullは射順を外し、イベントにはnullを記録する'
);

-- When: 射手・射順を持つ矢を消し、点数だけの記録で戻す
select public.record_shots(jsonb_build_array(pg_temp.rec(7, 1, 'D', 1, 6, '{"shot_number":3}')));
select public.clear_shots(jsonb_build_array(pg_temp.clr(8, 1, 'D')));
select is(pg_temp.st(1), '6/V/#3/cleared', '消すときは射手・射順を変えない');
insert into si_r (n, r) values (2, public.record_shots(jsonb_build_array(pg_temp.rec(9, 1, 'D', 1, 10))));
select is(
  pg_temp.res((select r from si_r where n = 2)) || ' ' || pg_temp.st(1),
  'applied{score} 10/V/#3/live',
  '消した矢を点数だけの記録で戻すと、射手・射順も戻る'
);

-- ============================================================
-- 射順: 範囲と重複
-- ============================================================

select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(10, 2, 'D', 1, 9, '{"shot_number":0}')))),
  'UNFIT',
  '射順0の記録は効かない'
);
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(11, 2, 'D', 1, 9, '{"shot_number":7}')))),
  'UNFIT',
  '射順が矢数を超える記録は効かない'
);
insert into si_r (n, r) values (3, public.record_shots(jsonb_build_array(pg_temp.rec(12, 2, 'D', 1, 9, '{"shot_number":6}'))));
select is(
  pg_temp.res((select r from si_r where n = 3)) || ' ' || pg_temp.st(2),
  'applied{score,shooter_id,shot_number} 9/E/#6/live',
  '射順が矢数と同じ記録は効く'
);

-- Given: 矢1が射順3を持つ。When: 同じエンドの矢2に射順3と新しい点数・射手を書く
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(13, 2, 'D', 1, 5, jsonb_build_object('shot_number', 3, 'shooter_id', pg_temp.id('V')))))),
  'applied{score,shooter_id}!shot_number:UNFIT',
  '同じエンドの他の生きている矢と重なる射順は、射順だけが効かない'
);
select is(pg_temp.st(2), '5/V/#6/live', '射順が効かなかった記録でも、点数と射手は効く');
select is(
  public.record_shots(jsonb_build_array(pg_temp.rec(13, 2, 'D', 1, 5, jsonb_build_object('shot_number', 3, 'shooter_id', pg_temp.id('V'))))) -> 0,
  jsonb_build_object('revision', 2, 'applied', true, 'applied_fields', jsonb_build_array('score', 'shooter_id'), 'rejected_fields', jsonb_build_array(jsonb_build_object('field', 'shot_number', 'reason', 'REJECTED')), 'reason', null),
  '確定済みの記録の再送は、記録した属性を効いた項目として返し、記録に無い属性をREJECTEDで返す'
);
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(14, 3, 'D', 2, 9, '{"shot_number":3}')))),
  'applied{score,shooter_id,shot_number}',
  '別のエンドなら同じ射順を書ける'
);

-- When: 射順3の矢1を消し、矢2に射順3を書く
select public.clear_shots(jsonb_build_array(pg_temp.clr(15, 1, 'D')));
insert into si_r (n, r) values (4, public.record_shots(jsonb_build_array(pg_temp.rec(16, 2, 'D', 1, 5, '{"shot_number":3}'))));
select is(
  pg_temp.res((select r from si_r where n = 4)) || ' ' || pg_temp.st(2),
  'applied{score,shot_number} 5/V/#3/live',
  '消した矢の射順は、同じエンドの別の矢に書ける'
);

-- ============================================================
-- 射順: 消した矢を戻す
-- ============================================================

-- Given: 射順3の矢1を消し、矢2が射順3を持つ。When: 矢1の消去を点数の記録で戻す
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(17, 1, 'D', 1, 10)))),
  'applied{score,shot_number}',
  '戻す矢の射順が他の矢に使われていれば、射順を外したことを効いた属性に含める'
);
select is(
  pg_temp.st(1) || ' ' || pg_temp.st(2) || ' ' || pg_temp.evst(17),
  '10/V/#-/live 5/V/#3/live score,shot_number/V/#-',
  '戻した矢は点数・射手とともに射順不明で戻り、他の矢の射順は残る'
);

-- Given: 射順4の矢4を消し、射順4は使われていない。When: 矢4を戻す
select public.record_shots(jsonb_build_array(pg_temp.rec(18, 4, 'D', 1, 8, '{"shot_number":4}')));
select public.clear_shots(jsonb_build_array(pg_temp.clr(19, 4, 'D')));
insert into si_r (n, r) values (5, public.record_shots(jsonb_build_array(pg_temp.rec(20, 4, 'D', 1, 7))));
select is(
  pg_temp.res((select r from si_r where n = 5)) || ' ' || pg_temp.st(4),
  'applied{score} 7/E/#4/live',
  '戻す矢の射順が使われていなければ、射順ごと戻る'
);

-- Given: 射順5の矢5を消し、矢6が射順5を持つ。When: 矢5を射順5の指定つきで戻す
select public.record_shots(jsonb_build_array(pg_temp.rec(21, 5, 'D', 3, 8, '{"shot_number":5}')));
select public.clear_shots(jsonb_build_array(pg_temp.clr(22, 5, 'D')));
select public.record_shots(jsonb_build_array(pg_temp.rec(23, 6, 'D', 3, 8, '{"shot_number":5}')));
insert into si_r (n, r) values (6, public.record_shots(jsonb_build_array(pg_temp.rec(24, 5, 'D', 3, 9, '{"shot_number":5}'))));
select is(
  pg_temp.res((select r from si_r where n = 6)) || ' ' || pg_temp.st(5) || ' ' || pg_temp.st(6),
  'applied{score,shot_number}!shot_number:UNFIT 9/E/#-/live 8/E/#5/live',
  '重なる射順を指定して戻すと、指定の射順は効かず、射順不明で戻る'
);

-- ============================================================
-- 射順: 構成の変更とDBの制約
-- ============================================================

-- Given: 矢数6の距離に射順6の矢がある。When: 記録を知らない端末から矢数4への変更が届く
select public.record_shots(jsonb_build_array(pg_temp.rec(25, 7, 'DS', 1, 9, '{"shot_number":6}')));
select is(
  public.update_distance(pg_temp.ev(26), pg_temp.id('DS'), jsonb_build_object('config', jsonb_build_object('total_ends', 6, 'arrows_per_end', 4, 'target_face_id', pg_temp.face())))
    -> 'rejected_fields',
  '[{"field":"config","reason":"UNFIT"}]'::jsonb,
  '射順が新しい矢数を超える矢があれば、構成の変更は効かない'
);
select is(
  (select arrows_per_end from public.distances where id = pg_temp.id('DS')) || ' ' || pg_temp.st(7),
  '6 9/E/#6/live',
  '効かなかった構成の変更の後も、矢数と射順・点数は残る'
);

reset role;

select throws_ok(
  format($$insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int, shot_number) values (%L, 4, %L, '9', 9, 0)$$, pg_temp.id('D'), pg_temp.id('E')),
  '23514',
  null,
  'RPCを通らない射順0の挿入はCHECK制約で止まる'
);
select throws_ok(
  format($$insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int, shot_number) values (%L, 1, %L, '9', 9, 3)$$, pg_temp.id('D'), pg_temp.id('E')),
  '23505',
  null,
  'RPCを通らない、同じエンドの生きている矢と重なる射順の挿入は一意索引で止まる'
);
select lives_ok(
  format($$insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int, shot_number, disabled_at) values (%L, 1, %L, '9', 9, 3, now())$$, pg_temp.id('D'), pg_temp.id('E')),
  '消した矢どうしは同じ射順を持てる'
);

-- ============================================================
-- 矢数の上限
-- ============================================================

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- When: 矢数3のエンドへ、同じ要求で4本を記録する
insert into si_r (n, r) values (8, public.record_shots(jsonb_build_array(
  pg_temp.rec(30, 30, 'DC', 1, 9), pg_temp.rec(31, 31, 'DC', 1, 9), pg_temp.rec(32, 32, 'DC', 1, 9), pg_temp.rec(33, 33, 'DC', 1, 9)
)));
select is(
  (select string_agg(coalesce(e ->> 'reason', 'applied'), ',' order by o)
    from jsonb_array_elements((select r from si_r where n = 8)) with ordinality as t(e, o)) || ' live=' || pg_temp.live('DC', 1),
  'applied,applied,applied,UNFIT live=3',
  '同じ要求で矢数を超える本目の新しい矢は効かない'
);
select is(pg_temp.st(33), 'absent', '効かなかった新しい矢は記録されない');

-- Given: 他の端末が矢30を消し、別の端末がそのエンドを矢数まで埋めた。When: 矢30の点数を変える記録が届く
select public.clear_shots(jsonb_build_array(pg_temp.clr(34, 30, 'DC')));
select public.record_shots(jsonb_build_array(pg_temp.rec(35, 34, 'DC', 1, 7)));
insert into si_r (n, r) values (7, public.record_shots(jsonb_build_array(pg_temp.rec(36, 30, 'DC', 1, 10))));
select is(
  pg_temp.res((select r from si_r where n = 7)) || ' ' || pg_temp.st(30) || ' live=' || pg_temp.live('DC', 1),
  'UNFIT 9/E/#-/cleared live=3',
  '消された矢の復活は、エンドが矢数に達していれば効かない'
);
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(37, 31, 'DC', 1, 10)))),
  'applied{score}',
  '矢数に達したエンドでも、生きている矢の点数は変えられる'
);

-- When: 3本のエンドがある距離の矢数を2に変える
select is(
  public.update_distance(pg_temp.ev(38), pg_temp.id('DC'), jsonb_build_object('config', jsonb_build_object('total_ends', 6, 'arrows_per_end', 2, 'target_face_id', pg_temp.face())))
    -> 'rejected_fields',
  '[{"field":"config","reason":"UNFIT"}]'::jsonb,
  '生きている矢の数が新しい矢数を超えるエンドがあれば、構成の変更は効かない'
);

reset role;

select throws_ok(
  format($$insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int) values (%L, 1, %L, '9', 9)$$, pg_temp.id('DC'), pg_temp.id('E')),
  '23514',
  'エンドの矢が矢数を超えます。',
  'RPCを通らない、矢数を超える挿入は制約トリガーで止まる'
);
select throws_ok(
  format($$update public.shots set disabled_at = null where id = %L$$, pg_temp.sh(30)),
  '23514',
  'エンドの矢が矢数を超えます。',
  'RPCを通らない、矢数を超える復活は制約トリガーで止まる'
);
select throws_ok(
  format($$update public.distances set arrows_per_end = 2 where id = %L$$, pg_temp.id('DC')),
  '23514',
  'エンドの矢が矢数を超えます。',
  'RPCを通らない矢数の減少は制約トリガーで止まる'
);

select * from finish();

rollback;
