begin;

select plan(26);

select results_eq(
  $$select count(*) from public.preset_rounds where owner_id is null$$,
  $$values (10::bigint)$$,
  'グローバルプリセットが10件シードされている'
);

-- e2e等で個人プリセットが作成され得るため、公式プリセット（owner_id is
-- null）分だけに絞って数える。
select results_eq(
  $$select count(*) from public.preset_distances rpd
    join public.preset_rounds rp on rp.id = rpd.preset_id
    where rp.owner_id is null$$,
  $$values (18::bigint)$$,
  'シードされたプリセットの距離構成は合計18件'
);

-- Fixture: two users. RLS挙動を確認する。
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

set local role authenticated;

-- User A: 自分のowner_idで個人的なプリセットを作成できる。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$insert into public.preset_rounds (id, owner_id, name, format, bow_type)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'My Preset', 'outdoor', 'recurve')$$,
  'ユーザーは自分のowner_idでプリセットを作成できる'
);

select throws_ok(
  $$insert into public.preset_rounds (owner_id, name, format, bow_type)
    values ('11111111-1111-1111-1111-111111111111', 'Invalid Format', 'invalid', 'recurve')$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.preset_rounds (owner_id, name, format, bow_type)
    values ('11111111-1111-1111-1111-111111111111', 'Invalid Bow Type', 'outdoor', 'invalid')$$,
  '23514',
  null,
  '不正なbow_typeはCHECK制約で拒否される'
);

select throws_like(
  $$insert into public.preset_rounds (owner_id, name, format, bow_type)
    values (null, 'Global attempt', 'outdoor', 'recurve')$$,
  '%row-level security%',
  'クライアントはowner_idをnull（グローバル）にしてプリセットを作成できない'
);

select throws_like(
  $$insert into public.preset_rounds (owner_id, name, format, bow_type)
    values ('99999999-9999-9999-9999-999999999999', 'Other owner attempt', 'outdoor', 'recurve')$$,
  '%row-level security%',
  'ユーザーは他人のowner_idでプリセットを作成できない'
);

-- User B: 他人の個人的なプリセットも含め、グローバル・個人問わず全て閲覧できる。
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
select results_eq(
  $$select count(*) from public.preset_rounds where id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (1::bigint)$$,
  '他ユーザーの個人的なプリセットも閲覧できる'
);

-- このアプリは認証済みユーザーだけが利用するため、未認証では参照できない。
set local role anon;
select throws_ok(
  $$select count(*) from public.preset_rounds where owner_id is null$$,
  '42501',
  null,
  '未認証（anon）はグローバルなプリセットを閲覧できない'
);

select throws_ok(
  $$select id from public.preset_rounds where id = '22222222-2222-2222-2222-222222222222'$$,
  '42501',
  null,
  '未認証（anon）は個人的なプリセットを閲覧できない'
);

select throws_ok(
  $$select count(*) from public.preset_distances rpd
    join public.preset_rounds rp on rp.id = rpd.preset_id
    where rp.owner_id is null$$,
  '42501',
  null,
  '未認証（anon）はグローバルなプリセットの距離構成を閲覧できない'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

select throws_like(
  $$insert into public.preset_distances (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values ('22222222-2222-2222-2222-222222222222', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '%row-level security%',
  '他ユーザーは自分が所有しないプリセットに距離を追加できない'
);

select throws_ok(
  $$update public.preset_rounds set name = 'Hijacked'
    where id = '22222222-2222-2222-2222-222222222222'$$,
  '42501',
  'permission denied for table preset_rounds',
  'プリセットの直接UPDATEはGRANTがなくpermission deniedになる'
);

select is_empty(
  $$delete from public.preset_rounds
    where id = '22222222-2222-2222-2222-222222222222'
    returning id$$,
  '他ユーザーは自分が所有しないプリセットを削除できない（0件削除）'
);

-- User A: 自分のプリセットに距離を追加でき、削除もできる（子テーブルは親のowner_idに従う）。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$insert into public.preset_distances (id, preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '1', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '所有者は自分のプリセットに距離構成を追加できる'
);

-- preset_distances.is_markedの既定値・制約を検証する。
select results_eq(
  $$select is_marked from public.preset_distances where id = '33333333-3333-3333-3333-333333333333'$$,
  $$values (true)$$,
  'preset_distances.is_markedを省略すると既定値はtrue'
);

select lives_ok(
  $$insert into public.preset_distances
      (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('22222222-2222-2222-2222-222222222222', '2', null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'preset_distancesもis_marked=falseならdistanceがnullでも挿入できる'
);

select throws_ok(
  $$insert into public.preset_distances
      (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('22222222-2222-2222-2222-222222222222', '3', null, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  '23514',
  null,
  'preset_distancesもis_marked=true（既定）でdistanceがnullだとCHECK制約で拒否される'
);

-- preset_distances: distance/total_ends/arrows_per_endの1以上の整数CHECK制約
-- （distances側と同じ制約をここでも保証する）。

select throws_ok(
  $$insert into public.preset_distances
      (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('22222222-2222-2222-2222-222222222222', '10', 0, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'preset_distances.distance=0はCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.preset_distances
      (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('22222222-2222-2222-2222-222222222222', '10', 70, 0, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'preset_distances.total_ends=0はCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.preset_distances
      (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('22222222-2222-2222-2222-222222222222', '10', 70, 6, 0, 'a1000000-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'preset_distances.arrows_per_end=0はCHECK制約で拒否される'
);

select lives_ok(
  $$insert into public.preset_distances
      (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('22222222-2222-2222-2222-222222222222', '10', 1, 1, 1, 'a1000000-0000-0000-0000-000000000001')$$,
  'preset_distancesもdistance/total_ends/arrows_per_endが1（境界値）なら挿入できる'
);

select lives_ok(
  $$insert into public.preset_distances
      (preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
    values
      ('22222222-2222-2222-2222-222222222222', '10', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '同一preset_id内でposition_keyが重複しても挿入できる'
);

select throws_ok(
  $$delete from public.preset_distances where id = '33333333-3333-3333-3333-333333333333'$$,
  '42501',
  'permission denied for table preset_distances',
  '親が残っている間は、preset_distancesを直接DELETEできない'
);

select lives_ok(
  $$delete from public.preset_rounds where id = '22222222-2222-2222-2222-222222222222'$$,
  '所有者は自分のプリセットを削除できる'
);

select results_eq(
  $$select count(*) from public.preset_distances where preset_id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (0::bigint)$$,
  'プリセットの削除で距離構成もカスケード削除される（preset_distancesにDELETE権限がなくても外部キーのCASCADEは動く）'
);

select * from finish();

rollback;
