begin;

select plan(9);

select tables_are(
  'public',
  array[
    'distance_events',
    'distances',
    'preset_distances',
    'preset_rounds',
    'round_events',
    'round_users',
    'rounds',
    'shot_events',
    'shots',
    'target_face_rings',
    'target_face_spots',
    'target_faces',
    'users'
  ],
  'publicスキーマのテーブルは想定通りの集合と完全に一致する'
);

select col_is_pk(
  'public', 'shots', array['distance_id', 'end_number', 'arrow_number'],
  'shots は (distance_id, end_number, arrow_number) を主キーとする'
);

insert into auth.users (id)
values ('77777777-7777-7777-7777-777777777777');

select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);

insert into public.rounds (id, name, round_date, format, bow_type)
values ('88888888-8888-8888-8888-888888888888', 'Flexible scores', current_date, 'outdoor', 'recurve');

insert into public.distances
    (id, round_id, position_key, distance, total_ends, arrows_per_end, target_face_id)
  values
    ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', 'a', 70, 1, 1, 'a1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.shots
      (distance_id, end_number, arrow_number, shooter_id, score_str, score_int)
    values
      ('99999999-9999-9999-9999-999999999999', 1, 1,
        '77777777-7777-7777-7777-777777777777', 'bullseye', -1)$$,
  'score_strとscore_intの対応を固定せず、入力ツールの結果を保存できる'
);

select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.round_events'::regclass and tgname = 'set_round_events_updated_at' and not tgisinternal),
  'round_eventsのupdated_atはトリガーで保証される'
);

select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.distance_events'::regclass and tgname = 'set_distance_events_updated_at' and not tgisinternal),
  'distance_eventsのupdated_atはトリガーで保証される'
);

select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.shot_events'::regclass and tgname = 'set_shot_events_updated_at' and not tgisinternal),
  'shot_eventsのupdated_atはトリガーで保証される'
);

select ok(
  (select pg_get_expr(adbin, adrelid) like '%clock_timestamp%'
   from pg_attrdef
   where adrelid = 'public.round_events'::regclass and adnum = 10),
  'round_events.created_atはclock_timestamp()を既定値にする'
);

select ok(
  (select pg_get_expr(adbin, adrelid) like '%clock_timestamp%'
   from pg_attrdef
   where adrelid = 'public.distance_events'::regclass and adnum = 13),
  'distance_events.created_atはclock_timestamp()を既定値にする'
);

select ok(
  (select pg_get_expr(adbin, adrelid) like '%clock_timestamp%'
   from pg_attrdef
   where adrelid = 'public.shot_events'::regclass and adnum = 11),
  'shot_events.created_atはclock_timestamp()を既定値にする'
);

select * from finish();

rollback;
