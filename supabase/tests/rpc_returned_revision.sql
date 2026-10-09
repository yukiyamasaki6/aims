-- 書き込みRPCが、確定した対象のrevisionを返すことと、重複したevent_idの再送の扱いを確認する。
--   - 書き込みRPCの返り値（新規は確定したrevision、重複の再送は既存のイベントのrevision）
--   - record_shots/clear_shotsは、入力の順の要素ごとの結果（revisionを含む）の配列を返す
--   - 確定済みのevent_idの再送は、規則の判定より先に行い、効いた項目を同じ形で返す
--   - 権限のない呼び出しは、確定済みのevent_idでも拒否される
-- 呼び出しの権限と入力の検証はrpc_matrix.sqlで固定している。

begin;

select plan(32);

create temp table rv_id (alias text primary key, id uuid not null);
insert into rv_id (alias, id) values
  ('E',   'd0000000-0000-0000-0000-000000000001'),
  ('N',   'd0000000-0000-0000-0000-000000000002'),
  ('R1',  'd0000000-0000-0000-0000-000000000010'),
  ('R2',  'd0000000-0000-0000-0000-000000000011'),
  ('D1',  'd0000000-0000-0000-0000-000000000021'),
  ('D2',  'd0000000-0000-0000-0000-000000000022'),
  ('D3',  'd0000000-0000-0000-0000-000000000023'),
  ('DN',  'd0000000-0000-0000-0000-000000000024');

grant select on rv_id to authenticated;

create function pg_temp.id(p_alias text) returns uuid
language sql stable
as $$ select id from rv_id where alias = p_alias $$;

-- イベントIDは呼び出しごとに連番で払い出す。
create function pg_temp.ev(p_n int) returns uuid
language sql immutable
as $$ select ('d0000000-0000-0000-0000-0000000e' || lpad(p_n::text, 4, '0'))::uuid $$;

create function pg_temp.face() returns uuid
language sql stable
as $$ select id from public.target_faces order by id limit 1 $$;

-- 矢のIDは番号から作る。
create function pg_temp.shot_id(p_shot int) returns uuid
language sql immutable
as $$ select ('d0000000-0000-0000-0000-0000000a' || lpad(p_shot::text, 4, '0'))::uuid $$;

-- 点数が無ければクリアの要素を作る。
create function pg_temp.shot(p_n int, p_distance text, p_end int, p_shot int, p_score int default null) returns jsonb
language sql stable
as $$
  select case when p_score is null
    then jsonb_build_object('shot_event_id', pg_temp.ev(p_n), 'shot_id', pg_temp.shot_id(p_shot), 'distance_id', pg_temp.id(p_distance))
    else jsonb_build_object('shot_event_id', pg_temp.ev(p_n), 'shot_id', pg_temp.shot_id(p_shot), 'distance_id', pg_temp.id(p_distance), 'end_number', p_end, 'score_str', p_score::text, 'score_int', p_score)
  end
$$;

-- 応答のrevisionの列。
create function pg_temp.revs(p_results jsonb) returns bigint[]
language sql stable
as $$
  select coalesce(array_agg((e ->> 'revision')::bigint order by ord), '{}'::bigint[])
  from jsonb_array_elements(p_results) with ordinality as t(e, ord)
$$;

create function pg_temp.rev(p_result jsonb) returns bigint
language sql immutable
as $$ select (p_result ->> 'revision')::bigint $$;

insert into auth.users (id) values (pg_temp.id('E')), (pg_temp.id('N'));

-- R1: outdoor。D1は矢なし、D2は矢あり。R2: field。
insert into public.rounds (id, name, round_date, format, bow_type) values
  (pg_temp.id('R1'), 'Rev Outdoor', '2026-01-01', 'outdoor', 'recurve'),
  (pg_temp.id('R2'), 'Rev Field', '2026-01-01', 'field', 'recurve');
insert into public.round_users (round_id, user_id, role) values
  (pg_temp.id('R1'), pg_temp.id('E'), 'editor'),
  (pg_temp.id('R2'), pg_temp.id('E'), 'editor');
insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked) values
  (pg_temp.id('D1'), pg_temp.id('R1'), 'a', 70, 6, 6, pg_temp.face(), true),
  (pg_temp.id('D2'), pg_temp.id('R1'), 'b', 50, 6, 6, pg_temp.face(), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('E')::text, true);

-- ============================================================
-- 返り値: ラウンド・距離
-- ============================================================
select is(
  pg_temp.rev(public.update_round(pg_temp.ev(1), pg_temp.id('R1'), '{"name":"Rev Outdoor 2","round_date":"2026-01-02"}'::jsonb)),
  2::bigint,
  'update_roundは確定したラウンドのrevisionを返す'
);
select is(
  public.update_round(pg_temp.ev(1), pg_temp.id('R1'), '{"name":"Rev Outdoor 2","round_date":"2026-01-02"}'::jsonb),
  '{"revision":2,"applied":true,"applied_fields":["name","round_date"],"rejected_fields":[],"reason":null}'::jsonb,
  'update_roundの同じevent_idの再送は、既存のrevisionと効いた項目を返す'
);
select is(
  (select revision from public.rounds where id = pg_temp.id('R1')) || '/' || (select count(*) from public.round_events where round_id = pg_temp.id('R1')),
  '2/1',
  'update_roundの再送は射影もイベントも増やさない'
);

select is(
  pg_temp.rev(public.create_distance(pg_temp.ev(2), pg_temp.id('DN'), pg_temp.id('R1'), 'c', 30, 4, 3, pg_temp.face(), true)),
  1::bigint,
  'create_distanceは1を返す'
);
select is(
  pg_temp.rev(public.create_distance(pg_temp.ev(2), pg_temp.id('DN'), pg_temp.id('R1'), 'c', 30, 4, 3, pg_temp.face(), true)),
  1::bigint,
  'create_distanceの再送は既存のrevisionを返す'
);
select is(
  (select count(*) from public.distance_events where distance_id = pg_temp.id('DN')),
  1::bigint,
  'create_distanceの再送はイベントを増やさない'
);

select is(
  pg_temp.rev(public.update_distance(pg_temp.ev(3), pg_temp.id('DN'), '{"distance":35}'::jsonb)),
  2::bigint,
  'update_distanceは確定した距離のrevisionを返す'
);
select is(
  public.update_distance(pg_temp.ev(3), pg_temp.id('DN'), '{"distance":35}'::jsonb),
  '{"revision":2,"applied":true,"applied_fields":["distance"],"rejected_fields":[],"reason":null}'::jsonb,
  'update_distanceの再送は、既存のrevisionと効いた項目を返す'
);

select is(
  pg_temp.rev(public.disable_distance(pg_temp.ev(4), pg_temp.id('DN'))),
  3::bigint,
  'disable_distanceは確定した距離のrevisionを返す'
);
select is(
  pg_temp.rev(public.disable_distance(pg_temp.ev(4), pg_temp.id('DN'))),
  3::bigint,
  'disable_distanceの再送は既存のrevisionを返す'
);
select is(
  (select revision || '/' || (select count(*) from public.distance_events where distance_id = pg_temp.id('DN')) from public.distances where id = pg_temp.id('DN')),
  '3/3',
  'disable_distanceの再送は射影もイベントも増やさない'
);

-- ============================================================
-- 返り値: 矢
-- ============================================================
select is(
  pg_temp.revs(public.record_shots(jsonb_build_array(pg_temp.shot(10, 'D2', 1, 1, 9), pg_temp.shot(11, 'D2', 1, 2, 8)))),
  array[1, 1]::bigint[],
  'record_shotsは入力の順にイベントごとのrevisionを返す'
);
select is(
  pg_temp.revs(public.record_shots(jsonb_build_array(pg_temp.shot(12, 'D2', 2, 21, 7), pg_temp.shot(13, 'D2', 2, 21, 6)))),
  array[1, 2]::bigint[],
  'record_shotsは同じ矢が配列に複数あればrevisionを増やして返す'
);
select is(
  pg_temp.revs(public.record_shots(jsonb_build_array(pg_temp.shot(10, 'D2', 1, 1, 9), pg_temp.shot(14, 'D2', 1, 3, 5), pg_temp.shot(13, 'D2', 2, 21, 6)))),
  array[1, 1, 2]::bigint[],
  'record_shotsは新規と重複が混ざる配列で各要素のrevisionを返す'
);
select is(
  (select count(*) from public.shot_events where distance_id = pg_temp.id('D2')),
  5::bigint,
  'record_shotsの重複の要素はイベントを増やさない'
);
select is(
  pg_temp.revs(public.clear_shots(jsonb_build_array(pg_temp.shot(15, 'D2', 1, 1), pg_temp.shot(16, 'D2', 1, 1)))),
  array[2, 3]::bigint[],
  'clear_shotsは同じ矢が配列に複数あればrevisionを増やして返す'
);
select is(
  pg_temp.revs(public.clear_shots(jsonb_build_array(pg_temp.shot(15, 'D2', 1, 1), pg_temp.shot(17, 'D2', 4, 44)))),
  array[2, null]::bigint[],
  'clear_shotsは重複の要素に既存のrevisionを、存在しない矢にrevisionの無い結果を返す'
);
select is(
  (select revision || '/' || (disabled_at is not null)::text from public.shots where id = pg_temp.shot_id(1)),
  '3/true',
  '取り消した矢の行は、disabled_atと取り消しのrevisionを持つ'
);
select is(
  public.record_shots('[]'::jsonb),
  '[]'::jsonb,
  'record_shotsは空の配列に空の配列を返す'
);

-- ============================================================
-- 重複の判定が、規則の判定より先に行われる
-- ============================================================
-- update_distance: 矢のない距離の構成を変える更新を確定し、矢を記録した後に再送する。
select is(
  pg_temp.rev(public.update_distance(pg_temp.ev(20), pg_temp.id('D1'), jsonb_build_object('config', jsonb_build_object('total_ends', 4, 'arrows_per_end', 6, 'target_face_id', pg_temp.face())))),
  2::bigint,
  '準備: 構成を変えるupdate_distanceが確定する'
);
select is(
  pg_temp.revs(public.record_shots(jsonb_build_array(pg_temp.shot(21, 'D1', 4, 31, 9)))),
  array[1]::bigint[],
  '準備: その距離の4エンド目へ矢を記録する'
);
select is(
  public.update_distance(pg_temp.ev(20), pg_temp.id('D1'), jsonb_build_object('config', jsonb_build_object('total_ends', 4, 'arrows_per_end', 6, 'target_face_id', pg_temp.face()))),
  '{"revision":2,"applied":true,"applied_fields":["config"],"rejected_fields":[],"reason":null}'::jsonb,
  'update_distance: 矢の記録後でも、確定済みのevent_idの再送は効かないと判定されず既存のrevisionを返す'
);
select is(
  public.update_distance(pg_temp.ev(22), pg_temp.id('D1'), jsonb_build_object('config', jsonb_build_object('total_ends', 3, 'arrows_per_end', 6, 'target_face_id', pg_temp.face()))),
  '{"revision":null,"applied":false,"applied_fields":[],"rejected_fields":[{"field":"config","reason":"UNFIT"}],"reason":null}'::jsonb,
  'update_distance: 新しいevent_idで矢が無効になる構成へ変える更新は、UNFITで効かない'
);
select is(
  (select revision || '/' || (select count(*) from public.distance_events where event_id = pg_temp.ev(22)) from public.distances where id = pg_temp.id('D1')),
  '2/0',
  'update_distance: 効かなかった更新は、イベントも射影のrevisionも進めない'
);

-- update_round: 種別を変える更新を確定し、フィールドへ戻してUnmarkedの距離を作った後に再送する。
select is(
  pg_temp.rev(public.update_round(pg_temp.ev(30), pg_temp.id('R2'), '{"format":"outdoor"}'::jsonb)),
  2::bigint,
  '準備: 種別を変えるupdate_roundが確定する'
);
select is(
  pg_temp.rev(public.update_round(pg_temp.ev(31), pg_temp.id('R2'), '{"format":"field"}'::jsonb)),
  3::bigint,
  '準備: フィールドへ戻す'
);
select is(
  pg_temp.rev(public.create_distance(pg_temp.ev(32), pg_temp.id('D3'), pg_temp.id('R2'), 'a', null, 6, 6, pg_temp.face(), false)),
  1::bigint,
  '準備: Unmarkedの距離を作る'
);
select is(
  pg_temp.rev(public.update_round(pg_temp.ev(30), pg_temp.id('R2'), '{"format":"outdoor"}'::jsonb)),
  2::bigint,
  'update_round: Unmarkedの距離が作られた後でも、確定済みのevent_idの再送は効かないと判定されず既存のrevisionを返す'
);

-- create_distance: Unmarkedの距離の作成を確定し、種別を変えた後に再送する。
select is(
  pg_temp.rev(public.disable_distance(pg_temp.ev(33), pg_temp.id('D3'))),
  2::bigint,
  '準備: Unmarkedの距離を無効化して、種別を変えられるようにする'
);
select is(
  pg_temp.rev(public.update_round(pg_temp.ev(34), pg_temp.id('R2'), '{"format":"outdoor"}'::jsonb)),
  4::bigint,
  '準備: フィールド以外へ変更する'
);
select is(
  pg_temp.rev(public.create_distance(pg_temp.ev(32), pg_temp.id('D3'), pg_temp.id('R2'), 'a', null, 6, 6, pg_temp.face(), false)),
  1::bigint,
  'create_distance: 種別の変更後でも、確定済みのevent_idの再送は効かないと判定されず既存のrevisionを返す'
);

-- 権限のない呼び出しは、確定済みのevent_idでも拒否される。
select set_config('request.jwt.claim.sub', pg_temp.id('N')::text, true);
select throws_ok(
  format($$select public.update_round(%L, %L, '{"name":"Rev Outdoor 2"}'::jsonb)$$, pg_temp.ev(1), pg_temp.id('R1')),
  'PT403',
  'このラウンドを編集する権限がありません。',
  '権限のない呼び出しは、確定済みのevent_idでも拒否される'
);

select * from finish();

rollback;
