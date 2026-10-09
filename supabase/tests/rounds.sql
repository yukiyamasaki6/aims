-- rounds / round_users / distances / shots は、is_round_memberの
-- SELECTポリシーという同じRLSの仕組みで繋がり、create_round RPCが3テーブルへ原子的に
-- 書き込む、切り離せない1つのクラスタとして扱う。

begin;

select plan(42);

-- 既存の制約・権限テスト向けのfixture生成ヘルパー。プロダクションの
-- create_roundはid/position_keyを必須とするため、旧形式の簡潔なfixtureだけを
-- 新しい入力形式へ正規化する。create_roundの契約はrpc_matrix.sqlで検証する。
-- このテスト用関数は最後のrollbackでDBに残らない。
create function create_test_round(
  p_name text,
  p_round_date date,
  p_format text,
  p_bow_type text,
  p_distances jsonb
) returns uuid
language sql
volatile
as $$
  with normalized_distances as (
    select coalesce(
      jsonb_agg(
        distance || jsonb_build_object(
          'distance_event_id', gen_random_uuid(),
          'id', gen_random_uuid(),
          'position_key', lpad(ordinality::text, 12, '0'),
          'is_marked', coalesce((distance ->> 'is_marked')::boolean, true)
        )
        order by ordinality
      ),
      '[]'::jsonb
    ) as distances
    from jsonb_array_elements(p_distances) with ordinality as items(distance, ordinality)
  )
  select create_round(
    gen_random_uuid(), gen_random_uuid(), p_name, p_round_date, p_format, p_bow_type, distances
  )
  from normalized_distances;
$$;

-- ============================================================
-- RLS: editor / 非メンバー
-- ============================================================

-- Fixture: user A owns a round. rounds への直接INSERTは create_round RPC経由のみ許可される
-- ため、このフィクスチャは authenticated ロールへ切り替える前（RLS対象外の接続ロール）で
-- 直接INSERTして用意する。
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('44444444-4444-4444-4444-444444444444', 'Private Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'editor');

select throws_ok(
  $$insert into public.round_users (round_id, user_id, role)
    values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'viewer')$$,
  '23505',
  null,
  '同一(round_id, user_id)の重複登録は一意制約で拒否される'
);

set local role authenticated;

-- Acting as user A (member/editor): the round is visible.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select results_eq(
  $$select count(*) from public.rounds where id = '44444444-4444-4444-4444-444444444444'$$,
  $$values (1::bigint)$$,
  'ラウンド作成者（editor）には自分のラウンドが見える'
);

-- Acting as user B (not a member): the round is hidden by RLS.
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
select results_eq(
  $$select count(*) from public.rounds where id = '44444444-4444-4444-4444-444444444444'$$,
  $$values (0::bigint)$$,
  'round_usersに存在しないユーザーにはラウンドが見えない'
);

-- ============================================================
-- RLS: viewerロールの閲覧
-- ============================================================
-- viewerの書き込み拒否はrls_matrix.sql（直接の書き込み）とrpc_matrix.sql（RPC）で固定する。

-- Fixture: user A (editor) owns a round with one distance and one shot.
-- User B is registered as a 'viewer' on the same round.
-- 前セクションのauthenticatedロールをリセットし、フィクスチャ投入用の
-- 接続ロール（RLS対象外）に戻す。
reset role;

insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555');
insert into auth.users (id) values ('66666666-6666-6666-6666-666666666666');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('77777777-7777-7777-7777-777777777777', 'Viewer Test Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role)
values ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'editor');
insert into public.round_users (round_id, user_id, role)
values ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'viewer');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int)
values ('88888888-8888-8888-8888-888888888888', 1, '55555555-5555-5555-5555-555555555555', 'X', 10);

set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);

-- viewerはis_round_member経由でSELECTできる（閲覧のみ許可）。
select results_eq(
  $$select count(*) from public.rounds where id = '77777777-7777-7777-7777-777777777777'$$,
  $$values (1::bigint)$$,
  'viewerロールのユーザーはラウンドを閲覧できる'
);

select results_eq(
  $$select count(*) from public.distances where round_id = '77777777-7777-7777-7777-777777777777'$$,
  $$values (1::bigint)$$,
  'viewerロールのユーザーはdistancesを閲覧できる'
);

select results_eq(
  $$select count(*) from public.shots where distance_id = '88888888-8888-8888-8888-888888888888'$$,
  $$values (1::bigint)$$,
  'viewerロールのユーザーはshotsを閲覧できる'
);

-- ============================================================
-- round_users.role のCHECK制約
-- ============================================================

reset role;

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000001');
insert into public.rounds (id, name, round_date, format, bow_type)
values ('b0000000-0000-0000-0000-000000000002', 'Role Check Round', current_date, 'outdoor', 'recurve');

select throws_ok(
  $$insert into public.round_users (round_id, user_id, role)
    values ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'admin')$$,
  '23514',
  null,
  'round_users.roleは''editor''/''viewer''以外はCHECK制約で拒否される'
);

-- ============================================================
-- rounds / distances: format / bow_type / target_faceのCHECK・外部キー制約
-- ============================================================

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true);

select create_test_round('Format Test Round', current_date, 'outdoor', 'recurve',
  '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as round_id \gset

-- rounds/distancesへの直接UPDATEはRLSで拒否されるため、ここではRLS対象外の
-- 接続ロールに戻し、CHECK/FK制約そのものの検証に限定する。
reset role;

select throws_ok(
  $$update public.rounds set format = 'invalid' where id = '$$ || :'round_id' || $$'$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.rounds set bow_type = 'invalid' where id = '$$ || :'round_id' || $$'$$,
  '23514',
  null,
  '不正なbow_typeはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.distances set target_face_id = '00000000-0000-0000-0000-000000000000'
    where round_id = '$$ || :'round_id' || $$'$$,
  '23503',
  null,
  '存在しないtarget_face_idは外部キー制約で拒否される'
);

-- ============================================================
-- shots: CHECK/一意制約とRLS
-- ============================================================

reset role;

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000004');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000004', true);

select create_test_round('Shots Constraint Round', current_date, 'outdoor', 'recurve',
  '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as shots_round_id \gset

select id as shots_distance_id from public.distances where round_id = :'shots_round_id' \gset

select results_eq(
  $$select record_shots(jsonb_build_array(jsonb_build_object(
      'shot_event_id', gen_random_uuid(), 'shot_id', gen_random_uuid(), 'distance_id', '$$ || :'shots_distance_id' || $$'::uuid,
      'end_number', 1, 'score_str', 'bullseye', 'score_int', -1
    ))) -> 0 ->> 'reason'$$,
  $$values ('UNFIT'::text)$$,
  '的に無い点数はUNFITで効かず、矢として記録されない'
);

-- 以降の一意制約テストが、1エンド目に矢b0000000-...-0000000000a1がある状態を前提とする。
select record_shots(jsonb_build_array(jsonb_build_object(
  'shot_event_id', gen_random_uuid(), 'shot_id', 'b0000000-0000-0000-0000-0000000000a1'::uuid, 'distance_id', :'shots_distance_id'::uuid,
  'end_number', 1, 'score_str', 'X', 'score_int', 10
)));

-- record_shotsは同じ矢IDへの再記録を更新として扱うため、生の主キー制約（23505）はRLS対象外の接続ロールで直接検証する。
reset role;

select throws_ok(
  $$insert into public.shots (id, distance_id, end_number, shooter_id, score_str, score_int)
    values ('b0000000-0000-0000-0000-0000000000a1', '$$ || :'shots_distance_id' || $$', 1, 'b0000000-0000-0000-0000-000000000004', '9', 9)$$,
  '23505',
  null,
  '同じ矢IDの重複挿入は主キーで拒否される'
);

-- 同じエンドの矢は位置で識別しないため、別の矢IDなら同じエンドに並ぶ。
select lives_ok(
  $$insert into public.shots (id, distance_id, end_number, shooter_id, score_str, score_int)
    values ('b0000000-0000-0000-0000-0000000000a2', '$$ || :'shots_distance_id' || $$', 1, 'b0000000-0000-0000-0000-000000000004', 'X', 10)$$,
  '同じエンドに、同じ点数・同じ射手の別の矢を記録できる'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000004', true);

-- ============================================================
-- distances.is_marked
-- ============================================================

reset role;

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000005');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000005', true);

select create_test_round('Marked Test Round', current_date, 'field', 'recurve', '[]'::jsonb
) as marked_round_id \gset

-- 以降はdistancesのCHECK制約そのものの検証であり、RLS/RPCの権限とは無関係
-- なため、RLS対象外の接続ロールに戻して直接INSERTで検証する。
reset role;

insert into public.distances (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values (:'marked_round_id', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select is_marked from public.distances where round_id = '$$ || :'marked_round_id' || $$' and position_key = '1'$$,
  $$values (true)$$,
  'is_markedを省略すると既定値はtrue'
);

select lives_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('$$ || :'marked_round_id' || $$', '2', null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'is_marked=falseならdistanceがnullでも挿入できる（アンマークドで距離不明）'
);

select lives_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('$$ || :'marked_round_id' || $$', '3', 55, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'is_marked=falseでもdistanceを持てる（自己目測の記録）'
);

select throws_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('$$ || :'marked_round_id' || $$', '4', null, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  '23514',
  null,
  'is_marked=true（既定）でdistanceがnullだとCHECK制約で拒否される'
);

-- ============================================================
-- distances: distance/total_ends/arrows_per_endの1以上の整数CHECK制約
-- ============================================================

select throws_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('$$ || :'marked_round_id' || $$', '10', 0, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'distance=0はCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('$$ || :'marked_round_id' || $$', '10', 70, 0, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'total_ends=0はCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('$$ || :'marked_round_id' || $$', '10', 70, 6, 0, 'a1000000-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'arrows_per_end=0はCHECK制約で拒否される'
);

select lives_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('$$ || :'marked_round_id' || $$', '10', 1, 1, 1, 'a1000000-0000-0000-0000-000000000001')$$,
  'distance/total_ends/arrows_per_endが1（境界値）なら挿入できる'
);

-- ============================================================
-- distances: position_keyの同値を許容し、idで表示順を確定できる
-- ============================================================

select lives_ok(
  $$insert into public.distances
      (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('$$ || :'marked_round_id' || $$', '10', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '同一round_id内でposition_keyが重複しても挿入できる'
);

-- ============================================================
-- カスケード削除: rounds → distances/shots/round_users
-- ============================================================

reset role;

insert into auth.users (id) values ('d0000000-0000-0000-0000-000000000001');
insert into auth.users (id) values ('d0000000-0000-0000-0000-000000000002');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('d0000000-0000-0000-0000-000000000010', 'Cascade Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role)
values ('d0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000001', 'editor');
insert into public.round_users (round_id, user_id, role)
values ('d0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000002', 'viewer');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values ('d0000000-0000-0000-0000-000000000020', 'd0000000-0000-0000-0000-000000000010', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, shooter_id, score_str, score_int)
values ('d0000000-0000-0000-0000-000000000020', 1, 'd0000000-0000-0000-0000-000000000001', 'X', 10);

delete from public.rounds where id = 'd0000000-0000-0000-0000-000000000010';

select results_eq(
  $$select count(*) from public.distances where round_id = 'd0000000-0000-0000-0000-000000000010'$$,
  $$values (0::bigint)$$,
  'ラウンド削除でdistancesがカスケード削除される'
);

select results_eq(
  $$select count(*) from public.shots where distance_id = 'd0000000-0000-0000-0000-000000000020'$$,
  $$values (0::bigint)$$,
  'ラウンド削除でshotsもカスケード削除される（distances経由の多段カスケード）'
);

select results_eq(
  $$select count(*) from public.round_users where round_id = 'd0000000-0000-0000-0000-000000000010'$$,
  $$values (0::bigint)$$,
  'ラウンド削除でround_usersもカスケード削除される'
);

-- ============================================================
-- issue460: イベントログ（round_events/distance_events/shot_events）
-- ============================================================

reset role;

insert into auth.users (id) values ('90000000-0000-0000-0000-000000000001'); -- editor

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);

select create_round(
  '90000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000011',
  'Event Log Round', current_date, 'outdoor', 'recurve',
  '[{"distance_event_id":"90000000-0000-0000-0000-000000000012","id":"90000000-0000-0000-0000-000000000013","position_key":"a","distance":70,"is_marked":true,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
);

select results_eq(
  $$select type, revision, name from round_events where round_id = '90000000-0000-0000-0000-000000000011'$$,
  $$values ('CREATED'::text, 1::bigint, 'Event Log Round'::text)$$,
  'create_roundはround_eventsにCREATED・revision=1のイベントを記録する'
);

select results_eq(
  $$select revision from rounds where id = '90000000-0000-0000-0000-000000000011'$$,
  $$values (1::bigint)$$,
  '射影(rounds)のrevisionはイベントのrevisionと一致する'
);

select results_eq(
  $$select type, revision, position_key from distance_events where distance_id = '90000000-0000-0000-0000-000000000013'$$,
  $$values ('CREATED'::text, 1::bigint, 'a'::text)$$,
  'create_roundは初期距離についてdistance_eventsにCREATED・revision=1のイベントを記録する'
);

select update_round(
  '90000000-0000-0000-0000-000000000014', '90000000-0000-0000-0000-000000000011',
  '{"name":"Renamed Event Log Round"}'::jsonb
);

select results_eq(
  $$select revision, type from round_events where round_id = '90000000-0000-0000-0000-000000000011' order by revision$$,
  $$values (1::bigint, 'CREATED'::text), (2::bigint, 'UPDATED'::text)$$,
  'round_eventsはCREATED→UPDATEDの順でrevisionが確定する'
);

select record_shots(jsonb_build_array(jsonb_build_object(
  'shot_event_id', '90000000-0000-0000-0000-000000000015',
  'shot_id', '90000000-0000-0000-0000-0000000000a1',
  'distance_id', '90000000-0000-0000-0000-000000000013',
  'end_number', 1, 'score_str', 'X', 'score_int', 10
)));

select results_eq(
  $$select type, revision from shot_events where event_id = '90000000-0000-0000-0000-000000000015'$$,
  $$values ('RECORDED'::text, 1::bigint)$$,
  'record_shotsはshot_eventsにRECORDED・revision=1のイベントを記録する'
);

select clear_shots(jsonb_build_array(jsonb_build_object(
  'shot_event_id', '90000000-0000-0000-0000-000000000016',
  'shot_id', '90000000-0000-0000-0000-0000000000a1',
  'distance_id', '90000000-0000-0000-0000-000000000013'
)));

select results_eq(
  $$select type, revision from shot_events where event_id = '90000000-0000-0000-0000-000000000016'$$,
  $$values ('CLEARED'::text, 2::bigint)$$,
  'clear_shotsは同じ矢のrevisionを2に進めてCLEAREDイベントを記録する'
);

select results_eq(
  $$select revision, (disabled_at is not null) from shots
    where id = '90000000-0000-0000-0000-0000000000a1'$$,
  $$values (2::bigint, true)$$,
  'clear_shots後の射影(shots)はrevision=2・disabled_at設定済みになる（物理削除ではない）'
);

select record_shots(jsonb_build_array(jsonb_build_object(
  'shot_event_id', '90000000-0000-0000-0000-000000000017',
  'shot_id', '90000000-0000-0000-0000-0000000000a1',
  'distance_id', '90000000-0000-0000-0000-000000000013',
  'end_number', 1, 'score_str', '9', 'score_int', 9
)));

select results_eq(
  $$select revision, disabled_at, score_str from shots
    where id = '90000000-0000-0000-0000-0000000000a1'$$,
  $$values (3::bigint, null::timestamptz, '9'::text)$$,
  '取消済みの矢への再記録はdisabled_atを解除しrevisionを進める'
);

select disable_round('90000000-0000-0000-0000-000000000018', '90000000-0000-0000-0000-000000000011');

-- 削除済みのラウンドへの後続の操作は、効かない操作として応答で返し、記録しない。
select results_eq(
  $$select update_round(gen_random_uuid(), '90000000-0000-0000-0000-000000000011', '{"name":"x"}'::jsonb) ->> 'reason'$$,
  $$values ('DISABLED'::text)$$,
  '削除済みのラウンドへの更新はDISABLEDで効かない'
);

select results_eq(
  $$select create_distance(gen_random_uuid(), gen_random_uuid(), '90000000-0000-0000-0000-000000000011', 'z', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', true) ->> 'reason'$$,
  $$values ('DISABLED'::text)$$,
  '削除済みのラウンドへの距離追加はDISABLEDで効かない'
);

select results_eq(
  $$select record_shots(jsonb_build_array(jsonb_build_object('shot_event_id', gen_random_uuid(), 'shot_id', gen_random_uuid(), 'distance_id', '90000000-0000-0000-0000-000000000013', 'end_number', 2, 'score_str', 'X', 'score_int', 10))) -> 0 ->> 'reason'$$,
  $$values ('DISABLED'::text)$$,
  '削除済みのラウンド配下への矢記録はDISABLEDで効かない'
);

select results_eq(
  $$select (select count(*) from round_events where round_id = '90000000-0000-0000-0000-000000000011'),
           (select max(revision) from round_events where round_id = '90000000-0000-0000-0000-000000000011'),
           (select revision from rounds where id = '90000000-0000-0000-0000-000000000011'),
           (select count(*) from distance_events where round_id = '90000000-0000-0000-0000-000000000011'),
           (select count(*) from shot_events where distance_id = '90000000-0000-0000-0000-000000000013' and end_number = 2)$$,
  $$values (3::bigint, 3::bigint, 3::bigint, 1::bigint, 0::bigint)$$,
  '削除済みのラウンドへの後続の操作は、イベントも射影のrevisionも進めない'
);

-- 削除済みの距離への後続の操作も、効かない操作として返し、記録しない。
select create_round(
  '90000000-0000-0000-0000-000000000020', '90000000-0000-0000-0000-000000000021',
  'Disable Distance Round', current_date, 'outdoor', 'recurve',
  '[{"distance_event_id":"90000000-0000-0000-0000-000000000022","id":"90000000-0000-0000-0000-000000000023","position_key":"a","distance":70,"is_marked":true,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"},
    {"distance_event_id":"90000000-0000-0000-0000-000000000027","id":"90000000-0000-0000-0000-000000000028","position_key":"b","distance":50,"is_marked":true,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
);

select disable_distance('90000000-0000-0000-0000-000000000024', '90000000-0000-0000-0000-000000000023');

select results_eq(
  $$select update_distance(gen_random_uuid(), '90000000-0000-0000-0000-000000000023', '{"distance":60}'::jsonb) ->> 'reason'$$,
  $$values ('DISABLED'::text)$$,
  '削除済みの距離への更新はDISABLEDで効かない'
);

select results_eq(
  $$select record_shots(jsonb_build_array(jsonb_build_object('shot_event_id', gen_random_uuid(), 'shot_id', gen_random_uuid(), 'distance_id', '90000000-0000-0000-0000-000000000023', 'end_number', 1, 'score_str', 'X', 'score_int', 10))) -> 0 ->> 'reason'$$,
  $$values ('DISABLED'::text)$$,
  '削除済みの距離への矢記録はDISABLEDで効かない'
);

select results_eq(
  $$select disabled_at is not null, revision, (select count(*) from distance_events where distance_id = '90000000-0000-0000-0000-000000000023'), (select count(*) from shot_events where distance_id = '90000000-0000-0000-0000-000000000023')
    from distances where id = '90000000-0000-0000-0000-000000000023'$$,
  $$values (true, 2::bigint, 2::bigint, 0::bigint)$$,
  '削除済みの距離への後続の操作は、削除を維持し、イベントも射影のrevisionも進めない'
);

-- 存在しない矢への取り消しは効かない操作として返し、記録しない。
select results_eq(
  $$select (r -> 0 ->> 'reason') || '/' || (r -> 0 ->> 'applied') || '/' || (select count(*) from shot_events where event_id = '90000000-0000-0000-0000-000000000025')
    from clear_shots(jsonb_build_array(jsonb_build_object('shot_event_id', '90000000-0000-0000-0000-000000000025', 'shot_id', '90000000-0000-0000-0000-0000000000a3', 'distance_id', '90000000-0000-0000-0000-000000000028'))) as r$$,
  $$values ('MISSING/false/0'::text)$$,
  '存在しない矢への取り消しはMISSINGで効かず、記録されない'
);

select record_shots(jsonb_build_array(jsonb_build_object('shot_event_id', '90000000-0000-0000-0000-000000000026', 'shot_id', '90000000-0000-0000-0000-0000000000a2', 'distance_id', '90000000-0000-0000-0000-000000000028', 'end_number', 6, 'score_str', 'X', 'score_int', 10)));

select clear_shots(jsonb_build_array(jsonb_build_object('shot_event_id', '90000000-0000-0000-0000-000000000029', 'shot_id', '90000000-0000-0000-0000-0000000000a2', 'distance_id', '90000000-0000-0000-0000-000000000028')));

select record_shots(jsonb_build_array(jsonb_build_object('shot_event_id', '90000000-0000-0000-0000-00000000002a', 'shot_id', '90000000-0000-0000-0000-0000000000a2', 'distance_id', '90000000-0000-0000-0000-000000000028', 'end_number', 6, 'score_str', '9', 'score_int', 9)));

select results_eq(
  $$select type, revision, end_number from shot_events where shot_id = '90000000-0000-0000-0000-0000000000a2' order by revision$$,
  $$values ('RECORDED'::text, 1::bigint, 6::bigint), ('CLEARED'::text, 2::bigint, 6::bigint), ('RECORDED'::text, 3::bigint, 6::bigint)$$,
  '記録・取り消し・再記録は矢ごとの順序を保って追記され、取り消しにも行のエンドを写す'
);

select * from finish();

rollback;
