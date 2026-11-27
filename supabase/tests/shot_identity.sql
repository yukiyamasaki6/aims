-- 矢のマス(distance_id, end_number, shot_number)による記録を確認する。
--   - record_shotsはマスの行を足す・置き換える・生き返らせ、効いた属性をset_fieldsとapplied_fieldsに残す
--   - 同じマスへの記録は、別のevent_idでも1行に置き換わり、2本の矢にならない
--   - 範囲外のマス・的に無い点数の記録は効かない（UNFIT）。射数/エンドの上限は、この範囲と主キーで守る
--   - マスの無い要素と、shot_idで矢を指しshot_numberが無い要素は契約の不一致（PT422）で拒否する
--   - 構成の変更は、生きている矢が全て新しい範囲に収まるときだけ効く
-- RPC × 観点（権限、入力検証、冪等性）はrpc_matrix.sqlで固定している。

begin;

select plan(34);

create temp table si_id (alias text primary key, id uuid not null);
insert into si_id (alias, id) values
  ('E',  'f1000000-0000-0000-0000-000000000001'),
  ('V',  'f1000000-0000-0000-0000-000000000002'),
  ('R',  'f1000000-0000-0000-0000-000000000010'),
  ('D',  'f1000000-0000-0000-0000-000000000020'),
  ('DC', 'f1000000-0000-0000-0000-000000000021'),
  ('DS', 'f1000000-0000-0000-0000-000000000022'),
  ('DB', 'f1000000-0000-0000-0000-000000000023');

grant select on si_id to authenticated;

-- RPCの応答を保存する。応答と、その後の行の状態を別の文で読むため（同じ文の中では呼び出しの前の状態が見える）。
create temp table si_r (n int primary key, r jsonb not null);
grant select, insert on si_r to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from si_id where alias = p_alias $$;

-- イベントIDは番号から作る。
create function pg_temp.ev(p_n int) returns uuid
language sql immutable
as $$ select ('f1000000-0000-0000-0000-0000000e' || lpad(p_n::text, 4, '0'))::uuid $$;

create function pg_temp.face() returns uuid
language sql stable
as $$ select id from public.target_faces order by id limit 1 $$;

-- 記録の要素。p_extraで射手などのキーを足す。
create function pg_temp.rec(p_event int, p_distance text, p_end int, p_number int, p_score int, p_extra jsonb default '{}') returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'shot_event_id', pg_temp.ev(p_event), 'distance_id', pg_temp.id(p_distance),
    'end_number', p_end, 'shot_number', p_number, 'score_str', p_score::text, 'score_int', p_score
  ) || p_extra
$$;

create function pg_temp.clr(p_event int, p_distance text, p_end int, p_number int) returns jsonb
language sql stable
as $$ select jsonb_build_object('shot_event_id', pg_temp.ev(p_event), 'distance_id', pg_temp.id(p_distance), 'end_number', p_end, 'shot_number', p_number) $$;

-- 1要素の結果を 理由または効いた{効いた属性}!効かなかった属性:理由 で表す。
create function pg_temp.res(p_results jsonb) returns text
language sql immutable
as $$
  select coalesce(e ->> 'reason', 'applied')
    || coalesce('{' || (select string_agg(f, ',') from jsonb_array_elements_text(case when jsonb_typeof(e -> 'applied_fields') = 'array' then e -> 'applied_fields' else '[]' end) f) || '}', '')
    || coalesce('!' || (select string_agg((r ->> 'field') || ':' || (r ->> 'reason'), ',') from jsonb_array_elements(case when jsonb_typeof(e -> 'rejected_fields') = 'array' then e -> 'rejected_fields' else '[]' end) r), '')
  from (select p_results -> 0 as e) t
$$;

-- 全要素の結果を、理由またはappliedの列で表す。
create function pg_temp.reasons(p_results jsonb) returns text
language sql immutable
as $$
  select string_agg(coalesce(e ->> 'reason', 'applied'), ',' order by o)
  from jsonb_array_elements(p_results) with ordinality as t(e, o)
$$;

-- RPCを呼び、拒否されたときはSQLSTATE、受け付けたときはokを返す。
create function pg_temp.code(p_fn text, p_shots jsonb) returns text
language plpgsql
as $$
begin
  execute format('select public.%I($1)', p_fn) using p_shots;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- マスの行を 点数/射手/revision/生死 で表す。
create function pg_temp.st(p_distance text, p_end int, p_number int) returns text
language sql stable
as $$
  select coalesce((
    select s.score_str || '/' || coalesce(u.alias, '?') || '/r' || s.revision
      || case when s.disabled_at is null then '/live' else '/cleared' end
    from public.shots s
    left join si_id u on u.id = s.shooter_id
    where s.distance_id = pg_temp.id(p_distance) and s.end_number = p_end and s.shot_number = p_number
  ), 'absent')
$$;

-- イベントを 種別/set_fields/射手/マス/revision で表す。
create function pg_temp.evst(p_event int) returns text
language sql stable
as $$
  select coalesce((
    select e.type || '/' || coalesce(array_to_string(e.set_fields, ','), '-') || '/' || coalesce(u.alias, '-')
      || '/' || e.end_number || '#' || e.shot_number || '/r' || e.revision
    from public.shot_events e
    left join si_id u on u.id = e.shooter_id
    where e.event_id = pg_temp.ev(p_event)
  ), 'absent')
$$;

create function pg_temp.rows(p_distance text, p_end int) returns bigint
language sql stable
as $$ select count(*) from public.shots where distance_id = pg_temp.id(p_distance) and end_number = p_end $$;

create function pg_temp.live(p_distance text, p_end int) returns bigint
language sql stable
as $$ select count(*) from public.shots where distance_id = pg_temp.id(p_distance) and end_number = p_end and disabled_at is null $$;

create function pg_temp.events(p_distance text) returns bigint
language sql stable
as $$ select count(*) from public.shot_events where distance_id = pg_temp.id(p_distance) $$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('V'));

-- D: 6エンド×6射。DC: 6エンド×3射。DS: 6エンド×6射（構成の変更）。DB: 6エンド×6射（範囲の境界）。
insert into public.rounds (id, name, round_date, format, bow_type) values
  (pg_temp.id('R'), 'Shot Identity', '2026-01-01', 'outdoor', 'recurve');
insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('R'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R'), pg_temp.id('V'), 'editor');
insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked) values
  (pg_temp.id('D'), pg_temp.id('R'), 'a', 70, 6, 6, pg_temp.face(), true),
  (pg_temp.id('DC'), pg_temp.id('R'), 'b', 50, 6, 3, pg_temp.face(), true),
  (pg_temp.id('DS'), pg_temp.id('R'), 'c', 30, 6, 6, pg_temp.face(), true),
  (pg_temp.id('DB'), pg_temp.id('R'), 'd', 20, 6, 6, pg_temp.face(), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- 記録: 空のマス・記録済みのマス・取り消したマス
-- ============================================================

-- When: 射手を省いて空のマスへ記録する
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(1, 'D', 1, 1, 9)))),
  'applied{score,shooter_id}',
  '空のマスへの記録は、射手を省くと実行者を射手として記録し、射手を効いた属性に含める'
);
select is(pg_temp.st('D', 1, 1), '9/E/r1/live', '空のマスへの記録は、そのマスに行を1つ作る');
select is(pg_temp.evst(1), 'RECORDED/score,shooter_id/E/1#1/r1', '履歴はマスと点数・射手を持ち、revisionはマスごとに1から始まる');

-- When: 射手を指定して、記録済みのマスへ重ねる
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(2, 'D', 1, 1, 8, jsonb_build_object('shooter_id', pg_temp.id('V')))))),
  'applied{score,shooter_id}',
  '射手を指定した記録は、射手を効いた属性に含める'
);
select is(pg_temp.st('D', 1, 1) || ' ' || pg_temp.rows('D', 1), '8/V/r2/live 1', '記録済みのマスへの記録は、同じ行を置き換えてrevisionを進める');

-- When: 射手を省いて点数だけを変える
select is(
  pg_temp.res(public.record_shots(jsonb_build_array(pg_temp.rec(3, 'D', 1, 1, 7)))),
  'applied{score}',
  '射手を省いた記録は、点数だけを効いた属性にする'
);
select is(pg_temp.st('D', 1, 1) || ' ' || pg_temp.evst(3), '7/V/r3/live RECORDED/score/V/1#1/r3', '射手を省いた記録は行の射手を変えず、履歴には点数だけを残す');

-- Given: 別の利用者が射手の矢。When: 射手を省いて記録する
select public.record_shots(jsonb_build_array(pg_temp.rec(4, 'D', 1, 2, 10, jsonb_build_object('shooter_id', pg_temp.id('V')))));
select public.record_shots(jsonb_build_array(pg_temp.rec(5, 'D', 1, 2, 6)));
select is(pg_temp.st('D', 1, 2), '6/V/r2/live', '別の利用者を射手にした矢を、射手を含まない記録が書き換えても射手は保たれる');

-- Given: 同じマスへ別のevent_idで後から記録する
select public.record_shots(jsonb_build_array(pg_temp.rec(6, 'D', 2, 1, 9)));
select public.record_shots(jsonb_build_array(pg_temp.rec(7, 'D', 2, 1, 5)));
select is(
  pg_temp.st('D', 2, 1) || ' rows=' || pg_temp.rows('D', 2) || ' events=' || (select count(*) from public.shot_events where distance_id = pg_temp.id('D') and end_number = 2),
  '5/E/r2/live rows=1 events=2',
  '同じマスへ別のevent_idで後から記録すると、後の点数だけが1行に残り、履歴は2件になる'
);

-- Given: 記録したマスを消す。When: 射手を省いて記録する
select public.record_shots(jsonb_build_array(pg_temp.rec(8, 'D', 3, 1, 9, jsonb_build_object('shooter_id', pg_temp.id('V')))));
select public.clear_shots(jsonb_build_array(pg_temp.clr(9, 'D', 3, 1)));
select is(pg_temp.st('D', 3, 1), '9/V/r2/cleared', '消したマスは、行を残したまま取り消し済みにする');
insert into si_r (n, r) values (1, public.record_shots(jsonb_build_array(pg_temp.rec(10, 'D', 3, 1, 10))));
select is(
  pg_temp.res((select r from si_r where n = 1)) || ' ' || pg_temp.st('D', 3, 1),
  'applied{score} 10/V/r3/live',
  '取り消したマスへの記録は、行を生き返らせ、射手を省けば行の射手を引き継ぐ'
);
select is(
  (select disabled_at is null from public.shots where distance_id = pg_temp.id('D') and end_number = 3 and shot_number = 1),
  true,
  '生き返ったマスの取り消しの印は外れる'
);

-- ============================================================
-- 上限: マスの範囲と1マス1行
-- ============================================================

-- When: 射数/エンド3のエンドの全てのマスを埋め、さらに同じマスへ記録する
select public.record_shots(jsonb_build_array(
  pg_temp.rec(20, 'DC', 1, 1, 9), pg_temp.rec(21, 'DC', 1, 2, 9), pg_temp.rec(22, 'DC', 1, 3, 9),
  pg_temp.rec(23, 'DC', 1, 1, 7), pg_temp.rec(24, 'DC', 1, 3, 7)
));
select is(
  pg_temp.live('DC', 1) || ' ' || pg_temp.st('DC', 1, 1) || ' ' || pg_temp.st('DC', 1, 3),
  '3 7/E/r2/live 7/E/r2/live',
  '同じエンドの全てのマスを埋めて重ねて記録しても、生きている矢は射数/エンドの個数を超えず、後の点数に置き換わる'
);

-- When: マスの範囲の境界と的に無い点数を、1つの要求で記録する
insert into si_r (n, r) values (2, public.record_shots(jsonb_build_array(
  pg_temp.rec(30, 'DB', 1, 1, 9),
  pg_temp.rec(31, 'DB', 6, 6, 9),
  pg_temp.rec(32, 'DB', 7, 1, 9),
  pg_temp.rec(33, 'DB', 1, 7, 9),
  pg_temp.rec(34, 'DB', 1, 2, 99)
)));
select is(
  pg_temp.reasons((select r from si_r where n = 2)),
  'applied,applied,UNFIT,UNFIT,UNFIT',
  'エンドが1とエンド数の記録は効き、エンド数+1・番号が射数/エンド+1・的に無い点数の記録は効かない'
);
select is(
  (select count(*) from public.shots where distance_id = pg_temp.id('DB')) || ' ' || pg_temp.events('DB'),
  '2 2',
  '効かなかった記録は、行も履歴も作らない'
);
insert into si_r (n, r) values (3, public.record_shots(jsonb_build_array(pg_temp.rec(35, 'DB', 1, 6, 9), pg_temp.rec(36, 'DB', 6, 1, 9))));
select is(
  pg_temp.reasons((select r from si_r where n = 3)),
  'applied,applied',
  '番号が射数/エンドと同じマスと、エンド数と同じエンドの先頭のマスの記録は効く'
);

-- ============================================================
-- 契約の不一致
-- ============================================================

select is(
  pg_temp.code('record_shots', jsonb_build_array(pg_temp.rec(40, 'DB', 1, 1, 9) - 'shot_number')),
  'PT422',
  'shot_numberの無い記録は契約の不一致で拒否する'
);
select is(
  pg_temp.code('record_shots', jsonb_build_array(pg_temp.rec(41, 'DB', 1, 1, 9) - 'end_number')),
  'PT422',
  'end_numberの無い記録は契約の不一致で拒否する'
);
select is(
  pg_temp.code('record_shots', jsonb_build_array(pg_temp.rec(42, 'DB', 1, 1, 9, '{"shot_number":0}'))) || ','
    || pg_temp.code('record_shots', jsonb_build_array(pg_temp.rec(43, 'DB', 1, 1, 9, '{"shot_number":-1}'))) || ','
    || pg_temp.code('record_shots', jsonb_build_array(pg_temp.rec(44, 'DB', 1, 1, 9, '{"shot_number":1.5}'))) || ','
    || pg_temp.code('record_shots', jsonb_build_array(pg_temp.rec(45, 'DB', 1, 1, 9, '{"shot_number":"1"}'))),
  'PT422,PT422,PT422,PT422',
  '0・負・整数でない・数値でないshot_numberの記録は契約の不一致で拒否する'
);
select is(
  pg_temp.code('record_shots', jsonb_build_array(
    jsonb_build_object('shot_event_id', pg_temp.ev(46), 'shot_id', pg_temp.ev(46), 'distance_id', pg_temp.id('DB'), 'end_number', 1, 'score_str', '9', 'score_int', 9)))
    || ',' || pg_temp.code('clear_shots', jsonb_build_array(
    jsonb_build_object('shot_event_id', pg_temp.ev(47), 'shot_id', pg_temp.ev(46), 'distance_id', pg_temp.id('DB')))),
  'PT422,PT422',
  'shot_idで矢を指しshot_numberが無い要素の記録と取り消しは契約の不一致で拒否する'
);
select is(
  (select count(*) from public.shots where distance_id = pg_temp.id('DB')) || ' ' || pg_temp.events('DB'),
  '4 4',
  '拒否された要求は、行も履歴も増やさない'
);

-- ============================================================
-- 冪等性
-- ============================================================

insert into si_r (n, r) values (4, public.record_shots(jsonb_build_array(pg_temp.rec(50, 'DS', 1, 1, 9))));
select is(
  public.record_shots(jsonb_build_array(pg_temp.rec(50, 'DS', 1, 1, 9))) -> 0,
  (select r -> 0 from si_r where n = 4),
  '同じevent_idの再送は、最初と同じ応答を返す'
);
select is(
  pg_temp.events('DS') || ' ' || pg_temp.st('DS', 1, 1),
  '1 9/E/r1/live',
  '同じevent_idの再送は、履歴もrevisionも増やさない'
);

-- ============================================================
-- クリア
-- ============================================================

select public.record_shots(jsonb_build_array(pg_temp.rec(60, 'DS', 2, 1, 9), pg_temp.rec(61, 'DS', 2, 2, 8)));
select public.clear_shots(jsonb_build_array(pg_temp.clr(62, 'DS', 2, 1)));
select is(
  pg_temp.st('DS', 2, 1) || ' ' || pg_temp.st('DS', 2, 2) || ' ' || pg_temp.evst(62),
  '9/E/r2/cleared 8/E/r1/live CLEARED/-/-/2#1/r2',
  'クリアは、記録済みのマスだけを取り消し済みにして履歴を足し、同じエンドの別のマスは変えない'
);
select is(
  pg_temp.reasons(public.clear_shots(jsonb_build_array(pg_temp.clr(63, 'DS', 3, 1), pg_temp.clr(64, 'DS', 2, 1))))
    || ' ' || pg_temp.events('DS'),
  'MISSING,DISABLED 4',
  '行の無いマスのクリアはMISSING、取り消し済みのマスのクリアはDISABLEDで、履歴を足さない'
);

-- ============================================================
-- 距離の構成の変更
-- ============================================================

-- Given: DSのエンド2のマス2に生きている矢がある。他に、エンド6のマス6にも矢を置く
select public.record_shots(jsonb_build_array(pg_temp.rec(70, 'DS', 6, 6, 9)));

-- When: 全ての矢が収まる構成へ変える
select is(
  public.update_distance(pg_temp.ev(71), pg_temp.id('DS'), jsonb_build_object('config', jsonb_build_object('total_ends', 6, 'arrows_per_end', 6, 'target_face_id', pg_temp.face()))) -> 'applied_fields',
  '["config"]'::jsonb,
  '生きている矢が全て新しい範囲に収まる構成の変更は効く'
);
select is(
  pg_temp.st('DS', 6, 6) || ' ' || pg_temp.st('DS', 2, 2) || ' ' || pg_temp.st('DS', 1, 1),
  '9/E/r1/live 8/E/r1/live 9/E/r1/live',
  '効いた構成の変更の後も、矢はマスも値も変わらない'
);

-- When: 範囲外のマスの生きている矢があるまま、距離(m)と構成を同時に変える
select is(
  public.update_distance(pg_temp.ev(72), pg_temp.id('DS'), jsonb_build_object('distance', 25, 'config', jsonb_build_object('total_ends', 6, 'arrows_per_end', 4, 'target_face_id', pg_temp.face())))
    -> 'rejected_fields',
  '[{"field":"config","reason":"UNFIT"}]'::jsonb,
  '範囲外のマスの生きている矢があれば、構成の変更は効かない'
);
select is(
  (select arrows_per_end || ' ' || distance from public.distances where id = pg_temp.id('DS')),
  '6 25',
  '構成が効かなくても、同じ保存の距離(m)は効く'
);

-- When: 射数/エンドを減らしても、全マスが埋まった距離の範囲外のマスの矢は、数でなくマスで判定される
select is(
  public.update_distance(pg_temp.ev(73), pg_temp.id('DC'), jsonb_build_object('config', jsonb_build_object('total_ends', 6, 'arrows_per_end', 2, 'target_face_id', pg_temp.face())))
    -> 'rejected_fields',
  '[{"field":"config","reason":"UNFIT"}]'::jsonb,
  '全てのマスが埋まった距離の射数/エンドを減らすと、範囲外のマスの生きている矢があるため効かない'
);

-- Given: 範囲外のマスの矢が取り消し済み。When: 構成を狭める
select public.clear_shots(jsonb_build_array(pg_temp.clr(74, 'DS', 6, 6)));
select is(
  public.update_distance(pg_temp.ev(75), pg_temp.id('DS'), jsonb_build_object('config', jsonb_build_object('total_ends', 5, 'arrows_per_end', 6, 'target_face_id', pg_temp.face())))
    -> 'applied_fields',
  '["config"]'::jsonb,
  '範囲外のマスの矢が取り消し済みだけなら、構成の変更は効く'
);

reset role;

-- ============================================================
-- DBの制約
-- ============================================================

select throws_ok(
  format($$insert into public.shots (distance_id, end_number, shot_number, shooter_id, score_str, score_int) values (%L, 4, 0, %L, '9', 9)$$, pg_temp.id('D'), pg_temp.id('E')),
  '23514',
  null,
  'RPCを通らないマスの番号0の挿入はCHECK制約で止まる'
);
select throws_ok(
  format($$insert into public.shots (distance_id, end_number, shot_number, shooter_id, score_str, score_int, disabled_at) values (%L, 1, 1, %L, '9', 9, now())$$, pg_temp.id('D'), pg_temp.id('E')),
  '23505',
  null,
  'RPCを通らない挿入でも、取り消し済みを含めて同じマスの2行目は主キーで止まる'
);
select throws_ok(
  format($$insert into public.shot_events (event_id, distance_id, type, author_id, revision, end_number, shot_number)
    values (gen_random_uuid(), %L, 'CLEARED', %L, 1, 1, 1)$$, pg_temp.id('D'), pg_temp.id('E')),
  '23505',
  null,
  '同じマスの履歴に、同じrevisionは入れられない'
);

select * from finish();

rollback;
