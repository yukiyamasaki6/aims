begin;

select plan(4);

-- Fixture: user A creates a round with one distance.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');

insert into public.rounds (id, name, round_date)
values ('22222222-2222-2222-2222-222222222222', 'Test Round', current_date);

insert into public.distances (id, round_id, distance_number, distance, total_ends, arrows_per_end)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1, 70, 6, 6);

select lives_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
    values ('33333333-3333-3333-3333-333333333333', 1, 1, '11111111-1111-1111-1111-111111111111', 'X', 10)$$,
  '有効なshotsの挿入は成功する'
);

select throws_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
    values ('33333333-3333-3333-3333-333333333333', 1, 2, '11111111-1111-1111-1111-111111111111', 'X', 5)$$,
  '23514',
  null,
  'score_str=X で score_int<>10 の挿入はCHECK制約で拒否される'
);

select throws_ok(
  $$insert into public.shots (distance_id, end_number, arrow_number, user_id, score_str, score_int)
    values ('33333333-3333-3333-3333-333333333333', 1, 1, '11111111-1111-1111-1111-111111111111', '9', 9)$$,
  '23505',
  null,
  '同一(distance_id, user_id, end_number, arrow_number)の重複挿入は一意制約で拒否される'
);

select results_eq(
  $$select role from public.round_users
    where round_id = '22222222-2222-2222-2222-222222222222'
      and user_id = '11111111-1111-1111-1111-111111111111'$$,
  $$values ('editor'::text)$$,
  'ラウンド作成者がround_usersにeditorとして自動登録される'
);

select * from finish();

rollback;
