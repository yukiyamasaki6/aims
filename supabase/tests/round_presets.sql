begin;

select plan(28);

select has_table('public', 'round_presets', 'round_presets テーブルが存在する');
select has_table('public', 'round_preset_distances', 'round_preset_distances テーブルが存在する');
select has_column(
  'public', 'round_preset_distances', 'is_marked',
  'round_preset_distances.is_marked カラムが存在する'
);

select results_eq(
  $$select count(*) from public.round_presets where owner_id is null$$,
  $$values (10::bigint)$$,
  'グローバルプリセットが10件シードされている'
);

-- e2e等で個人プリセットが作成され得るため、公式プリセット（owner_id is
-- null）分だけに絞って数える。
select results_eq(
  $$select count(*) from public.round_preset_distances rpd
    join public.round_presets rp on rp.id = rpd.preset_id
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
  $$insert into public.round_presets (id, owner_id, name, format, bow_type)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'My Preset', 'outdoor', 'recurve')$$,
  'ユーザーは自分のowner_idでプリセットを作成できる'
);

select throws_ok(
  $$update public.round_presets set format = 'invalid' where id = '22222222-2222-2222-2222-222222222222'$$,
  '23514',
  null,
  '不正なformatはCHECK制約で拒否される'
);

select throws_ok(
  $$update public.round_presets set bow_type = 'invalid' where id = '22222222-2222-2222-2222-222222222222'$$,
  '23514',
  null,
  '不正なbow_typeはCHECK制約で拒否される'
);

select throws_like(
  $$insert into public.round_presets (owner_id, name, format, bow_type)
    values (null, 'Global attempt', 'outdoor', 'recurve')$$,
  '%row-level security%',
  'クライアントはowner_idをnull（グローバル）にしてプリセットを作成できない'
);

select throws_like(
  $$insert into public.round_presets (owner_id, name, format, bow_type)
    values ('99999999-9999-9999-9999-999999999999', 'Other owner attempt', 'outdoor', 'recurve')$$,
  '%row-level security%',
  'ユーザーは他人のowner_idでプリセットを作成できない'
);

-- User B: 他人の個人的なプリセットも含め、グローバル・個人問わず全て閲覧できる。
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
select results_eq(
  $$select count(*) from public.round_presets where id = '22222222-2222-2222-2222-222222222222'$$,
  $$values (1::bigint)$$,
  '他ユーザーの個人的なプリセットも閲覧できる'
);

-- グローバルなプリセットをキャッシュ可能にするため、未認証（anon）でもグローバル
-- 分だけは閲覧できるようにRLSを緩和する。個人的なプリセットは引き続き閲覧できない。
set local role anon;
select results_eq(
  $$select count(*) from public.round_presets where owner_id is null$$,
  $$values (10::bigint)$$,
  '未認証（anon）でもグローバルなプリセットは閲覧できる'
);

select is_empty(
  $$select id from public.round_presets where id = '22222222-2222-2222-2222-222222222222'$$,
  '未認証（anon）は個人的なプリセットを閲覧できない'
);

select results_eq(
  $$select count(*) from public.round_preset_distances rpd
    join public.round_presets rp on rp.id = rpd.preset_id
    where rp.owner_id is null$$,
  $$values (18::bigint)$$,
  '未認証（anon）でもグローバルなプリセットの距離構成は閲覧できる'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

select throws_like(
  $$insert into public.round_preset_distances (preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
    values ('22222222-2222-2222-2222-222222222222', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '%row-level security%',
  '他ユーザーは自分が所有しないプリセットに距離を追加できない'
);

select is_empty(
  $$update public.round_presets set name = 'Hijacked'
    where id = '22222222-2222-2222-2222-222222222222'
    returning id$$,
  '他ユーザーは自分が所有しないプリセットを更新できない（0件更新）'
);

select is_empty(
  $$delete from public.round_presets
    where id = '22222222-2222-2222-2222-222222222222'
    returning id$$,
  '他ユーザーは自分が所有しないプリセットを削除できない（0件削除）'
);

-- User A: 自分のプリセットに距離を追加でき、削除もできる（子テーブルは親のowner_idに従う）。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$insert into public.round_preset_distances (id, preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
    values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1, 70, 6, 6, 'a1000000-0000-0000-0000-000000000001')$$,
  '所有者は自分のプリセットに距離構成を追加できる'
);

-- round_preset_distances.is_markedの既定値・制約を検証する。
select results_eq(
  $$select is_marked from public.round_preset_distances where id = '33333333-3333-3333-3333-333333333333'$$,
  $$values (true)$$,
  'round_preset_distances.is_markedを省略すると既定値はtrue'
);

select lives_ok(
  $$insert into public.round_preset_distances
      (preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('22222222-2222-2222-2222-222222222222', 2, null, 6, 6, 'a1000000-0000-0000-0000-000000000001', false)$$,
  'round_preset_distancesもis_marked=falseならdistanceがnullでも挿入できる'
);

select throws_ok(
  $$insert into public.round_preset_distances
      (preset_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values
      ('22222222-2222-2222-2222-222222222222', 3, null, 6, 6, 'a1000000-0000-0000-0000-000000000001', true)$$,
  '23514',
  null,
  'round_preset_distancesもis_marked=true（既定）でdistanceがnullだとCHECK制約で拒否される'
);

select lives_ok(
  $$delete from public.round_presets where id = '22222222-2222-2222-2222-222222222222'$$,
  '所有者は自分のプリセットを削除できる'
);

select results_eq(
  $$select count(*) from public.round_preset_distances where preset_id = '22222222-2222-2222-2222-222222222222'$$,
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

select create_round(
  'Save As Preset Round', current_date, 'field', 'compound',
  '[{"distance":50,"total_ends":6,"arrows_per_end":6,"target_face_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb
) as save_preset_round_id \gset

insert into public.distances
    (round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id, is_marked)
  values
    (:'save_preset_round_id', 2, null, 4, 6, 'a1000000-0000-0000-0000-000000000001', false);

select has_function(
  'public', 'save_round_as_preset', array['uuid','text'],
  'save_round_as_preset関数が存在する'
);

select save_round_as_preset(:'save_preset_round_id', 'My Saved Preset') as saved_preset_id \gset

select results_eq(
  $$select name, format, bow_type, owner_id from public.round_presets where id = '$$ || :'saved_preset_id' || $$'$$,
  $$values ('My Saved Preset'::text, 'field'::text, 'compound'::text, 'f0000000-0000-0000-0000-000000000001'::uuid)$$,
  'save_round_as_presetでラウンドの内容を引き継いだプリセットが作成される'
);

select results_eq(
  $$select distance_number, distance, is_marked from public.round_preset_distances
    where preset_id = '$$ || :'saved_preset_id' || $$'
    order by distance_number$$,
  $$values (1::bigint, 50::bigint, true), (2::bigint, null::bigint, false)$$,
  'save_round_as_presetでラウンドの距離構成が複製される（is_markedも含む）'
);

select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$select save_round_as_preset('$$ || :'save_preset_round_id' || $$', 'Hijacked Preset')$$,
  'P0001',
  'ラウンドの取得に失敗しました。',
  '非メンバーが呼び出すとラウンドが見えずエラーになる'
);

select results_eq(
  $$select count(*) from public.round_presets where name = 'Hijacked Preset'$$,
  $$values (0::bigint)$$,
  '非メンバーの呼び出しはプリセットを作成しない（ロールバックされる）'
);

select * from finish();

rollback;
