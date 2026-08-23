begin;

select plan(3);

-- Fixture: user A creates a round (becomes editor via trigger). User B has no relation to it.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into auth.users (id) values ('99999999-9999-9999-9999-999999999999');

insert into public.rounds (id, name, round_date)
values ('44444444-4444-4444-4444-444444444444', 'Private Round', current_date);

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

select * from finish();

rollback;
