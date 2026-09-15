begin;

select plan(31);

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
  $$update public.preset_rounds set format = 'invalid' where id = '22222222-2222-2222-2222-222222222222'$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.preset_rounds set bow_type = 'invalid' where id = '22222222-2222-2222-2222-222222222222'$$,
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

select is_empty(
  $$update public.preset_rounds set name = 'Hijacked'
    where id = '22222222-2222-2222-2222-222222222222'
    returning id$$,
  '他ユーザーは自分が所有しないプリセットを更新できない（0件更新）'
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

select lives_ok(
  $$delete from public.preset_rounds where id = '22222222-2222-2222-2222-222222222222'$$,
  '所有者は自分のプリセットを削除できる'
);

select results_eq(
  $$select count(*) from public.preset_distances where preset_id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (0::bigint)$$,
  'プリセットの削除で距離構成もカスケード削除される'
);

-- ============================================================
-- save_round_as_preset RPC: 複数テーブルへの書き込みとロールバック
-- ============================================================
-- ラウンド取得・距離取得・プリセット作成・距離複製を1つの関数にまとめ、
-- 途中で失敗した場合に距離を持たない空のプリセットが残らないようにする
-- （アプリ側での手動delete処理が不要になる）。

reset role;

insert into auth.users (id) values ('f0000000-0000-0000-0000-000000000001'); -- editor
insert into auth.users (id) values ('f0000000-0000-0000-0000-000000000002'); -- 非メンバー

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', true);

select create_round(gen_random_uuid(),
  'Save As Preset Round', current_date, 'field', 'compound',
  '[{"id":"f0000000-0000-0000-0000-000000000009","position_key":"000000000001","distance":50,"is_marked":true,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as save_preset_round_id \gset

select create_distance(
  gen_random_uuid(), :'save_preset_round_id', '2',
  null, 4, 6, 'a1000000-0000-0000-0000-000000000001', false
);

select save_round_as_preset(:'save_preset_round_id', 'My Saved Preset') as saved_preset_id \gset

select results_eq(
  $$select name, format, bow_type, owner_id from public.preset_rounds where id = '$$ || :'saved_preset_id' || $$'$$,
  $$values ('My Saved Preset'::text, 'field'::text, 'compound'::text, 'f0000000-0000-0000-0000-000000000001'::uuid)$$,
  'save_round_as_presetでラウンドの内容を引き継いだプリセットが作成される'
);

select results_eq(
  $$select position_key collate "default", distance, is_marked from public.preset_distances
    where preset_id = '$$ || :'saved_preset_id' || $$'
    order by position_key$$,
  $$values ('000000000001'::text, 50::bigint, true), ('2'::text, null::bigint, false)$$,
  'save_round_as_presetでラウンドの距離構成が複製される（is_markedも含む）'
);

-- preset_rounds.name: 50文字までのCHECK制約
select throws_ok(
  $$select save_round_as_preset('$$ || :'save_preset_round_id' || $$', repeat('a', 51))$$,
  '23514',
  null,
  'save_round_as_preset経由でもpreset_rounds.nameが51文字以上だとCHECK制約で拒否される'
);

select lives_ok(
  $$select save_round_as_preset('$$ || :'save_preset_round_id' || $$', repeat('a', 50))$$,
  'preset_rounds.nameが50文字（境界値）なら保存できる'
);

select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$select save_round_as_preset('$$ || :'save_preset_round_id' || $$', 'Hijacked Preset')$$,
  'P0001',
  'ラウンドの取得に失敗しました。',
  '非メンバーが呼び出すとラウンドが見えずエラーになる'
);

select results_eq(
  $$select count(*) from public.preset_rounds where name = 'Hijacked Preset'$$,
  $$values (0::bigint)$$,
  '非メンバーの呼び出しはプリセットを作成しない（ロールバックされる）'
);

select * from finish();

rollback;
