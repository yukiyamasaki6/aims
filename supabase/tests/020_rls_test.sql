begin;

select plan(5);

-- Fixture: user A owns a round. rounds への直接INSERTは create_round RPC経由のみ許可される
-- ため、このフィクスチャは authenticated ロールへ切り替える前（RLS対象外の接続ロール）で
-- 直接INSERTして用意する。
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

insert into public.rounds (id, name, round_date)
values ('44444444-4444-4444-4444-444444444444', 'Private Round', current_date);

insert into public.round_users (round_id, user_id, role)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'editor');

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
  $$insert into public.distances (round_id, distance_number, distance, total_ends, arrows_per_end)
    values ('44444444-4444-4444-4444-444444444444', 1, 70, 6, 6)$$,
  '%row-level security%',
  'round_usersに存在しないユーザーは他人のラウンドにdistancesを追加できない'
);

select throws_like(
  $$insert into public.rounds (name, round_date) values ('direct insert', current_date)$$,
  '%row-level security%',
  'roundsへの直接INSERTはRLSで拒否される（create_round RPC経由のみ許可）'
);

-- create_round RPC: round_usersへの登録をroundsの作成より先に行うことで、
-- rounds作成時のRETURNING（RLSのSELECTポリシー評価を伴う）が正しくround_usersを
-- 参照できる（同一ステートメント内のトリガー副作用とは異なり、別ステートメントとして
-- 先に完了した登録は後続の評価から見える）ことを確認する。
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok(
  $$select create_round('Atomic Round', current_date, '[{"distance":70,"total_ends":6,"arrows_per_end":6}]'::jsonb)$$,
  'create_round RPCでround_users・rounds・distancesが原子的に作成される'
);

select * from finish();

rollback;
