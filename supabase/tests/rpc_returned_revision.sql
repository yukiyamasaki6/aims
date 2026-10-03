-- 書き込みRPCが、確定した対象のrevisionを返すことと、重複したevent_idの再送の扱いを確認する。
--   - 7つのRPCの返り値（新規はrevision、重複の再送は既存のイベントのrevision）
--   - record_shots/clear_shotsは、入力の順のbigint[]を返す
--   - 確定済みのevent_idの再送は、状態に依存する検証より先に判定し、拒否せず既存のrevisionを返す
--   - 権限のない呼び出しは、確定済みのevent_idでも拒否される
-- 呼び出しの権限と入力の検証はrpc_matrix.sqlで固定している。

begin;

select plan(31);

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

create function pg_temp.shot(p_n int, p_distance text, p_end int, p_arrow int, p_score int default null) returns jsonb
language sql stable
as $$
  select case when p_score is null
    then jsonb_build_object('shot_event_id', pg_temp.ev(p_n), 'distance_id', pg_temp.id(p_distance), 'end_number', p_end, 'arrow_number', p_arrow)
    else jsonb_build_object('shot_event_id', pg_temp.ev(p_n), 'distance_id', pg_temp.id(p_distance), 'end_number', p_end, 'arrow_number', p_arrow, 'score_str', p_score::text, 'score_int', p_score)
  end
$$;

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
  public.update_round(pg_temp.ev(1), pg_temp.id('R1'), 'Rev Outdoor 2', '2026-01-02', 'outdoor', 'recurve'),
  2::bigint,
  'update_roundは確定したラウンドのrevisionを返す'
);
select is(
  public.update_round(pg_temp.ev(1), pg_temp.id('R1'), 'Rev Outdoor 2', '2026-01-02', 'outdoor', 'recurve'),
  2::bigint,
  'update_roundの同じevent_idの再送は既存のrevisionを返す'
);
select is(
  (select revision from public.rounds where id = pg_temp.id('R1')) || '/' || (select count(*) from public.round_events where round_id = pg_temp.id('R1')),
  '2/1',
  'update_roundの再送は射影もイベントも増やさない'
);

select is(
  public.create_distance(pg_temp.ev(2), pg_temp.id('DN'), pg_temp.id('R1'), 'c', 30, 4, 3, pg_temp.face(), true),
  1::bigint,
  'create_distanceは1を返す'
);
select is(
  public.create_distance(pg_temp.ev(2), pg_temp.id('DN'), pg_temp.id('R1'), 'c', 30, 4, 3, pg_temp.face(), true),
  1::bigint,
  'create_distanceの再送は既存のrevisionを返す'
);
select is(
  (select count(*) from public.distance_events where distance_id = pg_temp.id('DN')),
  1::bigint,
  'create_distanceの再送はイベントを増やさない'
);

select is(
  public.update_distance(pg_temp.ev(3), pg_temp.id('DN'), 35, 4, 3, pg_temp.face(), true),
  2::bigint,
  'update_distanceは確定した距離のrevisionを返す'
);
select is(
  public.update_distance(pg_temp.ev(3), pg_temp.id('DN'), 35, 4, 3, pg_temp.face(), true),
  2::bigint,
  'update_distanceの再送は既存のrevisionを返す'
);

select is(
  public.disable_distance(pg_temp.ev(4), pg_temp.id('DN')),
  3::bigint,
  'disable_distanceは確定した距離のrevisionを返す'
);
select is(
  public.disable_distance(pg_temp.ev(4), pg_temp.id('DN')),
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
  public.record_shots(jsonb_build_array(pg_temp.shot(10, 'D2', 1, 1, 9), pg_temp.shot(11, 'D2', 1, 2, 8))),
  array[1, 1]::bigint[],
  'record_shotsは入力の順にイベントごとのrevisionを返す'
);
select is(
  public.record_shots(jsonb_build_array(pg_temp.shot(12, 'D2', 2, 1, 7), pg_temp.shot(13, 'D2', 2, 1, 6))),
  array[1, 2]::bigint[],
  'record_shotsは同じマスが配列に複数あればrevisionを増やして返す'
);
select is(
  public.record_shots(jsonb_build_array(pg_temp.shot(10, 'D2', 1, 1, 9), pg_temp.shot(14, 'D2', 1, 3, 5), pg_temp.shot(13, 'D2', 2, 1, 6))),
  array[1, 1, 2]::bigint[],
  'record_shotsは新規と重複が混ざる配列で各要素のrevisionを返す'
);
select is(
  (select count(*) from public.shot_events where distance_id = pg_temp.id('D2')),
  5::bigint,
  'record_shotsの重複の要素はイベントを増やさない'
);
select is(
  public.clear_shots(jsonb_build_array(pg_temp.shot(15, 'D2', 1, 1), pg_temp.shot(16, 'D2', 1, 1))),
  array[2, 3]::bigint[],
  'clear_shotsは同じマスが配列に複数あればrevisionを増やして返す'
);
select is(
  public.clear_shots(jsonb_build_array(pg_temp.shot(15, 'D2', 1, 1), pg_temp.shot(17, 'D2', 4, 4))),
  array[2, 1]::bigint[],
  'clear_shotsは重複の要素に既存のrevisionを、行の無いマスに1を返す'
);
select is(
  (select revision || '/' || (disabled_at is not null)::text from public.shots where distance_id = pg_temp.id('D2') and end_number = 1 and arrow_number = 1),
  '3/true',
  '取り消した矢の行は、disabled_atと取り消しのrevisionを持つ'
);
select is(
  public.record_shots('[]'::jsonb),
  '{}'::bigint[],
  'record_shotsは空の配列に空の配列を返す'
);

-- ============================================================
-- 重複の判定が、状態に依存する検証より先に行われる
-- ============================================================
-- update_distance: 矢のない距離の構成を変える更新を確定し、矢を記録した後に再送する。
select is(
  public.update_distance(pg_temp.ev(20), pg_temp.id('D1'), 70, 4, 6, pg_temp.face(), true),
  2::bigint,
  '準備: 構成を変えるupdate_distanceが確定する'
);
select is(
  public.record_shots(jsonb_build_array(pg_temp.shot(21, 'D1', 1, 1, 9))),
  array[1]::bigint[],
  '準備: その距離へ矢を記録する'
);
select is(
  public.update_distance(pg_temp.ev(20), pg_temp.id('D1'), 70, 4, 6, pg_temp.face(), true),
  2::bigint,
  'update_distance: 矢の記録後でも、確定済みのevent_idの再送は拒否されず既存のrevisionを返す'
);
select throws_ok(
  format($$select public.update_distance(%L, %L, 70, 5, 6, %L, true)$$, pg_temp.ev(22), pg_temp.id('D1'), pg_temp.face()),
  'P0001',
  '既に得点が記録されているため、エンド数・矢数・的は変更できません。',
  'update_distance: 新しいevent_idで構成を変える更新は、矢の記録後は拒否される'
);

-- update_round: 種別を変える更新を確定し、フィールドへ戻してUnmarkedの距離を作った後に再送する。
select is(
  public.update_round(pg_temp.ev(30), pg_temp.id('R2'), 'Rev Field', '2026-01-01', 'outdoor', 'recurve'),
  2::bigint,
  '準備: 種別を変えるupdate_roundが確定する'
);
select is(
  public.update_round(pg_temp.ev(31), pg_temp.id('R2'), 'Rev Field', '2026-01-01', 'field', 'recurve'),
  3::bigint,
  '準備: フィールドへ戻す'
);
select is(
  public.create_distance(pg_temp.ev(32), pg_temp.id('D3'), pg_temp.id('R2'), 'a', null, 6, 6, pg_temp.face(), false),
  1::bigint,
  '準備: Unmarkedの距離を作る'
);
select is(
  public.update_round(pg_temp.ev(30), pg_temp.id('R2'), 'Rev Field', '2026-01-01', 'outdoor', 'recurve'),
  2::bigint,
  'update_round: Unmarkedの距離が作られた後でも、確定済みのevent_idの再送は拒否されず既存のrevisionを返す'
);

-- create_distance: Unmarkedの距離の作成を確定し、種別を変えた後に再送する。
select is(
  public.disable_distance(pg_temp.ev(33), pg_temp.id('D3')),
  2::bigint,
  '準備: Unmarkedの距離を無効化して、種別を変えられるようにする'
);
select is(
  public.update_round(pg_temp.ev(34), pg_temp.id('R2'), 'Rev Field', '2026-01-01', 'outdoor', 'recurve'),
  4::bigint,
  '準備: フィールド以外へ変更する'
);
select is(
  public.create_distance(pg_temp.ev(32), pg_temp.id('D3'), pg_temp.id('R2'), 'a', null, 6, 6, pg_temp.face(), false),
  1::bigint,
  'create_distance: 種別の変更後でも、確定済みのevent_idの再送は拒否されず既存のrevisionを返す'
);

-- 権限のない呼び出しは、確定済みのevent_idでも拒否される。
select set_config('request.jwt.claim.sub', pg_temp.id('N')::text, true);
select throws_ok(
  format($$select public.update_round(%L, %L, 'Rev Outdoor 2', '2026-01-02', 'outdoor', 'recurve')$$, pg_temp.ev(1), pg_temp.id('R1')),
  'P0001',
  'このラウンドを編集する権限がありません。',
  '権限のない呼び出しは、確定済みのevent_idでも拒否される'
);

select * from finish();

rollback;
