begin;

select plan(3);

select tables_are(
  'public',
  array[
    'distances',
    'round_preset_distances',
    'round_presets',
    'round_users',
    'rounds',
    'shots',
    'target_face_rings',
    'target_face_spots',
    'target_faces',
    'users'
  ],
  'publicスキーマのテーブルは想定通りの集合と完全に一致する'
);

select col_is_unique(
  'public', 'shots', array['distance_id', 'end_number', 'arrow_number'],
  'shots は (distance_id, end_number, arrow_number) で一意'
);

insert into auth.users (id)
values ('77777777-7777-7777-7777-777777777777');

select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);

insert into public.rounds (id, name, round_date, format, bow_type)
values ('88888888-8888-8888-8888-888888888888', 'Flexible scores', current_date, 'outdoor', 'recurve');

insert into public.distances
    (id, round_id, distance_number, distance, total_ends, arrows_per_end, target_face_id)
  values
    ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', 1, 70, 1, 1,
      'a1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.shots
      (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
    values
      ('99999999-9999-9999-9999-999999999999', 1, 1,
        '77777777-7777-7777-7777-777777777777', 'bullseye', -1)$$,
  'score_strとscore_intの対応を固定せず、入力ツールの結果を保存できる'
);

select * from finish();

rollback;
