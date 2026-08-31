-- rounds / round_users / distances / shots は、is_round_member/is_round_editor
-- という同じRLSの仕組みで繋がり、create_round RPCが3テーブルへ原子的に
-- 書き込む、切り離せない1つのクラスタとして扱う。

begin;

select plan(63);

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
  $$insert into public.distances (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
    values ('44444444-4444-4444-4444-444444444444', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
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
  $$select create_round(
    'Atomic Round', current_date, 'outdoor', 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  'create_round RPCでround_users・rounds・distancesが原子的に作成される'
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

insert into public.distances (id, round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
values ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
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
  $$insert into public.distances (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
    values ('77777777-7777-7777-7777-777777777777', 2, 50, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '%row-level security%',
  'viewerロールのユーザーはdistancesを追加できない'
);

select throws_like(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
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
-- RLS: editorの正常系操作（更新・削除）
-- ============================================================
-- shotsのupdate_if_editor/delete_if_editorは記録者本人限定ではなく、
-- 「そのラウンドのeditorなら誰でも」という非自明な仕様である点を検証する。

reset role;

insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000001'); -- editor1（記録者）
insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000002'); -- editor2（別のeditor）
insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000003'); -- viewer

insert into public.rounds (id, name, round_date, format, bow_type)
values ('c0000000-0000-0000-0000-000000000010', 'Editor CRUD Round', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role)
values ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', 'editor');
insert into public.round_users (round_id, user_id, role)
values ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000002', 'editor');
insert into public.round_users (round_id, user_id, role)
values ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000003', 'viewer');

insert into public.distances (id, round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
values ('c0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000010', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
values ('c0000000-0000-0000-0000-000000000020', 1, 1, 'c0000000-0000-0000-0000-000000000001', 'X', 10);

set local role authenticated;

-- editor1: 自分のラウンド・距離を更新できる。
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$update public.rounds set name = 'Renamed Round' where id = 'c0000000-0000-0000-0000-000000000010'$$,
  'editorはラウンド名を更新できる'
);
select results_eq(
  $$select name from public.rounds where id = 'c0000000-0000-0000-0000-000000000010'$$,
  $$values ('Renamed Round'::text)$$,
  '更新したラウンド名が反映される'
);

select lives_ok(
  $$update public.distances set arrows_per_end = 3 where id = 'c0000000-0000-0000-0000-000000000020'$$,
  'editorはdistancesを更新できる'
);
select results_eq(
  $$select arrows_per_end from public.distances where id = 'c0000000-0000-0000-0000-000000000020'$$,
  $$values (3::bigint)$$,
  '更新したdistancesの値が反映される'
);

-- editor2: 記録者（editor1）でなくても、同じラウンドのeditorならshotsを更新・削除できる。
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $$update public.shots set score_str = '9', score_int = 9
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1$$,
  '記録者と異なるeditorでも同じラウンドのshotsを更新できる'
);
select results_eq(
  $$select score_str from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1$$,
  $$values ('9'::text)$$,
  '更新したshotsの値が反映される'
);

select lives_ok(
  $$delete from public.shots
    where distance_id = 'c0000000-0000-0000-0000-000000000020' and end_number = 1 and arrow_number = 1$$,
  '記録者と異なるeditorでも同じラウンドのshotsを削除できる'
);
select results_eq(
  $$select count(*) from public.shots where distance_id = 'c0000000-0000-0000-0000-000000000020'$$,
  $$values (0::bigint)$$,
  '削除したshotsが0件になる'
);

-- viewer: round_usersの更新・削除はeditor限定で、viewerはできない（0件更新・0件削除）。
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);

update public.round_users set role = 'editor'
  where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000003';
select results_eq(
  $$select role from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000003'$$,
  $$values ('viewer'::text)$$,
  'viewerはround_usersの自分のロールを更新できない（RLSにより対象行が0件になる）'
);

delete from public.round_users
  where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000002';
select results_eq(
  $$select count(*) from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000002'$$,
  $$values (1::bigint)$$,
  'viewerは他のメンバーをround_usersから削除できない（RLSにより対象行が0件になる）'
);

-- editor1: round_usersの更新・削除、distances/roundsの削除もできる。
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$update public.round_users set role = 'editor'
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000003'$$,
  'editorはround_usersのロールを更新できる'
);
select results_eq(
  $$select role from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000003'$$,
  $$values ('editor'::text)$$,
  '更新したround_usersのロールが反映される'
);

select lives_ok(
  $$delete from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000003'$$,
  'editorはround_usersからメンバーを削除できる'
);
select results_eq(
  $$select count(*) from public.round_users
    where round_id = 'c0000000-0000-0000-0000-000000000010' and user_id = 'c0000000-0000-0000-0000-000000000003'$$,
  $$values (0::bigint)$$,
  '削除したround_usersが0件になる'
);

select lives_ok(
  $$delete from public.distances where id = 'c0000000-0000-0000-0000-000000000020'$$,
  'editorはdistancesを削除できる'
);
select results_eq(
  $$select count(*) from public.distances where id = 'c0000000-0000-0000-0000-000000000020'$$,
  $$values (0::bigint)$$,
  '削除したdistancesが0件になる'
);

select lives_ok(
  $$delete from public.rounds where id = 'c0000000-0000-0000-0000-000000000010'$$,
  'editorは自分のラウンドを削除できる'
);
select results_eq(
  $$select count(*) from public.rounds where id = 'c0000000-0000-0000-0000-000000000010'$$,
  $$values (0::bigint)$$,
  '削除したラウンドが0件になる'
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

select has_column('public', 'rounds', 'format', 'rounds.format カラムが存在する');
select has_column('public', 'rounds', 'bow_type', 'rounds.bow_type カラムが存在する');
select has_column('public', 'distances', 'target_face_id', 'distances.target_face_id カラムが存在する');

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000003', true);

select create_round(
  'Format Test Round', current_date, 'outdoor', 'recurve',
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

select throws_ok(
  $$select create_round(
    'No Format Round', current_date, null, 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23502',
  null,
  'formatを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$select create_round(
    'No Bow Type Round', current_date, 'outdoor', null,
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23502',
  null,
  'bow_typeを省略した作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$select create_round(
    'No Target Face Round', current_date, 'outdoor', 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6}]'::jsonb
  )$$,
  '23502',
  null,
  'target_face_idを省略した距離の作成はNOT NULL制約で拒否される'
);

select throws_ok(
  $$select create_round(
    'Invalid Format Round', current_date, 'invalid_format', 'recurve',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23514',
  null,
  'create_roundに不正なformatを直接渡すとCHECK制約で拒否される'
);

select throws_ok(
  $$select create_round(
    'Invalid Bow Type Round', current_date, 'outdoor', 'invalid_bow_type',
    '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
  )$$,
  '23514',
  null,
  'create_roundに不正なbow_typeを直接渡すとCHECK制約で拒否される'
);

select lives_ok(
  $$select create_round('Empty Distances Round', current_date, 'outdoor', 'recurve', '[]'::jsonb)$$,
  'distancesが空配列でもラウンドを作成できる'
);

select create_round(
  'Multi Distance Round', current_date, 'outdoor', 'recurve',
  '[
    {"distance":90,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"},
    {"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}
  ]'::jsonb
) as multi_round_id \gset

select results_eq(
  $$select distance_number, distance from public.distances
    where round_id = '$$ || :'multi_round_id' || $$'
    order by distance_number$$,
  $$values (1::bigint, 90::bigint), (2::bigint, 70::bigint)$$,
  'create_roundは複数distancesを連番（distance_number）で正しく作成する'
);

-- ============================================================
-- shots: CHECK/一意制約とRLS
-- ============================================================

reset role;

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000004');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000004', true);

select create_round(
  'Shots Constraint Round', current_date, 'outdoor', 'recurve',
  '[{"distance":70,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as shots_round_id \gset

select id as shots_distance_id from public.distances where round_id = :'shots_round_id' \gset

select lives_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
    values ('$$ || :'shots_distance_id' || $$', 1, 1, 'b0000000-0000-0000-0000-000000000004', 'X', 10)$$,
  '有効なshotsの挿入は成功する'
);

select throws_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
    values ('$$ || :'shots_distance_id' || $$', 1, 2, 'b0000000-0000-0000-0000-000000000004', 'X', 5)$$,
  '23514',
  null,
  'score_str=X で score_int<>10 の挿入はCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
    values ('$$ || :'shots_distance_id' || $$', 1, 1, 'b0000000-0000-0000-0000-000000000004', '9', 9)$$,
  '23505',
  null,
  '同一(distance_id, user_id, end_number, arrow_number)の重複挿入は一意制約で拒否される'
);

select lives_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
    values ('$$ || :'shots_distance_id' || $$', 2, 1, 'b0000000-0000-0000-0000-000000000004', 'X', 10)$$,
  'editorロールのユーザーはRLS経由でshotsを記録できる（create_roundの呼び出し者自身がeditorとして書き込む）'
);

-- ============================================================
-- distances.is_marked
-- ============================================================

select has_column('public', 'distances', 'is_marked', 'distances.is_marked カラムが存在する');

reset role;

insert into auth.users (id) values ('b0000000-0000-0000-0000-000000000005');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000005', true);

select create_round(
  'Marked Test Round', current_date, 'field', 'recurve', '[]'::jsonb
) as marked_round_id \gset

insert into public.distances (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
values (:'marked_round_id', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select is_marked from public.distances where round_id = '$$ || :'marked_round_id' || $$' and distance_number = 1$$,
  $$values (true)$$,
  'is_markedを省略すると既定値はtrue'
);

select lives_ok(
  $$insert into public.distances
      (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('$$ || :'marked_round_id' || $$', 2, null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'is_marked=falseならdistanceがnullでも挿入できる（アンマークドで距離不明）'
);

select lives_ok(
  $$insert into public.distances
      (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('$$ || :'marked_round_id' || $$', 3, 55, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'is_marked=falseでもdistanceを持てる（自己目測の記録）'
);

select throws_ok(
  $$insert into public.distances
      (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('$$ || :'marked_round_id' || $$', 4, null, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  '23514',
  null,
  'is_marked=true（既定）でdistanceがnullだとCHECK制約で拒否される'
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

insert into public.distances (id, round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
values ('d0000000-0000-0000-0000-000000000020', 'd0000000-0000-0000-0000-000000000010', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001');

insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
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

select * from finish();

rollback;
