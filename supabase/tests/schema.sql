-- 点数の保存の柔軟性を確認する。表はscore_strとscore_intの対応を固定しない。

begin;

select plan(1);

insert into auth.users (id)
values ('77777777-7777-7777-7777-777777777777');

select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);

insert into public.rounds (id, name, round_date, format, bow_type)
values ('88888888-8888-8888-8888-888888888888', 'Flexible scores', current_date, 'outdoor', 'recurve');

insert into public.round_users (round_id, user_id, role, shooter_number)
values ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777', 'owner', 1);

insert into public.distances
    (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
  values
    ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', 'a', 70, 1, 1, 'a1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.shots
      (round_id, distance_id, end_number, shot_number, shooter_number, score_str, score_int)
    values
      ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', 1, 1,
        1, 'bullseye', -1)$$,
  'score_strとscore_intの対応を固定せず、入力ツールの結果を保存できる'
);

select * from finish();

rollback;
