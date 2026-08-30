begin;

select plan(8);

-- Fixture: user A (editor) owns a round with one distance and one shot.
-- User B is registered as a 'viewer' on the same round.
-- rounds/round_users/distances/shots への直接INSERTは create_round RPC経由
-- 以外RLSで拒否されるため、このフィクスチャは authenticated ロールへ切り替える
-- 前（RLS対象外の接続ロール）で直接INSERTして用意する。
insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555');
insert into auth.users (id) values ('66666666-6666-6666-6666-666666666666');
-- どのラウンドにも未参加の第三者。round_usersへの追加自体がRLSで拒否される
-- ことを検証する際、外部キー違反ではなくRLS違反であることを保証するために使う。
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

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

delete from public.distances where id = '88888888-8888-8888-8888-888888888888';
select results_eq(
  $$select count(*) from public.distances where id = '88888888-8888-8888-8888-888888888888'$$,
  $$values (1::bigint)$$,
  'viewerロールのユーザーはdistancesを削除できない（RLSにより対象行が0件になる）'
);

-- viewer自身を含め、round_usersへの新規追加（招待相当）もeditor限定である。
select throws_like(
  $$insert into public.round_users (round_id, user_id, role)
    values ('77777777-7777-7777-7777-777777777777', '99999999-9999-9999-9999-999999999999', 'viewer')$$,
  '%row-level security%',
  'viewerロールのユーザーは他のユーザーをラウンドに追加できない'
);

select * from finish();

rollback;
