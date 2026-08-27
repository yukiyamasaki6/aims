begin;

select plan(17);

select has_table('public', 'target_faces', 'target_faces テーブルが存在する');
select has_table('public', 'target_face_spots', 'target_face_spots テーブルが存在する');
select has_table('public', 'target_face_rings', 'target_face_rings テーブルが存在する');

-- Seed data: グローバル的（owner_id is null）が投入されている。
select results_eq(
  $$select count(*) from public.target_faces where owner_id is null$$,
  $$values (13::bigint)$$,
  'グローバル的が13件シードされている'
);

select results_eq(
  $$select count(*) from public.target_face_spots s
    join public.target_faces tf on tf.id = s.target_face_id
    where tf.name = '6点的（インドア・40cm・3つ目トライアングル）'$$,
  $$values (3::bigint)$$,
  '3つ目の的は3つのスポットを持つ'
);

select results_eq(
  $$select count(*) from public.target_face_rings$$,
  $$values (159::bigint)$$,
  'シードされた的の点数帯は合計159件'
);

select results_eq(
  $$select count(*) from public.target_face_rings where line_color is null$$,
  $$values (27::bigint)$$,
  '境界線なしのリングが存在する'
);

-- Fixture: two users. RLS挙動を確認する。
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

set local role authenticated;

-- User A: 自分のowner_idで個人的な的を作成できる。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$insert into public.target_faces (id, owner_id, name)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'My Target')$$,
  'ユーザーは自分のowner_idで的を作成できる'
);

select throws_like(
  $$insert into public.target_faces (owner_id, name) values (null, 'Global attempt')$$,
  '%row-level security%',
  'クライアントはowner_idをnull（グローバル）にして的を作成できない'
);

select throws_like(
  $$insert into public.target_faces (owner_id, name)
    values ('99999999-9999-9999-9999-999999999999', 'Other owner attempt')$$,
  '%row-level security%',
  'ユーザーは他人のowner_idで的を作成できない'
);

-- User B: 他人の個人的な的も含め、グローバル・個人問わず全て閲覧できる。
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
select results_eq(
  $$select count(*) from public.target_faces where id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (1::bigint)$$,
  '他ユーザーの個人的な的も閲覧できる'
);

select throws_like(
  $$insert into public.target_face_spots (target_face_id, center_x, center_y)
    values ('22222222-2222-2222-2222-222222222222', 0, 0)$$,
  '%row-level security%',
  '他ユーザーは自分が所有しない的にスポットを追加できない'
);

select is_empty(
  $$update public.target_faces set name = 'Hijacked'
    where id = '22222222-2222-2222-2222-222222222222'
    returning id$$,
  '他ユーザーは自分が所有しない的を更新できない（0件更新）'
);

-- User A: 自分の的にスポット・点数帯を追加でき、削除もできる（子テーブルは親のowner_idに従う）。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$insert into public.target_face_spots (id, target_face_id, center_x, center_y)
    values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 0, 0)$$,
  '所有者は自分の的にスポットを追加できる'
);

select lives_ok(
  $$insert into public.target_face_rings (spot_id, radius, color, line_color, z_index, score_str, score_int)
    values ('33333333-3333-3333-3333-333333333333', 6.1, '#FFE552', null, 1, '10', 10)$$,
  '所有者は自分の的のスポットに点数帯を追加できる（境界線なしも許容される）'
);

select lives_ok(
  $$delete from public.target_faces where id = '22222222-2222-2222-2222-222222222222'$$,
  '所有者は自分の的を削除できる'
);

select results_eq(
  $$select count(*) from public.target_face_spots where target_face_id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (0::bigint)$$,
  '的の削除でスポット・点数帯もカスケード削除される'
);

select * from finish();

rollback;
