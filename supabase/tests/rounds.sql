-- rounds / round_users / distances / shots は、is_round_member/is_round_editor
-- という同じRLSの仕組みで繋がり、create_round RPCが3テーブルへ原子的に
-- 書き込む、切り離せない1つのクラスタとして扱う。

begin;

select plan(105);

-- 既存の制約・権限テスト向けのfixture生成ヘルパー。プロダクションの
-- create_roundはid/position_keyを必須とするため、旧形式の簡潔なfixtureだけを
-- 新しい入力形式へ正規化する。関数自体の契約は下の明示的なcreate_roundテストで
-- 検証する。このテスト用関数は最後のrollbackでDBに残らない。
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
    gen_random_uuid(), p_name, p_round_date, p_format, p_bow_type, distances
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

select throws_like(
  $$insert into public.distances (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values ('44444444-4444-4444-4444-444444444444', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '%row-level security%',
  'round_usersに存在しないユーザーは他人のラウンドにdistancesを追加できない'
);

select throws_like(
  $$insert into public.rounds (name, round_date, format, bow_type)
    values ('direct insert', current_date, 'outdoor', 'recurve')$$,
  '%row-level security%',
  'roundsへの直接INSERTはRLSで拒否される（create_round RPC経由のみ許可）'
);

-- create_round RPC: round_usersへの登録をroundsの作成より先に行うことで、
-- rounds作成時のRETURNING（RLSのSELECTポリシー評価を伴う）が正しくround_usersを
-- 参照できる（同一ステートメント内のトリガー副作用とは異なり、別ステートメントとして
-- 先に完了した登録は後続の評価から見える）ことを確認する。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$select create_test_round('Atomic Round', current_date, 'outdoor', 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  'create_round RPCでround_users・rounds・distancesが原子的に作成される'
);

select results_eq(
  $$select create_round(
      'c0000000-0000-0000-0000-000000000090',
      'Client ID Round', current_date, 'outdoor', 'recurve',
      '[{"id":"c0000000-0000-0000-0000-000000000091","position_key":"m","distance":70,"is_marked":true,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
    )$$,
  $$values ('c0000000-0000-0000-0000-000000000090'::uuid)$$,
  'create_roundはクライアント生成のラウンドIDをそのまま返す'
);

select results_eq(
  $$select id from distances where round_id = 'c0000000-0000-0000-0000-000000000090'$$,
  $$values ('c0000000-0000-0000-0000-000000000091'::uuid)$$,
  'create_roundは初期距離のクライアント生成IDをそのまま保存する'
);

select is(
  (select position_key from distances where id = 'c0000000-0000-0000-0000-000000000091'),
  'm',
  'create_roundは初期距離のクライアント生成position_keyをそのまま保存する'
);

select throws_ok(
  $$select create_round(
      'c0000000-0000-0000-0000-000000000092',
      'Missing Marked State', current_date, 'outdoor', 'recurve',
      '[{"id":"c0000000-0000-0000-0000-000000000093","position_key":"a","distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
    )$$,
  'P0001',
  '初期距離のis_markedは必須です。',
  'create_roundは初期距離のis_marked省略を入力エラーとして拒否する'
);

-- ============================================================
-- RLS: viewerロールの権限境界
-- ============================================================

-- Fixture: user A (editor) owns a round with one distance and one shot.
-- User B is registered as a 'viewer' on the same round.
-- 前セクションのauthenticatedロールをリセットし、フィクスチャ投入用の
-- 接続ロール（RLS対象外）に戻す。
reset role;

insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555');
insert into auth.users (id) values ('66666666-6666-6666-6666-666666666666');
-- どのラウンドにも未参加の第三者。round_usersへの追加自体がRLSで拒否される
-- ことを検証する際、外部キー違反ではなくRLS違反であることを保証するために使う。
insert into auth.users (id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.rounds (id, name, round_date, format, bow_type)
values ('77777777-7777-7777-7777-777777777777', 'Viewer Test Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role)
values ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'editor');
insert into public.round_users (round_id, user_id, role)
values ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'viewer');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
values ('88888888-8888-8888-8888-888888888888', 1, 1, '55555555-5555-5555-5555-555555555555', 'X', 10);

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

-- viewerはis_round_editorを要求する変更系操作を一切実行できない。
-- UPDATE/DELETEはRLSのUSING句で対象行が静かに除外されるだけで例外は
-- 投げられない（0件更新・0件削除になる）ため、throws_likeではなく
-- 実行後に対象が変化していないことを確認する。
update public.rounds set name = 'hacked' where id = '77777777-7777-7777-7777-777777777777';
select results_eq(
  $$select name from public.rounds where id = '77777777-7777-7777-7777-777777777777'$$,
  $$values ('Viewer Test Round'::text)$$,
  'viewerロールのユーザーはラウンド名を更新できない（RLSにより対象行が0件になる）'
);

delete from public.rounds where id = '77777777-7777-7777-7777-777777777777';
select results_eq(
  $$select count(*) from public.rounds where id = '77777777-7777-7777-7777-777777777777'$$,
  $$values (1::bigint)$$,
  'viewerロールのユーザーはラウンドを削除できない（RLSにより対象行が0件になる）'
);

select throws_like(
  $$insert into public.distances (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values ('77777777-7777-7777-7777-777777777777', '2', 50, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '%row-level security%',
  'viewerロールのユーザーはdistancesを追加できない'
);

select throws_like(
  $$insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
    values ('88888888-8888-8888-8888-888888888888', 1, 2, '66666666-6666-6666-6666-666666666666', '9', 9)$$,
  '%row-level security%',
  'viewerロールのユーザーはshotsを記録できない'
);

update public.shots set score_str = '9', score_int = 9
  where distance_id = '88888888-8888-8888-8888-888888888888' and end_number = 1 and arrow_number = 1;
select results_eq(
  $$select score_str from public.shots
    where distance_id = '88888888-8888-8888-8888-888888888888' and end_number = 1 and arrow_number = 1$$,
  $$values ('X'::text)$$,
  'viewerロールのユーザーはshotsを更新できない（RLSにより対象行が0件になる）'
);

delete from public.distances where id = '88888888-8888-8888-8888-888888888888';
select results_eq(
  $$select count(*) from public.distances where id = '88888888-8888-8888-8888-888888888888'$$,
  $$values (1::bigint)$$,
  'viewerロールのユーザーはdistancesを削除できない（RLSにより対象行が0件になる）'
);

-- viewer自身を含め、round_usersへの新規追加（招待相当）もeditor限定である。
select throws_like(
  $$insert into public.round_users (round_id, user_id, role)
    values ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer')$$,
  '%row-level security%',
  'viewerロールのユーザーは他のユーザーをラウンドに追加できない'
);

-- ============================================================
-- issue459: 直接書き込みの拒否（editorであっても）とRPC経由の正常系操作
-- ============================================================
-- rounds/distances/shotsへの変更はSECURITY DEFINER RPC経由に一本化する。
-- round_usersは権限変更・参加者追加をオンラインで即時に扱うため、editorに
-- よる直接INSERT/UPDATE/DELETEを維持する。

reset role;

insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000001'); -- editor1（記録者）
insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000002'); -- editor2（別のeditor）
insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000003'); -- viewer
insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000004'); -- 招待対象

insert into public.rounds (id, name, round_date, format, bow_type)
values ('c0000000-0000-0000-0000-000000000010', 'Editor CRUD Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role)
values ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', 'editor');
insert into public.round_users (round_id, user_id, role)
values ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000002', 'editor');
insert into public.round_users (round_id, user_id, role)
values ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000003', 'viewer');

insert into public.distances (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
values ('c0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000010', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
values ('c0000000-0000-0000-0000-000000000020', 1, 1, 'c0000000-0000-0000-0000-000000000001', 'X', 10);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

update public.rounds set name = 'Direct Update' where id = 'c0000000-0000-0000-0000-000000000010';
select results_eq(
  $$select name from public.rounds where id = 'c0000000-0000-0000-0000-000000000010'$$,
  $$values ('Editor CRUD Round'::text)$$,
  'editorであってもroundsへの直接UPDATEはRLSにより対象行が0件になる'
);

delete from public.rounds where id = 'c0000000-0000-0000-0000-000000000010';
select results_eq(
  $$select count(*) from public.rounds where id = 'c0000000-0000-0000-0000-000000000010'$$,
  $$values (1::bigint)$$,
  'editorであってもroundsへの直接DELETEはRLSにより対象行が0件になる'
);

update public.distances set arrows_per_end = 3 where id = 'c0000000-0000-0000-0000-000000000020';
select results_eq(
  $$select arrows_per_end from public.distances where id = 'c0000000-0000-0000-0000-000000000020'$$,
  $$values (6::bigint)$$,
  'editorであってもdistancesへの直接UPDATEはRLSにより対象行が0件になる'
);

delete from public.distances where id = 'c0000000-0000-0000-0000-000000000020';
select results_eq(
  $$select count(*) from public.distances where id = 'c0000000-0000-0000-0000-000000000020'$$,
  $$values (1::bigint)$$,
  'editorであってもdistancesへの直接DELETEはRLSにより対象行が0件になる'
);

select throws_like(
  $$insert into public.distances (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values ('c0000000-0000-0000-0000-000000000010', '2', 50, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '%row-level security%',
  'editorであってもdistancesへの直接INSERTはRLSで拒否される（create_distance RPC経由のみ許可）'
);

update public.shots set score_str = '9', score_int = 9
  where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1;
select results_eq(
  $$select score_str from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1$$,
  $$values ('X'::text)$$,
  'editorであってもshotsへの直接UPDATEはRLSにより対象行が0件になる'
);

delete from public.shots
  where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1;
select results_eq(
  $$select count(*) from public.shots where distance_id = 'c0000000-0000-0000-0000-000000000020'$$,
  $$values (1::bigint)$$,
  'editorであってもshotsへの直接DELETEはRLSにより対象行が0件になる'
);

select throws_like(
  $$insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
    values ('c0000000-0000-0000-0000-000000000020', 1, 2, 'c0000000-0000-0000-0000-000000000001', '9', 9)$$,
  '%row-level security%',
  'editorであってもshotsへの直接INSERTはRLSで拒否される（record_shots RPC経由のみ許可）'
);

insert into public.round_users (round_id, user_id, role)
values ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000004', 'viewer');
select results_eq(
  $$select role from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000004'$$,
  $$values ('viewer'::text)$$,
  'editorはround_usersへ参加者を追加できる'
);

update public.round_users set role = 'editor'
  where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000004';
select results_eq(
  $$select role from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000004'$$,
  $$values ('editor'::text)$$,
  'editorはround_usersのロールを更新できる'
);

delete from public.round_users
  where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000004';
select results_eq(
  $$select count(*) from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000004'$$,
  $$values (0::bigint)$$,
  'editorはround_usersから参加者を削除できる'
);

-- ------------------------------------------------------------
-- create_distance RPC
-- ------------------------------------------------------------

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select create_distance('c0000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-000000000010', '2', 50, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  'P0001',
  'このラウンドに距離を追加する権限がありません。',
  'viewerはcreate_distance RPCで距離を追加できない'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select create_distance('c0000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-000000000010', '2', 50, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  'editorはcreate_distance RPCで距離を追加できる'
);
select results_eq(
  $$select distance, total_ends, arrows_per_end from public.distances
    where id = 'c0000000-0000-0000-0000-000000000021'$$,
  $$values (50::bigint, 6::bigint, 6::bigint)$$,
  'create_distanceで指定した内容がdistancesに反映される'
);

-- ------------------------------------------------------------
-- record_shots / clear_shots RPC（バッチ・shooter_idのラウンドメンバー検証）
-- ------------------------------------------------------------

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select record_shots('[{"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":2,"arrow_number":1,"score_str":"9","score_int":9}]'::jsonb)$$,
  'P0001',
  'この距離に矢を記録する権限がありません。',
  'viewerはrecord_shots RPCで矢を記録できない'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$select record_shots('[{"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":2,"arrow_number":3,"score_str":"1","score_int":1,"shooter_id":"99999999-9999-9999-9999-999999999999"}]'::jsonb)$$,
  'P0001',
  '指定された射手はこのラウンドのメンバーではありません。',
  'このラウンドのメンバーではないshooter_idを指定するとrecord_shotsは拒否される'
);

select lives_ok(
  $$select record_shots('[
      {"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":1,"arrow_number":1,"score_str":"9","score_int":9},
      {"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":2,"arrow_number":1,"score_str":"7","score_int":7},
      {"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":2,"arrow_number":2,"score_str":"5","score_int":5,"shooter_id":"c0000000-0000-0000-0000-000000000002"}
    ]'::jsonb)$$,
  'editorはrecord_shots RPCで複数件の矢をまとめて記録できる（既存分は上書き）'
);

select results_eq(
  $$select score_str from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1$$,
  $$values ('9'::text)$$,
  '既存(distance_id, end_number, arrow_number)への再記録は上書きされる'
);

select results_eq(
  $$select shooter_id from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 2 and arrow_number = 1$$,
  $$values ('c0000000-0000-0000-0000-000000000001'::uuid)$$,
  'shooter_idを省略するとauth.uid()（実行者本人）が記録される'
);

select results_eq(
  $$select shooter_id from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 2 and arrow_number = 2$$,
  $$values ('c0000000-0000-0000-0000-000000000002'::uuid)$$,
  '同じラウンドのメンバーであれば、実行者と異なるshooter_idを指定して代理記録できる'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select clear_shots('[{"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":2,"arrow_number":1}]'::jsonb)$$,
  'P0001',
  'この距離の矢を取り消す権限がありません。',
  'viewerはclear_shots RPCで矢を取り消せない'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select clear_shots('[
      {"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":2,"arrow_number":1},
      {"distance_id":"c0000000-0000-0000-0000-000000000020","end_number":2,"arrow_number":2}
    ]'::jsonb)$$,
  'editorはclear_shots RPCで複数件の矢をまとめて取り消せる'
);

select results_eq(
  $$select count(*) from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 2$$,
  $$values (0::bigint)$$,
  'clear_shotsで指定した矢が削除される'
);

select results_eq(
  $$select count(*) from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1$$,
  $$values (1::bigint)$$,
  'clear_shotsで指定していない矢は削除されない'
);

-- ------------------------------------------------------------
-- delete_distance / delete_round RPC
-- ------------------------------------------------------------

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select delete_distance('c0000000-0000-0000-0000-000000000021')$$,
  'P0001',
  'この距離を削除する権限がありません。',
  'viewerはdelete_distance RPCで距離を削除できない'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select delete_distance('c0000000-0000-0000-0000-000000000021')$$,
  'editorはdelete_distance RPCで距離を削除できる'
);
select results_eq(
  $$select count(*) from public.distances where id = 'c0000000-0000-0000-0000-000000000021'$$,
  $$values (0::bigint)$$,
  'delete_distanceで削除したdistancesが0件になる'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select delete_round('c0000000-0000-0000-0000-000000000010')$$,
  'P0001',
  'このラウンドを削除する権限がありません。',
  'viewerはdelete_round RPCでラウンドを削除できない'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select delete_round('c0000000-0000-0000-0000-000000000010')$$,
  'editorはdelete_round RPCでラウンドを削除できる'
);
select results_eq(
  $$select count(*) from public.rounds where id = 'c0000000-0000-0000-0000-000000000010'$$,
  $$values (0::bigint)$$,
  'delete_roundで削除したラウンドが0件になる（distances/shots/round_usersもカスケード削除される）'
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
-- create_round RPC: format / bow_type / target_face
-- ============================================================

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true);

select create_test_round('Format Test Round', current_date, 'outdoor', 'recurve',
  '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as round_id \gset

select results_eq(
  $$select format, bow_type from public.rounds where id = '$$ || :'round_id' || $$'$$,
  $$values ('outdoor'::text, 'recurve'::text)$$,
  'create_round経由でrounds.format/bow_typeが保存される'
);

select results_eq(
  $$select target_face_id from public.distances where round_id = '$$ || :'round_id' || $$'$$,
  $$values ('a1000000-0000-0000-0000-000000000001'::uuid)$$,
  'create_round経由でdistances.target_face_idが保存される'
);

select results_eq(
  $$select role from public.round_users where round_id = '$$ || :'round_id' || $$' and user_id = 'b0000000-0000-0000-0000-000000000003'$$,
  $$values ('editor'::text)$$,
  'create_roundは呼び出しユーザーをround_usersにeditorとして登録する'
);

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

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select create_test_round('No Format Round', current_date, null, 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23502',
  null,
  'formatを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$select create_test_round('No Bow Type Round', current_date, 'outdoor', null,
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23502',
  null,
  'bow_typeを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$select create_test_round('No Target Face Round', current_date, 'outdoor', 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6}]'::jsonb
  )$$,
  '23502',
  null,
  'target_face_idを省略した距離の作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$select create_test_round('Invalid Format Round', current_date, 'invalid_format', 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23514',
  null,
  'create_roundに不正なformatを直接渡すとCHECK制約で拒否される'
);

select throws_ok(
  $$select create_test_round('Invalid Bow Type Round', current_date, 'outdoor', 'invalid_bow_type',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23514',
  null,
  'create_roundに不正なbow_typeを直接渡すとCHECK制約で拒否される'
);

select lives_ok(
  $$select create_test_round('Empty Distances Round', current_date, 'outdoor', 'recurve', '[]'::jsonb)$$,
  'distancesが空配列でもラウンドを作成できる'
);

select create_test_round('Multi Distance Round', current_date, 'outdoor', 'recurve',
  '[
    {"distance":90,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"},
    {"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}
  ]'::jsonb
) as multi_round_id \gset

select results_eq(
  $$select position_key collate "default", distance from public.distances
    where round_id = '$$ || :'multi_round_id' || $$'
    order by position_key$$,
  $$values ('000000000001'::text, 90::bigint), ('000000000002'::text, 70::bigint)$$,
  'create_roundは複数distancesをposition_key順で作成する'
);

-- ============================================================
-- rounds.name: 50文字までのCHECK制約
-- ============================================================

select throws_ok(
  $$select create_test_round(repeat('a', 51), current_date, 'outdoor', 'recurve', '[]'::jsonb)$$,
  '23514',
  null,
  'rounds.nameが51文字以上だとCHECK制約で拒否される'
);

select lives_ok(
  $$select create_test_round(repeat('a', 50), current_date, 'outdoor', 'recurve', '[]'::jsonb)$$,
  'rounds.nameが50文字（境界値）なら作成できる'
);

select throws_ok(
  $$select update_round('$$ || :'round_id' || $$', repeat('a', 51), current_date, 'outdoor', 'recurve')$$,
  '23514',
  null,
  'update_round経由でもrounds.nameが51文字以上だとCHECK制約で拒否される'
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

select lives_ok(
  $$select record_shots(jsonb_build_array(jsonb_build_object(
      'distance_id', '$$ || :'shots_distance_id' || $$'::uuid,
      'end_number', 1, 'arrow_number', 1, 'score_str', 'X', 'score_int', 10
    )))$$,
  '有効なshotsの挿入はrecord_shots RPCで成功する'
);

select lives_ok(
  $$select record_shots(jsonb_build_array(jsonb_build_object(
      'distance_id', '$$ || :'shots_distance_id' || $$'::uuid,
      'end_number', 1, 'arrow_number', 2, 'score_str', 'bullseye', 'score_int', -1
    )))$$,
  'score_strとscore_intの対応は固定せず、入力ツールの結果を保存できる'
);

-- record_shotsは同一キーへの再記録をON CONFLICT DO UPDATEで上書きする
-- （通信リトライ時に同じ内容を再送しても失敗しない、意図した冪等性）。
-- そのため生の一意制約（23505）はRLS対象外の接続ロールで直接検証する。
reset role;

select throws_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
    values ('$$ || :'shots_distance_id' || $$', 1, 1, 'b0000000-0000-0000-0000-000000000004', '9', 9)$$,
  '23505',
  null,
  '同一(distance_id, end_number, arrow_number)の重複挿入は一意制約で拒否される'
);

-- 一意制約はshooter_idを含まない（同じ位置の矢は射手によらず1本）。
insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000006');
insert into public.round_users (round_id, user_id, role)
values (:'shots_round_id', 'b0000000-0000-0000-0000-000000000006', 'editor');

select throws_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
    values ('$$ || :'shots_distance_id' || $$', 1, 1, 'b0000000-0000-0000-0000-000000000006', '9', 9)$$,
  '23505',
  null,
  '異なるshooter_idでも同一(distance_id, end_number, arrow_number)の挿入は一意制約で拒否される（shooter_idはキーに含まれない）'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000004', true);

select lives_ok(
  $$select record_shots(jsonb_build_array(jsonb_build_object(
      'distance_id', '$$ || :'shots_distance_id' || $$'::uuid,
      'end_number', 2, 'arrow_number', 1, 'score_str', 'X', 'score_int', 10
    )))$$,
  'editorロールのユーザーはrecord_shots RPC経由でshotsを記録できる（create_roundの呼び出し者自身がeditorとして書き込む）'
);

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

insert into public.shots (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
values ('d0000000-0000-0000-0000-000000000020', 1, 1, 'd0000000-0000-0000-0000-000000000001', 'X', 10);

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
-- update_round RPC: Unmarkedチェックとトランザクション
-- ============================================================
-- チェック（Unmarkedな距離の有無）と更新（rounds）を1つの関数呼び出しに
-- まとめることで、この2つのSupabase呼び出しの間に別クライアントが割り込む
-- 競合状態を防ぐ。

reset role;

insert into auth.users (id) values ('e0000000-0000-0000-0000-000000000001'); -- editor
insert into auth.users (id) values ('e0000000-0000-0000-0000-000000000002'); -- viewer

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);

select create_test_round('Update Config Round', current_date, 'field', 'recurve', '[]'::jsonb
) as update_config_round_id \gset

select create_distance(
  'e0000000-0000-0000-0000-000000000009', :'update_config_round_id', '1',
  null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false
);

reset role;
insert into public.round_users (round_id, user_id, role)
values (:'update_config_round_id', 'e0000000-0000-0000-0000-000000000002', 'viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);

select throws_like(
  $$select update_round('$$ || :'update_config_round_id' || $$', 'Renamed', current_date, 'outdoor', 'recurve')$$,
  '%Unmarked%',
  'Unmarkedな距離が残ったままフィールド以外への変更はエラーになる'
);

select results_eq(
  $$select format from public.rounds where id = '$$ || :'update_config_round_id' || $$'$$,
  $$values ('field'::text)$$,
  'エラー時はformatが変更されない'
);

select lives_ok(
  $$select update_round('$$ || :'update_config_round_id' || $$', 'Field Renamed', current_date, 'field', 'barebow')$$,
  'formatがfieldのままの変更はUnmarkedが残っていても成功する'
);

select results_eq(
  $$select name, bow_type from public.rounds where id = '$$ || :'update_config_round_id' || $$'$$,
  $$values ('Field Renamed'::text, 'barebow'::text)$$,
  'field据え置きの更新内容が反映される'
);

select update_distance('e0000000-0000-0000-0000-000000000009', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select update_round('$$ || :'update_config_round_id' || $$', 'Outdoor Renamed', current_date, 'outdoor', 'recurve')$$,
  'Unmarkedな距離が無ければフィールド以外への変更が成功する'
);

select results_eq(
  $$select name, format, bow_type from public.rounds where id = '$$ || :'update_config_round_id' || $$'$$,
  $$values ('Outdoor Renamed'::text, 'outdoor'::text, 'recurve'::text)$$,
  'Unmarked解消後の更新内容が反映される'
);

select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$select update_round('$$ || :'update_config_round_id' || $$', 'Hacked By Viewer', current_date, 'outdoor', 'recurve')$$,
  'P0001',
  'このラウンドを編集する権限がありません。',
  'viewerがupdate_roundを呼び出すと権限エラーになる'
);

select results_eq(
  $$select name from public.rounds where id = '$$ || :'update_config_round_id' || $$'$$,
  $$values ('Outdoor Renamed'::text)$$,
  'viewerの呼び出しではラウンド名が変更されない'
);

-- ============================================================
-- update_distance RPC: shots件数チェックとトランザクション
-- ============================================================
-- shotsの有無チェックと、その結果に応じて更新対象列を変えるdistancesの
-- 更新を1つの関数呼び出しにまとめることで、この2つのSupabase呼び出しの
-- 間に別クライアントが矢を記録する競合状態を防ぐ。

reset role;

insert into auth.users (id) values ('70000000-0000-0000-0000-000000000001'); -- editor
insert into auth.users (id) values ('70000000-0000-0000-0000-000000000002'); -- viewer

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);

select create_test_round('Update Distance Round', current_date, 'field', 'recurve',
  '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as update_distance_round_id \gset

select id as update_distance_id from public.distances
  where round_id = :'update_distance_round_id' \gset

reset role;
insert into public.round_users (round_id, user_id, role)
values (:'update_distance_round_id', '70000000-0000-0000-0000-000000000002', 'viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select update_distance('$$ || :'update_distance_id' || $$', 50, 3, 3, 'a1000000-0000-0000-0000-000000000002', false)$$,
  'shotsが無い距離は全列を更新できる'
);

select results_eq(
  $$select distance, total_ends, arrows_per_end, target_face_id, is_marked
    from public.distances where id = '$$ || :'update_distance_id' || $$'$$,
  $$values (50::bigint, 3::bigint, 3::bigint, 'a1000000-0000-0000-0000-000000000002'::uuid, false)$$,
  'shotsが無い距離は全列の更新内容が反映される'
);

select throws_ok(
  $$select update_distance('$$ || :'update_distance_id' || $$', 50, 0, 3, 'a1000000-0000-0000-0000-000000000002', false)$$,
  '23514',
  null,
  'update_distance経由でもtotal_ends=0はCHECK制約で拒否される'
);

select record_shots(jsonb_build_array(jsonb_build_object(
  'distance_id', :'update_distance_id', 'end_number', 1, 'arrow_number', 1,
  'score_str', 'X', 'score_int', 10
)));

select throws_ok(
  $$select update_distance('$$ || :'update_distance_id' || $$', 55, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  'P0001',
  '既に得点が記録されているため、エンド数・矢数・的は変更できません。',
  'shotsが存在する距離の構成変更は成功扱いにせず拒否される'
);

select lives_ok(
  $$select update_distance('$$ || :'update_distance_id' || $$', 55, 3, 3, 'a1000000-0000-0000-0000-000000000002', true)$$,
  'shotsが存在する距離でも、構成を変えない距離値・Marked変更はできる'
);

select results_eq(
  $$select distance, total_ends, arrows_per_end, target_face_id, is_marked
    from public.distances where id = '$$ || :'update_distance_id' || $$'$$,
  $$values (55::bigint, 3::bigint, 3::bigint, 'a1000000-0000-0000-0000-000000000002'::uuid, true)$$,
  'shotsが存在する距離はdistance/is_markedのみ更新され、総エンド数・エンドあたりの本数・的は変更されない'
);

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$select update_distance('$$ || :'update_distance_id' || $$', 90, 12, 12, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'P0001',
  'この距離を編集する権限がありません。',
  'viewerがupdate_distanceを呼び出すと権限エラーになる'
);

select results_eq(
  $$select distance, is_marked from public.distances where id = '$$ || :'update_distance_id' || $$'$$,
  $$values (55::bigint, true)$$,
  'viewerの呼び出しでは距離の内容が変更されない'
);

-- ============================================================
-- Unmarked距離はfieldラウンド限定
-- ============================================================
-- UIの選択肢だけに依存せず、書き込みRPCの全入口で種別との整合を保証する。
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select create_test_round('Unmarked Invariant Round', current_date, 'outdoor', 'recurve',
  '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001","is_marked":true}]'::jsonb
) as unmarked_invariant_round_id \gset

select id as unmarked_invariant_distance_id
from public.distances
where round_id = :'unmarked_invariant_round_id' \gset

select throws_ok(
  $$select create_distance('c0000000-0000-0000-0000-000000000022', '$$ || :'unmarked_invariant_round_id' || $$', '2', null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'P0001',
  'Unmarkedの距離はフィールド種別でのみ使用できます。',
  'outdoorラウンドへUnmarked距離を追加できない'
);

select throws_ok(
  $$select update_distance('$$ || :'unmarked_invariant_distance_id' || $$', null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'P0001',
  'Unmarkedの距離はフィールド種別でのみ使用できます。',
  'outdoorラウンドの距離をUnmarkedへ変更できない'
);

select throws_ok(
  $$select create_test_round('Invalid Unmarked Round', current_date, 'outdoor', 'recurve',
      '[{"distance":null,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001","is_marked":false}]'::jsonb
    )$$,
  'P0001',
  'Unmarkedの距離はフィールド種別でのみ使用できます。',
  'outdoorラウンドをUnmarked距離付きで作成できない'
);

-- ============================================================
-- 書き込みRPCの実行権限
-- ============================================================
-- SECURITY DEFINER関数は既定でPUBLICにEXECUTEが付くため、明示的に剥奪する。
-- 認証済みユーザーだけが書き込みRPCを呼べることを確認する。
select ok(
  (
    select bool_and(not has_function_privilege('anon', function_signature, 'execute'))
    from unnest(array[
      'public.create_round(uuid,text,date,text,text,jsonb)'::regprocedure,
      'public.update_round(uuid,text,date,text,text)'::regprocedure,
      'public.update_distance(uuid,bigint,bigint,bigint,uuid,boolean)'::regprocedure,
      'public.create_distance(uuid,uuid,text,bigint,bigint,bigint,uuid,boolean)'::regprocedure,
      'public.delete_round(uuid)'::regprocedure,
      'public.delete_distance(uuid)'::regprocedure,
      'public.record_shots(jsonb)'::regprocedure,
      'public.clear_shots(jsonb)'::regprocedure
    ]) as function_signature
  ),
  'anonは書き込みRPCを実行できない'
);

select ok(
  (
    select bool_and(has_function_privilege('authenticated', function_signature, 'execute'))
    from unnest(array[
      'public.create_round(uuid,text,date,text,text,jsonb)'::regprocedure,
      'public.update_round(uuid,text,date,text,text)'::regprocedure,
      'public.update_distance(uuid,bigint,bigint,bigint,uuid,boolean)'::regprocedure,
      'public.create_distance(uuid,uuid,text,bigint,bigint,bigint,uuid,boolean)'::regprocedure,
      'public.delete_round(uuid)'::regprocedure,
      'public.delete_distance(uuid)'::regprocedure,
      'public.record_shots(jsonb)'::regprocedure,
      'public.clear_shots(jsonb)'::regprocedure
    ]) as function_signature
  ),
  'authenticatedは書き込みRPCを実行できる'
);

select * from finish();

rollback;
